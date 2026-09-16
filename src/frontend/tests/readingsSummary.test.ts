/**
 * Tests for readingsSummary (supabase/functions/agent-run/readingsSummary.ts).
 *
 * The module is pure, so these are arithmetic checks — but the arithmetic is
 * what the Specialist will quote to a plant manager, so each number is pinned:
 * the slope of a known ramp, the excursion count against known bands, the
 * coverage of a half-empty window, and what the headline says in each case.
 *
 * The synthetic series stand in for the Coal-Fired Boiler set (Hu et al. 2025,
 * Sci Data 12:742, CC BY 4.0) until a one-hour slice of it is vendored to
 * tests/fixtures/. The paper's own abnormal-state definition — outlet steam
 * temperature outside 530–545 °C — is the band used below.
 */
import { describe, it, expect } from 'vitest';
import {
    summarizeWindow, summarizeUntimed, downsample, normalizeBuckets, bucketsFromManualLogs,
    type WindowBucket,
} from '../supabase/functions/agent-run/readingsSummary.ts';

describe('summarizeUntimed — the projection sparkline', () => {
    it('reports order and values, never a rate or a span', () => {
        const s = summarizeUntimed([4.0, 4.1, 4.3, 4.6, 5.0], { unit: 'mm/s', bands: { warn_high: 4.5, crit_high: 7.1 } });
        expect(s.n_points).toBe(5);
        expect(s.first).toBe(4);
        expect(s.last).toBe(5);
        expect(s.direction).toBe('rising');
        expect(s.pct_change).toBe(25);
        expect(s.slope_per_day).toBeNull();
        expect(s.drift_pct_of_mean).toBeNull();
        expect(s.span_days).toBe(0);
        expect(s.coverage_pct).toBe(0);
        expect(s.excursions.warn_high).toBe(2);     // 4.6, 5.0
        expect(s.headline).toBe('untimed projection, last 5 sample(s): rising 25% (4 → 5 mm/s); 2 of 5 outside warning; no timestamps — order only, no rate');
    });
    it('tolerates strings and junk, and says when empty', () => {
        expect(summarizeUntimed(['1.5', 'x', null, 1.5]).n_points).toBe(2);
        expect(summarizeUntimed([]).headline).toBe('no readings (projection empty)');
        expect(summarizeUntimed([7]).direction).toBe('unknown');
    });
});

const T0 = Date.parse('2026-09-01T00:00:00Z');
const HOUR = 3_600_000;

/** n hourly buckets, value = f(i). */
function hourly(n: number, f: (i: number) => number, samplesPer = 60): WindowBucket[] {
    return Array.from({ length: n }, (_, i) => {
        const v = f(i);
        return { ts: new Date(T0 + i * HOUR).toISOString(), n: samplesPer, min: v - 0.5, avg: v, max: v + 0.5, last: v };
    });
}
const windowOf = (hours: number) => ({ from: new Date(T0).toISOString(), to: new Date(T0 + hours * HOUR).toISOString() });

describe('summarizeWindow — trend arithmetic', () => {
    it('recovers the slope of a linear ramp and calls it rising', () => {
        // +1 °C per hour over 24 h from 530 → slope 24/day, +4.5 % of first.
        const s = summarizeWindow(hourly(24, (i) => 530 + i), { ...windowOf(24), unit: '°C' });
        expect(s.n_buckets).toBe(24);
        expect(s.n_points).toBe(24 * 60);
        expect(s.slope_per_day).toBeCloseTo(24, 3);
        expect(s.first).toBe(530);
        expect(s.last).toBe(553);
        expect(s.pct_change).toBeCloseTo(4.34, 1);
        expect(s.direction).toBe('rising');
        expect(s.headline).toMatch(/^rising 4\.3% over 1\.0 d \(530 → 553 °C\)/);
    });

    it('a flat series with noise is flat, not rising', () => {
        const s = summarizeWindow(hourly(48, (i) => 537 + (i % 2 ? 0.3 : -0.3)), windowOf(48));
        expect(s.direction).toBe('flat');
        expect(Math.abs(s.drift_pct_of_mean ?? 0)).toBeLessThan(2);
        expect(s.headline).toMatch(/^flat over 2\.0 d at ~537/);
    });

    it('a falling series is falling with a negative slope', () => {
        const s = summarizeWindow(hourly(24, (i) => 540 - 0.8 * i), windowOf(24));
        expect(s.direction).toBe('falling');
        expect(s.slope_per_day).toBeLessThan(0);
        expect(s.pct_change).toBeLessThan(0);
    });

    it('a single bucket is a reading, not a trend', () => {
        const s = summarizeWindow(hourly(1, () => 538), windowOf(24));
        expect(s.direction).toBe('unknown');
        expect(s.slope_per_day).toBeNull();
        expect(s.headline).toMatch(/^single reading 538/);
    });

    it('an empty window says so and returns nulls, never NaN', () => {
        const s = summarizeWindow([], { ...windowOf(24 * 7) });
        expect(s.n_buckets).toBe(0);
        expect(s.avg).toBeNull();
        expect(s.coverage_pct).toBe(0);
        expect(s.headline).toBe('no readings in the last 7.0 d');
        expect(JSON.stringify(s)).not.toContain('NaN');
    });
});

