/**
 * Database rows → canonical documents. Pure, so it can be tested without a
 * database, which is the whole reason the mapping lives apart from the service
 * that fetches the rows.
 *
 * Every mapper returns either a document or a skip reason. Nothing throws and
 * nothing is dropped silently: a row we cannot express becomes a visible
 * SkippedDocument, because an export that quietly omits a posting is worse
 * than one that reports it could not map it.
 */
import {
    movementSemantic,
    type CostPostingDoc,
    type GoodsMovementDoc,
    type GoodsReceiptDoc,
    type PurchaseOrderLineDoc,
    type SupplierInvoiceDoc,
    type SkippedDocument,
} from './canonical';

export type Mapped<T> = { doc: T } | { skipped: SkippedDocument };

const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
const opt = (v: unknown): string | undefined => str(v) || undefined;
/** Postgres dates arrive as 'YYYY-MM-DD' or a full timestamp; we want the day. */
const day = (v: unknown): string => str(v).slice(0, 10);

/**
 * A settled cost posting. `cost_allocations` joined to the refs a receiver can
 * actually resolve — nobody's ERP can do anything with our UUIDs, so a posting
 * that resolves no business key at all is skipped rather than sent as noise.
 */
export function mapCostPosting(row: any, currency = 'USD'): Mapped<CostPostingDoc> {
    const amount = num(row?.amount);
    const id = str(row?.id);

    if (!id) {
        return { skipped: { document_id: '(no id)', kind: 'cost_posting', reason: 'row has no id' } };
    }
    if (amount === 0) {
        // A zero delta is not a document. Settlement never writes one, but a
        // manual entry can.
        return { skipped: { document_id: id, kind: 'cost_posting', reason: 'zero amount' } };
    }

    const costCentre = opt(row?.cost_centers?.code);
    const workOrder = opt(row?.work_orders?.wo_number);
    const asset = opt(row?.assets?.tag);
    if (!costCentre && !workOrder && !asset) {
        return {
            skipped: {
                document_id: id, kind: 'cost_posting',
                reason: 'no cost centre, work order or asset — nothing the receiver can post against',
            },
        };
    }

    return {
        doc: {
            kind: 'cost_posting',
            document_id: id,
            document_date: day(row?.posting_date || row?.created_at),
            cost_type: (str(row?.cost_type) || 'OVERHEAD') as CostPostingDoc['cost_type'],
            amount,
            currency,
            cost_center_ref: costCentre,
            asset_ref: asset,
            work_order_ref: workOrder,
            gl_account: opt(row?.cost_centers?.gl_account),
            quantity: row?.quantity == null ? undefined : num(row.quantity),
            unit: opt(row?.unit),
            // Settlement corrects by posting a negative delta rather than
            // editing history (0244), so the sign IS the reversal flag.
            is_reversal: amount < 0,
        },
    };
}

/** A stock movement from sem_stock_movements. */
export function mapGoodsMovement(row: any): Mapped<GoodsMovementDoc> {
    const id = str(row?.movement_id);
    if (!id) {
        return { skipped: { document_id: '(no id)', kind: 'goods_movement', reason: 'row has no id' } };
    }

    const material = opt(row?.material_number) || opt(row?.part_number);
    if (!material) {
        return {
            skipped: {
                document_id: id, kind: 'goods_movement',
                reason: 'item has no material or part number — the receiver cannot identify it',
            },
        };
    }

    const bwart = str(row?.movement_type);
    return {
        doc: {
            kind: 'goods_movement',
            document_id: id,
            document_date: day(row?.moved_at),
            movement: movementSemantic(bwart),
            sap_movement_type: bwart || undefined,
            material_ref: material,
            storage_location_ref: opt(row?.location_id),
            quantity: num(row?.quantity),
            unit: undefined,
            unit_cost: num(row?.cost_at_time),
            value: num(row?.total_value),
            work_order_ref: opt(row?.wo_id),
            purchase_order_ref: opt(row?.po_id),
            cost_center_ref: opt(row?.cost_center_id),
            asset_ref: opt(row?.asset_id),
            gl_account: opt(row?.gl_account),
        },
    };
}

