/**
 * Health trend from saved history (0392 ers_health_history).
 *
 * The twin's own 30-day projection is a fixed decay rate per health band — a
 * direction. Once an asset has enough saved points, the projection is fitted
 * to them instead: ordinary least squares of health on time, projected from
 * the latest value, with a band of ±1.96 × the residual spread that widens
 * with distance (√(1 + d/span)). Every number is recomputable by hand.
 *
 * Minimums: 5 points over at least 2 days. Fewer, and the fixed-rate
 * direction stays (labelled as such).
 */

export interface HistoryPoint {
    at: string;       // ISO time
    value: number;
}

export interface HealthFit {
    n: number;
    spanDays: number;
    slopePerDay: number;
    /** Residual standard deviation, health points. */
    residualSd: number;
    latest: number;
}

export const MIN_FIT_POINTS = 5;
export const MIN_FIT_SPAN_DAYS = 2;
const DAY = 86_400_000;

export function fitHealthTrend(points: HistoryPoint[]): HealthFit | null {
    const pts = points
        .map(p => ({ t: new Date(p.at).getTime(), v: Number(p.value) }))
        .filter(p => Number.isFinite(p.t) && Number.isFinite(p.v))
        .sort((a, b) => a.t - b.t);
    if (pts.length < MIN_FIT_POINTS) return null;
    const t0 = pts[0].t;
    const xs = pts.map(p => (p.t - t0) / DAY);
    const spanDays = xs[xs.length - 1];
    if (spanDays < MIN_FIT_SPAN_DAYS) return null;
    const n = pts.length;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = pts.reduce((a, p) => a + p.v, 0) / n;
    let sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (pts[i].v - my); sxx += (xs[i] - mx) ** 2; }
    const slope = sxx > 0 ? sxy / sxx : 0;
    const intercept = my - slope * mx;
    const ss = pts.reduce((a, p, i) => a + (p.v - (intercept + slope * xs[i])) ** 2, 0);
    const residualSd = Math.sqrt(ss / Math.max(1, n - 2));
    return { n, spanDays: round1(spanDays), slopePerDay: round3(slope), residualSd: round2(residualSd), latest: pts[n - 1].v };
}

/** Same shape as TwinState.health_projection, so the existing chart draws it unchanged. */
export function fittedProjection(fit: HealthFit, days = 30) {
    return Array.from({ length: days }, (_, i) => {
        const d = i + 1;
        const mid = clamp(fit.latest + fit.slopePerDay * d);
        const half = 1.96 * fit.residualSd * Math.sqrt(1 + d / Math.max(1, fit.spanDays));
        return { days_ahead: d, health_index: round1(mid), confidence_lower: round1(clamp(mid - half)), confidence_upper: round1(clamp(mid + half)) };
    });
}

/** How much a series moved over its window — for "How this estimate changed". */
export function seriesSpread(points: HistoryPoint[]): { first: number; last: number; min: number; max: number; n: number } | null {
    const vs = points.map(p => Number(p.value)).filter(Number.isFinite);
    if (vs.length < 2) return null;
    return { first: vs[0], last: vs[vs.length - 1], min: Math.min(...vs), max: Math.max(...vs), n: vs.length };
}

const clamp = (v: number) => Math.max(0, Math.min(100, v));
const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;
const round3 = (v: number) => Math.round(v * 1000) / 1000;
