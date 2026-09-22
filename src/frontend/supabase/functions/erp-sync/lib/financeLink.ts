/**
 * Finance over the live link: the canonical documents (canonical.ts — the
 * same ones the nightly file lane renders to CSV) shaped for S/4's document
 * APIs, exactly-once per document (the erp_outbox finance index).
 *
 *   cost_posting      → A_JournalEntry            (a G/L posting: one line, its offset is SAP's)
 *   goods_movement    → A_MaterialDocumentHeader  (one item, the movement type from movementSemantic)
 *   goods_receipt     → A_MaterialDocumentHeader  (101 against the purchase order)
 *   supplier_invoice  → A_SupplierInvoice         (gross amount, PO reference, payment block)
 *   purchase_order_line: not a finance document; stays on the file lane / PO family.
 *
 * Shapes follow the public S/4 APIs' field names where they are stable
 * (material document, supplier invoice); the journal entry is the one
 * S/4 exposes over SOAP, so its JSON shape here is the simulator's stand-in
 * and the phase-4 adapter renders it into the SOAP request. Nothing here
 * posts to a real SAP.
 *
 * Pure. The worker (erp-sync) carries a byte-identical copy alongside
 * canonical.ts and mapToCanonical.ts; functionCopy.test.ts guards it.
 */
import type {
    CanonicalDocument, CostPostingDoc, GoodsMovementDoc, GoodsReceiptDoc, SupplierInvoiceDoc, DocumentKind, MovementSemantic,
} from './canonical.ts';

export type FinanceKind = Exclude<DocumentKind, 'purchase_order_line'>;
export const FINANCE_KINDS: FinanceKind[] = ['cost_posting', 'goods_movement', 'goods_receipt', 'supplier_invoice'];

export type FinanceSet = 'A_JournalEntry' | 'A_MaterialDocumentHeader' | 'A_SupplierInvoice';

/** Where each kind lands, what IREAMS row it is, and SAP's own table name for the map. */
export const FINANCE_ROUTE: Record<FinanceKind, { set: FinanceSet; entityType: 'cost_allocation' | 'inventory_transaction' | 'goods_receipt' | 'supplier_invoice'; externalType: 'BKPF' | 'MKPF' | 'RBKP'; word: string }> = {
    cost_posting: { set: 'A_JournalEntry', entityType: 'cost_allocation', externalType: 'BKPF', word: 'Cost posting → journal entry' },
    goods_movement: { set: 'A_MaterialDocumentHeader', entityType: 'inventory_transaction', externalType: 'MKPF', word: 'Goods movement → material document' },
    goods_receipt: { set: 'A_MaterialDocumentHeader', entityType: 'goods_receipt', externalType: 'MKPF', word: 'Goods receipt → material document' },
    supplier_invoice: { set: 'A_SupplierInvoice', entityType: 'supplier_invoice', externalType: 'RBKP', word: 'Supplier invoice' },
};

export const isFinanceDoc = (d: CanonicalDocument): d is CostPostingDoc | GoodsMovementDoc | GoodsReceiptDoc | SupplierInvoiceDoc =>
    d.kind !== 'purchase_order_line';

/** SAP's goods-movement code on the header: 01 GR for PO, 03 goods issue, 04 transfer, 06 other receipts / adjustments. */
export function goodsMovementCode(m: MovementSemantic): '01' | '03' | '04' | '06' {
    switch (m) {
        case 'receipt_against_order': return '01';
        case 'issue_to_order': case 'issue_to_cost_center': case 'scrap': return '03';
        case 'transfer': return '04';
        default: return '06';
    }
}

/** The BWART, from the document's own code when the mapping supplied one, else from what the movement means. */
export function movementType(d: GoodsMovementDoc): string {
    if (d.sap_movement_type) return d.sap_movement_type;
    const by: Record<MovementSemantic, string> = {
        receipt_against_order: '101', receipt_without_order: '501', issue_to_order: '261', issue_to_cost_center: '201',
        scrap: '551', transfer: '311', count_gain: '701', count_loss: '702', reversal: '102',
    };
    return by[d.movement];
}

