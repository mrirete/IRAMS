import { describe, it, expect } from 'vitest';
import { FileEmitter, toCsv, batchToFiles } from './emitters';
import type { CanonicalBatch, CanonicalDocument } from './canonical';

const costPosting = (over: Partial<any> = {}): CanonicalDocument => ({
    kind: 'cost_posting', document_id: 'ca-1', document_date: '2026-08-04',
    cost_type: 'LABOR', amount: 150, currency: 'USD',
    cost_center_ref: 'CC-MNT-01', work_order_ref: 'WO-1', is_reversal: false, ...over,
});

const movement = (over: Partial<any> = {}): CanonicalDocument => ({
    kind: 'goods_movement', document_id: 'mv-1', document_date: '2026-08-04',
    movement: 'issue_to_order', sap_movement_type: '261', material_ref: 'MAT-9001',
    quantity: 3, unit_cost: 25, value: 75, ...over,
});

const batch = (documents: CanonicalDocument[], skipped: any[] = []): CanonicalBatch =>
    ({ from: '2026-08-01', to: '2026-08-04', documents, skipped });

describe('FileEmitter', () => {
    const emitter = new FileEmitter();

    it('groups documents into one table per family', () => {
        const out = emitter.render(batch([costPosting(), movement(), costPosting({ document_id: 'ca-2' })]));
        expect(out.tables.map(t => t.kind)).toEqual(['cost_posting', 'goods_movement']);
        expect(out.tables[0].rows).toHaveLength(2);
        expect(out.tables[1].rows).toHaveLength(1);
    });

    it('keeps table order stable regardless of what the period contained', () => {
        // Movements first on the way in; cost postings still render first.
        const out = emitter.render(batch([movement(), costPosting()]));
        expect(out.tables.map(t => t.kind)).toEqual(['cost_posting', 'goods_movement']);
    });

    it('omits a family entirely when the period had none of it', () => {
        const out = emitter.render(batch([costPosting()]));
        expect(out.tables).toHaveLength(1);
    });

    it('renders every declared column, present or not', () => {
        const out = emitter.render(batch([costPosting({ asset_ref: undefined, gl_account: undefined })]));
        const table = out.tables[0];
        for (const col of table.columns) {
            expect(table.rows[0]).toHaveProperty(col);
        }
    });

    it('writes an absent value as an empty cell, never "undefined"', () => {
        const out = emitter.render(batch([costPosting({ asset_ref: undefined })]));
        expect(out.tables[0].rows[0].asset).toBe('');
    });

    it('renders a boolean as a flag rather than true/false', () => {
        const out = emitter.render(batch([costPosting({ is_reversal: true })]));
        expect(out.tables[0].rows[0].is_reversal).toBe('X');
        const plain = emitter.render(batch([costPosting({ is_reversal: false })]));
        expect(plain.tables[0].rows[0].is_reversal).toBe('');
    });

    it('carries the semantic AND the SAP hint, so a non-SAP target is not stuck', () => {
        const row = emitter.render(batch([movement()])).tables[0].rows[0];
        expect(row.movement).toBe('issue_to_order');
        expect(row.sap_movement_type).toBe('261');
    });

    it('reports what it could not express instead of dropping it', () => {
        const out = emitter.render(batch([costPosting()], [
            { document_id: 'ca-9', kind: 'cost_posting', reason: 'no receiver' },
        ]));
        expect(out.skipped).toHaveLength(1);
        expect(out.notes.join(' ')).toMatch(/NOT sent/);
    });

    it('states the period, because a batch is a period and not a watermark', () => {
        const out = emitter.render(batch([costPosting()]));
        expect(out.notes[0]).toContain('2026-08-01');
        expect(out.notes[0]).toContain('2026-08-04');
    });

    it('renders the same batch identically twice — a re-export is safe', () => {
        const b = batch([costPosting(), movement()]);
        expect(JSON.stringify(emitter.render(b))).toBe(JSON.stringify(emitter.render(b)));
    });
});

describe('toCsv', () => {
    const table = { kind: 'cost_posting' as const, columns: ['a', 'b'], rows: [] as any[] };

    it('emits a header even with no rows, so a receiver can still parse it', () => {
        expect(toCsv(table)).toBe('a,b');
    });

    it('quotes a value containing a comma', () => {
        const csv = toCsv({ ...table, rows: [{ a: 'Bearing, 6205', b: 1 }] });
        expect(csv.split('\r\n')[1]).toBe('"Bearing, 6205",1');
    });

    it('doubles an embedded quote', () => {
        const csv = toCsv({ ...table, rows: [{ a: 'Seal 2"', b: 1 }] });
        expect(csv.split('\r\n')[1]).toBe('"Seal 2""",1');
    });

    it('quotes a value containing a newline', () => {
        const csv = toCsv({ ...table, rows: [{ a: 'line1\nline2', b: 1 }] });
        expect(csv).toContain('"line1\nline2"');
    });

    it('writes columns in the declared order, not the object key order', () => {
        const csv = toCsv({ ...table, rows: [{ b: 2, a: 1 } as any] });
        expect(csv.split('\r\n')[1]).toBe('1,2');
    });

    it('uses CRLF, which is what middleware file pickups expect', () => {
        const csv = toCsv({ ...table, rows: [{ a: 1, b: 2 }] });
        expect(csv).toContain('\r\n');
    });
});

describe('batchToFiles', () => {
    it('names each file by family and period so a pickup rule can match it', () => {
        const out = new FileEmitter().render(batch([costPosting(), movement()]));
        const files = batchToFiles(out);
        expect(files.map(f => f.name)).toEqual([
            'ireams_cost_posting_2026-08-01_2026-08-04.csv',
            'ireams_goods_movement_2026-08-01_2026-08-04.csv',
        ]);
    });

    it('produces no file for a family with nothing in it', () => {
        const out = new FileEmitter().render(batch([costPosting()]));
        expect(batchToFiles(out)).toHaveLength(1);
    });
});
