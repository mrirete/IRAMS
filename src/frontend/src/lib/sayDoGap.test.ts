import { describe, it, expect } from 'vitest';
import { verdictFor, computeSayDoGap, type MeasuredSignals } from './sayDoGap';
import type { IntakeAnalysis } from '../eam/services/IntakeQuickAnalysis';

const analysisWith = (scores: Partial<Record<string, number | null>>): IntakeAnalysis => ({
    overall: 3, overallPercentage: 60, band: null as any,
    dimensions: (['governance', 'financial', 'regulatory', 'people', 'data'] as const).map(k => ({
        key: k, label: k, isoBadge: '', color: '',
        score: scores[k] ?? null, answeredCount: 1, totalCount: 3,
    })),
    strengths: [], quickWins: [], coverage: 0.5, answeredCount: 8, totalScoreable: 16,
    headline: '', industrySector: 'x', keyRiskCount: 0,
});

const signals = (over: Partial<MeasuredSignals> = {}): MeasuredSignals => ({
    failureCodingPct: null, downtimeCapturePct: null, costCoveragePct: null,
    preventiveSharePct: null, assignmentCoveragePct: null, downtimeRateConfigured: false,
    ...over,
});

describe('verdictFor', () => {
    it('is unmeasured with no proxies or no self-score — never guessed', () => {
        expect(verdictFor(4, [])).toBe('unmeasured');
        expect(verdictFor(null, [80])).toBe('unmeasured');
    });
    it('questions a high claim that the data runs far behind', () => {
        // score 4 claims ~80% practice; measured 30% < 40% (half the claim)
        expect(verdictFor(4, [30])).toBe('questions');
    });
    it('supports a high claim the data backs, and modest claims with modest data', () => {
        expect(verdictFor(4, [70])).toBe('supports');
        expect(verdictFor(2, [15])).toBe('supports');   // low claim, low data — consistent
    });
});

describe('computeSayDoGap', () => {
    it('regulatory is always unmeasured (no proxy exists) — honesty over invention', () => {
        const gaps = computeSayDoGap(analysisWith({ regulatory: 4 }), signals());
        expect(gaps.find(g => g.key === 'regulatory')!.verdict).toBe('unmeasured');
    });
    it('flags the classic gap: data self-rated 4, coding coverage 20%', () => {
        const gaps = computeSayDoGap(
            analysisWith({ data: 4 }),
            signals({ failureCodingPct: 20, downtimeCapturePct: 25 }),
        );
        const d = gaps.find(g => g.key === 'data')!;
        expect(d.verdict).toBe('questions');
        expect(d.note).toMatch(/Failure Review/);
    });
    it('counts a configured downtime rate as financial practice', () => {
        const withRate = computeSayDoGap(analysisWith({ financial: 3 }), signals({ costCoveragePct: 50, downtimeRateConfigured: true }));
        const without = computeSayDoGap(analysisWith({ financial: 3 }), signals({ costCoveragePct: 50, downtimeRateConfigured: false }));
        expect(withRate.find(g => g.key === 'financial')!.verdict).toBe('supports');
        // 3/5 claims 60%; measured avg (50+0)/2 = 25 < 30 → questioned
        expect(without.find(g => g.key === 'financial')!.verdict).toBe('questions');
    });
});
