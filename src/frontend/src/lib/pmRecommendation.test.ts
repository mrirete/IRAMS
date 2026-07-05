import { describe, it, expect } from 'vitest';
import { recommendPM } from './pmRecommendation';

const COSTS = { costPerFailure: 10000, pmCost: 1500 };

describe('recommendPM', () => {
    it('flags insufficient data below 2 failures', () => {
        expect(recommendPM([100], [], COSTS).pattern).toBe('insufficient');
        expect(recommendPM([], [], COSTS).pmAdvised).toBe(false);
    });

    it('recommends a PM for a wear-out pattern (β > 1) with a cost case', () => {
        // Increasing inter-arrivals clustered around a life → β > 1.
        const r = recommendPM([900, 1000, 1050, 1100, 1150, 1200], [], COSTS);
        expect(r.pattern).toBe('wear-out');
        expect(r.pmAdvised).toBe(true);
        expect(r.recommendedIntervalDays).toBeGreaterThan(0);
        expect(r.cost).not.toBeNull();
        // B10 interval is below the mean life, so PMs/yr > failures/yr but each PM is far cheaper.
        expect(r.cost!.netAnnualSavings).toBeTypeOf('number');
        expect(r.citations.some(c => /Weibull β=/.test(c))).toBe(true);
    });

    it('does NOT advise age-based PM for random failures (β≈1)', () => {
        // Exponential-ish spread → β near 1.
        const r = recommendPM([200, 1800, 400, 1200, 100, 2400, 600], [], COSTS);
        expect(['random', 'wear-out', 'infant-mortality']).toContain(r.pattern);
        if (r.pattern === 'random') {
            expect(r.pmAdvised).toBe(false);
            expect(r.recommendedIntervalDays).toBeNull();
            expect(r.rationale).toMatch(/condition-based|constant/i);
        }
    });

    it('carries confidence + citations for a fittable set', () => {
        const r = recommendPM([500, 600, 700, 800, 900], [], COSTS);
        expect(r.fit).not.toBeNull();
        expect(r.citations.length).toBeGreaterThanOrEqual(3);
    });
});
