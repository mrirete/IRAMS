import { describe, it, expect } from 'vitest';
import { computeRenewalQueue, type LifecycleRow } from './renewal';

const NOW = new Date('2026-08-31T00:00:00Z').getTime();

const base: LifecycleRow = {
    asset_id: 'a1', asset_tag: 'PMP-1', asset_name: 'Pump 1', criticality: 'B',
    wo_count_lifetime: 10,
    maint_cost_lifetime: 50000, maint_cost_12mo: 0, maint_cost_prior12: 0,
    unplanned_downtime_hrs_12mo: 0,
    acquisition_cost: 100000, acquisition_date: '2020-01-01',
    useful_life_months: 120, replacement_value: null, asset_downtime_rate: null,
};

describe('computeRenewalQueue', () => {
    it('is silent for assets with no recent spend — screening works off evidence', () => {
        expect(computeRenewalQueue([base], null, NOW)).toEqual([]);
    });

    it('flags high maintenance intensity against replacement value', () => {
        const [c] = computeRenewalQueue([{
            ...base, maint_cost_12mo: 55000, maint_cost_prior12: 20000, replacement_value: 100000,
        }], null, NOW);
        expect(c).toBeDefined();
        expect(c.intensityPct).toBe(55);
        expect(c.reasons.join(' ')).toMatch(/55% of its replacement value/);
        // Trend also fired (55k vs 20k = +175%)
        expect(c.reasons.join(' ')).toMatch(/grew 175%/);
        expect(c.score).toBeGreaterThan(40);
    });

    it('monetizes downtime only when a rate exists, and prices with the asset rate first', () => {
        const withRate = computeRenewalQueue([{
            ...base, maint_cost_12mo: 25000, maint_cost_prior12: 24000,
            unplanned_downtime_hrs_12mo: 40, asset_downtime_rate: 500,
        }], 2000, NOW)[0];
        expect(withRate.downtimeCost12mo).toBe(20000); // 40h × asset $500, NOT company $2000
        expect(withRate.annualCost12mo).toBe(45000);

        const noRate = computeRenewalQueue([{
            ...base, maint_cost_12mo: 25000, maint_cost_prior12: 24000,
            unplanned_downtime_hrs_12mo: 40,
        }], null, NOW)[0];
        expect(noRate.downtimeCost12mo).toBeNull();
        expect(noRate.reasons.join(' ')).toMatch(/set a production-loss rate/);
    });

    it('scores age past 80% of planned life and amplifies criticality A', () => {
        const rows: LifecycleRow[] = [
            { ...base, asset_id: 'old', asset_tag: 'OLD', criticality: 'A', maint_cost_12mo: 30000, maint_cost_prior12: 28000, acquisition_date: '2016-09-01', useful_life_months: 120 },
            { ...base, asset_id: 'young', asset_tag: 'YNG', criticality: 'C', maint_cost_12mo: 30000, maint_cost_prior12: 28000, acquisition_date: '2025-01-01', useful_life_months: 120 },
        ];
        const q = computeRenewalQueue(rows, null, NOW);
        expect(q[0].assetId).toBe('old');
        expect(q[0].reasons.join(' ')).toMatch(/planned life/);
        expect(q[0].score).toBeGreaterThan(q[1].score);
    });

    it('caps the score at 100 and ranks descending', () => {
        const q = computeRenewalQueue([
            { ...base, asset_id: 'x', maint_cost_12mo: 90000, maint_cost_prior12: 30000, replacement_value: 80000, unplanned_downtime_hrs_12mo: 200, asset_downtime_rate: 1000, acquisition_date: '2014-01-01', criticality: 'A' },
            { ...base, asset_id: 'y', maint_cost_12mo: 25000, maint_cost_prior12: 24000, replacement_value: 100000 },
        ], null, NOW);
        expect(q[0].assetId).toBe('x');
        expect(q[0].score).toBeLessThanOrEqual(100);
        expect(q[1].score).toBeLessThan(q[0].score);
    });
});
