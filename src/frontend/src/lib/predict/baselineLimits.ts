/**
 * Learned baseline limits (Phase 1.5.2) — Senseye-style automatic baselining,
 * but transparent: the suggestion always shows its statistics and the user
 * approves before anything is written. High-side bands from a healthy-period
 * sample: warning = μ + 2σ, critical = μ + 3σ, optionally clamped so the
 * statistics never exceed a standards envelope (e.g. ISO 20816-3 zones).
 */

/** Minimum usable sample; below ~30 the rationale flags low confidence. */
export const MIN_BASELINE_READINGS = 12;
export const GOOD_BASELINE_READINGS = 30;

export interface BaselineSuggestion {
    maxWarning: number;
    maxCritical: number;
    n: number;
    mean: number;
    sd: number;
    clamped: boolean;
    /** the full, human-readable justification — always shown with the numbers */
    rationale: string;
    source: 'learned';
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export function suggestBandsFromReadings(
    rawValues: number[],
    envelope?: { maxWarning?: number | null; maxCritical?: number | null },
    minN: number = MIN_BASELINE_READINGS,
): BaselineSuggestion | null {
    const values = (rawValues || []).filter(v => Number.isFinite(v));
    const n = values.length;
    if (n < minN) return null;

    const mean = values.reduce((s, v) => s + v, 0) / n;
    const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
    // Zero spread carries no information about normal variation — nothing to learn.
    if (!(sd > 0)) return null;

    let warning = mean + 2 * sd;
    let critical = mean + 3 * sd;
    let clamped = false;
    if (envelope?.maxWarning != null && warning > envelope.maxWarning) { warning = envelope.maxWarning; clamped = true; }
    if (envelope?.maxCritical != null && critical > envelope.maxCritical) { critical = envelope.maxCritical; clamped = true; }
    // Keep band order sane after clamping.
    if (critical < warning) critical = warning;

    const rationale =
        `Learned from ${n} readings (μ=${round2(mean)}, σ=${round2(sd)}): warning = μ+2σ, critical = μ+3σ` +
        (clamped ? ', clamped to the standards envelope' : '') +
        (n < GOOD_BASELINE_READINGS ? ` — low sample (<${GOOD_BASELINE_READINGS}), refine as more readings arrive` : '') +
        '. Assumes the sampled period is healthy operation.';

    return { maxWarning: round2(warning), maxCritical: round2(critical), n, mean: round2(mean), sd: round2(sd), clamped, rationale, source: 'learned' };
}
