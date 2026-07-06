import { describe, it, expect } from 'vitest';
import { computeReadingDue, summariseDue, isDueNow, type DuePointInput } from './readingDue';

const TODAY = new Date('2026-07-06T12:00:00Z');
const p = (over: Partial<DuePointInput> = {}): DuePointInput => ({ definitionId: 'd1', assetId: 'a1', criticality: 'B', ...over });

// B criticality → 30-day interval.
describe('computeReadingDue', () => {
    it('flags a never-read point as NEVER', () => {
        const [r] = computeReadingDue([p({ lastReadingDate: null })], TODAY);
        expect(r.status).toBe('NEVER');
        expect(r.daysOverdue).toBeNull();
        expect(r.nextDueDate).toBeNull();
    });

    it('OK when the last reading is within the interval', () => {
        const [r] = computeReadingDue([p({ lastReadingDate: '2026-07-01' })], TODAY); // 5 days ago, interval 30
        expect(r.status).toBe('OK');
        expect(r.daysOverdue).toBeLessThan(0);
    });

    it('DUE exactly on the due date', () => {
        const [r] = computeReadingDue([p({ lastReadingDate: '2026-06-06' })], TODAY); // +30d = 2026-07-06
        expect(r.status).toBe('DUE');
        expect(r.daysOverdue).toBe(0);
        expect(r.nextDueDate).toBe('2026-07-06');
    });

    it('OVERDUE past the due date, with day count', () => {
        const [r] = computeReadingDue([p({ lastReadingDate: '2026-05-01' })], TODAY); // +30d = 2026-05-31, ~36 late
        expect(r.status).toBe('OVERDUE');
        expect(r.daysOverdue).toBe(36);
    });

    it('interval scales with criticality (A weekly is stricter than C quarterly)', () => {
        const last = '2026-06-20'; // 16 days ago
        const [a] = computeReadingDue([p({ criticality: 'A', lastReadingDate: last })], TODAY); // 7d → overdue
        const [c] = computeReadingDue([p({ criticality: 'C', lastReadingDate: last })], TODAY); // 90d → OK
        expect(a.status).toBe('OVERDUE');
        expect(c.status).toBe('OK');
    });
});

describe('summariseDue + isDueNow', () => {
    it('counts each status bucket and flags due-now', () => {
        const results = computeReadingDue([
            p({ definitionId: 'd1', lastReadingDate: null }),          // NEVER
            p({ definitionId: 'd2', lastReadingDate: '2026-05-01' }),  // OVERDUE
            p({ definitionId: 'd3', lastReadingDate: '2026-06-06' }),  // DUE
            p({ definitionId: 'd4', lastReadingDate: '2026-07-01' }),  // OK
        ], TODAY);
        const s = summariseDue(results);
        expect(s).toMatchObject({ never: 1, overdue: 1, due: 1, ok: 1, total: 4 });
        expect(results.filter(isDueNow)).toHaveLength(3);
    });
});
