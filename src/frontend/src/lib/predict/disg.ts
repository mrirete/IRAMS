/**
 * D-I-S-G engine (Olorunfemi PSC framework) — Design → Installation →
 * Success → Golden Spot: the success-side mirror of the extended P-F curve.
 * Design & installation quality decide whether and how fast an asset reaches
 * Success (stable operation); the Golden Spot phase is about SUSTAINING it.
 *
 * This module makes the curve computational:
 *   I — install-quality signature: fitted Weibull β < 0.85 = infant-mortality
 *       pattern (early-life defects — the failure-side symptom of a bad I).
 *   S — time-to-success: first observation → first entry into the Golden Spot.
 *   G — drift projection: per-parameter linear trend → time until the worst
 *       parameter crosses its warning band = predicted remaining time in spot
 *       → predicted MTOP and SR (the success-side forecast).
 *
 * Honesty gates: a projection needs ≥ MIN_DRIFT_POINTS readings and a trend
 * that isn't noise (R² floor); stable/improving parameters project nothing.
 */
import { computePSC, type GoldenSpotParam, type ParamReading, type PSCResult } from '../psc';

export const MIN_DRIFT_POINTS = 8;
export const MIN_DRIFT_R2 = 0.25;
/** projections beyond this horizon are reported as "no measurable drift" */
export const MAX_PROJECTION_YEARS = 5;

const HOUR = 3_600_000;

export interface DriftProjection {
    paramId: string;
    paramName: string;
    n: number;
    /** engineering units per hour (signed) */
    slopePerHour: number;
    r2: number;
    current: number;
    /** the warning-band edge the trend is heading for */
    targetBand: number | null;
    /** hours until the trend crosses it; null = stable / away / too noisy */
    hoursToDeparture: number | null;
    status: 'projecting' | 'stable' | 'noisy' | 'insufficient' | 'outside';
}

export interface DisgAssessment {
    /** I — early-life defect signature from the fitted Weibull (null = no fit) */
    installSignal: { beta: number; infantMortality: boolean } | null;
    /** S — hours from first observation to first Golden Spot entry (0 = commissioned straight in) */
    timeToSuccessHours: number | null;
    /** G — measured now */
    zoneNow: PSCResult['zoneNow'];
    currentStreakHours: number | null;
    /** G — forecast */
    drifts: DriftProjection[];
    /** the soonest projected band-crossing across parameters */
    predictedRemainingInSpotHours: number | null;
    /** current streak + projected remaining = one full in-spot period estimate */
    predictedMtopHours: number | null;
    /** Eq. 3 with predicted MTOP and MEASURED MTTRg */
    predictedSuccessRate: number | null;
    limitingParam: string | null;
}

/** Least-squares trend of one parameter's readings (x = hours since first). */
function fitTrend(points: { atMs: number; value: number }[]): { slopePerHour: number; r2: number; last: number } | null {
    const n = points.length;
    if (n < 2) return null;
    const x0 = points[0].atMs;
    const xs = points.map(p => (p.atMs - x0) / HOUR);
    const ys = points.map(p => p.value);
    const xm = xs.reduce((s, v) => s + v, 0) / n;
    const ym = ys.reduce((s, v) => s + v, 0) / n;
    let sxx = 0, sxy = 0, syy = 0;
    for (let i = 0; i < n; i++) {
        sxx += (xs[i] - xm) ** 2;
        sxy += (xs[i] - xm) * (ys[i] - ym);
        syy += (ys[i] - ym) ** 2;
    }
    if (sxx <= 0) return null;
    const slope = sxy / sxx;
    const r2 = syy > 0 ? (sxy * sxy) / (sxx * syy) : 1;
    return { slopePerHour: slope, r2, last: ys[n - 1] };
}

