// readingsSummary — turn a bucketed signal window into the few numbers a
// reliability engineer would read off a trend before deciding anything.
//
// WHY THIS EXISTS
// The agents can now read history (sem_readings_window, 0362), but a language
// model handed 96 buckets will either skim them or invent a trend. This module
// does the arithmetic once, deterministically, and hands over the result:
// slope, % change, band excursions, coverage, and a one-line headline. The
// model narrates; it does not compute.
//
// No I/O and no imports: buckets in, summary out. Shared by the query_readings
// tool, the 7-day lines in get_asset_context, and (later) the regime-aware
// detector — and runs identically under Deno and vitest.

// ── Shapes ───────────────────────────────────────────────────────────────

/** One row of sem_readings_window (or one manual reading, as an n=1 bucket). */
export interface WindowBucket {
  ts: string;      // ISO timestamp, bucket start
  n: number;       // samples inside the bucket
  min: number;
  avg: number;
  max: number;
  last: number;
  /**
   * Samples in the bucket above / below the warning band, counted in the
   * database (sem_readings_window p_lo/p_hi, 0368). Present on the raw path
   * only; a bucket mean cannot see a ten-minute dip inside a two-hour bucket.
   */
  n_above?: number | null;
  n_below?: number | null;
}

/** Alarm bands. Any side may be absent; warn is inside crit. */
export interface Bands {
  warn_low?: number | null;
  warn_high?: number | null;
  crit_low?: number | null;
  crit_high?: number | null;
}

export type Direction = "rising" | "falling" | "flat" | "unknown";

export interface SeriesSummary {
  n_points: number;         // samples across all buckets
  n_buckets: number;
  span_days: number;
  coverage_pct: number;     // buckets present / buckets expected at the observed width
  first: number | null;     // avg of the first bucket
  last: number | null;      // last sample of the last bucket
  min: number | null;
  avg: number | null;       // n-weighted mean
  max: number | null;
  slope_per_day: number | null;   // least squares on bucket means vs time
  pct_change: number | null;      // (last - first) / |first| × 100
  drift_pct_of_mean: number | null; // slope × span / |mean| × 100 — the size of the trend
  direction: Direction;
  excursions: {
    /** buckets whose MAX/MIN crossed the line — "did it ever touch the limit" */
    warn_high: number; warn_low: number; crit_high: number; crit_low: number;
    pct_buckets_outside_warn: number;
    /** share of TIME outside the warning band — see time_share_basis for how it was measured */
    pct_time_outside_warn: number;
    /**
     * 'samples'     — every sample counted against the band in the database (exact);
     * 'bucket-mean' — buckets judged by their mean (a short dip inside a long bucket is invisible);
     * 'none'        — no band, or no data.
     */
    time_share_basis: 'samples' | 'bucket-mean' | 'none';
  };
  headline: string;
}

export interface SummarizeOptions {
  from: string | Date;
  to: string | Date;
  bands?: Bands | null;
  unit?: string | null;
  /** Override the expected bucket count (else inferred from the bucket spacing). */
  expected_buckets?: number;
}

// A trend counts as a direction when the fitted line moves the signal by at
// least this share of its mean across the window. 2% is deliberately small:
// the caller decides whether a 2% drift matters; this module only reports it.
const DIRECTION_MIN_DRIFT_PCT = 2;

// ── Helpers ──────────────────────────────────────────────────────────────

const toMs = (v: string | Date): number => (v instanceof Date ? v.getTime() : Date.parse(v));
const round = (v: number, dp = 3): number => Math.round(v * 10 ** dp) / 10 ** dp;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Least-squares slope of y against x. Null when fewer than 2 distinct x. */
function slope(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  return sxx === 0 ? null : sxy / sxx;
}

/** Median gap between consecutive bucket starts, in ms. */
function medianGapMs(sorted: WindowBucket[]): number | null {
  if (sorted.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) gaps.push(toMs(sorted[i].ts) - toMs(sorted[i - 1].ts));
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
}

