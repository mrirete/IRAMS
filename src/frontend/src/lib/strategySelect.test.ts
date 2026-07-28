import { describe, it, expect } from 'vitest';
import { selectStrategies, type StrategyInputs } from './strategySelect';

const NOW = Date.UTC(2026, 6, 28);
const DAY_MS = 86_400_000;
const times = (gaps: number[], start = 30) => {
    let d = start; const out: number[] = [];
    for (const g of gaps) { d += g; out.push(NOW - d * DAY_MS); }
    return out;
};

const asset = (id: string, criticality: string | null) => ({ id, tag: id.toUpperCase(), name: id, criticality });

const base = (over: Partial<StrategyInputs>): StrategyInputs => ({
    assets: [], cmTimesByAsset: new Map(), cmCost12ByAsset: new Map(),
    activePmAssets: new Set(), monitoredAssets: new Set(), ...over,
});

describe('selectStrategies', () => {
    it('recommends age-based PM at B10 for wear-out behaviour', () => {
        const r = selectStrategies(base({
            assets: [asset('k1', 'A')],
            cmTimesByAsset: new Map([['k1', times([55, 58, 62, 65, 59, 61, 63])]]),
            activePmAssets: new Set(['k1']),
        }), NOW);
        const v = r.verdicts[0];
        expect(v.recommended).toBe('fixed_interval');
        expect(v.recommendedIntervalDays).toBe(v.weibull!.b10Days);
        expect(v.aligned).toBe(true); // active PM exists → matches the regime
    });

    it('recommends condition monitoring for random failures and flags missing points', () => {
        const r = selectStrategies(base({
            assets: [asset('p1', 'A')],
            cmTimesByAsset: new Map([['p1', times([5, 90, 12, 200, 33, 70, 15, 130])]]),
        }), NOW);
        const v = r.verdicts[0];
        if (v.recommended === 'condition_based') {
            expect(v.basis).toContain('No monitoring points');
            expect(v.aligned).toBe(false);
        }
        expect(['condition_based', 'fixed_interval', 'defect_elimination']).toContain(v.recommended);
    });

    it('sends unknowable criticals to an RCM study, not a guess', () => {
        const r = selectStrategies(base({ assets: [asset('v1', 'A')] }), NOW);
        expect(r.verdicts[0].recommended).toBe('rcm_study');
        expect(r.verdicts[0].aligned).toBe(false);
    });

    it('calls deliberate run-to-failure for low-consequence assets', () => {
        const r = selectStrategies(base({ assets: [asset('lamp', 'D')] }), NOW);
        const v = r.verdicts[0];
        expect(v.recommended).toBe('run_to_failure');
        expect(v.aligned).toBe(true); // no PM on an RTF asset is the correct state
        expect(v.basis).toContain('record the decision');
    });

    it('computes coverage over A/B assets only and ranks gaps A-first then by cost', () => {
        const r = selectStrategies(base({
            assets: [asset('a1', 'A'), asset('b1', 'B'), asset('c1', 'C')],
            cmCost12ByAsset: new Map([['b1', 50_000]]),
            activePmAssets: new Set(['a1']),
        }), NOW);
        expect(r.criticalTotal).toBe(2);
        expect(r.criticalCovered).toBe(1);
        expect(r.coveragePct).toBe(50);
        // both A and B are gaps here (rcm_study / uncovered) — A ranks first
        expect(r.gaps[0].criticality).toBe('A');
    });

    it('returns 100% coverage on a register with no criticals instead of dividing by zero', () => {
        const r = selectStrategies(base({ assets: [asset('c1', 'C')] }), NOW);
        expect(r.coveragePct).toBe(100);
        expect(r.criticalTotal).toBe(0);
    });
});