const money = (n: number): number => Math.round(n * 100) / 100;

export interface JournalEntryDoc {
    AccountingDocument?: string;
    CompanyCode: string;
    AccountingDocumentType: 'SA';
    DocumentDate: string;
    PostingDate: string;
    TransactionCurrency: string;
    DocumentReferenceID: string;   // our document_id — the receiver's idempotency key
    DocumentHeaderText?: string;
    IsReversal: boolean;
    to_Item: {
        GLAccount?: string;
        CostCenter?: string;
        OrderID?: string;
        AmountInTransactionCurrency: number;
        Quantity?: number;
        QuantityUnit?: string;
        ItemText: string;
    }[];
    LastChangeDateTime?: string;
}

export function toJournalEntry(d: CostPostingDoc, companyCode: string): JournalEntryDoc {
    const item: JournalEntryDoc['to_Item'][number] = {
        AmountInTransactionCurrency: money(d.amount),
        ItemText: [d.cost_type, d.work_order_ref ? `WO ${d.work_order_ref}` : '', d.asset_ref ?? ''].filter(Boolean).join(' · ').slice(0, 50),
    };
    if (d.gl_account) item.GLAccount = d.gl_account;
    if (d.cost_center_ref) item.CostCenter = d.cost_center_ref;
    if (d.work_order_ref) item.OrderID = d.work_order_ref;
    if (typeof d.quantity === 'number' && d.quantity) { item.Quantity = d.quantity; if (d.unit) item.QuantityUnit = d.unit; }
    return {
        CompanyCode: d.company_code ?? companyCode,
        AccountingDocumentType: 'SA',
        DocumentDate: d.document_date,
        PostingDate: d.document_date,
        TransactionCurrency: d.currency,
        DocumentReferenceID: d.document_id,
        DocumentHeaderText: `IREAMS ${d.cost_type.toLowerCase()} ${d.work_order_ref ?? d.asset_ref ?? d.cost_center_ref ?? ''}`.trim().slice(0, 25),
        IsReversal: d.is_reversal,
        to_Item: [item],
    };
}

export interface MaterialDocumentDoc {
    MaterialDocument?: string;
    DocumentDate: string;
    PostingDate: string;
    GoodsMovementCode: '01' | '03' | '04' | '06';
    ReferenceDocument: string;      // our document_id
    MaterialDocumentHeaderText?: string;
    to_MaterialDocumentItem: {
        Material: string;
        StorageLocation?: string;
        GoodsMovementType: string;
        QuantityInEntryUnit: number;
        EntryUnit?: string;
        PurchaseOrder?: string;
        PurchaseOrderItem?: string;
        MaintenanceOrder?: string;
        CostCenter?: string;
        GLAccount?: string;
        GoodsMovementRefDocType?: 'B';
    }[];
    LastChangeDateTime?: string;
}

