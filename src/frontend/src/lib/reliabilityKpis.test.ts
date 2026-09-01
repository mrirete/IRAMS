import { describe, it, expect } from 'vitest';
import { computeMtbfMttr, computePmCompliance, computePmRatio, type KpiWoRow } from './reliabilityKpis';

const NOW = Date.UTC(2026, 6, 29);
const DAY = 86_400_000;
const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

const cm = (downtime: number | null, daysAgo = 30): KpiWoRow =>
    ({ type: 'CM', status: 'CLOSED', created_at: iso(daysAgo), actual_downtime_hrs: downtime });
const pm = (over: Partial<KpiWoRow>): KpiWoRow =>
    ({ type: 'PM', status: 'CLOSED', created_at: iso(40), ...over });

describe('computeMtbfMttr', () => {
    it('computes MTBF from operating time and REAL failure count', () => {
        // 2 assets × 30 days = 1440 calendar hours; 2 failures, 40h downtime.
        const r = computeMtbfMttr([cm(10), cm(30)], 30, 2);
        expect(r.failures).toBe(2);
        expect(r.downtimeHrs).toBe(40);
        expect(r.operatingHrs).toBe(1400);       // 1440 − 40
        expect(r.mtbfHours).toBe(700);           // 1400 / 2
        expect(r.mttrHours).toBe(20);            // 40 / 2
        expect(r.availabilityPct).toBeCloseTo(97.2, 1); // 700/(700+20)
    });

    it('ignores PM work — repair time is about failures', () => {
        const withPms = [cm(10), pm({ actual_downtime_hrs: 500 })];
        const r = computeMtbfMttr(withPms, 30, 1);
        expect(r.failures).toBe(1);
        expect(r.mttrHours).toBe(10);            // the PM's 500h never enters MTTR
    });

    it('returns null rather than a fake number when there are no failures', () => {
        const r = computeMtbfMttr([pm({})], 30, 5);
        expect(r.mtbfHours).toBeNull();
        expect(r.mttrHours).toBeNull();
        expect(r.availabilityPct).toBeNull();
    });

    it('reports downtime coverage so a thin denominator is visible', () => {
        const r = computeMtbfMttr([cm(10), cm(null), cm(null), cm(null)], 30, 1);
        expect(r.failures).toBe(4);
        expect(r.downtimeCoveragePct).toBe(25);
        expect(r.mttrHours).toBe(10);            // averaged over TIMED repairs only
    });

    it('never lets downtime drive operating hours negative', () => {
        const r = computeMtbfMttr([cm(10_000)], 1, 1);
        expect(r.operatingHrs).toBe(0);
        expect(r.mtbfHours).toBe(0);
    });
});

describe('computePmCompliance — schedule adherence, not proactive share', () => {
    const windowStart = NOW - 90 * DAY;

    it('counts PMs due in the window and those closed by their due date', () => {
        const r = computePmCompliance([
            pm({ due_date: iso(30), closed_at: iso(31) }),   // early → compliant
            pm({ due_date: iso(20), closed_at: iso(20) }),   // on the day → compliant
            pm({ due_date: iso(10), closed_at: iso(5) }),    // late → not
            pm({ due_date: iso(5), closed_at: null }),       // never closed → not
        ], windowStart, NOW);
        expect(r.due).toBe(4);
        expect(r.onTime).toBe(2);
        expect(r.compliancePct).toBe(50);
    });

    it('excludes PMs due outside the window and non-PM work', () => {
        const r = computePmCompliance([
            pm({ due_date: iso(200), closed_at: iso(201) }),
            { type: 'CM', status: 'CLOSED', created_at: iso(5), due_date: iso(5), closed_at: iso(6) },
        ], windowStart, NOW);
        expect(r.due).toBe(0);
        expect(r.compliancePct).toBeNull();
    });

    it('keeps a still-open overdue PM in the denominator however old its due date', () => {
        // The blind spot this guards against: two PMs due 6 months ago sat OPEN
        // while the sliding window aged them out — the tile read 100% beside
        // live PM-Overdue escalations.
        const r = computePmCompliance([
            pm({ due_date: iso(30), closed_at: iso(31) }),                    // in-window, on time
            pm({ status: 'OPEN', due_date: iso(180), closed_at: null }),      // ancient miss, still open → counts
            pm({ status: 'OPEN', due_date: iso(180), closed_at: null }),
        ], windowStart, NOW);
        expect(r.due).toBe(3);
        expect(r.onTime).toBe(1);
        expect(r.compliancePct).toBeCloseTo(33.3, 1);
    });

    it('covers inspections and calibrations — the one PM_WORK_TYPES list', () => {
        // The duplicate engine in services/reliabilityMetrics carried its own
        // type list (with INSPECTION, without SCHEDULED), so two pages could
        // disagree from the filter alone. One exported list now.
        const r = computePmCompliance([
            { type: 'INSPECTION', status: 'CLOSED', created_at: iso(40), due_date: iso(20), closed_at: iso(21) },
            { type: 'CALIBRATION', status: 'OPEN', created_at: iso(40), due_date: iso(10), closed_at: null },
        ], windowStart, NOW);
        expect(r.due).toBe(2);
        expect(r.onTime).toBe(1);
    });

    it('lets a miss leave the denominator only by completion or cancellation', () => {
        const r = computePmCompliance([
            pm({ status: 'CANCELLED', due_date: iso(180), closed_at: null }), // cancelled → out
            pm({ status: 'CLOSED', due_date: iso(180), closed_at: iso(150) }), // done late, pre-window → out
        ], windowStart, NOW);
        expect(r.due).toBe(0);
        expect(r.compliancePct).toBeNull();
    });
});

describe('computePmRatio — the number that was mislabelled as compliance', () => {
    it('is preventive share of all work', () => {
        const r = computePmRatio([pm({}), pm({}), pm({}), cm(1)]);
        expect(r).toMatchObject({ preventive: 3, corrective: 1, ratioPct: 75 });
    });

    it('is null on an empty set instead of 0%', () => {
        expect(computePmRatio([]).ratioPct).toBeNull();
    });
});
