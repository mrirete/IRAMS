import { describe, it, expect } from 'vitest';
import { poissonSpares, poissonLogPmf, logGamma } from './poissonSpares';

/**
 * Regression cover for audit M-9: the linear-space pmf overflowed at λ ≳ 140
 * and under-sized the holding. These check the maths against independently
 * computed references, and the big-λ case is the one that used to be wrong.
 */
describe('logGamma', () => {
    it('matches known factorials', () => {
        // Γ(n+1) = n!
        expect(Math.exp(logGamma(5))).toBeCloseTo(24, 6);        // 4!
        expect(Math.exp(logGamma(11))).toBeCloseTo(3628800, 1);  // 10!
    });
    it('stays finite far beyond the 170! overflow point', () => {
        expect(Number.isFinite(logGamma(500))).toBe(true);
        expect(logGamma(500)).toBeGreaterThan(2000);
    });
});

describe('poissonLogPmf', () => {
    it('matches the linear formula where the linear formula still works', () => {
        const lambda = 3;
        for (let k = 0; k <= 8; k++) {
            const linear = (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
            expect(Math.exp(poissonLogPmf(k, lambda))).toBeCloseTo(linear, 12);
        }
    });
    it('sums to one over a wide support', () => {
        const lambda = 216;
        let total = 0;
        for (let k = 0; k < 600; k++) total += Math.exp(poissonLogPmf(k, lambda));
        expect(total).toBeCloseTo(1, 8);
    });
});

describe('poissonSpares', () => {
    it('sizes a small holding the way the textbook does', () => {
        // λ = 2, 95% service level: cumulative reaches 0.95 at k = 5.
        const r = poissonSpares(1, 0.002, 1000, 95);
        expect(r.lambda).toBeCloseTo(2, 10);
        expect(r.requiredSpares).toBe(5);
        expect(r.truncated).toBe(false);
    });

    it('does NOT collapse at large lambda (the M-9 regression)', () => {
        // 100 units, MTBF 1000 h, 90-day resupply → λ = 216.
        // The old linear-space loop returned 133; the true 95% quantile is 240.
        const r = poissonSpares(100, 1 / 1000, 2160, 95);
        expect(r.lambda).toBeCloseTo(216, 10);
        expect(r.requiredSpares).toBe(240);
        expect(r.truncated).toBe(false);
        // Independent check: the recommendation must be the smallest k whose
        // cumulative probability reaches the service level.
        expect(cdf(r.requiredSpares, r.lambda)).toBeGreaterThanOrEqual(0.95);
        expect(cdf(r.requiredSpares - 1, r.lambda)).toBeLessThan(0.95);
    });

    it('handles a zero failure rate without looping', () => {
        const r = poissonSpares(10, 0, 2160, 95);
        expect(r.lambda).toBe(0);
        expect(r.requiredSpares).toBe(0);
    });

    it('rises with the service level', () => {
        const l = poissonSpares(50, 1 / 800, 1440, 90).requiredSpares;
        const h = poissonSpares(50, 1 / 800, 1440, 99).requiredSpares;
        expect(h).toBeGreaterThan(l);
    });
});

function factorial(n: number): number {
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
}

/** Reference CDF, summed in log space. */
function cdf(k: number, lambda: number): number {
    let total = 0;
    for (let i = 0; i <= k; i++) total += Math.exp(poissonLogPmf(i, lambda));
    return total;
}
