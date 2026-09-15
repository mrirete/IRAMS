/**
 * regimeBaseline — "is this value normal AT THIS LOAD?"
 *
 * WHY THIS EXISTS
 * Every fixed alarm band on a boiler fan, a compressor or a pump has the same
 * two failure modes: it alarms on a load change (the signal moved because
 * the duty moved) and it misses real degradation (the signal moved while the
 * duty did not, but stayed inside the band). ID-fan motor current rising 8 %
 * at flat steam flow is impeller build-up; the same 8 % on a 40 % load ramp
 * is Tuesday. A band cannot tell them apart. A baseline of the signal AGAINST
 * the load can.
 *
 * WHAT IT IS
 * Least squares of y (the monitored tag) on x (the load / regime tag) over a
 * healthy baseline window — linear, or quadratic when asked (fan laws are
 * square-ish). The residual standard deviation is the noise floor; a new
 * (x, y) pair is scored as a z against that floor. Plain arithmetic, no
 * training, no labels, and every number it reports can be recomputed by hand.
 *
 * WHAT IT IS NOT
 * Not a classifier and not a black box. It says "this is unusual for this
 * load"; diagnosisRules says what it might be, from the asset's own FMEA. It
 * refuses to speak when the load does not explain the signal (low R²) or when
 * the current load is outside anything the baseline saw (extrapolation) —
 * both are silence, not guesses.
 *
 * Pure: numbers in, numbers out. No I/O.
 */

// ── Shapes ───────────────────────────────────────────────────────────────

/** One aligned observation: the monitored value y at load x, at time t. */
export interface RegimePair {
    t: string;
    x: number;
    y: number;
}

export interface RegimeFit {
    degree: 1 | 2;
    n: number;
    /** y ≈ a + b·x + c·x²  (c = 0 for degree 1) */
    a: number;
    b: number;
    c: number;
    /** residual standard deviation (n − p degrees of freedom) */
    sigma: number;
    /** share of y's variance the load explains */
    r2: number;
    xMin: number;
    xMax: number;
    yMean: number;
}

export interface RegimeScore {
    expected: number;
    residual: number;
    /** residual as a % of the expected value */
    residualPct: number;
    /** residual / sigma */
    z: number;
    /** x lies outside the baseline's load range (± tolerance) — no verdict is safe */
    extrapolated: boolean;
}

export interface RegimeFinding {
    direction: 'high' | 'low';
    value: number;
    load: number;
    expected: number;
    sigma: number;
    z: number;
    residualPct: number;
    baselineN: number;
    r2: number;
    /** how many consecutive current pairs agreed (persistence) */
    persisted: number;
}

// ── Thresholds (stated once; echoed into every finding) ──────────────────

/** Fewer baseline pairs than this and the noise floor is a guess. */
export const MIN_BASELINE_PAIRS = 24;
/** Below this R² the load does not explain the signal — the model is silent. */
export const MIN_R2 = 0.3;
/** Load range tolerance for "have we seen this regime before". */
export const EXTRAPOLATION_TOLERANCE = 0.1;

