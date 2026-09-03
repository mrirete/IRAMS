import { describe, it, expect } from 'vitest';
import { computeOee7, downtimeBucket, SMRP_TABLE1_EXAMPLE } from './oee7';

describe('computeOee7 — SMRP 7th Edition 2.1.1 / 2.1.2 / 2.2 / 2.4 / 2.5', () => {
    it('reproduces the 2.1.1 Table 1 worked example (Machine D)', () => {
        const r = computeOee7(SMRP_TABLE1_EXAMPLE);
        expect(r.scheduledHrs).toBe(16);          // 24 − 8 idle
        expect(r.uptimeHrs).toBeCloseTo(12.26, 2);
        expect(r.availabilityPct).toBeCloseTo(76.6, 1);   // 12.26 / 16
        expect(r.performancePct).toBeCloseTo(59.9, 1);    // 100 / 167
        expect(r.qualityPct).toBe(92);
        expect(r.oeePct).toBeCloseTo(42.2, 1);
    });

    it('reproduces the 2.1.2 TEEP example: utilization × OEE', () => {
        const r = computeOee7(SMRP_TABLE1_EXAMPLE);
        expect(r.utilizationPct).toBeCloseTo(66.7, 1);    // 16 / 24
        expect(r.teepPct).toBeCloseTo(28.1, 1);
    });

    it('keeps scheduled downtime in the availability denominator, idle time out', () => {
        const base = { totalAvailableHrs: 100, idleHrs: 0, scheduledDowntimeHrs: 0, unscheduledDowntimeHrs: 0, bestRatePerHr: 10, actualProduction: 1000, firstPassGood: 1000 };
        expect(computeOee7({ ...base, idleHrs: 20 }).availabilityPct).toBe(100);        // 80 / 80
        expect(computeOee7({ ...base, scheduledDowntimeHrs: 20 }).availabilityPct).toBe(80); // 80 / 100
    });

    it('flags performance above 100% and caps it in the product', () => {
        const r = computeOee7({ totalAvailableHrs: 10, idleHrs: 0, scheduledDowntimeHrs: 0, unscheduledDowntimeHrs: 0, bestRatePerHr: 10, actualProduction: 120, firstPassGood: 120 });
        expect(r.performanceRawPct).toBe(120);
        expect(r.performancePct).toBe(100);
        expect(r.oeePct).toBe(100);
        expect(r.warnings.some(w => w.includes('exceeds 100%'))).toBe(true);
    });

    it('returns null legs rather than zeros when there is no basis', () => {
        const r = computeOee7({ totalAvailableHrs: 0, idleHrs: 0, scheduledDowntimeHrs: 0, unscheduledDowntimeHrs: 0, bestRatePerHr: 0, actualProduction: 0, firstPassGood: 0 });
        expect(r.availabilityPct).toBeNull();
        expect(r.performancePct).toBeNull();
        expect(r.qualityPct).toBeNull();
        expect(r.oeePct).toBeNull();
        expect(r.teepPct).toBeNull();
    });
});

describe('downtimeBucket — production_logs reasons on the 7th-edition timeline', () => {
    it('sends no-demand and material shortages to idle time', () => {
        expect(downtimeBucket('NO_DEMAND')).toBe('idle');
        expect(downtimeBucket('material')).toBe('idle');
    });
    it('sends planned maintenance to scheduled downtime, the rest to unscheduled', () => {
        expect(downtimeBucket('PLANNED_MAINT')).toBe('scheduled');
        expect(downtimeBucket('BREAKDOWN')).toBe('unscheduled');
        expect(downtimeBucket('SETUP')).toBe('unscheduled');
        expect(downtimeBucket(null)).toBe('unscheduled');
    });
});
