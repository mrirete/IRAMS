// Supabase Edge Function: sensor-sync
// ────────────────────────────────────────────────────────────────────────────
// The real backend worker behind the Connector Hub. Reads active REST/weather
// connectors from the `connectors` table (0177), pulls each source, and upserts
// the readings into ers_sensor_readings — the same feed the Predict twin reads
// and the CSV importer writes to. Idempotent per (asset_id, tag), so a scheduled
// run refreshes values instead of duplicating them.
//
// Runs two ways:
//   • on a schedule  — pg_cron POSTs here every N minutes (see README)
//   • on demand      — POST { "connectorId": "<uuid>" } to sync just one
//
// Deploy:  supabase functions deploy sensor-sync
// Uses the auto-injected SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (service role
// bypasses RLS so it can write). No secrets in this repo — per-source tokens go
// in the connector's `config.headers` or a function secret.
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

interface Mapping {
    asset: string; tag: string; value: string;
    unit?: string; timestamp?: string; alarm_high?: string; alarm_low?: string;
}
interface RestConfig {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    /** dotted path to the array of records in the response (omit if the body IS the array) */
    root?: string;
    /** maps our fields → source JSON field paths */
    map: Mapping;
}

const getPath = (o: unknown, path?: string): unknown =>
    !path ? o : path.split('.').reduce<unknown>((acc, k) => (acc == null ? acc : (acc as Record<string, unknown>)[k]), o);

async function syncRest(sb: SupabaseClient, connector: Record<string, unknown>): Promise<number> {
    const cfg = connector.config as RestConfig;
    if (!cfg?.url || !cfg?.map) throw new Error('connector config missing url/map');

    const res = await fetch(cfg.url, { method: cfg.method || 'GET', headers: cfg.headers || {} });
    if (!res.ok) throw new Error(`source responded ${res.status}`);
    const json = await res.json();
    const arr = getPath(json, cfg.root);
    const items: unknown[] = Array.isArray(arr) ? arr : Array.isArray(json) ? json : [];
    if (items.length === 0) return 0;

    const m = cfg.map;
    const rows = items.map((it) => ({
        assetToken: String(getPath(it, m.asset) ?? '').trim(),
        tag: String(getPath(it, m.tag) ?? '').trim(),
        value: Number(getPath(it, m.value)),
        unit: m.unit ? String(getPath(it, m.unit) ?? '') : '',
        ts: m.timestamp ? String(getPath(it, m.timestamp) ?? '') : '',
        hi: m.alarm_high ? Number(getPath(it, m.alarm_high)) : null,
        lo: m.alarm_low ? Number(getPath(it, m.alarm_low)) : null,
    })).filter((r) => r.tag && Number.isFinite(r.value));
    if (rows.length === 0) return 0;

    // Resolve asset tokens → asset_id (by tag or id).
    const { data: assets } = await sb.from('assets').select('id, tag');
    const byId = new Map<string, string>(); const byTag = new Map<string, string>();
    for (const a of assets ?? []) {
        byId.set(String(a.id).toLowerCase(), a.id);
        if (a.tag) byTag.set(String(a.tag).toLowerCase(), a.id);
    }
    const resolve = (tok: string) => byId.get(tok.toLowerCase()) || byTag.get(tok.toLowerCase()) || null;

    // Aggregate per (asset_id, tag): latest value, series, trend, bands.
    type Grp = { asset_id: string; tag: string; unit: string; hi: number | null; lo: number | null; series: { v: number; ts: string }[] };
    const groups = new Map<string, Grp>();
    for (const r of rows) {
        const aid = resolve(r.assetToken); if (!aid) continue;
        const key = `${aid}|${r.tag}`;
        const g = groups.get(key) ?? { asset_id: aid, tag: r.tag, unit: r.unit, hi: r.hi, lo: r.lo, series: [] };
        g.series.push({ v: r.value, ts: r.ts });
        if (!g.unit && r.unit) g.unit = r.unit;
        if (g.hi == null && r.hi != null) g.hi = r.hi;
        if (g.lo == null && r.lo != null) g.lo = r.lo;
        groups.set(key, g);
    }
    if (groups.size === 0) return 0;

    // Reuse existing row ids so upsert refreshes rather than duplicates.
    const assetIds = [...new Set([...groups.values()].map((g) => g.asset_id))];
    const { data: existing } = await sb.from('ers_sensor_readings').select('id, asset_id, tag').in('asset_id', assetIds);
    const idByKey = new Map<string, string>();
    for (const e of existing ?? []) idByKey.set(`${e.asset_id}|${e.tag}`, e.id);

    const payload = [...groups.values()].map((g) => {
        const ordered = g.series.every((s) => s.ts)
            ? [...g.series].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
            : g.series;
        const vals = ordered.map((s) => s.v);
        const last = vals[vals.length - 1];
        const prev = vals.length > 1 ? vals[vals.length - 2] : undefined;
        const trend = prev == null ? null : last > prev ? 'rising' : last < prev ? 'falling' : 'stable';
        return {
            id: idByKey.get(`${g.asset_id}|${g.tag}`) ?? crypto.randomUUID(),
            asset_id: g.asset_id, tag: g.tag, current_value: last,
            unit: g.unit || '—', trend, alarm_high: g.hi, alarm_low: g.lo,
            readings: vals.slice(-50),
        };
    });
    const { error } = await sb.from('ers_sensor_readings').upsert(payload);
    if (error) throw new Error(error.message);
    return payload.length;
}

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    let connectorId: string | undefined;
    try { connectorId = (await req.json())?.connectorId; } catch { /* cron: no body */ }

    const base = sb.from('connectors').select('*');
    const query = connectorId
        ? base.eq('id', connectorId)
        : base.eq('is_active', true).in('type', ['rest_api', 'weather_api']);
    const { data: connectors, error } = await query;
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const results: unknown[] = [];
    for (const c of connectors ?? []) {
        const startedAt = new Date().toISOString();
        try {
            const records = await syncRest(sb, c);
            await sb.from('connectors').update({
                last_sync: startedAt, last_status: 'ok', last_error: null,
                records_synced: (Number(c.records_synced) || 0) + records, updated_at: startedAt,
            }).eq('id', c.id);
            await sb.from('connector_sync_logs').insert({ connector_id: c.id, started_at: startedAt, finished_at: new Date().toISOString(), status: 'ok', records, message: `${records} points` });
            results.push({ connector: c.name, ok: true, records });
        } catch (e) {
            const msg = String((e as Error)?.message ?? e).slice(0, 300);
            await sb.from('connectors').update({ last_sync: startedAt, last_status: 'error', last_error: msg, updated_at: startedAt }).eq('id', c.id);
            await sb.from('connector_sync_logs').insert({ connector_id: c.id, started_at: startedAt, finished_at: new Date().toISOString(), status: 'error', records: 0, message: msg });
            results.push({ connector: c.name, ok: false, error: msg });
        }
    }
    return new Response(JSON.stringify({ ran: results.length, results }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