/** Project one parameter's drift toward its warning band. */
export function projectDrift(param: GoldenSpotParam, readings: { atMs: number; value: number }[]): DriftProjection {
    const base: DriftProjection = {
        paramId: param.id, paramName: param.name, n: readings.length,
        slopePerHour: 0, r2: 0, current: readings[readings.length - 1]?.value ?? NaN,
        targetBand: null, hoursToDeparture: null, status: 'insufficient',
    };
    if (readings.length < MIN_DRIFT_POINTS) return base;

    const t = fitTrend(readings);
    if (!t) return base;
    base.slopePerHour = t.slopePerHour;
    base.r2 = Math.round(t.r2 * 100) / 100;
    base.current = t.last;

    if (t.r2 < MIN_DRIFT_R2) return { ...base, status: 'noisy' };

    // Which warning edge is the trend heading for?
    const up = t.slopePerHour > 0 ? param.maxWarning : null;
    const down = t.slopePerHour < 0 ? param.minWarning : null;
    const target = up ?? down ?? null;
    if (target == null || t.slopePerHour === 0) return { ...base, status: 'stable' };

    // Already outside the band → departure isn't a forecast, it's the present.
    if ((up != null && t.last >= up) || (down != null && t.last <= down)) {
        return { ...base, targetBand: target, hoursToDeparture: 0, status: 'outside' };
    }

    const hours = (target - t.last) / t.slopePerHour;
    if (!(hours > 0) || hours > MAX_PROJECTION_YEARS * 8766) return { ...base, targetBand: target, status: 'stable' };
    return { ...base, targetBand: target, hoursToDeparture: Math.round(hours), status: 'projecting' };
}

export function assessDisg(
    params: GoldenSpotParam[],
    readings: ParamReading[],
    opts: { fittedBeta?: number | null; mttrgHours?: number | null; now?: number } = {},
): DisgAssessment {
    const now = opts.now ?? Date.now();
    const psc = computePSC(params, readings, now, 365);

    // S — first observation → first OPTIMAL segment.
    let timeToSuccessHours: number | null = null;
    if (psc.segments.length) {
        const firstOptimal = psc.segments.find(s => s.state === 'OPTIMAL');
        timeToSuccessHours = firstOptimal
            ? Math.round((firstOptimal.start - psc.segments[0].start) / HOUR)
            : null; // observed, but never reached the spot — an S-phase red flag
    }

    // G measured — the open trailing streak, if currently in spot.
    const lastSeg = psc.segments[psc.segments.length - 1] ?? null;
    const currentStreakHours = lastSeg && lastSeg.state === 'OPTIMAL'
        ? Math.round((now - lastSeg.start) / HOUR)
        : null;

    // G forecast — per-parameter drift, worst crossing wins.
    const byParam = new Map<string, { atMs: number; value: number }[]>();
    for (const r of readings) {
        const atMs = typeof r.at === 'number' ? r.at : new Date(r.at).getTime();
        if (!Number.isFinite(atMs) || !Number.isFinite(r.value)) continue;
        const list = byParam.get(r.paramId) ?? [];
        list.push({ atMs, value: r.value });
        byParam.set(r.paramId, list);
    }
    const drifts = params
        .filter(p => byParam.has(p.id))
        .map(p => projectDrift(p, (byParam.get(p.id) || []).sort((a, b) => a.atMs - b.atMs)));

    const projecting = drifts.filter(d => d.status === 'projecting' && d.hoursToDeparture != null);
    const worst = projecting.reduce((m, d) => (m == null || d.hoursToDeparture! < m.hoursToDeparture! ? d : m), null as DriftProjection | null);

    const predictedRemainingInSpotHours = worst?.hoursToDeparture ?? null;
    const predictedMtopHours = predictedRemainingInSpotHours != null
        ? (currentStreakHours ?? 0) + predictedRemainingInSpotHours
        : null;
    const mttrg = opts.mttrgHours ?? psc.mttrgHours;
    const predictedSuccessRate = predictedMtopHours != null && mttrg != null
        ? Math.round((predictedMtopHours / (predictedMtopHours + mttrg)) * 1000) / 10
        : null;

    return {
        installSignal: opts.fittedBeta != null ? { beta: opts.fittedBeta, infantMortality: opts.fittedBeta < 0.85 } : null,
        timeToSuccessHours,
        zoneNow: psc.zoneNow,
        currentStreakHours,
        drifts,
        predictedRemainingInSpotHours,
        predictedMtopHours,
        predictedSuccessRate,
        limitingParam: worst?.paramName ?? null,
    };
}
