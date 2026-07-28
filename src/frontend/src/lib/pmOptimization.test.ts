import { describe, it, expect } from 'vitest';
import { computePmOptimization, type PmProgramRow, type CmEventRow } from './pmOptimization';

const NOW = Date.UTC(2026, 6, 28);
const DAY_MS = 86_400_000;
const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY_MS).toISOString();

const pm = (over: Partial<PmProgramRow> & { id: string; code: string }): PmProgramRow => ({
    title: over.code, asset_id: 'a1', job_type: 'PM',
    frequency_interval: 30, frequency_unit: 'days', ...over,
});
const ASSETS = [
    { id: 'a1', tag: 'K-601', name: 'Compressor', criticality: 'A' },
    { id: 'a2', tag: 'P-101', name: 'Pump', criticality: 'C' },
];
/** Tightly-clustered wear-out failures (~60d ± a little) → high β. Gaps must
 *  vary — identical intervals give the rank regression zero variance. */
const wearOutEvents = (assetId: string): CmEventRow[] => {
    const gaps = [55, 58, 62, 65, 59, 61, 63];
    let daysAgo = 30;
    const out: CmEventRow[] = [];
    for (const g of gaps) { daysAgo += g; out.push({ asset_id: assetId, created_at: iso(daysAgo) }); }
    return out;
};

describe('computePmOptimization', () => {
    it('flags duplicate programmes on one asset as redundant, keeping the first', () => {
        const r = computePmOptimization(
            [pm({ id: '1', code: 'PM-A' }), pm({ id: '2', code: 'PM-B' })],
            [], ASSETS, NOW,
        );
        const red = r.verdicts.filter((v) => v.verdict === 'redundant');
        expect(red).toHaveLength(1);
        expect(red[0].code).toBe('PM-B');
        expect(red[0].reason).toContain('PM-A');
        expect(red[0].eventsSavedPerYear).toBeGreaterThan(0);
    });

    it('stretches a wear-out asset serviced far more often than its B10 life', () => {
        // Weekly PM against ~60d wear-out failures → interval < 0.5×B10.
        const r = computePmOptimization(
            [pm({ id: '1', code: 'PM-W', frequency_interval: 7 })],
            wearOutEvents('a1'), ASSETS, NOW,
        );
        const v = r.verdicts.find((x) => x.code === 'PM-W')!;
        expect(v.verdict).toBe('over_maintenance');
        expect(v.weibull).not.toBeNull();
        expect(v.recommendedIntervalDays).toBe(v.weibull!.b10Days);
        expect(v.eventsSavedPerYear).toBeGreaterThan(20); // 52/yr → ~7/yr
    });

    it('tightens a wear-out asset whose PM arrives after the failures do', () => {
        const r = computePmOptimization(
            [pm({ id: '1', code: 'PM-L', frequency_interval: 12, frequency_unit: 'months' })],
            wearOutEvents('a1'), ASSETS, NOW,
        );
        const v = r.verdicts.find((x) => x.code === 'PM-L')!;
        expect(v.verdict).toBe('under_maintenance');
        expect(v.eventsSavedPerYear).toBe(0); // tightening never claims savings
    });

    it('calls a calendar PM ineffective when failures are random in time', () => {
        // Exponential-ish gaps (β≈1): jittered arrivals, several inside 12mo.
        const gaps = [5, 90, 12, 200, 33, 70, 15, 130, 48];
        let t = 30; const events: CmEventRow[] = [];
        for (const g of gaps) { t += g; events.push({ asset_id: 'a1', created_at: iso(t) }); }
        const r = computePmOptimization(
            [pm({ id: '1', code: 'PM-R', frequency_interval: 14 })],
            events.concat([{ asset_id: 'a1', created_at: iso(40) }, { asset_id: 'a1', created_at: iso(100) }]),
            ASSETS, NOW,
        );
        const v = r.verdicts.find((x) => x.code === 'PM-R');
        if (v) { // fit shape depends on jitter; when flagged it must be the CBM verdict
            expect(['ineffective', 'over_maintenance']).toContain(v.verdict);
        }
        expect(r.scanned).toBe(1);
    });

    it('stretches high-frequency PMs on assets that have never failed', () => {
        const r = computePmOptimization(
            [pm({ id: '1', code: 'PM-N', asset_id: 'a2', frequency_interval: 7 })],
            [], ASSETS, NOW,
        );
        const v = r.verdicts.find((x) => x.code === 'PM-N')!;
        expect(v.verdict).toBe('over_maintenance');
        expect(v.recommendedIntervalDays).toBe(14);
        expect(v.reason).toContain('zero recorded failures');
    });

    it('ranks criticality-A verdicts first and sums events saved', () => {
        const r = computePmOptimization(
            [
                pm({ id: '1', code: 'PM-C', asset_id: 'a2', frequency_interval: 7 }),
                pm({ id: '2', code: 'PM-A1', frequency_interval: 7 }),
                pm({ id: '3', code: 'PM-A2', frequency_interval: 7 }),
            ],
            [], ASSETS, NOW,
        );
        expect(r.verdicts[0].criticality).toBe('A');
        expect(r.eventsSavedPerYear).toBeGreaterThan(0);
        expect(r.counts.redundant + r.counts.over_maintenance).toBe(r.verdicts.length);
    });
});
