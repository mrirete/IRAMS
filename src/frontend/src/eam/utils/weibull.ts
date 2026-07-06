/**
 * Censored Weibull life-data analysis — THE Weibull fitter (R-1).
 *
 * Median-rank regression (industry-standard Weibull plotting) extended with:
 *  - RIGHT-CENSORED units (suspensions) via Johnson's adjusted-rank method.
 *    Real fleets are mostly suspensions — units still running, retired, or
 *    renewed by PM before failing. Fitting failures alone biases β/η
 *    pessimistic, and every downstream artifact (Monte Carlo inputs, PM
 *    intervals from Create-PM) inherits the bias.
 *  - Approximate CONFIDENCE BOUNDS on β and η from the regression standard
 *    errors (Student-t on the slope; delta method on ln η). These are
 *    regression bounds, not likelihood-ratio bounds — labeled approximate.
 *
 * Every Weibull surface (Modelling Weibull tab, Monte Carlo TTF fit, Predict)
 * must fit through this module — never a local re-implementation.
 */
// @ts-ignore — jstat ships no types
import * as jStat from 'jstat';

export interface WeibullUnit {
    time: number;
    /** true = suspension (unit removed/still running unfailed at `time`) */
    censored: boolean;
}

export interface WeibullConfidence {
    level: number;       // e.g. 0.90
    betaLower: number;
    betaUpper: number;
    etaLower: number;
    etaUpper: number;
}

export interface WeibullFitResult {
    beta: number;
    eta: number;
    r2: number;
    nFailures: number;
    nSuspensions: number;
    /** undefined when < 3 failures (no residual degrees of freedom) */
    confidence?: WeibullConfidence;
    /** failure plotting positions (median ranks) for probability plots */
    points: { t: number; F: number }[];
    /** sampled CDF/reliability curve for charting */
    plotData: { t: number; reliability: number; failure: number }[];
}

/**
 * Johnson adjusted ranks for a mixed failure/suspension sample.
 * Returns one entry per FAILURE (suspensions shift later failures' ranks).
 * Ties: the failure ranks ahead of a suspension at the same time.
 */
export function johnsonAdjustedRanks(units: WeibullUnit[]): { time: number; rank: number }[] {
    const sorted = [...units].sort((a, b) => a.time - b.time || Number(a.censored) - Number(b.censored));
    const N = sorted.length;
    let prev = 0;
    const out: { time: number; rank: number }[] = [];
    sorted.forEach((u, idx) => {
        if (u.censored) return;
        const k = idx + 1; // 1-based position in the full ordered sample
        const increment = (N + 1 - prev) / (2 + N - k);
        prev += increment;
        out.push({ time: u.time, rank: prev });
    });
    return out;
}

export interface FitWeibullOptions {
    /** two-sided confidence level for the parameter bounds (default 0.90) */
    confidenceLevel?: number;
}

/**
 * Fit a 2-parameter Weibull to failure times + optional right-censored
 * suspension times. Needs >= 2 failures; returns null otherwise.
 */
