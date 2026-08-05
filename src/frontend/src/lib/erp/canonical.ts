/**
 * Canonical ERP documents — the layer that keeps a second emitter cheap.
 *
 * Every outbound business fact becomes one of these before anything decides
 * how to send it. Emitters (a nightly file today, S/4 OData next) render FROM
 * this and never from the database rows, for the same reason
 * lib/writebackPackage renders vendor columns from a NormalizedAction and
 * never from the raw proposal payload: the moment one emitter reaches past
 * the canonical shape, the shape stops being canonical and the next emitter
 * costs as much as the first.
 *
 * THE RULE THAT MAKES THIS WORTH DOING — semantics, not vendor codes.
 * A goods issue to a work order is `issue_to_order`, never `261`. SAP's BWART
 * is one MAPPING of that semantic, carried alongside as a hint for emitters
 * that want it; Dynamics, NetSuite and QuickBooks all want something else.
 * The same applies to ETags, deep-insert payload shapes and 18-character
 * field limits: all of that lives in the emitter, none of it up here.
 *
 * Idempotency: `document_id` is ours and stable — a settlement posting's
 * cost_allocations id, a movement's inventory_transactions id. Re-exporting
 * the same period produces the same ids, so a receiver that has already taken
 * one can recognise and drop it. That is what makes a nightly file safely
 * re-runnable without any watermark state on our side.
 */

/** The document families. Extending this is how a new business fact joins the pipe. */
export type DocumentKind =
    | 'cost_posting'
    | 'goods_movement'
    | 'goods_receipt'
    | 'purchase_order_line'
    | 'supplier_invoice';

/**
 * What a stock movement MEANS, independent of any ERP's code for it.
 * SAP's BWART numbers are a mapping (see movementSemantic), not the identity.
 */
export type MovementSemantic =
    | 'receipt_against_order'      // 101 — stock arrives against a PO
    | 'receipt_without_order'      // 501/561 — arrives with no PO, or opening balance
    | 'issue_to_order'             // 261 — consumed by a work order
    | 'issue_to_cost_center'       // 201 — drawn by a cost center
    | 'scrap'                      // 551 — written off
    | 'transfer'                   // 311 — moved, no value change
    | 'count_gain'                 // 701
    | 'count_loss'                 // 702
    | 'reversal';                  // 102/202/262/552 — cancels its counterpart

export interface CanonicalEnvelope {
    kind: DocumentKind;
    /** OUR id, stable across re-exports. The receiver's idempotency key. */
    document_id: string;
    /** ISO date the fact happened — not when it was exported. */
    document_date: string;
    /** Their id for this object, once erp_object_map knows it. */
    external_key?: string;
    /** SAP company code / legal entity, when the tenant has one. */
    company_code?: string;
}

/** Settled maintenance cost on its way to their ledger. */
export interface CostPostingDoc extends CanonicalEnvelope {
    kind: 'cost_posting';
    cost_type: 'LABOR' | 'MATERIAL' | 'SERVICE' | 'OVERHEAD';
    amount: number;
    currency: string;
    /** Both settlement receivers travel together — see migration 0244. */
    cost_center_ref?: string;
    asset_ref?: string;
    work_order_ref?: string;
    gl_account?: string;
    quantity?: number;
    unit?: string;
    /** Set when this posting reverses earlier cost. Amount is negative. */
    is_reversal: boolean;
}

export interface GoodsMovementDoc extends CanonicalEnvelope {
    kind: 'goods_movement';
    movement: MovementSemantic;
    /** SAP BWART, for emitters that speak it. One mapping, not the identity. */
    sap_movement_type?: string;
    material_ref?: string;
    storage_location_ref?: string;
    quantity: number;
    unit?: string;
    unit_cost: number;
    /** Signed as expense: positive when stock leaves. */
    value: number;
    work_order_ref?: string;
    purchase_order_ref?: string;
    cost_center_ref?: string;
    asset_ref?: string;
    gl_account?: string;
}

export interface GoodsReceiptDoc extends CanonicalEnvelope {
    kind: 'goods_receipt';
    receipt_number: string;
    purchase_order_ref?: string;
    purchase_order_line?: number;
    material_ref?: string;
    quantity: number;
    unit_cost: number;
    total_value: number;
    storage_location_ref?: string;
}

export interface PurchaseOrderLineDoc extends CanonicalEnvelope {
    kind: 'purchase_order_line';
    purchase_order_ref: string;
    line_number: number;
    line_type: 'MATERIAL' | 'SERVICE';
    description: string;
    material_ref?: string;
    supplier_ref?: string;
    quantity_ordered: number;
    quantity_received: number;
    unit?: string;
    unit_cost: number;
    net_value: number;
    work_order_ref?: string;
    cost_center_ref?: string;
    gl_account?: string;
}

export interface SupplierInvoiceDoc extends CanonicalEnvelope {
    kind: 'supplier_invoice';
    invoice_number: string;
    supplier_ref?: string;
    purchase_order_ref?: string;
    invoice_amount: number;
    currency: string;
    /** Our three-way verdict travels with it — their AP team decides what to do. */
    match_status: 'MATCHED' | 'BLOCKED' | 'PENDING';
    payment_block?: 'PRICE' | 'QUANTITY';
    variance_amount: number;
}

export type CanonicalDocument =
    | CostPostingDoc
    | GoodsMovementDoc
    | GoodsReceiptDoc
    | PurchaseOrderLineDoc
    | SupplierInvoiceDoc;

/**
 * BWART → semantic. Defined here rather than in the emitter because the
 * semantic is what the canonical document carries; the emitter maps the other
 * way if its target happens to want SAP codes.
 */
const SEMANTIC_BY_BWART: Record<string, MovementSemantic> = {
    '101': 'receipt_against_order',
    '102': 'reversal',
    '201': 'issue_to_cost_center',
    '202': 'reversal',
    '261': 'issue_to_order',
    '262': 'reversal',
    '311': 'transfer',
    '501': 'receipt_without_order',
    '551': 'scrap',
    '552': 'reversal',
    '561': 'receipt_without_order',
    '701': 'count_gain',
    '702': 'count_loss',
};

/**
 * An unmapped code resolves to `transfer` — the only semantic with no
 * financial consequence. Guessing `issue_to_order` for an unknown movement
 * would invent a cost against a work order; guessing nothing at all would
 * drop the document silently. A value-neutral movement is the honest default
 * and it shows up in the export for someone to look at.
 */
export function movementSemantic(bwart: string | null | undefined): MovementSemantic {
    return SEMANTIC_BY_BWART[String(bwart ?? '').trim()] ?? 'transfer';
}

/** Documents a given emitter cannot express are reported, never dropped. */
export interface SkippedDocument {
    document_id: string;
    kind: DocumentKind | 'unknown';
    reason: string;
}

export interface CanonicalBatch {
    /** Inclusive ISO dates. A batch is a period, not a watermark — see the file note. */
    from: string;
    to: string;
    documents: CanonicalDocument[];
    skipped: SkippedDocument[];
}
