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
    /** When the latest point was saved — crossings are counted from here. */
    latestAt: string;
}

/**
 * History points that stand on data: every twin update saves a health point
 * (0392 trigger), including a re-score of readings that have not changed. A
 * point recorded more than `staleDays` after the newest reading is such a
 * re-score, and a line fitted through repeats of one measurement would look
 * confident about nothing.
 */
export function freshHistory(points: HistoryPoint[], newestReadingAt: string | null | undefined, staleDays: number): { points: HistoryPoint[]; ignored: number } {
    const newest = newestReadingAt ? new Date(newestReadingAt).getTime() : NaN;
    if (!Number.isFinite(newest)) return { points: [], ignored: points.length };
    const cutoff = newest + staleDays * DAY;
    const kept = points.filter(p => new Date(p.at).getTime() <= cutoff);
    return { points: kept, ignored: points.length - kept.length };
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
    return {
        n, spanDays: round1(spanDays), slopePerDay: round3(slope), residualSd: round2(residualSd),
        latest: pts[n - 1].v, latestAt: new Date(pts[n - 1].t).toISOString(),
    };
}

/**
 * Days from the latest saved point until the fitted line reaches `limit`.
 * 0 when already at or below it; null when health is not falling.
 */
export function daysToLimit(fit: HealthFit, limit: number): number | null {
    if (fit.latest <= limit) return 0;
    if (!(fit.slopePerDay < 0)) return null;
    return (fit.latest - limit) / -fit.slopePerDay;
}

/** Days of notice the planner needs to schedule the job and get parts in. */
export const PLANNING_LEAD_DAYS = 7;

export interface NeededBy {
    /** YYYY-MM-DD, or null when nothing supports a date. */
    date: string | null;
    /** Why this date (or why none) — shown next to the field, so it can be judged. */
    note: string;
}

/**
 * When the work is needed by: the date the asset is expected to reach the
 * failure limit, less PLANNING_LEAD_DAYS, never before today. The fitted
 * health trend is the clock when there is one; the remaining-life estimate
 * otherwise; no date when neither exists. Every suggestion names its basis.
 */
export function suggestNeededBy(args: {
    fit: HealthFit | null;
    limit: number;
    rulDays?: number | null;
    rulBasis?: string | null;
    now?: Date;
}): NeededBy {
    const now = args.now ?? new Date();
    const lead = PLANNING_LEAD_DAYS;
    const dateAt = (ms: number) => ymd(new Date(Math.max(ms - lead * DAY, now.getTime())));
    const fmt = (ms: number) => ymd(new Date(ms));

    if (args.fit) {
        const d = daysToLimit(args.fit, args.limit);
        if (d === 0) {
            return { date: ymd(now), note: `Health (${args.fit.latest}) is already at the failure limit (${args.limit}). Needed now.` };
        }
        if (d != null) {
            const cross = new Date(args.fit.latestAt).getTime() + d * DAY;
            const beyond = d > 30 ? ' (beyond the 30-day chart, so an extrapolation)' : '';
            return {
                date: dateAt(cross),
                note: `Health trend, fitted to ${args.fit.n} points (${args.fit.slopePerDay} a day), reaches ${args.limit} around ${fmt(cross)}${beyond}. ` +
                    `Needed ${lead} days before that to plan and get parts.`,
            };
        }
    }
    if (args.rulDays != null && Number.isFinite(args.rulDays) && args.rulDays > 0) {
        const end = now.getTime() + args.rulDays * DAY;
        return {
            date: dateAt(end),
            note: `Remaining life ${Math.round(args.rulDays)} days${args.rulBasis ? ` (${args.rulBasis})` : ''}, ending around ${fmt(end)}. ` +
                `Needed ${lead} days before that to plan and get parts.`,
        };
    }
    return {
        date: null,
        note: args.fit
            ? 'No date suggested: health is not falling and there is no remaining-life estimate. Set one if the work has a deadline.'
            : `No date suggested: no fitted health trend yet (needs ${MIN_FIT_POINTS} saved points over ${MIN_FIT_SPAN_DAYS} days) and no remaining-life estimate.`,
    };
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

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
