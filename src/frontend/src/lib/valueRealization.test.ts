import { describe, it, expect } from 'vitest';
import { computeRealization, REALIZATION_MATURITY_DAYS } from './valueRealization';

const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 6, 27); // fixed clock — the module takes nowMs explicitly
const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY_MS).toISOString();

const cm = (assetId: string, daysAgo: number, cost: number) => ({
    asset_id: assetId, type: 'CM', created_at: iso(daysAgo), cost,
});

describe('computeRealization', () => {
    it('measures a reduced corrective run-rate after approval', () => {
        // Before: $36,500 over the prior year → $100/day. After (100 days): $2,000 → $20/day.
        const actions = [{ asset_id: 'A', approved_at: iso(100) }];
        const wos = [
            cm('A', 130, 20000), cm('A', 200, 16500),
            cm('A', 40, 2000),
        ];
        const r = computeRealization(actions, wos, NOW);
        expect(r.assetsMeasured).toBe(1);
        expect(r.assetsMaturing).toBe(0);
        // (100 − 20) $/day × 100 days = $8,000
        expect(r.perAsset[0].measuredToDate).toBe(8000);
        expect(r.measuredToDate).toBe(8000);
        expect(r.perAsset[0].beforeAnnualRate).toBe(36500);
        expect(r.perAsset[0].afterAnnualRate).toBe(7300);
    });

    it('reports a worsening asset as a negative delta, not zero', () => {
        const actions = [{ asset_id: 'A', approved_at: iso(100) }];
        const wos = [cm('A', 400, 0), cm('A', 10, 5000)]; // nothing before, $5k after
        const r = computeRealization(actions, wos, NOW);
        expect(r.perAsset[0].measuredToDate).toBeLessThan(0);
        expect(r.measuredToDate).toBeLessThan(0);
    });

    it('holds assets inside the maturity window as maturing, not measured', () => {
        const actions = [{ asset_id: 'A', approved_at: iso(REALIZATION_MATURITY_DAYS - 5) }];
        const r = computeRealization(actions, [cm('A', 60, 1000)], NOW);
        expect(r.assetsMeasured).toBe(0);
        expect(r.assetsMaturing).toBe(1);
        expect(r.measuredToDate).toBe(0);
    });

    it('counts an asset once across multiple approvals, from the earliest', () => {
        const actions = [
            { asset_id: 'A', approved_at: iso(50) },
            { asset_id: 'A', approved_at: iso(200) },
        ];
        const wos = [cm('A', 300, 36500), cm('A', 20, 0)];
        const r = computeRealization(actions, wos, NOW);
        expect(r.assetsMeasured).toBe(1);
        expect(r.perAsset[0].elapsedDays).toBe(200);
    });

    it('ignores PM work, actions without assets, and unparsable stamps', () => {
        const actions = [
            { asset_id: null, approved_at: iso(100) },
            { asset_id: 'A', approved_at: 'not-a-date' },
            { asset_id: 'B', approved_at: iso(100) },
        ];
        const wos = [
            { asset_id: 'B', type: 'PM', created_at: iso(150), cost: 9999 },
            cm('B', 150, 3650),
        ];
        const r = computeRealization(actions, wos, NOW);
        expect(r.assetsMeasured).toBe(1);
        expect(r.perAsset[0].assetId).toBe('B');
        // before daily = 3650/365 = 10; after = 0 → 10 × 100 days
        expect(r.perAsset[0].measuredToDate).toBe(1000);
    });
});
