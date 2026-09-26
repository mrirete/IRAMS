import { describe, it, expect } from 'vitest';
import { fitHealthTrend, fittedProjection, seriesSpread, daysToLimit, suggestNeededBy, freshHistory, PLANNING_LEAD_DAYS } from './healthTrend';
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

describe('needed-by date', () => {
    // 90 → 85 over 10 days: −0.5 a day, latest 85 at day 10.
    const fit = fitHealthTrend([0, 2, 4, 6, 8, 10].map(d => ({ at: day(d), value: 90 - 0.5 * d })))!;
    const now = new Date(day(10));

    it('days to the limit from the fitted line', () => {
        expect(daysToLimit(fit, 30)).toBeCloseTo(110, 6);           // (85 − 30) / 0.5
        expect(daysToLimit({ ...fit, slopePerDay: 0.1 }, 30)).toBeNull();
        expect(daysToLimit({ ...fit, latest: 28 }, 30)).toBe(0);
    });

    it('fitted trend: the crossing less the planning lead, and says so', () => {
        const s = suggestNeededBy({ fit, limit: 30, rulDays: 20, now });
        expect(s.date).toBe(day(110 - PLANNING_LEAD_DAYS + 10).slice(0, 10));
        expect(s.note).toContain('fitted to 6 points');
        expect(s.note).toContain('extrapolation');
    });

    it('falls back to remaining life, then to no date with the reason', () => {
        const noFall = { ...fit, slopePerDay: 0 };
        const r = suggestNeededBy({ fit: noFall, limit: 30, rulDays: 20, rulBasis: 'heuristic', now });
        expect(r.date).toBe(day(10 + 20 - PLANNING_LEAD_DAYS).slice(0, 10));
        expect(r.note).toContain('Remaining life 20 days (heuristic)');
        const none = suggestNeededBy({ fit: null, limit: 30, rulDays: null, now });
        expect(none.date).toBeNull();
        expect(none.note).toContain('no fitted health trend');
    });

    it('never before today; at the limit means now', () => {
        expect(suggestNeededBy({ fit: null, limit: 30, rulDays: 3, now }).date).toBe(day(10).slice(0, 10));
        expect(suggestNeededBy({ fit: { ...fit, latest: 25 }, limit: 30, now }).date).toBe(day(10).slice(0, 10));
    });
});

describe('freshHistory', () => {
    const pts = [0, 1, 2, 20, 40].map(d => ({ at: day(d), value: 90 }));
    it('keeps points up to the newest reading plus the stale allowance; the rest are re-scores', () => {
        const r = freshHistory(pts, day(2), 7);
        expect(r.points.map(p => p.at)).toEqual([day(0), day(1), day(2)]);
        expect(r.ignored).toBe(2);
    });
    it('no readings at all: nothing stands on data', () => {
        expect(freshHistory(pts, null, 7)).toEqual({ points: [], ignored: 5 });
    });
});
