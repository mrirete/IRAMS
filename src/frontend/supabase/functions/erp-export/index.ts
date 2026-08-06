// Supabase Edge Function: erp-export
// ────────────────────────────────────────────────────────────────────────────
// The night in "nightly file exchange" (Tier 1, docs/ERP-Integration-Design.md
// §9 tiering). Runs at 04:30 UTC from pg_cron (0279), settles anything a day's
// work left unposted, builds yesterday's canonical batch PER TENANT, renders
// it through the same FileEmitter the interactive panel uses, and drops the
// CSVs into the private `erp-exports` bucket under <company_id>/<date>/ for
// the customer's middleware to collect.
//
// TENANT DISCIPLINE — the part that makes this function dangerous to edit.
// This runs as service_role, which RLS waves through. Every query below
// carries an explicit .eq('company_id', …); remove one and that tenant's
// export quietly contains every tenant's documents. The browser-side
// ErpExportService has no such filters because RLS scopes it invisibly —
// do not "align" the two by deleting these.
//
// The lib/ folder is a byte-for-byte copy of src/lib/erp (Deno needs .ts
// extensions on imports; the app's bundler forbids them). A vitest drift
// test asserts the copies match — edit src/lib/erp and re-copy, never edit
// lib/ directly.
//
// Auth mirrors specialist-watchdog: the x-cron-key header must equal the
// BRIEFING_CRON_KEY function secret (one shared cron key per project).
// A body of {"date": "YYYY-MM-DD"} exports that day instead of yesterday —
// which is also the re-run story: same date, same document_ids, same paths,
// upsert overwrite. A failed night is fixed by calling it again.
//
// Deploy: supabase functions deploy erp-export --no-verify-jwt
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import {
    mapCostPosting, mapGoodsMovement, mapGoodsReceipt, mapSupplierInvoice,
    type Mapped,
} from './lib/mapToCanonical.ts';
import type { CanonicalBatch, CanonicalDocument, SkippedDocument } from './lib/canonical.ts';
import { FileEmitter, batchToFiles } from './lib/emitters.ts';

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

const collect = <T extends CanonicalDocument>(
    results: Mapped<T>[], documents: CanonicalDocument[], skipped: SkippedDocument[],
): void => {
    for (const r of results) {
        if ('doc' in r) documents.push(r.doc);
        else skipped.push(r.skipped);
    }
};

/** Yesterday's date in UTC — the day that has ended everywhere. */
const yesterdayUtc = (): string =>
    new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

async function buildCompanyBatch(
    sb: SupabaseClient, companyId: string, currency: string, day: string,
): Promise<CanonicalBatch> {
    const documents: CanonicalDocument[] = [];
    const skipped: SkippedDocument[] = [];
    const endOfDay = `${day}T23:59:59.999Z`;

    const costs = await sb
        .from('cost_allocations')
        .select('*, work_orders(wo_number), assets(tag), cost_centers(code, gl_account)')
        .eq('company_id', companyId)
        .gte('posting_date', day)
        .lte('posting_date', day);
    if (costs.error) throw new Error(`cost postings: ${costs.error.message}`);
    collect((costs.data ?? []).map((r) => mapCostPosting(r, currency)), documents, skipped);

    const movements = await sb
        .from('sem_stock_movements')
        .select('*')
        .eq('company_id', companyId)
        .gte('moved_at', day)
        .lte('moved_at', endOfDay);
    if (movements.error) throw new Error(`goods movements: ${movements.error.message}`);
    collect((movements.data ?? []).map(mapGoodsMovement), documents, skipped);

    const receipts = await sb
        .from('goods_receipts')
        .select('*, purchase_orders(po_code), purchase_order_lines(line_no), inventory_items(material_number, part_number)')
        .eq('company_id', companyId)
        .gte('received_date', day)
        .lte('received_date', day);
    if (receipts.error) throw new Error(`goods receipts: ${receipts.error.message}`);
    collect((receipts.data ?? []).map(mapGoodsReceipt), documents, skipped);

    const invoices = await sb
        .from('sem_invoice_matches')
        .select('*')
        .eq('company_id', companyId)
        .gte('invoice_date', day)
        .lte('invoice_date', day);
    if (invoices.error) throw new Error(`supplier invoices: ${invoices.error.message}`);
    collect((invoices.data ?? []).map(mapSupplierInvoice), documents, skipped);

    return { from: day, to: day, documents, skipped };
}

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const CRON_KEY = Deno.env.get('BRIEFING_CRON_KEY') ?? '';
    if (!CRON_KEY) return json({ error: 'BRIEFING_CRON_KEY not configured' }, 500);
    if (req.headers.get('x-cron-key') !== CRON_KEY) return json({ error: 'Unauthorized' }, 401);

    const sb = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    let day = yesterdayUtc();
    let triggeredBy = 'cron';
    try {
        const body = await req.json();
        if (typeof body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) day = body.date;
        if (body?.manual) triggeredBy = 'manual';
    } catch { /* cron sends {} or nothing */ }

    // Sweep first: settle every finished order still carrying a variance, so
    // the file contains the postings, not a promise of them. NULL caller in a
    // definer context means the run scopes to ALL tenants — here that is the
    // point, and each posting derives its own tenant from its order (0261).
    let swept = 0;
    try {
        const { data } = await sb.rpc('ers_settlement_run', { p_limit: 500 });
        swept = Array.isArray(data) ? data.length : 0;
    } catch (e) {
        console.warn('[erp-export] settlement sweep failed, exporting what is posted:', e);
    }

    const { data: companies, error: coErr } = await sb
        .from('companies')
        .select('id, code, app_settings')
        .eq('active', true);
    if (coErr) return json({ error: coErr.message }, 500);

    const emitter = new FileEmitter();
    const results: unknown[] = [];

    for (const company of companies ?? []) {
        const runRow = {
            company_id: company.id,
            period_from: day,
            period_to: day,
            status: 'ok' as string,
            documents: 0,
            skipped: 0,
            files: [] as { name: string; rows: number }[],
            error: null as string | null,
            triggered_by: triggeredBy,
        };
        try {
            const currency = (company.app_settings as Record<string, string> | null)?.currency || 'USD';
            const batch = await buildCompanyBatch(sb, company.id, currency, day);
            const rendered = emitter.render(batch);
            const files = batchToFiles(rendered);

            for (const file of files) {
                const path = `${company.id}/${day}/${file.name}`;
                const { error: upErr } = await sb.storage
                    .from('erp-exports')
                    .upload(path, new Blob([file.content], { type: 'text/csv' }), {
                        contentType: 'text/csv',
                        upsert: true,     // a re-run of the same period replaces its own files
                    });
                if (upErr) throw new Error(`upload ${file.name}: ${upErr.message}`);
            }

            runRow.documents = batch.documents.length;
            runRow.skipped = batch.skipped.length;
            runRow.files = rendered.tables.map((t) => ({ name: `ireams_${t.kind}_${day}_${day}.csv`, rows: t.rows.length }));
            runRow.status = batch.documents.length === 0 ? 'empty' : 'ok';
        } catch (e) {
            runRow.status = 'error';
            runRow.error = String((e as Error)?.message ?? e).slice(0, 500);
        }

        // The run row is the product as much as the files are: "did last
        // night happen?" is answered here, per tenant, error included.
        const { error: logErr } = await sb.from('erp_export_runs').insert(runRow);
        if (logErr) console.error('[erp-export] run log failed:', logErr.message);

        results.push({ company: company.code, status: runRow.status, documents: runRow.documents, files: runRow.files.length, error: runRow.error });
    }

    return json({ date: day, settled_orders_swept: swept, companies: results });
});
