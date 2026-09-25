import { describe, it, expect } from 'vitest';
import { fitHealthTrend, fittedProjection, seriesSpread } from './healthTrend';
import { qualityFlags } from './dataQuality';

const day = (d: number) => new Date(Date.UTC(2026, 8, 1) + d * 86_400_000).toISOString();

describe('fitHealthTrend', () => {
    it('needs 5 points over 2 days — otherwise the fixed-rate direction stays', () => {
        expect(fitHealthTrend([0, 1, 2, 3].map(d => ({ at: day(d), value: 80 })))).toBeNull();
        expect(fitHealthTrend([0, 0.1, 0.2, 0.3, 0.4].map(d => ({ at: day(d), value: 80 })))).toBeNull();
    });

    it('recovers a clean decline of 0.5 points/day', () => {
        const fit = fitHealthTrend([0, 2, 4, 6, 8, 10].map(d => ({ at: day(d), value: 90 - 0.5 * d })))!;
        expect(fit.slopePerDay).toBeCloseTo(-0.5, 3);
        expect(fit.residualSd).toBe(0);
        const proj = fittedProjection(fit, 30);
        expect(proj[9].health_index).toBe(80);          // 85 − 0.5 × 10
        expect(proj[0].confidence_lower).toBe(proj[0].health_index);   // no scatter → no band
    });

    it('scatter widens the band with distance', () => {
        const vals = [80, 82, 79, 81, 80, 82, 79];
        const fit = fitHealthTrend(vals.map((v, i) => ({ at: day(i), value: v })))!;
        const proj = fittedProjection(fit, 30);
        const w = (p: typeof proj[0]) => p.confidence_upper - p.confidence_lower;
        expect(w(proj[29])).toBeGreaterThan(w(proj[0]));
        expect(proj.every(p => p.health_index >= 0 && p.health_index <= 100)).toBe(true);
    });

    it('seriesSpread reports first, last and range', () => {
        expect(seriesSpread([{ at: day(0), value: 200 }, { at: day(1), value: 180 }, { at: day(2), value: 190 }]))
            .toEqual({ first: 200, last: 190, min: 180, max: 200, n: 3 });
    });
});

describe('qualityFlags', () => {
    const now = Date.UTC(2026, 8, 25);
    it('flat-lined: ten identical readings', () => {
        expect(qualityFlags({ current: 5, readings: Array(10).fill(5), kind: 'vibration' }, now).map(f => f.flag)).toEqual(['flatlined']);
        expect(qualityFlags({ current: 5, readings: [...Array(9).fill(5), 5.1], kind: 'vibration' }, now)).toEqual([]);
    });
    it('implausible: negative magnitude, or ten times the alarm limit', () => {
        expect(qualityFlags({ current: -1, kind: 'vibration' }, now)[0].flag).toBe('implausible');
        expect(qualityFlags({ current: -5, kind: 'temperature' }, now)).toEqual([]);     // −5 °C is real
        expect(qualityFlags({ current: 1200, alarm_high: 95, kind: 'temperature' }, now)[0].flag).toBe('implausible');
        expect(qualityFlags({ current: 120, alarm_high: 95, kind: 'temperature' }, now)).toEqual([]);   // alarm, not bad data
    });
    it('stale: only when the point has its own reading time', () => {
        expect(qualityFlags({ current: 1, kind: 'pressure', lastReadingAt: new Date(now - 20 * 86_400_000).toISOString(), intervalDays: 7 }, now)[0].flag).toBe('stale');
        expect(qualityFlags({ current: 1, kind: 'pressure', lastReadingAt: new Date(now - 10 * 86_400_000).toISOString(), intervalDays: 7 }, now)).toEqual([]);
        expect(qualityFlags({ current: 1, kind: 'pressure' }, now)).toEqual([]);
    });
});
