/**
 * Mechanical-integrity calculations — API 510 / 570 / 653 corrosion & remaining life.
 *
 * Turns stored thickness readings into real engineering numbers instead of relying
 * on pre-stored corrosion rates. Pure functions, no DB / React — easy to unit-test.
 *
 * Method (two-point inspection data, no commissioning date available):
 *   Long-term rate  LT = (t_first − t_last) / years(first → last)
 *   Short-term rate ST = (t_prev  − t_last) / years(prev  → last)
 *   Controlling rate   = max(ST, LT, 0)               (API conservative practice)
 *   Remaining life     = (t_last − t_min) / controlling rate     [API 510 §7.1.1.1]
 *   Next inspection    = min(remaining life / 2, code max)        (half-life rule)
 */

import type { CML, ThicknessReading, CorrosionRate, ComponentType } from '../../types/integrity';

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

/** Code-mandated maximum inspection interval (years) by component type. */
function codeMaxIntervalYears(component: ComponentType): number {
    if (component.startsWith('piping') || component === 'weld') return 5;   // API 570
    if (component.startsWith('tank')) return 10;                            // API 653 (external)
    return 10;                                                             // API 510 pressure vessels
}

/** Cap used when corrosion is negligible/non-measurable (avoids Infinity in the UI). */
export const REMAINING_LIFE_CAP_YEARS = 99;

export interface CMLAssessment {
    cml_id: string;
    asset_id: string;
    /** Latest (governing — thinnest recent) measured thickness, mm */
    t_actual_mm: number;
    short_term_rate_mmpy: number;
    long_term_rate_mmpy: number;
    /** max(ST, LT, 0) — the rate that governs remaining life */
    controlling_rate_mmpy: number;
    is_accelerating: boolean;
    /** (t_actual − t_min) / controlling rate, capped; null only if already below t-min */
    remaining_life_years: number | null;
    /** true when the latest reading is at or below the minimum allowable thickness */
    below_tmin: boolean;
    next_inspection_interval_years: number;
    next_inspection_due: string;
    last_reading_date: string;
    reading_count: number;
}

function yearsBetween(isoEarlier: string, isoLater: string): number {
    return (new Date(isoLater).getTime() - new Date(isoEarlier).getTime()) / MS_PER_YEAR;
}

/**
 * Compute the full API-510 assessment for one CML from its thickness readings.
 * Returns null when there aren't enough readings to derive a rate (< 2).
 */
export function assessCML(cml: CML, readings: ThicknessReading[]): CMLAssessment | null {
    const series = readings
        .filter(r => r.cml_id === cml.id && Number.isFinite(r.measured_thickness_mm))
        .sort((a, b) => new Date(a.reading_date).getTime() - new Date(b.reading_date).getTime());

    if (series.length < 2) return null;

    const first = series[0];
    const prev = series[series.length - 2];
    const last = series[series.length - 1];

    const tFirst = first.measured_thickness_mm;
    const tPrev = prev.measured_thickness_mm;
    const tActual = last.measured_thickness_mm;

    const ltYears = yearsBetween(first.reading_date, last.reading_date);
    const stYears = yearsBetween(prev.reading_date, last.reading_date);

    // Guard against zero/negative time spans (same-day re-reads)
    const longTerm = ltYears > 0 ? (tFirst - tActual) / ltYears : 0;
    const shortTerm = stYears > 0 ? (tPrev - tActual) / stYears : 0;

    const controlling = Math.max(shortTerm, longTerm, 0);
    const belowTmin = tActual <= cml.tmin_mm;

    let remainingLife: number | null;
    if (belowTmin) {
        remainingLife = 0;
    } else if (controlling <= 0) {
        remainingLife = REMAINING_LIFE_CAP_YEARS; // no measurable loss
    } else {
        remainingLife = Math.min((tActual - cml.tmin_mm) / controlling, REMAINING_LIFE_CAP_YEARS);
    }

    const intervalYears = Math.max(0, Math.min((remainingLife ?? 0) / 2, codeMaxIntervalYears(cml.component_type)));
    const dueDate = new Date(new Date(last.reading_date).getTime() + intervalYears * MS_PER_YEAR);

    // Accelerating = short-term materially exceeds long-term (matches the 2× UI threshold)
    const isAccelerating = longTerm > 0 && shortTerm > 2 * longTerm;

    return {
        cml_id: cml.id,
        asset_id: cml.asset_id,
        t_actual_mm: round(tActual, 3),
        short_term_rate_mmpy: round(Math.max(0, shortTerm), 4),
        long_term_rate_mmpy: round(Math.max(0, longTerm), 4),
        controlling_rate_mmpy: round(controlling, 4),
        is_accelerating: isAccelerating,
        remaining_life_years: remainingLife === null ? null : round(remainingLife, 1),
        below_tmin: belowTmin,
        next_inspection_interval_years: round(intervalYears, 1),
        next_inspection_due: dueDate.toISOString(),
        last_reading_date: last.reading_date,
        reading_count: series.length,
    };
}

/** Convenience: derive a CorrosionRate row (matching the stored schema) from an assessment. */
export function assessmentToCorrosionRate(a: CMLAssessment): CorrosionRate {
    return {
        cml_id: a.cml_id,
        asset_id: a.asset_id,
        short_term_rate_mmpy: a.short_term_rate_mmpy,
        long_term_rate_mmpy: a.long_term_rate_mmpy,
        rate_type: 'general',
        is_accelerating: a.is_accelerating,
        last_reading_date: a.last_reading_date,
    };
}

/** Assess every CML that has enough readings; keyed by cml_id. */
export function assessAllCMLs(cmls: CML[], readings: ThicknessReading[]): Map<string, CMLAssessment> {
    const out = new Map<string, CMLAssessment>();
    for (const cml of cmls) {
        const a = assessCML(cml, readings);
        if (a) out.set(cml.id, a);
    }
    return out;
}

function round(n: number, dp: number): number {
    const f = 10 ** dp;
    return Math.round(n * f) / f;
}
