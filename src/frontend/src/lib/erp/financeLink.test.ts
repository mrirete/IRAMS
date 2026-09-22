import { describe, it, expect } from 'vitest';
import { goodsMovementCode, movementType, toJournalEntry, toMaterialDocument, toSupplierInvoice, toFinancePayload, FINANCE_ROUTE, isFinanceDoc } from './financeLink';
import type { CostPostingDoc, GoodsMovementDoc, GoodsReceiptDoc, SupplierInvoiceDoc, PurchaseOrderLineDoc } from './canonical';

const posting: CostPostingDoc = { kind: 'cost_posting', document_id: 'd1', document_date: '2026-09-22', cost_type: 'LABOR', amount: 125.456, currency: 'USD', cost_center_ref: '1000-PROD', work_order_ref: 'WO-2026-01000', asset_ref: 'P-101-A', gl_account: '600100', quantity: 2.5, unit: 'H', is_reversal: false };
const movement: GoodsMovementDoc = { kind: 'goods_movement', document_id: 'm1', document_date: '2026-09-22', movement: 'issue_to_order', material_ref: 'MAT-001', storage_location_ref: 'MAIN', quantity: -3, unit: 'EA', unit_cost: 10, value: -30, work_order_ref: 'WO-2026-01000', cost_center_ref: '1000-PROD', gl_account: '400100' };
const receipt: GoodsReceiptDoc = { kind: 'goods_receipt', document_id: 'g1', document_date: '2026-09-22', receipt_number: 'GRN-0001', purchase_order_ref: 'PO-2026-0001', purchase_order_line: 2, material_ref: 'MAT-001', quantity: 10, unit_cost: 10, total_value: 100, storage_location_ref: 'MAIN' };
const invoice: SupplierInvoiceDoc = { kind: 'supplier_invoice', document_id: 'i1', document_date: '2026-09-22', invoice_number: 'INV-123456789012345678', supplier_ref: '100234', purchase_order_ref: 'PO-2026-0001', invoice_amount: 101.005, currency: 'EUR', match_status: 'BLOCKED', payment_block: 'QUANTITY', variance_amount: 1.005 };

describe('journal entries', () => {
    it('renders a cost posting as one SA line with the refs SAP can post against, rounded to cents', () => {
        const j = toJournalEntry(posting, '1000');
        expect(j.CompanyCode).toBe('1000');
        expect(j.AccountingDocumentType).toBe('SA');
        expect(j.DocumentReferenceID).toBe('d1');
        expect(j.IsReversal).toBe(false);
        expect(j.to_Item).toEqual([{ GLAccount: '600100', CostCenter: '1000-PROD', OrderID: 'WO-2026-01000', AmountInTransactionCurrency: 125.46, Quantity: 2.5, QuantityUnit: 'H', ItemText: 'LABOR · WO WO-2026-01000 · P-101-A' }]);
        expect(j.DocumentHeaderText!.length).toBeLessThanOrEqual(25);
        expect(toJournalEntry({ ...posting, company_code: '2000' }, '1000').CompanyCode).toBe('2000');
    });
});

describe('material documents', () => {
    it('maps movement meaning to header code and BWART', () => {
        expect(goodsMovementCode('receipt_against_order')).toBe('01');
        expect(goodsMovementCode('issue_to_order')).toBe('03');
        expect(goodsMovementCode('transfer')).toBe('04');
        expect(goodsMovementCode('count_gain')).toBe('06');
        expect(movementType(movement)).toBe('261');
        expect(movementType({ ...movement, sap_movement_type: '262' })).toBe('262');
    });
    it('renders an issue to a work order with positive entry quantity', () => {
        const m = toMaterialDocument(movement);
        expect(m.GoodsMovementCode).toBe('03');
        expect(m.ReferenceDocument).toBe('m1');
        expect(m.to_MaterialDocumentItem).toEqual([{ Material: 'MAT-001', GoodsMovementType: '261', QuantityInEntryUnit: 3, EntryUnit: 'EA', StorageLocation: 'MAIN', MaintenanceOrder: 'WO-2026-01000', CostCenter: '1000-PROD', GLAccount: '400100' }]);
    });
    it('renders a receipt as 101 against the PO line (item 00020)', () => {
        const m = toMaterialDocument(receipt);
        expect(m.GoodsMovementCode).toBe('01');
        expect(m.MaterialDocumentHeaderText).toBe('GRN GRN-0001');
        expect(m.to_MaterialDocumentItem).toEqual([{ Material: 'MAT-001', GoodsMovementType: '101', QuantityInEntryUnit: 10, GoodsMovementRefDocType: 'B', PurchaseOrder: 'PO-2026-0001', PurchaseOrderItem: '00020', StorageLocation: 'MAIN' }]);
    });
});

describe('supplier invoices', () => {
    it('renders the gross amount, PO reference and a quantity block, invoice id clipped to 16', () => {
        const s = toSupplierInvoice(invoice, '1000');
        expect(s.SupplierInvoiceIDByInvcgParty).toBe('INV-123456789012');
        expect(s.InvoicingParty).toBe('100234');
        expect(s.InvoiceGrossAmount).toBe(101.01);
        expect(s.DocumentCurrency).toBe('EUR');
        expect(s.PaymentBlockingReason).toBe('B');
        expect(s.to_SuplrInvcItemPurOrdRef).toEqual([{ PurchaseOrder: 'PO-2026-0001', SupplierInvoiceItemAmount: 101.01, DocumentCurrency: 'EUR' }]);
        expect(toSupplierInvoice({ ...invoice, match_status: 'MATCHED', payment_block: undefined }, '1000').PaymentBlockingReason).toBeUndefined();
        expect(toSupplierInvoice({ ...invoice, payment_block: 'PRICE' }, '1000').PaymentBlockingReason).toBe('A');
    });
});

describe('routing', () => {
    it('routes each kind to its set, and leaves PO lines out', () => {
        expect(toFinancePayload(posting, '1000')?.set).toBe('A_JournalEntry');
        expect(toFinancePayload(movement, '1000')?.set).toBe('A_MaterialDocumentHeader');
        expect(toFinancePayload(receipt, '1000')?.set).toBe('A_MaterialDocumentHeader');
        expect(toFinancePayload(invoice, '1000')?.set).toBe('A_SupplierInvoice');
        const line: PurchaseOrderLineDoc = { kind: 'purchase_order_line', document_id: 'l1', document_date: '2026-09-22', purchase_order_ref: 'PO-1', line_number: 1, line_type: 'MATERIAL', description: 'x', quantity_ordered: 1, quantity_received: 0, unit_cost: 1, net_value: 1 };
        expect(toFinancePayload(line, '1000')).toBeNull();
        expect(isFinanceDoc(line)).toBe(false);
        expect(FINANCE_ROUTE.cost_posting.externalType).toBe('BKPF');
        expect(FINANCE_ROUTE.goods_receipt.entityType).toBe('goods_receipt');
    });
});
