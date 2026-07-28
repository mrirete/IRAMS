/**
 * skillsGap — workforce readiness vs the deployed strategies (Phase F5).
 *
 * The strategy engine decides HOW assets will be maintained; this asks
 * whether anyone on the roster is qualified to execute each regime.
 * Demand = strategy verdict counts; supply = active, unexpired
 * qualifications keyword-matched into capability areas. Deterministic,
 * honest when the qualifications table is empty ("build the matrix").
 */
import type { StrategyVerdict } from './strategySelect';

export interface QualificationRow {
    contact_id: string;
    name: string;
    type: string | null;
    status: string | null;
    date_expires: string | null;
}

export interface CapabilityArea {
    key: 'condition_monitoring' | 'pm_execution' | 'defect_elimination' | 'rcm_facilitation';
    label: string;
    /** Assets whose recommended regime needs this capability. */
    demand: number;
    /** Distinct people holding a matching, active, unexpired qualification. */
    qualifiedPeople: number;
    gap: boolean;
    exampleQuals: string[];
}

export interface SkillsGapReview {
    areas: CapabilityArea[];
    totalQualifications: number;
    expiringSoon: number; // within 90 days
}

const AREA_PATTERNS: Record<CapabilityArea['key'], { label: string; pattern: RegExp }> = {
    condition_monitoring: {
        label: 'Condition monitoring',
        pattern: /vibration|thermograph|ultrason|oil analysis|tribolog|condition monitor|cbm|iso *18436/i,
    },
    pm_execution: {
        label: 'Precision maintenance / PM execution',
        pattern: /alignment|balanc|lubricat|millwright|fitter|mechanic|technician|precision|craft/i,
    },
    defect_elimination: {
        label: 'RCA / defect elimination',
        pattern: /rca|root cause|defect elimination|apollo|taproot|kepner|cmrp|reliability engineer/i,
    },
    rcm_facilitation: {
        label: 'RCM / FMEA facilitation',
        pattern: /rcm|fmea|fmeca|maintenance strateg|asset management|iso *55000/i,
    },
};

const DAY_MS = 86_400_000;

export function computeSkillsGap(
    verdicts: Pick<StrategyVerdict, 'recommended'>[],
    quals: QualificationRow[],
    nowMs: number,
): SkillsGapReview {
    const demand: Record<CapabilityArea['key'], number> = {
        condition_monitoring: verdicts.filter((v) => v.recommended === 'condition_based').length,
        pm_execution: verdicts.filter((v) => v.recommended === 'fixed_interval').length,
        defect_elimination: verdicts.filter((v) => v.recommended === 'defect_elimination').length,
        rcm_facilitation: verdicts.filter((v) => v.recommended === 'rcm_study').length,
    };

    const active = quals.filter((q) => {
        const st = (q.status ?? 'Active').toLowerCase();
        if (st.includes('expired') || st.includes('revoked') || st.includes('inactive')) return false;
        if (q.date_expires && new Date(q.date_expires).getTime() < nowMs) return false;
        return true;
    });

    const areas = (Object.keys(AREA_PATTERNS) as CapabilityArea['key'][]).map((key) => {
        const { label, pattern } = AREA_PATTERNS[key];
        const matching = active.filter((q) => pattern.test(`${q.name} ${q.type ?? ''}`));
        const people = new Set(matching.map((q) => q.contact_id)).size;
        return {
            key, label,
            demand: demand[key],
            qualifiedPeople: people,
            gap: demand[key] > 0 && people === 0,
            exampleQuals: [...new Set(matching.map((q) => q.name))].slice(0, 3),
        };
    });

    return {
        areas,
        totalQualifications: active.length,
        expiringSoon: active.filter((q) =>
            q.date_expires && new Date(q.date_expires).getTime() < nowMs + 90 * DAY_MS).length,
    };
}
