import { describe, it, expect } from 'vitest';
import {
    mapCostPosting, mapGoodsMovement, mapGoodsReceipt,
    mapPurchaseOrderLine, mapSupplierInvoice,
} from './mapToCanonical';
import { movementSemantic } from './canonical';

const ok = <T>(r: { doc: T } | { skipped: unknown }): T => {
    if (!('doc' in r)) throw new Error(`expected a document, got skip: ${JSON.stringify(r)}`);
    return r.doc;
};
const skipReason = (r: any): string => {
    if (!('skipped' in r)) throw new Error('expected a skip');
    return r.skipped.reason;
};

describe('movementSemantic', () => {
    it('maps SAP codes to what they mean', () => {
        expect(movementSemantic('261')).toBe('issue_to_order');
        expect(movementSemantic('201')).toBe('issue_to_cost_center');
        expect(movementSemantic('101')).toBe('receipt_against_order');
        expect(movementSemantic('702')).toBe('count_loss');
    });

    it('treats every reversal code as a reversal', () => {
        for (const code of ['102', '202', '262', '552']) {
            expect(movementSemantic(code)).toBe('reversal');
        }
    });

    it('falls back to the one semantic with no financial consequence', () => {
        // Guessing issue_to_order would invent a cost against a work order.
        expect(movementSemantic('999')).toBe('transfer');
        expect(movementSemantic(null)).toBe('transfer');
        expect(movementSemantic(undefined)).toBe('transfer');
    });
});

describe('mapCostPosting', () => {
    const row = {
        id: 'ca-1', posting_date: '2026-08-04', cost_type: 'LABOR', amount: '150.00',
        quantity: '2.5', unit: 'H',
        cost_centers: { code: 'CC-MNT-01', gl_account: '400100' },
        work_orders: { wo_number: 'WO-2026-4526' },
        assets: { tag: 'PMP-101' },
    };

    it('carries both settlement receivers, not one', () => {
        const doc = ok(mapCostPosting(row));
        expect(doc.cost_center_ref).toBe('CC-MNT-01');
        expect(doc.asset_ref).toBe('PMP-101');
        expect(doc.amount).toBe(150);
        expect(doc.gl_account).toBe('400100');
    });

    it('reads a negative amount as a reversal', () => {
        const doc = ok(mapCostPosting({ ...row, amount: '-150.00' }));
        expect(doc.is_reversal).toBe(true);
        expect(doc.amount).toBe(-150);
    });

    it('does not treat an ordinary posting as a reversal', () => {
        expect(ok(mapCostPosting(row)).is_reversal).toBe(false);
    });

    it('skips a posting no receiver can resolve rather than sending noise', () => {
        const orphan = { id: 'ca-2', amount: '99', posting_date: '2026-08-04' };
        expect(skipReason(mapCostPosting(orphan))).toMatch(/nothing the receiver can post against/);
    });

    it('skips a zero amount — a zero delta is not a document', () => {
        expect(skipReason(mapCostPosting({ ...row, amount: '0' }))).toMatch(/zero amount/);
    });

    it('truncates a timestamp to the day it happened', () => {
        const doc = ok(mapCostPosting({ ...row, posting_date: '2026-08-04T13:45:12.123Z' }));
        expect(doc.document_date).toBe('2026-08-04');
    });

    it('uses our own id so re-export is recognisable', () => {
        expect(ok(mapCostPosting(row)).document_id).toBe('ca-1');
    });
});