export function fitWeibull(
    failureTimes: number[],
    suspensionTimes: number[] = [],
    opts: FitWeibullOptions = {},
): WeibullFitResult | null {
    const failures = (failureTimes || []).filter(t => Number.isFinite(t) && t > 0);
    const suspensions = (suspensionTimes || []).filter(t => Number.isFinite(t) && t > 0);
    if (failures.length < 2) return null;

    const units: WeibullUnit[] = [
        ...failures.map(t => ({ time: t, censored: false })),
        ...suspensions.map(t => ({ time: t, censored: true })),
    ];
    const N = units.length;

    // Benard's median rank on the ADJUSTED rank: F = (r − 0.3) / (N + 0.4)
    const ranked = johnsonAdjustedRanks(units);
    const pts = ranked.map(({ time, rank }) => {
        const F = (rank - 0.3) / (N + 0.4);
        return { t: time, F, x: Math.log(time), y: Math.log(-Math.log(1 - F)) };
    });

    // OLS on the failure points: y = β·x − β·ln(η)
    const r = pts.length;
    const xMean = pts.reduce((s, p) => s + p.x, 0) / r;
    const yMean = pts.reduce((s, p) => s + p.y, 0) / r;
    const sxx = pts.reduce((s, p) => s + (p.x - xMean) ** 2, 0);
    const sxy = pts.reduce((s, p) => s + (p.x - xMean) * (p.y - yMean), 0);
    if (sxx <= 0) return null; // all failure times identical
    const beta = sxy / sxx;
    const intercept = yMean - beta * xMean;
    if (!(beta > 0)) return null; // degenerate life data
    const eta = Math.exp(-intercept / beta);

    const ssRes = pts.reduce((s, p) => s + (p.y - (beta * p.x + intercept)) ** 2, 0);
    const ssTot = pts.reduce((s, p) => s + (p.y - yMean) ** 2, 0);
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 1;

    // ── Approximate parameter bounds from the regression errors ──
    let confidence: WeibullConfidence | undefined;
    const df = r - 2;
    const level = opts.confidenceLevel ?? 0.9;
    if (df >= 1) {
        const s2 = ssRes / df;
        const varB = s2 / sxx;
        const varA = s2 * (1 / r + (xMean ** 2) / sxx);
        const covAB = -s2 * xMean / sxx;
        const tCrit = jStat.studentt.inv(1 - (1 - level) / 2, df);

        const seBeta = Math.sqrt(Math.max(varB, 0));
        // ln η = −a/β → delta method
        const dgdA = -1 / beta;
        const dgdB = intercept / (beta * beta);
        const varLnEta = Math.max(dgdA * dgdA * varA + dgdB * dgdB * varB + 2 * dgdA * dgdB * covAB, 0);
        const seLnEta = Math.sqrt(varLnEta);

        confidence = {
            level,
            betaLower: Math.max(beta - tCrit * seBeta, 1e-6),
            betaUpper: beta + tCrit * seBeta,
            etaLower: eta * Math.exp(-tCrit * seLnEta),
            etaUpper: eta * Math.exp(tCrit * seLnEta),
        };
    }

    // Sampled curve to 1.5× the longest observed life (suspensions included —
    // the fleet demonstrably lives at least that long).
    const maxObserved = Math.max(...units.map(u => u.time));
    const maxT = maxObserved * 1.5;
    const plotData: { t: number; reliability: number; failure: number }[] = [];
    for (let t = 1; t <= maxT; t += maxT / 100) {
        const F = 1 - Math.exp(-Math.pow(t / eta, beta));
        plotData.push({ t: Math.round(t), reliability: Math.round((1 - F) * 10000) / 100, failure: Math.round(F * 10000) / 100 });
    }

    return {
        beta: Math.round(beta * 100) / 100,
        eta: Math.round(eta),
        r2: Math.round(r2 * 1000) / 1000,
        nFailures: failures.length,
        nSuspensions: suspensions.length,
        confidence,
        points: pts.map(p => ({ t: p.t, F: p.F })),
        plotData,
    };
}

/** B-life: age by which `pct`% of the population has failed. */
export function weibullBLife(beta: number, eta: number, pct: number): number {
    return eta * Math.pow(-Math.log(1 - pct / 100), 1 / beta);
}

/**
 * Conditional Mean Residual Life — the rigorous "remaining useful life": the
 * expected additional time to failure GIVEN the unit has already survived to
 * `ageHours`. This is the real RUL (replaces heuristic health-index scaling):
 *
 *   MRL(t) = ( ∫ₜ^∞ R(x) dx ) / R(t),   R(x) = exp(-(x/η)^β)
 *
 * Computed by numeric integration to a generous upper bound. For β>1 (wear-out)
 * MRL shrinks as age rises — an aging unit has less life left, exactly what a
 * PdM RUL should show. Returns 0 once survival is negligible.
 */
export function meanResidualLifeHours(beta: number, eta: number, ageHours: number): number {
    if (!(beta > 0) || !(eta > 0)) return 0;
    const t = Math.max(0, ageHours);
    const R = (x: number) => Math.exp(-Math.pow(x / eta, beta));
    const Rt = R(t);
    if (Rt <= 1e-9) return 0; // essentially certain to have failed by now
    const upper = t + eta * 10; // R(x) is negligible well before this
    const N = 2000;
    const h = (upper - t) / N;
    let integral = 0;
    for (let i = 0; i <= N; i++) {
        const w = i === 0 || i === N ? 0.5 : 1; // trapezoidal
        integral += w * R(t + i * h);
    }
    return (integral * h) / Rt;
}
