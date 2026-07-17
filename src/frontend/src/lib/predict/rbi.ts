/**
 * RBI-lite screening (Phase 5) — API 580/581-INSPIRED risk screening for
 * static equipment. Probability-of-failure category comes from the thickness-
 * trend remaining life (the measured damage evidence), consequence-of-failure
 * from the asset's criticality ranking; risk = PoF × CoF on a 5×5 matrix.
 *
 * This is a SCREENING aid for prioritising inspection — NOT a full API 581
 * quantitative analysis (no damage-factor tables, generic failure frequencies
 * or consequence modelling). It is labelled as such wherever it appears.
 */
import type { IntegrityAssessment } from './integrity';

export interface RbiScreening {
    /** probability category 1 (remote) … 5 (probable) */
    pof: number;
    /** consequence category 1 (minor) … 5 (severe) */
    cof: number;
    /** PoF × CoF (1–25) */
    score: number;
    band: 'Low' | 'Medium' | 'Medium-High' | 'High';
    /** matrix cell, e.g. "P4·C3" */
    cell: string;
    /** concrete date for the API 570 half-remaining-life interval */
    nextInspectionDate: string | null;
    note: string;
}

export function screenRbi(
    integrity: IntegrityAssessment | null | undefined,
    criticality?: string | null,
): RbiScreening | null {
    if (!integrity) return null;

    // PoF: measured wall-loss evidence → remaining-life bins.
    const rl = integrity.remainingLifeYears;
    const pof = rl == null
        ? (integrity.governingPerYear > 0 ? 3 : 1)  // thinning but no t-min set → moderate; stable wall → remote
        : rl < 2 ? 5 : rl < 5 ? 4 : rl < 10 ? 3 : rl < 20 ? 2 : 1;

    // CoF: criticality ranking as the consequence proxy.
    const cof = ({ A: 5, B: 4, C: 3, D: 2, E: 1 } as Record<string, number>)[(criticality || 'C').toUpperCase()] ?? 3;

    const score = pof * cof;
    const band: RbiScreening['band'] = score >= 16 ? 'High' : score >= 10 ? 'Medium-High' : score >= 5 ? 'Medium' : 'Low';

    const nextInspectionDate = integrity.nextInspectionYears != null
        ? new Date(Date.now() + integrity.nextInspectionYears * 365.25 * 86400000).toISOString()
        : null;

    return {
        pof, cof, score, band,
        cell: `P${pof}·C${cof}`,
        nextInspectionDate,
        note: 'Screening only — PoF from thickness-trend remaining life, CoF from criticality; not a full API 581 damage-factor analysis.',
    };
}