export interface EvaluateOptions {
    /** |z| a pair must reach (default 3). */
    minZ?: number;
    /** |residual %| a pair must reach (default 2) — a 3σ deviation of 0.1 % is noise on a quiet signal. */
    minPct?: number;
    /** consecutive most-recent pairs that must all agree (default 2). */
    persistence?: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const round = (v: number, dp = 4): number => Math.round(v * 10 ** dp) / 10 ** dp;

/** Solve the (p×p) normal equations by Gaussian elimination with partial pivoting. */
function solve(A: number[][], b: number[]): number[] | null {
    const n = b.length;
    const M = A.map((row, i) => [...row, b[i]]);
    for (let col = 0; col < n; col++) {
        let piv = col;
        for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
        if (Math.abs(M[piv][col]) < 1e-12) return null;
        [M[col], M[piv]] = [M[piv], M[col]];
        for (let r = 0; r < n; r++) {
            if (r === col) continue;
            const f = M[r][col] / M[col][col];
            for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
        }
    }
    return M.map((row, i) => row[n] / row[i]);
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Join two bucketed series on their bucket timestamp. Buckets from
 * sem_readings_window share a grid when asked for the same window and the
 * same max, so an exact match on `ts` is the alignment.
 */
export function alignSeries(
    y: Array<{ ts: string; avg: number }>,
    x: Array<{ ts: string; avg: number }>,
): RegimePair[] {
    const xAt = new Map<string, number>();
    for (const b of x ?? []) if (isNum(b.avg)) xAt.set(b.ts, b.avg);
    const out: RegimePair[] = [];
    for (const b of y ?? []) {
        const xv = xAt.get(b.ts);
        if (xv !== undefined && isNum(b.avg)) out.push({ t: b.ts, x: xv, y: b.avg });
    }
    return out.sort((p, q) => Date.parse(p.t) - Date.parse(q.t));
}

/** Fit y on x over the baseline. Null when there is too little data or no variance in x. */
export function fitRegime(pairs: RegimePair[], opts: { degree?: 1 | 2 } = {}): RegimeFit | null {
    const degree = opts.degree ?? 1;
    const P = pairs.filter((p) => isNum(p.x) && isNum(p.y));
    const n = P.length;
    const p = degree + 1;
    if (n < Math.max(MIN_BASELINE_PAIRS, p + 2)) return null;

    // Centre x for conditioning; expand back afterwards.
    const xMean = P.reduce((s, q) => s + q.x, 0) / n;
    const yMean = P.reduce((s, q) => s + q.y, 0) / n;
    const X = P.map((q) => q.x - xMean);
    const Y = P.map((q) => q.y);

    // Normal equations Σ x^(i+j) β_j = Σ x^i y
    const A: number[][] = Array.from({ length: p }, () => Array(p).fill(0));
    const B: number[] = Array(p).fill(0);
    for (let k = 0; k < n; k++) {
        const pow = [1, X[k], X[k] * X[k]];
        for (let i = 0; i < p; i++) {
            B[i] += pow[i] * Y[k];
            for (let j = 0; j < p; j++) A[i][j] += pow[i] * pow[j];
        }
    }
    const beta = solve(A, B);
    if (!beta) return null;
    const [b0, b1, b2 = 0] = beta;

    // Expand (x − xMean) back to x: a + b·x + c·x²
    const c = degree === 2 ? b2 : 0;
    const b = b1 - 2 * c * xMean;
    const a = b0 - b1 * xMean + c * xMean * xMean;

    let ssRes = 0, ssTot = 0;
    for (const q of P) {
        const yhat = a + b * q.x + c * q.x * q.x;
        ssRes += (q.y - yhat) ** 2;
        ssTot += (q.y - yMean) ** 2;
    }
    const sigma = Math.sqrt(ssRes / Math.max(1, n - p));
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
    const xs = P.map((q) => q.x);
    return {
        degree, n,
        a: round(a, 8), b: round(b, 8), c: round(c, 10),
        sigma: round(sigma, 6), r2: round(Math.max(0, r2), 4),
        xMin: Math.min(...xs), xMax: Math.max(...xs), yMean: round(yMean, 6),
    };
}

/** Score one (x, y) pair against the fit. */
export function scoreRegime(fit: RegimeFit, x: number, y: number): RegimeScore {
    const expected = fit.a + fit.b * x + fit.c * x * x;
    const residual = y - expected;
    const range = Math.max(1e-9, fit.xMax - fit.xMin);
    const tol = range * EXTRAPOLATION_TOLERANCE;
    return {
        expected: round(expected, 6),
        residual: round(residual, 6),
        residualPct: expected !== 0 ? round((residual / Math.abs(expected)) * 100, 3) : 0,
        z: fit.sigma > 0 ? round(residual / fit.sigma, 4) : 0,
        extrapolated: x < fit.xMin - tol || x > fit.xMax + tol,
    };
}

/**
 * The decision: do the most recent `persistence` pairs ALL deviate the same
 * way, each by ≥ minZ and ≥ minPct, at loads the baseline has seen? Then
 * report the latest one. Otherwise null — including when the fit explains
 * too little (R² < MIN_R2), which is the model declining to have an opinion.
 */
export function evaluateRegime(fit: RegimeFit | null, current: RegimePair[], opts: EvaluateOptions = {}): RegimeFinding | null {
    if (!fit || fit.r2 < MIN_R2) return null;
    const minZ = opts.minZ ?? 3;
    const minPct = opts.minPct ?? 2;
    const persistence = Math.max(1, opts.persistence ?? 2);
    const recent = [...current].filter((p) => isNum(p.x) && isNum(p.y)).sort((p, q) => Date.parse(p.t) - Date.parse(q.t)).slice(-persistence);
    if (recent.length < persistence) return null;

    const scores = recent.map((p) => ({ p, s: scoreRegime(fit, p.x, p.y) }));
    if (scores.some(({ s }) => s.extrapolated)) return null;
    const dir = (s: RegimeScore): 'high' | 'low' | null =>
        s.z >= minZ && s.residualPct >= minPct ? 'high'
            : s.z <= -minZ && s.residualPct <= -minPct ? 'low'
                : null;
    const dirs = scores.map(({ s }) => dir(s));
    if (dirs.some((d) => d === null) || new Set(dirs).size !== 1) return null;

    const { p, s } = scores[scores.length - 1];
    return {
        direction: dirs[0] as 'high' | 'low',
        value: p.y, load: p.x,
        expected: s.expected, sigma: fit.sigma, z: s.z, residualPct: s.residualPct,
        baselineN: fit.n, r2: fit.r2, persisted: persistence,
    };
}

/** The sentence an engineer would say — used on the alert and as diagnosis evidence. */
export function describeFinding(f: RegimeFinding, tag: string, loadTag: string, unit: string, loadUnit: string, baselineDays: number): string {
    const u = unit ? ` ${unit}` : '';
    const lu = loadUnit ? ` ${loadUnit}` : '';
    return `${tag} at ${round(f.value, 2)}${u} — ${Math.abs(round(f.residualPct, 1))}% ${f.direction === 'high' ? 'above' : 'below'} the ${round(f.expected, 2)}${u} expected at this load (${loadTag} = ${round(f.load, 2)}${lu}); ${Math.abs(round(f.z, 1))}σ against a ${baselineDays}-day baseline (n=${f.baselineN}, R²=${f.r2}), persisted ${f.persisted} consecutive hour(s).`;
}