/** A goods receipt. Carries the PO line so the receiver can match it. */
export function mapGoodsReceipt(row: any): Mapped<GoodsReceiptDoc> {
    const id = str(row?.id);
    if (!id) {
        return { skipped: { document_id: '(no id)', kind: 'goods_receipt', reason: 'row has no id' } };
    }
    const grn = str(row?.grn_number);
    if (!grn) {
        return { skipped: { document_id: id, kind: 'goods_receipt', reason: 'no GRN number' } };
    }

    return {
        doc: {
            kind: 'goods_receipt',
            document_id: id,
            document_date: day(row?.received_date || row?.created_at),
            receipt_number: grn,
            purchase_order_ref: opt(row?.purchase_orders?.po_code) || opt(row?.po_id),
            purchase_order_line: row?.purchase_order_lines?.line_no == null
                ? undefined : num(row.purchase_order_lines.line_no),
            material_ref: opt(row?.inventory_items?.material_number) || opt(row?.inventory_items?.part_number),
            quantity: num(row?.quantity),
            unit_cost: num(row?.unit_cost),
            total_value: num(row?.total_cost),
            storage_location_ref: opt(row?.storage_location),
        },
    };
}

/** A PO line from sem_purchase_order_lines. */
export function mapPurchaseOrderLine(row: any): Mapped<PurchaseOrderLineDoc> {
    const id = str(row?.line_id);
    if (!id) {
        return { skipped: { document_id: '(no id)', kind: 'purchase_order_line', reason: 'row has no id' } };
    }
    const po = opt(row?.po_code);
    if (!po) {
        return { skipped: { document_id: id, kind: 'purchase_order_line', reason: 'no PO code' } };
    }

    return {
        doc: {
            kind: 'purchase_order_line',
            document_id: id,
            document_date: day(row?.document_date || row?.created_at),
            purchase_order_ref: po,
            line_number: num(row?.line_no),
            line_type: str(row?.line_type) === 'SERVICE' ? 'SERVICE' : 'MATERIAL',
            description: str(row?.description),
            material_ref: opt(row?.part_number),
            supplier_ref: opt(row?.supplier_id),
            quantity_ordered: num(row?.qty_ordered),
            quantity_received: num(row?.qty_received),
            unit: opt(row?.uom),
            unit_cost: num(row?.unit_cost),
            net_value: num(row?.line_total),
            work_order_ref: opt(row?.wo_number),
            cost_center_ref: opt(row?.cost_center_id),
            gl_account: opt(row?.gl_account),
        },
    };
}

/** An invoice with its three-way verdict, from sem_invoice_matches. */
export function mapSupplierInvoice(row: any): Mapped<SupplierInvoiceDoc> {
    const id = str(row?.invoice_id);
    if (!id) {
        return { skipped: { document_id: '(no id)', kind: 'supplier_invoice', reason: 'row has no id' } };
    }
    const number = str(row?.invoice_number);
    if (!number) {
        return { skipped: { document_id: id, kind: 'supplier_invoice', reason: 'no invoice number' } };
    }

    const status = str(row?.match_status).toUpperCase();
    const block = str(row?.payment_block).toUpperCase();

    return {
        doc: {
            kind: 'supplier_invoice',
            document_id: id,
            document_date: day(row?.invoice_date),
            invoice_number: number,
            supplier_ref: opt(row?.vendor_id),
            purchase_order_ref: opt(row?.po_code) || opt(row?.po_id),
            invoice_amount: num(row?.invoice_amount),
            currency: str(row?.currency) || 'USD',
            match_status: status === 'MATCHED' || status === 'BLOCKED' ? status : 'PENDING',
            payment_block: block === 'PRICE' || block === 'QUANTITY' ? block : undefined,
            variance_amount: num(row?.variance_amount),
        },
    };
}