export function toMaterialDocument(d: GoodsMovementDoc | GoodsReceiptDoc): MaterialDocumentDoc {
    if (d.kind === 'goods_receipt') {
        const item: MaterialDocumentDoc['to_MaterialDocumentItem'][number] = {
            Material: d.material_ref ?? '', GoodsMovementType: '101', QuantityInEntryUnit: d.quantity, GoodsMovementRefDocType: 'B',
        };
        if (d.purchase_order_ref) item.PurchaseOrder = d.purchase_order_ref;
        if (typeof d.purchase_order_line === 'number') item.PurchaseOrderItem = String(d.purchase_order_line * 10).padStart(5, '0');
        if (d.storage_location_ref) item.StorageLocation = d.storage_location_ref;
        return {
            DocumentDate: d.document_date, PostingDate: d.document_date, GoodsMovementCode: '01', ReferenceDocument: d.document_id,
            MaterialDocumentHeaderText: `GRN ${d.receipt_number}`.slice(0, 25), to_MaterialDocumentItem: [item],
        };
    }
    const item: MaterialDocumentDoc['to_MaterialDocumentItem'][number] = {
        Material: d.material_ref ?? '', GoodsMovementType: movementType(d), QuantityInEntryUnit: Math.abs(d.quantity),
    };
    if (d.unit) item.EntryUnit = d.unit;
    if (d.storage_location_ref) item.StorageLocation = d.storage_location_ref;
    if (d.purchase_order_ref) item.PurchaseOrder = d.purchase_order_ref;
    if (d.work_order_ref) item.MaintenanceOrder = d.work_order_ref;
    if (d.cost_center_ref) item.CostCenter = d.cost_center_ref;
    if (d.gl_account) item.GLAccount = d.gl_account;
    return {
        DocumentDate: d.document_date, PostingDate: d.document_date, GoodsMovementCode: goodsMovementCode(d.movement), ReferenceDocument: d.document_id,
        MaterialDocumentHeaderText: `IREAMS ${d.movement.replace(/_/g, ' ')}`.slice(0, 25), to_MaterialDocumentItem: [item],
    };
}

export interface SupplierInvoiceApiDoc {
    SupplierInvoice?: string;
    CompanyCode: string;
    DocumentDate: string;
    PostingDate: string;
    SupplierInvoiceIDByInvcgParty: string;
    InvoicingParty?: string;
    DocumentCurrency: string;
    InvoiceGrossAmount: number;
    PaymentBlockingReason?: 'A' | 'B';   // A blocked for payment (price), B (quantity) — the usual customizing, not universal
    DocumentHeaderText?: string;
    ReferenceDocument: string;           // our document_id
    to_SuplrInvcItemPurOrdRef: { PurchaseOrder?: string; SupplierInvoiceItemAmount: number; DocumentCurrency: string }[];
    LastChangeDateTime?: string;
}

export function toSupplierInvoice(d: SupplierInvoiceDoc, companyCode: string): SupplierInvoiceApiDoc {
    const doc: SupplierInvoiceApiDoc = {
        CompanyCode: d.company_code ?? companyCode,
        DocumentDate: d.document_date, PostingDate: d.document_date,
        SupplierInvoiceIDByInvcgParty: d.invoice_number.slice(0, 16),
        DocumentCurrency: d.currency,
        InvoiceGrossAmount: money(d.invoice_amount),
        DocumentHeaderText: `IREAMS ${d.match_status.toLowerCase()}${d.variance_amount ? ` var ${money(d.variance_amount)}` : ''}`.slice(0, 25),
        ReferenceDocument: d.document_id,
        to_SuplrInvcItemPurOrdRef: [{ PurchaseOrder: d.purchase_order_ref, SupplierInvoiceItemAmount: money(d.invoice_amount), DocumentCurrency: d.currency }],
    };
    if (d.supplier_ref) doc.InvoicingParty = d.supplier_ref;
    if (d.match_status === 'BLOCKED') doc.PaymentBlockingReason = d.payment_block === 'QUANTITY' ? 'B' : 'A';
    return doc;
}

/** One entry point for the worker: the wire body and where it goes. */
export function toFinancePayload(d: CanonicalDocument, companyCode: string): { set: FinanceSet; body: Record<string, unknown> } | null {
    switch (d.kind) {
        case 'cost_posting': return { set: 'A_JournalEntry', body: toJournalEntry(d, companyCode) as unknown as Record<string, unknown> };
        case 'goods_movement': case 'goods_receipt': return { set: 'A_MaterialDocumentHeader', body: toMaterialDocument(d) as unknown as Record<string, unknown> };
        case 'supplier_invoice': return { set: 'A_SupplierInvoice', body: toSupplierInvoice(d, companyCode) as unknown as Record<string, unknown> };
        default: return null;
    }
}