function spanLabel(days: number): string {
  if (days < 1) return `${Math.max(1, Math.round(days * 24))} h`;
  if (days < 14) return `${days.toFixed(1)} d`;
  return `${Math.round(days / 7)} wk`;
}

// Below this, most of the window is guesswork and the headline says so.
const COVERAGE_MENTION_BELOW_PCT = 75;

// ── Public API ───────────────────────────────────────────────────────────

/** Sort, drop malformed rows, coerce numerics. Never throws. */
export function normalizeBuckets(rows: Array<Record<string, unknown>>): WindowBucket[] {
  const out: WindowBucket[] = [];
  for (const r of rows ?? []) {
    const ts = typeof r.ts === "string" ? r.ts : typeof r.bucket_ts === "string" ? r.bucket_ts : null;
    if (!ts || Number.isNaN(Date.parse(ts))) continue;
    const num = (k: string, alt?: string): number | null => {
      const raw = r[k] ?? (alt ? r[alt] : undefined);
      const v = typeof raw === "string" ? Number(raw) : raw;
      return isNum(v) ? v : null;
    };
    const avg = num("avg", "avg_value");
    if (avg === null) continue;
    out.push({
      ts,
      n: Math.max(1, Math.round(num("n") ?? 1)),
      min: num("min", "min_value") ?? avg,
      avg,
      max: num("max", "max_value") ?? avg,
      last: num("last", "last_value") ?? avg,
      n_above: num("n_above"),
      n_below: num("n_below"),
    });
  }
  return out.sort((a, b) => toMs(a.ts) - toMs(b.ts));
}

/** Keep at most `max` buckets, evenly spaced, always keeping the last one. */
export function downsample(buckets: WindowBucket[], max: number): WindowBucket[] {
  if (max <= 0) return [];
  if (buckets.length <= max) return buckets;
  const step = buckets.length / max;
  const out: WindowBucket[] = [];
  for (let i = 0; i < max; i++) out.push(buckets[Math.floor(i * step)]);
  out[out.length - 1] = buckets[buckets.length - 1];
  return out;
}

