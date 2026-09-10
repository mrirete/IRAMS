/**
 * Spares sizing — Poisson demand over a resupply window.
 *
 * How many spares must be on the shelf so that, with `confidence`% certainty,
 * demand during the resupply window is covered? Demand over the window is
 * Poisson with mean λ = population × failure rate × window, and the answer is
 * the smallest k whose cumulative probability reaches the service level.
 *
 * WHY THIS IS ITS OWN MODULE (audit M-9): the previous inline version computed
 * the pmf as λ^k · e^−λ / k! in LINEAR space. For λ ≳ 140 the numerator
 * overflows to Infinity and the factorial hits its own Infinity guard at
 * n > 170, so the term became NaN, the accumulation stopped early, and the
 * recommendation came back FAR too low — plausible inputs (100 units, MTBF
 * 1000 h, 90-day resupply → λ = 216) returned 133 spares where the true 95%
 * quantile is 240. A stocking decision was being made on a number that had
 * silently overflowed.
 *
 * Everything here is computed in log space, so λ is limited only by how long
 * you are willing to iterate.
 */

/** log Γ(x) — Lanczos approximation, g=7, n=9. Accurate to ~1e-13 for x > 0. */
const LANCZOS = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

export function logGamma(x: number): number {
    if (x < 0.5) {
        // Reflection formula keeps the approximation on its accurate side.
        return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
    }
    const z = x - 1;
    let a = LANCZOS[0];
    const t = z + 7.5;
    for (let i = 1; i < 9; i++) a += LANCZOS[i] / (z + i);
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Poisson pmf in log space: ln P(X = k) = k·lnλ − λ − lnΓ(k+1). */
export function poissonLogPmf(k: number, lambda: number): number {
    if (lambda <= 0) return k === 0 ? 0 : -Infinity;
    return k * Math.log(lambda) - lambda - logGamma(k + 1);
}

export interface SparesRow { k: number; prob: number; cumProb: number }

export interface SparesResult {
    /** Expected failures over the resupply window. */
    lambda: number;
    /** Smallest stock level whose cumulative probability reaches the service level. */
    requiredSpares: number;
    /** Per-k probability table, truncated at the service level. */
    rows: SparesRow[];
    /** True when the search hit its iteration ceiling before reaching the target. */
    truncated: boolean;
}

/**
 * Iterations are bounded well above the quantile of interest: for a Poisson,
 * λ + 12√λ is roughly a 12-sigma tail, far beyond any service level anyone
 * sets, and the +50 covers small λ.
 */
const iterationCeiling = (lambda: number) =>
    Math.min(200000, Math.ceil(lambda + 12 * Math.sqrt(Math.max(lambda, 1)) + 50));

export function poissonSpares(
    population: number,
    failureRate: number,
    interval: number,
    confidence: number,
): SparesResult {
    const lambda = population * failureRate * interval;
    const target = confidence / 100;

    if (!Number.isFinite(lambda) || lambda < 0) {
        return { lambda: 0, requiredSpares: 0, rows: [], truncated: false };
    }

    const ceiling = iterationCeiling(lambda);
    const rows: SparesRow[] = [];
    let cumulative = 0;
    let k = 0;

    while (cumulative < target && k <= ceiling) {
        const prob = Math.exp(poissonLogPmf(k, lambda));
        cumulative = Math.min(1, cumulative + prob);
        rows.push({
            k,
            prob: Math.round(prob * 10000) / 10000,
            cumProb: Math.round(cumulative * 10000) / 10000,
        });
        k++;
    }

    return {
        lambda,
        // The last k pushed is the smallest stock level meeting the service level.
        requiredSpares: Math.max(0, k - 1),
        rows,
        truncated: cumulative < target,
    };
}
