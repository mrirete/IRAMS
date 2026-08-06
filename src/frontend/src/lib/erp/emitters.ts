/**
 * Emitters — the only layer that knows what the receiving system looks like.
 *
 * An emitter RENDERS; it does not deliver. Rendering is pure and therefore
 * testable, which matters more here than anywhere else in the pipe: a wrong
 * column in a finance file is a wrong posting in someone's ledger. Delivery
 * (download a file today, POST to OData tomorrow) is a thin shell around a
 * rendered batch and is the only part that needs network mocking.
 *
 * TIER 1 → TIER 2. The file emitter below is Tier 1's whole outbound half. An
 * S/4 emitter implements the same `Emitter` interface, returning JSON payloads
 * instead of rows, and nothing above this file changes. That is the entire
 * reason for the canonical layer — see docs/ERP-Integration-Design.md §5.
 *
 * ONE RULE, ENFORCED BY THE INTERFACE: emitters read CanonicalDocument and
 * nothing else. No emitter reaches back into a database row, because the
 * moment one does, the canonical shape stops being canonical.
 */
import type { CanonicalBatch, CanonicalDocument, DocumentKind, SkippedDocument } from './canonical';

export interface RenderedTable {
    kind: DocumentKind;
    columns: string[];
    rows: Record<string, string | number>[];
}

export interface RenderedBatch {
    target: string;
    from: string;
    to: string;
    tables: RenderedTable[];
    skipped: SkippedDocument[];
    notes: string[];
}

export interface Emitter {
    readonly target: string;
    render(batch: CanonicalBatch): RenderedBatch;
}

// ── column contracts ───────────────────────────────────────────────────────
// Explicit and ordered. A receiver's import job is positional in practice even
// when it claims to be by-name, so column order is part of the contract and
// changing it is a breaking change.

const COLUMNS: Record<DocumentKind, string[]> = {
    cost_posting: [
        'document_id', 'document_date', 'cost_type', 'amount', 'currency',
        'cost_center', 'gl_account', 'work_order', 'asset', 'quantity', 'unit', 'is_reversal',
    ],
    goods_movement: [
        'document_id', 'document_date', 'movement', 'sap_movement_type', 'material',
        'storage_location', 'quantity', 'unit_cost', 'value',
        'work_order', 'purchase_order', 'cost_center', 'asset', 'gl_account',
    ],
    goods_receipt: [
        'document_id', 'document_date', 'receipt_number', 'purchase_order', 'purchase_order_line',
        'material', 'quantity', 'unit_cost', 'total_value', 'storage_location',
    ],
    purchase_order_line: [
        'document_id', 'document_date', 'purchase_order', 'line_number', 'line_type', 'description',
        'material', 'supplier', 'quantity_ordered', 'quantity_received', 'unit',
        'unit_cost', 'net_value', 'work_order', 'cost_center', 'gl_account',
    ],
    supplier_invoice: [
        'document_id', 'document_date', 'invoice_number', 'supplier', 'purchase_order',
        'invoice_amount', 'currency', 'match_status', 'payment_block', 'variance_amount',
    ],
};

/** Absent is an empty cell, never the string "undefined". */
const cell = (v: unknown): string | number => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean') return v ? 'X' : '';   // SAP-style flag
    if (typeof v === 'number') return v;
    return String(v);
};

