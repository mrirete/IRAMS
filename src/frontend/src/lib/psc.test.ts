import { describe, it, expect } from 'vitest';
import { classifyValue, computePSC, computeOPE, isBanded, type GoldenSpotParam, type ParamReading } from './psc';

const HOUR = 3_600_000;

const temp: GoldenSpotParam = { id: 't', name: 'Bearing temp', minWarning: 45, maxWarning: 65, minCritical: 35, maxCritical: 80 };
const vib: GoldenSpotParam = { id: 'v', name: 'Vibration', maxWarning: 2.5, maxCritical: 6 };

describe('classifyValue', () => {
    it('classifies against warning and critical bands', () => {
        expect(classifyValue(temp, 55)).toBe('OPTIMAL');
        expect(classifyValue(temp, 70)).toBe('DRIFT');      // above maxWarning
        expect(classifyValue(temp, 85)).toBe('CRITICAL');   // above maxCritical
        expect(classifyValue(temp, 40)).toBe('DRIFT');      // below minWarning
        expect(classifyValue(temp, 30)).toBe('CRITICAL');   // below minCritical
    });
    it('ignores NULL bands (one-sided params)', () => {
        expect(classifyValue(vib, 1.0)).toBe('OPTIMAL');
        expect(classifyValue(vib, 3.0)).toBe('DRIFT');
        expect(classifyValue(vib, 7.0)).toBe('CRITICAL');
    });
    it('isBanded rejects parameters with no bands at all', () => {
        expect(isBanded({ id: 'x', name: 'no bands' })).toBe(false);
        expect(isBanded(vib)).toBe(true);
    });
});

describe('computePSC — paper Table 4 worked example', () => {
    // Three complete Golden Spot cycles: 680h in / 14h out, 612h in / 9h out,
    // 698h in / 11h out, then back in spot (open streak). Expected per the paper:
    // MTOP = 663.3 h, MTTRg = 11.3 h, SR = 98.3%.
    it('reproduces MTOP, MTTRg and SR', () => {
        const t0 = Date.parse('2026-01-01T00:00:00Z');
        let t = t0;
        const readings: ParamReading[] = [];
        const push = (value: number, afterHours: number) => { t += afterHours * HOUR; readings.push({ paramId: 't', at: t, value }); };

        readings.push({ paramId: 't', at: t0, value: 55 });  // enter spot
        push(70, 680);   // depart after 680h in spot
        push(55, 14);    // restore after 14h
        push(70, 612);   // depart after 612h
        push(55, 9);     // restore after 9h
        push(70, 698);   // depart after 698h
        push(55, 11);    // restore after 11h → open in-spot streak
        const now = t + 40 * HOUR;

        const r = computePSC([temp], readings, now, 365);
        expect(r.inSpotPeriods).toBe(3);
        expect(r.completedRestorations).toBe(3);
        expect(r.mtopHours!).toBeCloseTo(663.33, 1);
        expect(r.mttrgHours!).toBeCloseTo(11.33, 1);
        expect(r.successRate!).toBeCloseTo(98.3, 1);
        expect(r.zoneNow).toBe('GOLDEN_SPOT');
        expect(r.lastRestoredAt).toBe(t);
    });
});

describe('computePSC — zones and edge cases', () => {
    const t0 = Date.parse('2026-03-01T00:00:00Z');

    it('UNKNOWN when there are no banded params or no readings', () => {
        expect(computePSC([], [], t0).zoneNow).toBe('UNKNOWN');
        expect(computePSC([temp], [], t0).zoneNow).toBe('UNKNOWN');
    });

    it('asset state is the WORST of its parameters', () => {
        const readings: ParamReading[] = [
            { paramId: 't', at: t0, value: 55 },            // optimal
            { paramId: 'v', at: t0 + HOUR, value: 7 },      // critical
        ];
        const r = computePSC([temp, vib], readings, t0 + 2 * HOUR);
        expect(r.zoneNow).toBe('CRITICAL_DEPARTURE');
        expect(r.coverage).toEqual({ params: 2, paramsWithData: 2 });
    });

    it('drift (not critical) departure reports SUB_OPTIMAL_DRIFT with a running departure clock', () => {
        const readings: ParamReading[] = [
            { paramId: 't', at: t0, value: 55 },
            { paramId: 't', at: t0 + 10 * HOUR, value: 70 },
        ];
        const r = computePSC([temp], readings, t0 + 16 * HOUR);
        expect(r.zoneNow).toBe('SUB_OPTIMAL_DRIFT');
        expect(r.currentDepartureHours!).toBeCloseTo(6, 5);
        expect(r.mttrgHours).toBeNull();                    // restoration not completed
        expect(r.successRate).toBeNull();                   // needs both MTOP and MTTRg
        expect(r.percentTimeInSpot!).toBeCloseTo(62.5, 1);  // 10h of 16h observed
    });

    it('provisional MTOP from the open streak when no cycle has completed', () => {
        const readings: ParamReading[] = [{ paramId: 't', at: t0, value: 55 }];
        const r = computePSC([temp], readings, t0 + 100 * HOUR);
        expect(r.zoneNow).toBe('GOLDEN_SPOT');
        expect(r.mtopHours!).toBeCloseTo(100, 5);
        expect(r.inSpotPeriods).toBe(1);
        expect(r.completedRestorations).toBe(0);
    });

    it('readings for unknown params and non-finite values are ignored', () => {
        const readings: ParamReading[] = [
            { paramId: 'ghost', at: t0, value: 999 },
            { paramId: 't', at: t0, value: Number.NaN },
        ];
        expect(computePSC([temp], readings, t0 + HOUR).zoneNow).toBe('UNKNOWN');
    });
});

describe('computeOPE', () => {
    it('computes SR × PQ × EE per Eq. 4 (paper example: 98.3 × 0.978 × 0.954 ≈ 91.7)', () => {
        expect(computeOPE(98.3, 0.978, 0.954)!).toBeCloseTo(91.7, 1);
    });
    it('never fabricates missing PQ/EE inputs', () => {
        expect(computeOPE(98.3)).toBeNull();
        expect(computeOPE(98.3, 0.978)).toBeNull();
        expect(computeOPE(null, 0.978, 0.954)).toBeNull();
        expect(computeOPE(98.3, 1.5, 0.9)).toBeNull(); // out-of-range guard
    });
});
