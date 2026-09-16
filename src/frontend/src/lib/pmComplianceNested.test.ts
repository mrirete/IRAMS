import { describe, it, expect } from 'vitest';
import { computePmCompliance, expandIncludedScopes } from './reliabilityKpis';

const day = (d: string) => new Date(d + 'T00:00:00Z').getTime();

describe('0366 — nested-interval occurrences count in PM compliance', () => {
    const sixMonthly = {
        type: 'PM', status: 'CLOSED', created_at: '2026-02-20T00:00:00Z',
        due_date: '2026-03-01T00:00:00Z', closed_at: '2026-03-01T10:00:00Z',
        properties: { included_scopes: [{ dueDate: '2026-03-01' }] },
    };

    it('expands one order into one row per satisfied occurrence', () => {
        const rows = expandIncludedScopes([sixMonthly]);
        expect(rows).toHaveLength(2);
        expect(rows[1].due_date).toBe('2026-03-01');
        expect(rows[1].properties).toBeNull();
    });

    it('the superseded 3-monthly is due AND on time when the 6-monthly order closes on time', () => {
        const r = computePmCompliance([sixMonthly], day('2026-02-01'), day('2026-03-31'));
        expect(r.due).toBe(2);
        expect(r.onTime).toBe(2);
        expect(r.compliancePct).toBe(100);
    });

    it('…and both are late when the order closes late', () => {
        const late = { ...sixMonthly, closed_at: '2026-03-05T10:00:00Z' };
        const r = computePmCompliance([late], day('2026-02-01'), day('2026-03-31'));
        expect(r.due).toBe(2);
        expect(r.onTime).toBe(0);
    });

    it('orders without nested scopes are unchanged', () => {
        const plain = { ...sixMonthly, properties: null };
        expect(computePmCompliance([plain], day('2026-02-01'), day('2026-03-31')).due).toBe(1);
    });
});