function toRow(doc: CanonicalDocument): Record<string, string | number> {
    switch (doc.kind) {
        case 'cost_posting':
            return {
                document_id: cell(doc.document_id), document_date: cell(doc.document_date),
                cost_type: cell(doc.cost_type), amount: cell(doc.amount), currency: cell(doc.currency),
                cost_center: cell(doc.cost_center_ref), gl_account: cell(doc.gl_account),
                work_order: cell(doc.work_order_ref), asset: cell(doc.asset_ref),
                quantity: cell(doc.quantity), unit: cell(doc.unit), is_reversal: cell(doc.is_reversal),
            };
        case 'goods_movement':
            return {
                document_id: cell(doc.document_id), document_date: cell(doc.document_date),
                movement: cell(doc.movement), sap_movement_type: cell(doc.sap_movement_type),
                material: cell(doc.material_ref), storage_location: cell(doc.storage_location_ref),
                quantity: cell(doc.quantity), unit_cost: cell(doc.unit_cost), value: cell(doc.value),
                work_order: cell(doc.work_order_ref), purchase_order: cell(doc.purchase_order_ref),
                cost_center: cell(doc.cost_center_ref), asset: cell(doc.asset_ref),
                gl_account: cell(doc.gl_account),
            };
        case 'goods_receipt':
            return {
                document_id: cell(doc.document_id), document_date: cell(doc.document_date),
                receipt_number: cell(doc.receipt_number), purchase_order: cell(doc.purchase_order_ref),
                purchase_order_line: cell(doc.purchase_order_line), material: cell(doc.material_ref),
                quantity: cell(doc.quantity), unit_cost: cell(doc.unit_cost),
                total_value: cell(doc.total_value), storage_location: cell(doc.storage_location_ref),
            };
        case 'purchase_order_line':
            return {
                document_id: cell(doc.document_id), document_date: cell(doc.document_date),
                purchase_order: cell(doc.purchase_order_ref), line_number: cell(doc.line_number),
                line_type: cell(doc.line_type), description: cell(doc.description),
                material: cell(doc.material_ref), supplier: cell(doc.supplier_ref),
                quantity_ordered: cell(doc.quantity_ordered), quantity_received: cell(doc.quantity_received),
                unit: cell(doc.unit), unit_cost: cell(doc.unit_cost), net_value: cell(doc.net_value),
                work_order: cell(doc.work_order_ref), cost_center: cell(doc.cost_center_ref),
                gl_account: cell(doc.gl_account),
            };
        case 'supplier_invoice':
            return {
                document_id: cell(doc.document_id), document_date: cell(doc.document_date),
                invoice_number: cell(doc.invoice_number), supplier: cell(doc.supplier_ref),
                purchase_order: cell(doc.purchase_order_ref), invoice_amount: cell(doc.invoice_amount),
                currency: cell(doc.currency), match_status: cell(doc.match_status),
                payment_block: cell(doc.payment_block), variance_amount: cell(doc.variance_amount),
            };
    }
}

/**
 * Tier 1: one table per document family, for a nightly drop into their
 * middleware. Deliberately dumb — the value is in the canonical layer above
 * and the column contract below, not in this renderer.
 */
export class FileEmitter implements Emitter {
    readonly target = 'file';

    render(batch: CanonicalBatch): RenderedBatch {
        const byKind = new Map<DocumentKind, CanonicalDocument[]>();
        for (const doc of batch.documents) {
            const list = byKind.get(doc.kind) ?? [];
            list.push(doc);
            byKind.set(doc.kind, list);
        }

        const tables: RenderedTable[] = [];
        // Iterate COLUMNS, not the map, so table order is stable regardless of
        // what the period happened to contain.
        for (const kind of Object.keys(COLUMNS) as DocumentKind[]) {
            const docs = byKind.get(kind);
            if (!docs || docs.length === 0) continue;
            // Sorted by our id so a re-export is byte-identical, not merely
            // set-identical. The queries carry no ORDER BY, so without this a
            // re-run shuffles rows and a receiver diffing files sees change
            // where there is none.
            const ordered = [...docs].sort((a, b) => a.document_id.localeCompare(b.document_id));
            tables.push({ kind, columns: COLUMNS[kind], rows: ordered.map(toRow) });
        }

        const notes = [
            `Period ${batch.from} to ${batch.to} inclusive.`,
            'Re-exporting the same period reproduces the same document_id values — a receiver that has already taken one can drop it.',
        ];
        if (batch.skipped.length > 0) {
            notes.push(`${batch.skipped.length} record(s) could not be expressed and are listed separately — they were NOT sent.`);
        }

        return { target: this.target, from: batch.from, to: batch.to, tables, skipped: batch.skipped, notes };
    }
}

/**
 * RFC 4180: quote everything containing a comma, quote or newline; double
 * inner quotes.
 *
 * Plus one guard RFC 4180 does not know about: a TEXT cell starting with
 * `=`, `+`, `-`, `@` or a tab is a formula the moment Excel opens the file,
 * and these files go to a finance team who will open them in Excel. A vendor
 * who names an asset `=WEBSERVICE(...)` must not get code execution in
 * accounts payable. The standard defence is a leading apostrophe. Numbers are
 * exempt — they arrive as numbers, and a negative amount is not an attack.
 */
export function toCsv(table: RenderedTable): string {
    const esc = (v: string | number): string => {
        if (typeof v === 'number') return String(v);
        let s = String(v ?? '');
        if (/^[=+\-@\t]/.test(s)) s = `'${s}`;
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = table.columns.join(',');
    const body = table.rows.map(r => table.columns.map(c => esc(r[c] ?? '')).join(','));
    return [header, ...body].join('\r\n');
}

/** One CSV per family, named so a middleware pickup rule can match on it. */
export function batchToFiles(batch: RenderedBatch): { name: string; content: string }[] {
    return batch.tables.map(t => ({
        name: `ireams_${t.kind}_${batch.from}_${batch.to}.csv`,
        content: toCsv(t),
    }));
}