describe('mapGoodsMovement', () => {
    const row = {
        movement_id: 'mv-1', moved_at: '2026-08-04T09:00:00Z', movement_type: '261',
        material_number: 'MAT-9001', part_number: 'BRG-6205',
        quantity: '3', cost_at_time: '25.00', total_value: '75.00',
        wo_id: 'wo-1', cost_center_id: 'cc-1',
    };

    it('carries the semantic, with the SAP code only as a hint', () => {
        const doc = ok(mapGoodsMovement(row));
        expect(doc.movement).toBe('issue_to_order');
        expect(doc.sap_movement_type).toBe('261');
    });

    it('prefers the material number over the internal part number', () => {
        expect(ok(mapGoodsMovement(row)).material_ref).toBe('MAT-9001');
    });

    it('falls back to the part number when no material number is mapped', () => {
        const { material_number, ...noMaterial } = row;
        expect(ok(mapGoodsMovement(noMaterial)).material_ref).toBe('BRG-6205');
    });

    it('skips an item the receiver could not identify', () => {
        const { material_number, part_number, ...anonymous } = row;
        expect(skipReason(mapGoodsMovement(anonymous))).toMatch(/cannot identify/);
    });

    it('keeps the expense sign the database computed', () => {
        expect(ok(mapGoodsMovement({ ...row, total_value: '-75.00' })).value).toBe(-75);
    });
});

describe('mapGoodsReceipt', () => {
    const row = {
        id: 'gr-1', grn_number: 'GRN-2026-000002', received_date: '2026-08-04',
        quantity: '6', unit_cost: '100', total_cost: '600',
        purchase_orders: { po_code: 'PO-2026-1001' },
        purchase_order_lines: { line_no: 800 },
        inventory_items: { material_number: 'MAT-9001' },
    };

    it('carries the PO line so the receiver can match it', () => {
        const doc = ok(mapGoodsReceipt(row));
        expect(doc.purchase_order_ref).toBe('PO-2026-1001');
        expect(doc.purchase_order_line).toBe(800);
        expect(doc.receipt_number).toBe('GRN-2026-000002');
    });

    it('skips a receipt with no document number', () => {
        expect(skipReason(mapGoodsReceipt({ ...row, grn_number: '' }))).toMatch(/no GRN number/);
    });
});

describe('mapPurchaseOrderLine', () => {
    const row = {
        line_id: 'pol-1', po_code: 'PO-2026-1001', line_no: 10, line_type: 'SERVICE',
        description: 'Contractor crane hire', qty_ordered: '1', qty_received: '1',
        unit_cost: '1200', line_total: '1200', uom: 'DAY', wo_number: 'WO-2026-4526',
    };

    it('keeps the material/service distinction the settlement rule depends on', () => {
        expect(ok(mapPurchaseOrderLine(row)).line_type).toBe('SERVICE');
        expect(ok(mapPurchaseOrderLine({ ...row, line_type: 'MATERIAL' })).line_type).toBe('MATERIAL');
    });

    it('defaults an unrecognised line type to MATERIAL', () => {
        expect(ok(mapPurchaseOrderLine({ ...row, line_type: 'WHATEVER' })).line_type).toBe('MATERIAL');
    });

    it('skips a line with no PO code', () => {
        expect(skipReason(mapPurchaseOrderLine({ ...row, po_code: '' }))).toMatch(/no PO code/);
    });
});

describe('mapSupplierInvoice', () => {
    const row = {
        invoice_id: 'inv-1', invoice_number: 'INV-QTY-3', invoice_date: '2026-08-04',
        invoice_amount: '1000', match_status: 'BLOCKED', payment_block: 'QUANTITY',
        variance_amount: '400', po_code: 'PO-2026-1001',
    };

    it('sends the verdict with the invoice — their AP team decides what to do', () => {
        const doc = ok(mapSupplierInvoice(row));
        expect(doc.match_status).toBe('BLOCKED');
        expect(doc.payment_block).toBe('QUANTITY');
        expect(doc.variance_amount).toBe(400);
    });

    it('never invents a block reason it does not recognise', () => {
        expect(ok(mapSupplierInvoice({ ...row, payment_block: 'MYSTERY' })).payment_block).toBeUndefined();
    });

    it('treats any unrecognised status as PENDING, not as cleared', () => {
        expect(ok(mapSupplierInvoice({ ...row, match_status: 'WEIRD' })).match_status).toBe('PENDING');
        expect(ok(mapSupplierInvoice({ ...row, match_status: '' })).match_status).toBe('PENDING');
    });
});
