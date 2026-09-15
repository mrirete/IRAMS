/**
 * Tests for regimeBaseline — "is this value normal at this load?"
 *
 * The fixture is the boiler case the module was built for: ID-fan motor
 * current as a function of steam flow. The two claims a plant would hold us
 * to are both here — an 8 % step at FLAT load fires (impeller build-up),
 * and a 40 % load ramp with current following the fan law stays QUIET —
 * plus the refusals: too little data, a load that explains nothing, and a
 * regime the baseline never saw.
 *
 * Stands in for the TEP / Coal-Fired-Boiler slices until those are loaded;
 * the arithmetic is the same and the numbers here are pinned by hand.
 */
import { describe, it, expect } from 'vitest';
import {
    alignSeries, fitRegime, scoreRegime, evaluateRegime, describeFinding,
    MIN_BASELINE_PAIRS, MIN_R2,
    type RegimePair,
} from './regimeBaseline';

const T0 = Date.parse('2026-08-01T00:00:00Z');
const HOUR = 3_600_000;
const ts = (i: number) => new Date(T0 + i * HOUR).toISOString();

/** Deterministic "noise": a small bounded pseudo-random sequence. */
const noise = (i: number, amp: number) => amp * Math.sin(i * 12.9898) * Math.cos(i * 78.233);

/** Healthy fan: I = 10 + 0.6·F + noise, steam flow wandering 150–250 t/h. */
function healthyBaseline(hours = 24 * 30): RegimePair[] {
    return Array.from({ length: hours }, (_, i) => {
        const x = 200 + 50 * Math.sin(i / 17) * Math.cos(i / 5);   // 150–250
        return { t: ts(i), x, y: 10 + 0.6 * x + noise(i, 1.5) };   // σ ≈ 1 A
    });
}

describe('alignSeries', () => {
    it('joins on bucket timestamp and drops unmatched or non-numeric buckets', () => {
        const y = [{ ts: ts(0), avg: 1 }, { ts: ts(1), avg: 2 }, { ts: ts(2), avg: 3 }, { ts: ts(3), avg: NaN }];
        const x = [{ ts: ts(1), avg: 10 }, { ts: ts(2), avg: 20 }, { ts: ts(3), avg: 30 }, { ts: ts(9), avg: 90 }];
        const pairs = alignSeries(y, x);
        expect(pairs).toEqual([{ t: ts(1), x: 10, y: 2 }, { t: ts(2), x: 20, y: 3 }]);
    });
});

describe('fitRegime', () => {
    it('recovers the healthy relationship and a sane noise floor', () => {
        const fit = fitRegime(healthyBaseline())!;
        expect(fit).not.toBeNull();
        expect(fit.n).toBe(720);
        expect(fit.b).toBeCloseTo(0.6, 2);
        expect(fit.a).toBeCloseTo(10, 0);
        expect(fit.sigma).toBeGreaterThan(0.5);
        expect(fit.sigma).toBeLessThan(1.5);
        expect(fit.r2).toBeGreaterThan(0.95);
        expect(fit.xMin).toBeGreaterThanOrEqual(150);
        expect(fit.xMax).toBeLessThanOrEqual(250);
    });

    it('a quadratic fit captures a fan-law curve a line would miss', () => {
        const pairs = Array.from({ length: 200 }, (_, i) => { const x = 100 + i; return { t: ts(i), x, y: 0.002 * x * x + noise(i, 0.5) }; });
        const lin = fitRegime(pairs, { degree: 1 })!;
        const quad = fitRegime(pairs, { degree: 2 })!;
        expect(quad.c).toBeCloseTo(0.002, 4);
        expect(quad.sigma).toBeLessThan(lin.sigma);
    });

    it('refuses with too few pairs or no variance in the load', () => {
        expect(fitRegime(healthyBaseline(MIN_BASELINE_PAIRS - 1))).toBeNull();
        const flat = Array.from({ length: 50 }, (_, i) => ({ t: ts(i), x: 200, y: 130 + noise(i, 1) }));
        expect(fitRegime(flat)).toBeNull();
    });
});

