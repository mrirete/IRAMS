/**
 * Static-equipment integrity math (Phase 2.4) — API 570-style thickness
 * trending. The correct "degradation model" for a cooler/vessel/pipe is wall
 * loss, not a bearing curve:
 *
 *   LTCR (long-term corrosion rate)  = (first − last) / years spanned
 *   STCR (short-term corrosion rate) = (previous − last) / years spanned
 *   governing rate = the HIGHER of the two (API 570 rule)
 *   remaining life = (current − t_min) / governing rate
 *   next inspection ≤ half the remaining life (API 570 interval rule)
 *
 * The rate/life/interval formulas delegate to the shared engine in
 * eam/utils/integrityCalcs — one source of math, so this module always agrees
 * with the Integrity pages (incl. the 99-yr life cap and the generic 10-yr
 * API 510 interval cap).
 */
import { controllingRate, remainingLife as sharedRemainingLife, nextInspectionInterval } from '../../eam/utils/integrityCalcs';

export interface ThicknessPoint {
    /** ISO date of the reading */
    date: string;
    /** wall thickness (same unit as tMin, typically mm) */
    value: number;
}

export interface IntegrityAssessment {
    current: number;
    tMin: number | null;
    /** thinning rates per YEAR (0 when wall is stable/growing) */
    ltcrPerYear: number;
    stcrPerYear: number;
    governingPerYear: number;
    governingBasis: 'LTCR' | 'STCR';
    /** null when no t_min is set or the wall isn't thinning */
    remainingLifeYears: number | null;
    /** API 570: re-inspect at ≤ half the remaining life */
    nextInspectionYears: number | null;
    n: number;
    spanYears: number;
    note: string;
}

const YEAR_MS = 365.25 * 86400000;
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Assess wall-loss from successive thickness readings. Needs ≥2 readings with
 * a positive time span; `tMin` is the definition's low-critical band (the
 * minimum required thickness). Returns null when there isn't enough data.
 */
export function assessIntegrity(points: ThicknessPoint[], tMin: number | null | undefined): IntegrityAssessment | null {
    const pts = (points || [])
        .filter(p => Number.isFinite(p.value) && p.value > 0 && !Number.isNaN(new Date(p.date).getTime()))
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    if (pts.length < 2) return null;

    const first = pts[0];
    const last = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    const spanYears = (new Date(last.date).getTime() - new Date(first.date).getTime()) / YEAR_MS;
    if (!(spanYears > 0)) return null;

    const ltcr = Math.max(0, (first.value - last.value) / spanYears);
    const stcrSpan = (new Date(last.date).getTime() - new Date(prev.date).getTime()) / YEAR_MS;
    const stcr = stcrSpan > 0 ? Math.max(0, (prev.value - last.value) / stcrSpan) : 0;

    // Governing rate: the more conservative (higher) of long- and short-term.
    const governing = controllingRate(stcr, ltcr);
    const governingBasis: 'LTCR' | 'STCR' = stcr > ltcr ? 'STCR' : 'LTCR';

    const t = tMin != null && Number.isFinite(tMin) ? Number(tMin) : null;
    let remainingLifeYears: number | null = null;
    if (t != null && governing > 0) {
        remainingLifeYears = sharedRemainingLife(last.value, t, governing);
    }

    const note = governing <= 0
        ? `No measurable wall loss across ${pts.length} readings (${r2(spanYears)}y span) — corrosion rate ≈ 0.`
        : t == null
            ? `Thinning at ${r3(governing)}/yr (${governingBasis}) — set the point's "Alert below" to the minimum required thickness (t-min) to get a remaining-life estimate.`
            : `Governing rate ${r3(governing)}/yr (${governingBasis}, API 570: higher of long/short-term). Remaining life to t-min ${t}: ${r2(remainingLifeYears!)}y.`;

    return {
        current: last.value,
        tMin: t,
        ltcrPerYear: r3(ltcr),
        stcrPerYear: r3(stcr),
        governingPerYear: r3(governing),
        governingBasis,
        remainingLifeYears: remainingLifeYears != null ? r2(remainingLifeYears) : null,
        nextInspectionYears: remainingLifeYears != null ? r2(nextInspectionInterval(remainingLifeYears)) : null,
        n: pts.length,
        spanYears: r2(spanYears),
        note,
    };
}
