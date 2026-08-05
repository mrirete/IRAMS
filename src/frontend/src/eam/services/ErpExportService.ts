/**
 * ErpExportService — Tier 1 outbound: a period of business documents, ready to
 * drop into the customer's middleware.
 *
 * The I/O half only. Every transformation lives in lib/erp (pure, tested);
 * this fetches rows and hands them over. Keeping the split means a wrong
 * column in a finance file is caught by a unit test rather than by their
 * accounts team.
 *
 * A BATCH IS A PERIOD, NOT A WATERMARK. Export "4th August" and you get every
 * document dated the 4th, every time, no matter how often you run it. That is
 * deliberate:
 *   • no export state to keep, so nothing to corrupt or reset;
 *   • a failed night is fixed by re-running the same day, not by unpicking
 *     a cursor;
 *   • document_id is ours and stable, so a receiver that already took a
 *     document recognises the repeat and drops it.
 * A watermark would give none of that and would need a table — which the
 * shared-DB tenancy sweep has not reached yet (see the design doc §9).
 *
 * PO lines are NOT in the nightly finance drop by default. A PO line is a
 * commitment, not an actual, and it has no event date to bound a period with —
 * including it would mean shipping today's open-order snapshot inside a file
 * labelled with last week's dates. Ask for it explicitly when feeding a
 * commitment report, and know what you are getting.
 */
import { supabase } from '../lib/supabase';
import {
    mapCostPosting, mapGoodsMovement, mapGoodsReceipt,
    mapPurchaseOrderLine, mapSupplierInvoice, type Mapped,
} from '../../lib/erp/mapToCanonical';
import type { CanonicalBatch, CanonicalDocument, SkippedDocument } from '../../lib/erp/canonical';
import { FileEmitter, batchToFiles, type Emitter, type RenderedBatch } from '../../lib/erp/emitters';

export interface ExportOptions {
    /** Inclusive ISO dates. */
    from: string;
    to: string;
    /** Include open PO lines as a commitment snapshot. Off by default — see the file note. */
    includeOpenCommitments?: boolean;
}

class ErpExportServiceClass {
    /** End-of-day bound for timestamp columns; date columns ignore the time part. */
    private endOfDay(to: string): string {
        return `${to}T23:59:59.999Z`;
    }

    private async tenantCurrency(): Promise<string> {
        const { data } = await supabase
            .from('companies').select('app_settings').eq('active', true).limit(1).maybeSingle();
        return (data?.app_settings as any)?.currency || 'USD';
    }

    /** Fold mapped results into the batch, keeping skips visible. */
    private collect<T extends CanonicalDocument>(
        results: Mapped<T>[], documents: CanonicalDocument[], skipped: SkippedDocument[],
    ): void {
        for (const r of results) {
            if ('doc' in r) documents.push(r.doc);
            else skipped.push(r.skipped);
        }
    }

    async buildBatch(opts: ExportOptions): Promise<CanonicalBatch> {
        const { from, to } = opts;
        const currency = await this.tenantCurrency();
        const documents: CanonicalDocument[] = [];
        const skipped: SkippedDocument[] = [];

        // ── Cost postings. The refs are embedded because a UUID is useless to
        //    a receiver — they need the codes their own system knows.
        const costs = await supabase
            .from('cost_allocations')
            .select('*, work_orders(wo_number), assets(tag), cost_centers(code, gl_account)')
            .gte('posting_date', from)
            .lte('posting_date', to);
        if (costs.error) throw new Error(`Cost postings: ${costs.error.message}`);
        this.collect((costs.data || []).map(r => mapCostPosting(r, currency)), documents, skipped);

        // ── Goods movements.
        const movements = await supabase
            .from('sem_stock_movements')
            .select('*')
            .gte('moved_at', from)
            .lte('moved_at', this.endOfDay(to));
        if (movements.error) throw new Error(`Goods movements: ${movements.error.message}`);
        this.collect((movements.data || []).map(mapGoodsMovement), documents, skipped);

        // ── Goods receipts.
        const receipts = await supabase
            .from('goods_receipts')
            .select('*, purchase_orders(po_code), purchase_order_lines(line_no), inventory_items(material_number, part_number)')
            .gte('received_date', from)
            .lte('received_date', to);
        if (receipts.error) throw new Error(`Goods receipts: ${receipts.error.message}`);
        this.collect((receipts.data || []).map(mapGoodsReceipt), documents, skipped);

        // ── Supplier invoices, with the three-way verdict attached.
        const invoices = await supabase
            .from('sem_invoice_matches')
            .select('*')
            .gte('invoice_date', from)
            .lte('invoice_date', to);
        if (invoices.error) throw new Error(`Supplier invoices: ${invoices.error.message}`);
        this.collect((invoices.data || []).map(mapSupplierInvoice), documents, skipped);

        // ── Open commitments, only when asked.
        if (opts.includeOpenCommitments) {
            const lines = await supabase
                .from('sem_purchase_order_lines')
                .select('*')
                .gt('qty_outstanding', 0);
            if (lines.error) throw new Error(`Open commitments: ${lines.error.message}`);
            this.collect((lines.data || []).map(mapPurchaseOrderLine), documents, skipped);
        }

        return { from, to, documents, skipped };
    }

    /**
     * Build and render in one call. The emitter is a parameter, not a constant:
     * swapping FileEmitter for an S/4 emitter is the whole of the Tier 1 → Tier 2
     * upgrade at this layer.
     */
    async exportPeriod(opts: ExportOptions, emitter: Emitter = new FileEmitter()): Promise<RenderedBatch> {
        return emitter.render(await this.buildBatch(opts));
    }

    /** Rendered batch → downloadable CSVs, one per document family. */
    toFiles(batch: RenderedBatch): { name: string; content: string }[] {
        return batchToFiles(batch);
    }

    /** Counts for a UI to show before anyone downloads anything. */
    summarise(batch: RenderedBatch): { kind: string; rows: number }[] {
        return batch.tables.map(t => ({ kind: t.kind, rows: t.rows.length }));
    }
}

export const ErpExportService = new ErpExportServiceClass();
