/**
 * Living-RCM evidence engine — checks an RCM study against the DATA:
 *
 *  1. PATTERN VERDICT — the fitted Weibull β says which task TYPE the failure
 *     data supports (Nowlan & Heap): β>1 wear-out → age-based restoration/
 *     discard is applicable; β≈1 random → time-based tasks don't reduce
 *     failures, on-condition wins; β<0.85 infant mortality → fix the
 *     install/defect (RCA) before scheduling anything. Decisions that
 *     contradict the pattern are flagged.
 *  2. MODE RECONCILIATION — postulated failure modes (the study) vs observed
 *     ones (wo_failure_data codes on real work orders). Modes that keep
 *     happening but were never analyzed, and analyzed modes never seen,
 *     are what make a study LIVING instead of a binder.
 *  3. CBM COVERAGE — every on-condition task needs a real measurement point
 *     behind it; a CBM task with no monitoring is a paper task.
 */
import { sensorKind, type SensorKind } from './healthModels';
import type { RCMFailureMode, RCMDecision } from '../../eam/services/RCMService';

// ── 1. Pattern verdict ───────────────────────────────────────

export type FailurePattern = 'wear-out' | 'random' | 'infant-mortality' | 'unknown';

export interface PatternVerdict {
    pattern: FailurePattern;
    beta: number | null;
    guidance: string;
}

export function patternVerdict(beta: number | null | undefined): PatternVerdict {
    if (beta == null || !Number.isFinite(beta)) {
        return { pattern: 'unknown', beta: null, guidance: 'No fitted life data yet (needs ≥2 failure intervals) — decisions rest on judgment alone.' };
    }
    if (beta < 0.85) return { pattern: 'infant-mortality', beta, guidance: `β=${beta} < 0.85: failures cluster early — installation/commissioning defects. Age-based tasks make it worse; investigate the install (RCA) first.` };
    if (beta <= 1.15) return { pattern: 'random', beta, guidance: `β=${beta} ≈ 1: constant hazard — time-based restoration/discard does NOT reduce failures. On-condition tasks (or design-out) are the effective route.` };
    return { pattern: 'wear-out', beta, guidance: `β=${beta} > 1: wear-out — age-based restoration/discard is applicable and on-condition remains valid.` };
}

export type DecisionSupport = 'supported' | 'contradicted' | 'neutral';

export interface DecisionCheck {
    failureModeId: string;
    support: DecisionSupport;
    note: string;
}

/** Flag decisions whose TASK TYPE contradicts the fitted failure pattern. */
export function checkDecisionAgainstPattern(d: RCMDecision, v: PatternVerdict): DecisionCheck {
    // The Strategy tab records the decision as recommended_strategy_code; the
    // per-task-type columns are only filled by imported studies. Reading just
    // the columns made every wizard decision "neutral", so the living-RCM
    // check never flagged a time-based task on a random-failure asset.
    const code = d.recommended_strategy_code;
    const timeBased = !!((d.restoration_applicable && d.scheduled_restoration_task) || (d.discard_applicable && d.scheduled_discard_task))
        || code === 'PM_TIME' || code === 'COMBINATION';
    const onCondition = !!(d.on_condition_applicable && d.on_condition_task)
        || code === 'PM_CONDITION' || code === 'PM_PREDICTIVE' || code === 'COMBINATION';

    if (v.pattern === 'unknown' || (!timeBased && !onCondition)) {
        return { failureModeId: d.failure_mode_id, support: 'neutral', note: v.pattern === 'unknown' ? 'no life data to check against' : 'no applicable task selected' };
    }
    if (timeBased && v.pattern === 'random') {
        return { failureModeId: d.failure_mode_id, support: 'contradicted', note: `time-based task selected but β=${v.beta} ≈ 1 (random) — data says fixed intervals won't reduce failures; prefer on-condition` };
    }
    if (timeBased && v.pattern === 'infant-mortality') {
        return { failureModeId: d.failure_mode_id, support: 'contradicted', note: `time-based task selected but β=${v.beta} < 0.85 (infant mortality) — address install/defect (RCA) before scheduling renewals` };
    }
    if (timeBased && v.pattern === 'wear-out') {
        return { failureModeId: d.failure_mode_id, support: 'supported', note: `age-based task matches the wear-out pattern (β=${v.beta})` };
    }
    // on-condition only
    return { failureModeId: d.failure_mode_id, support: 'supported', note: 'on-condition task — applicable across patterns' };
}

