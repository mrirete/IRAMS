/**
 * Supplier history for one vendor — the documents that prove a relationship
 * exists: purchase orders placed with them, goods receipts against those
 * orders, and the invoices they have sent.
 *
 * Read-only. Keyed on the id the Vendors page already uses for the selected
 * record (vendors.id today; a contact flagged as a vendor uses the same id
 * wherever purchase_orders.supplier_id / invoice_matches.vendor_id point at it).
 *
 * Tables (see 0034, 0248, 0255/0260 migrations):
 *   purchase_orders        supplier_id → vendor
 *   purchase_order_lines   po_id, line_total (generated qty × cost)
 *   goods_receipts         po_id, grn_number, received_date, quantity, total_cost
 *   invoice_matches        vendor_id, po_id, invoice_number, invoice_date,
 *                          invoice_amount, match_status
 *   sem_invoice_matches    the same rows + derived payables_status (view)
 */
import { supabase } from '../lib/supabase';

export interface VendorPurchaseOrder {
    id: string;
    poCode: string;
    status: string;
    dateCreated: string | null;
    currency: string | null;
    /** Sum of purchase_order_lines.line_total for the order. */
    total: number;
    lineCount: number;
}

export interface VendorGoodsReceipt {
    id: string;
    grnNumber: string;
    poId: string | null;
    poCode: string | null;
    receivedDate: string | null;
    quantity: number;
    totalCost: number;
}

export interface VendorInvoice {
    id: string;
    invoiceNumber: string;
    poId: string | null;
    poCode: string | null;
    invoiceDate: string | null;
    invoiceAmount: number;
    currency: string | null;
    matchStatus: string;
    /** From sem_invoice_matches when the view is readable; otherwise derived here. */
    payablesStatus: string;
}

export interface VendorHistory {
    purchaseOrders: VendorPurchaseOrder[];
    goodsReceipts: VendorGoodsReceipt[];
    invoices: VendorInvoice[];
    /** Non-fatal read problems, one per source, so the page can say which list is incomplete. */
    warnings: string[];
}

const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

/** Mirrors the CASE in sem_invoice_matches for the fallback path. */
const derivePayablesStatus = (row: any): string => {
    if (row.payment_date) return 'paid';
    if (row.match_status === 'BLOCKED') return `blocked — ${String(row.payment_block || 'variance').toLowerCase()}`;
    if (row.match_status === 'MATCHED') return 'cleared for payment';
    return 'not yet matched';
};

export async function getVendorHistory(vendorId: string): Promise<VendorHistory> {
    const warnings: string[] = [];
    const empty: VendorHistory = { purchaseOrders: [], goodsReceipts: [], invoices: [], warnings };
    if (!vendorId) return empty;

    // 1. Purchase orders placed with this supplier.
    const poRes = await supabase
        .from('purchase_orders')
        .select('id, po_code, status, date_created, currency')
        .eq('supplier_id', vendorId)
        .order('date_created', { ascending: false });
    if (poRes.error) {
        warnings.push(`Purchase orders could not be read: ${poRes.error.message}`);
    }
    const poRows: any[] = poRes.data || [];
    const poIds = poRows.map(r => r.id as string);
    const poCodeById = new Map<string, string>(poRows.map(r => [r.id as string, r.po_code as string]));

    // 2. Lines (for totals) and receipts, both keyed on po_id.
    const totals = new Map<string, { total: number; lines: number }>();
    let grnRows: any[] = [];
    if (poIds.length > 0) {
        const [lineRes, grnRes] = await Promise.all([
            supabase.from('purchase_order_lines').select('po_id, line_total').in('po_id', poIds),
            supabase
                .from('goods_receipts')
                .select('id, grn_number, po_id, received_date, quantity, total_cost')
                .in('po_id', poIds)
                .order('received_date', { ascending: false }),
        ]);
        if (lineRes.error) {
            warnings.push(`Order totals could not be read: ${lineRes.error.message}`);
        } else {
            for (const l of lineRes.data || []) {
                const cur = totals.get(l.po_id) || { total: 0, lines: 0 };
                cur.total += num(l.line_total);
                cur.lines += 1;
                totals.set(l.po_id, cur);
            }
        }
        if (grnRes.error) {
            warnings.push(`Goods receipts could not be read: ${grnRes.error.message}`);
        } else {
            grnRows = grnRes.data || [];
        }
    }

    // 3. Invoices: prefer the semantic view (carries payables_status); fall
    //    back to the table when the view is unavailable to this caller.
    let invoices: VendorInvoice[] = [];
    const viewRes = await supabase
        .from('sem_invoice_matches')
        .select('invoice_id, invoice_number, po_id, po_code, invoice_date, invoice_amount, currency, match_status, payables_status')
        .eq('vendor_id', vendorId)
        .order('invoice_date', { ascending: false });
    if (!viewRes.error) {
        invoices = (viewRes.data || []).map((r: any) => ({
            id: r.invoice_id,
            invoiceNumber: r.invoice_number,
            poId: r.po_id ?? null,
            poCode: r.po_code ?? (r.po_id ? poCodeById.get(r.po_id) ?? null : null),
            invoiceDate: r.invoice_date ?? null,
            invoiceAmount: num(r.invoice_amount),
            currency: r.currency ?? null,
            matchStatus: r.match_status || 'PENDING',
            payablesStatus: r.payables_status || derivePayablesStatus(r),
        }));
    } else {
        const tblRes = await supabase
            .from('invoice_matches')
            .select('id, invoice_number, po_id, invoice_date, invoice_amount, currency, match_status, payment_block, payment_date')
            .eq('vendor_id', vendorId)
            .order('invoice_date', { ascending: false });
        if (tblRes.error) {
            warnings.push(`Invoices could not be read: ${tblRes.error.message}`);
        } else {
            invoices = (tblRes.data || []).map((r: any) => ({
                id: r.id,
                invoiceNumber: r.invoice_number,
                poId: r.po_id ?? null,
                poCode: r.po_id ? poCodeById.get(r.po_id) ?? null : null,
                invoiceDate: r.invoice_date ?? null,
                invoiceAmount: num(r.invoice_amount),
                currency: r.currency ?? null,
                matchStatus: r.match_status || 'PENDING',
                payablesStatus: derivePayablesStatus(r),
            }));
        }
    }

    return {
        purchaseOrders: poRows.map(r => ({
            id: r.id,
            poCode: r.po_code,
            status: r.status,
            dateCreated: r.date_created ?? null,
            currency: r.currency ?? null,
            total: Number((totals.get(r.id)?.total || 0).toFixed(2)),
            lineCount: totals.get(r.id)?.lines || 0,
        })),
        goodsReceipts: grnRows.map(r => ({
            id: r.id,
            grnNumber: r.grn_number,
            poId: r.po_id ?? null,
            poCode: r.po_id ? poCodeById.get(r.po_id) ?? null : null,
            receivedDate: r.received_date ?? null,
            quantity: num(r.quantity),
            totalCost: num(r.total_cost),
        })),
        invoices,
        warnings,
    };
}