export function summarizeWindow(input: WindowBucket[], opts: SummarizeOptions): SeriesSummary {
  const buckets = [...input].sort((a, b) => toMs(a.ts) - toMs(b.ts));
  const fromMs = toMs(opts.from), toMsV = toMs(opts.to);
  const spanDays = Math.max(0, (toMsV - fromMs) / 86_400_000);
  const unit = (opts.unit ?? "").trim();
  const bands = opts.bands ?? {};

  const empty: SeriesSummary = {
    n_points: 0, n_buckets: 0, span_days: round(spanDays, 2), coverage_pct: 0,
    first: null, last: null, min: null, avg: null, max: null,
    slope_per_day: null, pct_change: null, drift_pct_of_mean: null, direction: "unknown",
    excursions: { warn_high: 0, warn_low: 0, crit_high: 0, crit_low: 0, pct_buckets_outside_warn: 0, pct_time_outside_warn: 0, time_share_basis: 'none' },
    headline: `no readings in the last ${spanLabel(spanDays)}`,
  };
  if (buckets.length === 0) return empty;

  // Coverage: how much of the window actually has data, at the width the
  // buckets came in. One bucket in a 7-day window is 1/N, not 100%.
  let expected = opts.expected_buckets ?? 0;
  if (!expected) {
    const gap = medianGapMs(buckets);
    expected = gap && gap > 0 ? Math.max(buckets.length, Math.round((toMsV - fromMs) / gap)) : Math.max(1, buckets.length);
  }
  const coverage = Math.min(100, round((buckets.length / Math.max(1, expected)) * 100, 1));

  const nPoints = buckets.reduce((s, b) => s + b.n, 0);
  const wsum = buckets.reduce((s, b) => s + b.avg * b.n, 0);
  const avg = wsum / Math.max(1, nPoints);
  const min = Math.min(...buckets.map((b) => b.min));
  const max = Math.max(...buckets.map((b) => b.max));
  const first = buckets[0].avg;
  const last = buckets[buckets.length - 1].last;

  const xs = buckets.map((b) => (toMs(b.ts) - fromMs) / 86_400_000);
  const ys = buckets.map((b) => b.avg);
  const slopePerDay = slope(xs, ys);
  const pctChange = first !== 0 ? ((last - first) / Math.abs(first)) * 100 : null;
  const driftPct = slopePerDay !== null && avg !== 0 && spanDays > 0
    ? (slopePerDay * spanDays) / Math.abs(avg) * 100
    : null;
  const direction: Direction = driftPct === null
    ? (buckets.length < 2 ? "unknown" : "flat")
    : driftPct >= DIRECTION_MIN_DRIFT_PCT ? "rising"
    : driftPct <= -DIRECTION_MIN_DRIFT_PCT ? "falling" : "flat";

  // Excursions: a bucket counts once per band side it crossed. Crit implies
  // warn on the same side when both are set, so warn counts are >= crit counts.
  const ex: SeriesSummary['excursions'] = { warn_high: 0, warn_low: 0, crit_high: 0, crit_low: 0, pct_buckets_outside_warn: 0, pct_time_outside_warn: 0, time_share_basis: 'none' };
  const wh = isNum(bands.warn_high) ? bands.warn_high : isNum(bands.crit_high) ? bands.crit_high : null;
  const wl = isNum(bands.warn_low) ? bands.warn_low : isNum(bands.crit_low) ? bands.crit_low : null;
  const hasBand = wh !== null || wl !== null;
  // Exact time share needs every bucket to carry database-side sample counts.
  const sampleCounts = hasBand && buckets.every((b) => isNum(b.n_above) && isNum(b.n_below));
  let outsideWarn = 0, outsideWeight = 0, weight = 0;
  for (const b of buckets) {
    let out = false;
    if (wh !== null && b.max > wh) { ex.warn_high++; out = true; }
    if (wl !== null && b.min < wl) { ex.warn_low++; out = true; }
    if (isNum(bands.crit_high) && b.max > bands.crit_high) ex.crit_high++;
    if (isNum(bands.crit_low) && b.min < bands.crit_low) ex.crit_low++;
    if (out) outsideWarn++;
    weight += b.n;
    if (sampleCounts) {
      outsideWeight += Math.min(b.n, (b.n_above as number) + (b.n_below as number));
    } else if ((wh !== null && b.avg > wh) || (wl !== null && b.avg < wl)) {
      // Fallback: weight each bucket by its samples, judge it by its mean.
      outsideWeight += b.n;
    }
  }
  ex.pct_buckets_outside_warn = round((outsideWarn / buckets.length) * 100, 1);
  ex.pct_time_outside_warn = hasBand ? round((outsideWeight / Math.max(1, weight)) * 100, 1) : 0;
  ex.time_share_basis = !hasBand ? 'none' : sampleCounts ? 'samples' : 'bucket-mean';

  // Headline — the sentence an engineer would say first.
  const u = unit ? ` ${unit}` : "";
  const parts: string[] = [];
  if (direction === "rising" || direction === "falling") {
    parts.push(`${direction} ${round(Math.abs(pctChange ?? driftPct ?? 0), 1)}% over ${spanLabel(spanDays)} (${round(first, 2)} → ${round(last, 2)}${u})`);
  } else if (direction === "flat") {
    parts.push(`flat over ${spanLabel(spanDays)} at ~${round(avg, 2)}${u}`);
  } else {
    parts.push(`single reading ${round(last, 2)}${u}`);
  }
  if (ex.crit_high || ex.crit_low) parts.push(`${ex.crit_high + ex.crit_low} of ${buckets.length} buckets beyond CRITICAL`);
  else if (ex.warn_high || ex.warn_low) parts.push(`${ex.warn_high + ex.warn_low} of ${buckets.length} buckets outside warning`);
  if (ex.warn_high || ex.warn_low) parts.push(`${ex.time_share_basis === 'samples' ? '' : '~'}${ex.pct_time_outside_warn}% of the time outside the band${ex.time_share_basis === 'bucket-mean' ? ' (by bucket mean — short dips not counted)' : ''}`);
  if (coverage < COVERAGE_MENTION_BELOW_PCT) parts.push(`only ${coverage}% of the window has data`);

  return {
    n_points: nPoints,
    n_buckets: buckets.length,
    span_days: round(spanDays, 2),
    coverage_pct: coverage,
    first: round(first, 4), last: round(last, 4),
    min: round(min, 4), avg: round(avg, 4), max: round(max, 4),
    slope_per_day: slopePerDay === null ? null : round(slopePerDay, 6),
    pct_change: pctChange === null ? null : round(pctChange, 2),
    drift_pct_of_mean: driftPct === null ? null : round(driftPct, 2),
    direction,
    excursions: ex,
    headline: parts.join("; "),
  };
}