describe('summarizeWindow — bands and excursions', () => {
    const bands = { warn_low: 530, warn_high: 545, crit_low: 525, crit_high: 550 };

    it('counts each bucket once per side it crosses, crit inside warn', () => {
        // 20 normal hours, 3 warn-high (546–548), 1 crit-high (552).
        const vals = [...Array(20).fill(537), 546, 547, 548, 552];
        const s = summarizeWindow(hourly(24, (i) => vals[i]), { ...windowOf(24), bands, unit: '°C' });
        // max = avg + 0.5 in the fixture, so 545.5 > 545 would also count — none here.
        expect(s.excursions.warn_high).toBe(4);   // 3 warn + the crit one
        expect(s.excursions.crit_high).toBe(1);
        expect(s.excursions.warn_low).toBe(0);
        expect(s.excursions.pct_buckets_outside_warn).toBeCloseTo(16.7, 1);
        // No database counts on these synthetic buckets → time share falls back to
        // bucket MEANS: the same 4 buckets sit outside → 16.7 %, and it says so.
        expect(s.excursions.time_share_basis).toBe('bucket-mean');
        expect(s.excursions.pct_time_outside_warn).toBeCloseTo(16.7, 1);
        expect(s.headline).toContain('1 of 24 buckets beyond CRITICAL');
        expect(s.headline).toContain('~16.7% of the time outside the band (by bucket mean — short dips not counted)');
    });

    it('with database sample counts the time share is exact and a short dip inside a bucket is counted', () => {
        // The B-301 case: 96 buckets of ~1.75 h; the excursions are minute-scale dips.
        // Every bucket mean sits inside 530–545, yet 8 % of the samples are outside.
        const b: WindowBucket[] = Array.from({ length: 96 }, (_, i) => ({
            ts: new Date(T0 + i * 105 * 60_000).toISOString(), n: 105, min: i % 12 === 0 ? 517 : 534, avg: 537, max: 541, last: 537,
            n_below: i % 12 === 0 ? 100 : 0, n_above: 0,
        }));
        const s = summarizeWindow(b, { from: new Date(T0).toISOString(), to: new Date(T0 + 96 * 105 * 60_000).toISOString(), bands: { warn_low: 530, warn_high: 545 } });
        expect(s.excursions.time_share_basis).toBe('samples');
        expect(s.excursions.pct_time_outside_warn).toBeCloseTo(7.9, 1);   // 8 × 100 / (96 × 105)
        expect(s.excursions.warn_low).toBe(8);
        expect(s.headline).toContain('; 7.9% of the time outside the band');   // exact: no '~', no bucket-mean caveat
        expect(s.headline).not.toContain('~7.9%');
        expect(s.headline).not.toContain('by bucket mean');
    });

    it('a bucket that merely TOUCHED the line counts as an excursion but not as time outside', () => {
        // avg 537 (inside), max 546 (touched): "did it ever" yes, "how often" no.
        const b: WindowBucket[] = [{ ts: new Date(T0).toISOString(), n: 60, min: 530, avg: 537, max: 546, last: 537 }];
        const s = summarizeWindow(b, { ...windowOf(1), bands });
        expect(s.excursions.warn_high).toBe(1);
        expect(s.excursions.pct_time_outside_warn).toBe(0);
    });

    it('with only warning bands, crit counts stay zero', () => {
        const s = summarizeWindow(hourly(10, (i) => (i === 9 ? 560 : 537)), { ...windowOf(10), bands: { warn_high: 545 } });
        expect(s.excursions.warn_high).toBe(1);
        expect(s.excursions.crit_high).toBe(0);
        expect(s.headline).toContain('1 of 10 buckets outside warning');
    });

    it('with only critical bands, they double as the warning line', () => {
        const s = summarizeWindow(hourly(10, (i) => (i === 9 ? 560 : 537)), { ...windowOf(10), bands: { crit_high: 550 } });
        expect(s.excursions.warn_high).toBe(1);
        expect(s.excursions.crit_high).toBe(1);
    });
});