// ── 2. Mode reconciliation ───────────────────────────────────

export interface ModeReconciliation {
    /** happening in the field but absent from the study — analyze these */
    observedNotAnalyzed: { code: string; count: number }[];
    /** in the study but never seen on a work order */
    postulatedNeverObserved: { code: string; description: string }[];
    matched: { code: string; count: number }[];
}

export function reconcileModes(
    postulated: Pick<RCMFailureMode, 'failure_mode_code' | 'failure_mode_description'>[],
    observedCounts: Record<string, number>,
): ModeReconciliation {
    const postCodes = new Set(postulated.map(p => (p.failure_mode_code || '').toUpperCase().trim()).filter(Boolean));
    const observedNotAnalyzed: ModeReconciliation['observedNotAnalyzed'] = [];
    const matched: ModeReconciliation['matched'] = [];
    for (const [codeRaw, count] of Object.entries(observedCounts)) {
        const code = codeRaw.toUpperCase().trim();
        if (!code) continue;
        (postCodes.has(code) ? matched : observedNotAnalyzed).push({ code, count });
    }
    const observedSet = new Set(Object.keys(observedCounts).map(c => c.toUpperCase().trim()));
    const postulatedNeverObserved = postulated
        .filter(p => p.failure_mode_code && !observedSet.has(p.failure_mode_code.toUpperCase().trim()))
        .map(p => ({ code: p.failure_mode_code!.toUpperCase().trim(), description: p.failure_mode_description }));
    observedNotAnalyzed.sort((a, b) => b.count - a.count);
    matched.sort((a, b) => b.count - a.count);
    return { observedNotAnalyzed, postulatedNeverObserved, matched };
}

// ── 3. CBM coverage ──────────────────────────────────────────

const KIND_WORDS: [SensorKind, string[]][] = [
    ['vibration', ['vibration', 'vib ', 'accelerometer', 'bearing analysis']],
    ['thickness', ['thickness', 'wall', 'ut ', 'ultrasonic']],
    ['temperature', ['temperature', 'thermograph', 'thermal', 'infrared', 'ir ']],
    ['pressure', ['pressure', 'δp', 'differential']],
    ['flow', ['flow']],
    ['current', ['current', 'motor circuit', 'amp']],
    ['level', ['level']],
];

/** Infer which sensor kind an on-condition task needs from its text. */
export function requiredKind(taskText: string): SensorKind | null {
    const t = (taskText || '').toLowerCase();
    for (const [kind, words] of KIND_WORDS) if (words.some(w => t.includes(w))) return kind;
    return null;
}

export interface CbmCoverageRow {
    failureModeId: string;
    task: string;
    technology: string | null;
    neededKind: SensorKind | null;
    /** matching measurement point name, if one exists */
    matchedPoint: string | null;
    covered: boolean;
    note: string;
}

export function checkCbmCoverage(
    decisions: RCMDecision[],
    readingDefs: { name: string; isActive?: boolean }[],
): CbmCoverageRow[] {
    const activeDefs = readingDefs.filter(d => d.isActive !== false);
    const byKind = new Map<SensorKind, string>();
    for (const d of activeDefs) {
        const k = sensorKind(d.name);
        if (!byKind.has(k)) byKind.set(k, d.name);
    }
    return decisions
        .filter(d => d.on_condition_applicable && d.on_condition_task)
        .map(d => {
            const text = `${d.on_condition_task} ${d.on_condition_technology || ''}`;
            const kind = requiredKind(text);
            if (kind) {
                const point = byKind.get(kind) ?? null;
                return {
                    failureModeId: d.failure_mode_id,
                    task: d.on_condition_task!,
                    technology: d.on_condition_technology,
                    neededKind: kind,
                    matchedPoint: point,
                    covered: !!point,
                    note: point ? `monitored by "${point}"` : `no ${kind} measurement point on this asset — the task can't execute`,
                };
            }
            const any = activeDefs[0]?.name ?? null;
            return {
                failureModeId: d.failure_mode_id,
                task: d.on_condition_task!,
                technology: d.on_condition_technology,
                neededKind: null,
                matchedPoint: any,
                covered: !!any,
                note: any ? 'technique not inferable from the task text — asset has condition points' : 'asset has NO condition measurement points at all',
            };
        });
}