/**
 * The 50-point projection on ers_sensor_readings has values but no timestamps
 * (a tenant seeded before 0236, or a feed that only ever wrote the sparkline).
 * Order is all we know, so: no span, no rate, coverage 0 — and the headline
 * says "untimed" so nobody reads a rate into it.
 */
export function summarizeUntimed(values: unknown[], opts: { bands?: Bands | null; unit?: string | null } = {}): SeriesSummary {
  const vals = (values ?? []).map((v) => (typeof v === "string" ? Number(v) : v)).filter(isNum) as number[];
  const n = vals.length;
  const minute = 60_000;
  const buckets: WindowBucket[] = vals.map((v, i) => ({ ts: new Date(i * minute).toISOString(), n: 1, min: v, avg: v, max: v, last: v }));
  const s = summarizeWindow(buckets, { from: new Date(0), to: new Date(Math.max(1, n) * minute), bands: opts.bands, unit: opts.unit });
  if (n === 0) return { ...s, headline: "no readings (projection empty)" };
  const unit = (opts.unit ?? "").trim();
  const u = unit ? ` ${unit}` : "";
  const dir: Direction = n < 2 ? "unknown" : s.pct_change !== null && s.pct_change >= DIRECTION_MIN_DRIFT_PCT ? "rising" : s.pct_change !== null && s.pct_change <= -DIRECTION_MIN_DRIFT_PCT ? "falling" : "flat";
  const parts = [
    `untimed projection, last ${n} sample(s): ${dir === "rising" || dir === "falling" ? `${dir} ${round(Math.abs(s.pct_change ?? 0), 1)}%` : dir === "flat" ? "flat" : "single value"} (${round(s.first ?? 0, 2)} → ${round(s.last ?? 0, 2)}${u})`,
  ];
  if (s.excursions.crit_high || s.excursions.crit_low) parts.push(`${s.excursions.crit_high + s.excursions.crit_low} of ${n} beyond CRITICAL`);
  else if (s.excursions.warn_high || s.excursions.warn_low) parts.push(`${s.excursions.warn_high + s.excursions.warn_low} of ${n} outside warning`);
  parts.push("no timestamps — order only, no rate");
  return {
    ...s,
    span_days: 0,
    coverage_pct: 0,
    slope_per_day: null,
    drift_pct_of_mean: null,
    direction: dir,
    headline: parts.join("; "),
  };
}

/** Manual reading_logs rows → n=1 buckets, so one summariser serves both paths. */
export function bucketsFromManualLogs(
  logs: Array<{ reading_date: string | null; reading_time?: string | null; reading_value: number | string | null }>,
): WindowBucket[] {
  const out: WindowBucket[] = [];
  for (const l of logs ?? []) {
    if (!l.reading_date) continue;
    const v = typeof l.reading_value === "string" ? Number(l.reading_value) : l.reading_value;
    if (!isNum(v)) continue;
    const ts = `${l.reading_date}T${(l.reading_time ?? "00:00:00").slice(0, 8)}Z`;
    if (Number.isNaN(Date.parse(ts))) continue;
    out.push({ ts, n: 1, min: v, avg: v, max: v, last: v });
  }
  return out.sort((a, b) => toMs(a.ts) - toMs(b.ts));
}