describe('summarizeWindow — coverage', () => {
    it('a window with half its hours missing reports ~50 % and says so', () => {
        // 12 hourly buckets in a 24 h window → 50 %.
        const s = summarizeWindow(hourly(12, () => 537), windowOf(24));
        expect(s.coverage_pct).toBeCloseTo(50, 0);
        expect(s.headline).toContain('only 50% of the window has data');
    });

    it('a full window is 100 %, and never more', () => {
        const s = summarizeWindow(hourly(24, () => 537), windowOf(24));
        expect(s.coverage_pct).toBe(100);
    });

    it('honours an explicit expected bucket count', () => {
        const s = summarizeWindow(hourly(6, () => 537), { ...windowOf(24), expected_buckets: 24 });
        expect(s.coverage_pct).toBe(25);
    });
});

describe('downsample', () => {
    it('keeps at most max buckets and always the last one', () => {
        const b = hourly(100, (i) => i);
        const d = downsample(b, 10);
        expect(d).toHaveLength(10);
        expect(d[0].ts).toBe(b[0].ts);
        expect(d[9].ts).toBe(b[99].ts);
    });
    it('returns the input untouched when already small enough', () => {
        const b = hourly(5, (i) => i);
        expect(downsample(b, 10)).toBe(b);
    });
});

describe('normalizeBuckets — the RPC row shape', () => {
    it('accepts sem_readings_window column names and string numerics', () => {
        const rows = [
            { bucket_ts: '2026-09-01T01:00:00+00:00', n: '60', min_value: '1.5', avg_value: '2', max_value: '2.5', last_value: '2.2', source: 'raw' },
            { bucket_ts: '2026-09-01T00:00:00+00:00', n: 60, min_value: 1, avg_value: 1, max_value: 1, last_value: 1 },
            { bucket_ts: 'not a date', avg_value: 5 },
            { bucket_ts: '2026-09-01T02:00:00+00:00', avg_value: null },
        ];
        const b = normalizeBuckets(rows);
        expect(b).toHaveLength(2);
        expect(b[0].avg).toBe(1);            // sorted oldest first
        expect(b[1].n).toBe(60);
        expect(b[1].last).toBe(2.2);
    });
});

describe('bucketsFromManualLogs — the rounds fallback', () => {
    it('turns reading_logs into n=1 buckets, sorted, skipping junk', () => {
        const b = bucketsFromManualLogs([
            { reading_date: '2026-09-03', reading_time: '08:00:00', reading_value: '12.5' },
            { reading_date: '2026-09-01', reading_time: null, reading_value: 12 },
            { reading_date: null, reading_value: 99 },
            { reading_date: '2026-09-02', reading_time: '08:00:00', reading_value: 'n/a' },
        ]);
        expect(b).toHaveLength(2);
        expect(b[0].ts).toBe('2026-09-01T00:00:00Z');
        expect(b[1].avg).toBe(12.5);
        expect(b[1].n).toBe(1);
    });

    it('summarises a sparse weekly route honestly', () => {
        const logs = [0, 7, 14, 21, 28].map((d) => ({
            reading_date: new Date(T0 + d * 24 * HOUR).toISOString().slice(0, 10),
            reading_time: '08:00:00',
            reading_value: 4 + d * 0.05,   // vibration creeping 4.0 → 5.4 mm/s
        }));
        const s = summarizeWindow(bucketsFromManualLogs(logs), { from: new Date(T0).toISOString(), to: new Date(T0 + 30 * 24 * HOUR).toISOString(), unit: 'mm/s', bands: { warn_high: 4.5, crit_high: 7.1 } });
        expect(s.n_points).toBe(5);
        expect(s.direction).toBe('rising');
        expect(s.excursions.warn_high).toBe(3);   // 4.7, 5.05, 5.4
        expect(s.excursions.crit_high).toBe(0);
        expect(s.coverage_pct).toBeGreaterThan(90); // weekly cadence, fully covered at that cadence
    });
});