describe('scoreRegime', () => {
    it('reports expected, residual, % and z; flags loads outside the baseline range', () => {
        const fit = fitRegime(healthyBaseline())!;
        const ok = scoreRegime(fit, 200, 10 + 0.6 * 200);
        expect(Math.abs(ok.residual)).toBeLessThan(1);
        expect(ok.extrapolated).toBe(false);
        const far = scoreRegime(fit, 400, 250);
        expect(far.extrapolated).toBe(true);
    });
});

describe('evaluateRegime — the two claims', () => {
    const fit = fitRegime(healthyBaseline())!;

    it('FIRES: current +8 % at flat load, inside a fixed band that would stay silent', () => {
        // Last 3 hours at F = 200 t/h. Healthy I = 130 A; observed 140.4 A (+8 %).
        // A band at, say, 90–160 A never fires. The baseline's σ ≈ 1 A → z ≈ 10.
        const current = [0, 1, 2].map((i) => ({ t: ts(1000 + i), x: 200, y: 130 * 1.08 + noise(i, 0.5) }));
        const f = evaluateRegime(fit, current)!;
        expect(f).not.toBeNull();
        expect(f.direction).toBe('high');
        expect(f.residualPct).toBeGreaterThan(6);
        expect(f.z).toBeGreaterThan(3);
        expect(f.persisted).toBe(2);
        expect(f.load).toBe(200);
        const text = describeFinding(f, 'ID_FAN_CURRENT', 'STEAM_FLOW', 'A', 't/h', 30);
        expect(text).toMatch(/^ID_FAN_CURRENT at 14[0-9.]+ A — [78]\.\d% above the 13[0-9.]+ A expected at this load \(STEAM_FLOW = 200 t\/h\); \d+(\.\d)?σ against a 30-day baseline/);
    });

    it('QUIET: a 40 % load ramp with current following the fan relationship', () => {
        // F ramps 150 → 210 t/h over 6 h; I follows 10 + 0.6·F exactly (+ noise).
        const current = [0, 1, 2, 3, 4, 5].map((i) => { const x = 150 + i * 12; return { t: ts(1000 + i), x, y: 10 + 0.6 * x + noise(i, 0.8) }; });
        expect(evaluateRegime(fit, current)).toBeNull();
        // …even though the raw value rose 36 A — a fixed "rising" rule would have fired.
        expect(current[5].y - current[0].y).toBeGreaterThan(30);
    });

    it('QUIET on a single-hour blip: persistence needs two agreeing hours', () => {
        const current = [
            { t: ts(1000), x: 200, y: 130 },
            { t: ts(1001), x: 200, y: 130 * 1.1 },   // one bad hour
        ];
        expect(evaluateRegime(fit, current)).toBeNull();
    });

    it('SILENT when the current load is outside anything the baseline saw', () => {
        const current = [0, 1].map((i) => ({ t: ts(1000 + i), x: 400, y: 300 }));   // way past 250 t/h
        expect(evaluateRegime(fit, current)).toBeNull();
    });

    it('SILENT when the load does not explain the signal (low R²)', () => {
        const junk = Array.from({ length: 200 }, (_, i) => ({ t: ts(i), x: 150 + (i % 7) * 15, y: 100 + noise(i, 20) }));
        const badFit = fitRegime(junk)!;
        expect(badFit.r2).toBeLessThan(MIN_R2);
        const current = [0, 1].map((i) => ({ t: ts(1000 + i), x: 200, y: 200 }));
        expect(evaluateRegime(badFit, current)).toBeNull();
    });

    it('a deviation below the % floor is noise, however many σ', () => {
        // A very quiet baseline (σ tiny) makes 0.5 % a huge z — still not a finding.
        const quiet = Array.from({ length: 100 }, (_, i) => ({ t: ts(i), x: 150 + i, y: 10 + 0.6 * (150 + i) + noise(i, 0.01) }));
        const qf = fitRegime(quiet)!;
        const current = [0, 1].map((i) => ({ t: ts(1000 + i), x: 200, y: (10 + 0.6 * 200) * 1.005 }));
        expect(scoreRegime(qf, 200, (10 + 0.6 * 200) * 1.005).z).toBeGreaterThan(3);
        expect(evaluateRegime(qf, current)).toBeNull();
    });
});
