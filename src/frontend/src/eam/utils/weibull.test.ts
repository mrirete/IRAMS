import { describe, it, expect } from 'vitest';
import { johnsonAdjustedRanks, fitWeibull, weibullBLife } from './weibull';

describe('johnsonAdjustedRanks', () => {
    it('equals ordinary ranks 1..n when there are no suspensions', () => {
        const ranks = johnsonAdjustedRanks([10, 20, 30, 40].map(t => ({ time: t, censored: false })));
        expect(ranks.map(r => r.rank)).toEqual([1, 2, 3, 4]);
    });

    it('matches the hand-computed mixed sample (F10, S15, F20, F30, S35)', () => {
        const ranks = johnsonAdjustedRanks([
            { time: 10, censored: false },
            { time: 15, censored: true },
            { time: 20, censored: false },
            { time: 30, censored: false },
            { time: 35, censored: true },
        ]);
        // N=5: F10 → (6−0)/6 = 1; F20 → 1 + (6−1)/4 = 2.25; F30 → 2.25 + (6−2.25)/3 = 3.5
        expect(ranks.map(r => r.rank)).toEqual([1, 2.25, 3.5]);
    });

    it('ranks a failure ahead of a suspension at the same time', () => {
        const ranks = johnsonAdjustedRanks([
            { time: 10, censored: true },
            { time: 10, censored: false },
            { time: 20, censored: false },
        ]);
        // failure sorts first at t=10 → plain rank 1; suspension then inflates the next
        expect(ranks[0].rank).toBe(1);
        expect(ranks[1].rank).toBeGreaterThan(2);
    });
});

describe('fitWeibull', () => {
    const sample = [20, 42, 55, 73, 95, 101, 118, 139];

    it('reproduces the legacy failures-only median-rank regression', () => {
        // Independent re-derivation of the simple (uncensored) fit.
        const n = sample.length;
        const pts = [...sample].sort((a, b) => a - b).map((t, i) => {
            const F = (i + 1 - 0.3) / (n + 0.4);
            return { x: Math.log(t), y: Math.log(-Math.log(1 - F)) };
        });
        const xm = pts.reduce((s, p) => s + p.x, 0) / n;
        const ym = pts.reduce((s, p) => s + p.y, 0) / n;
        const beta = pts.reduce((s, p) => s + (p.x - xm) * (p.y - ym), 0) / pts.reduce((s, p) => s + (p.x - xm) ** 2, 0);
        const eta = Math.exp(-(ym - beta * xm) / beta);

        const fit = fitWeibull(sample)!;
        expect(fit.beta).toBeCloseTo(beta, 1);
        expect(fit.eta / eta).toBeCloseTo(1, 1);
        expect(fit.nFailures).toBe(8);
        expect(fit.nSuspensions).toBe(0);
        expect(fit.r2).toBeGreaterThan(0.9);
    });

    it('suspensions beyond the last failure extend characteristic life (η)', () => {
        const without = fitWeibull(sample)!;
        const withSusp = fitWeibull(sample, [150, 160, 180])!;
        expect(withSusp.eta).toBeGreaterThan(without.eta);
        expect(withSusp.nSuspensions).toBe(3);
    });

    it('provides confidence bounds that bracket the point estimates', () => {
        const fit = fitWeibull(sample)!;
        expect(fit.confidence).toBeDefined();
        const c = fit.confidence!;
        expect(c.level).toBeCloseTo(0.9);
        expect(c.betaLower).toBeLessThan(fit.beta);
        expect(c.betaUpper).toBeGreaterThan(fit.beta);
        expect(c.etaLower).toBeLessThan(fit.eta);
        expect(c.etaUpper).toBeGreaterThan(fit.eta);
        expect(c.betaLower).toBeGreaterThan(0);
        expect(c.etaLower).toBeGreaterThan(0);
    });

    it('omits bounds when there is no residual degree of freedom (2 failures)', () => {
        const fit = fitWeibull([50, 100])!;
        expect(fit.confidence).toBeUndefined();
    });

    it('returns null for insufficient or degenerate data', () => {
        expect(fitWeibull([100])).toBeNull();
        expect(fitWeibull([])).toBeNull();
        expect(fitWeibull([50, 50, 50])).toBeNull(); // identical times → sxx = 0
    });

    it('B63.2 life equals η (definition of characteristic life)', () => {
        const fit = fitWeibull(sample)!;
        expect(weibullBLife(fit.beta, fit.eta, 63.2) / fit.eta).toBeCloseTo(1, 2);
    });
});
