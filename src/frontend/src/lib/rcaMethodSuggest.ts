/**
 * rcaMethodSuggest.ts — pick an RCA method from facts already on the record.
 *
 * The AI advisor is fed exactly these signals (problem text, criticality,
 * category, trigger, failure count, cost). A fixed rule reads the same facts
 * and answers instantly, for free, with reasons the reader can check. Ask AI
 * stays available as a second opinion; it is no longer the only path.
 *
 * Four questions, in priority order:
 *   1. Could someone have been hurt?        → Fault Tree
 *   2. Has it happened before?              → Logic Tree
 *   3. Is the cause space wide?             → Fishbone
 *   4. Otherwise it is one thread to pull.  → 5-Why
 */
import type { RCAMethod } from '../eam/services/AnalyzeService';

export interface MethodSignals {
    /** event_how_much.safety_tier: tier_1 | tier_2 | lti | first_aid | '' */
    safetyTier?: string | null;
    /** rca_category: safety | production | process | asset_failure */
    category?: string | null;
    /** Asset criticality letter A | B | C */
    criticality?: string | null;
    /** Prior RCA investigations on the same asset */
    priorRcaCount?: number;
    /** trigger_type: cost | recurrence | criticality | safety | pareto | downtime | near_miss | manual */
    triggerType?: string | null;
    /** Corrective work orders on the asset in the last 12 months */
    cmCount12mo?: number | null;
    /** Distinct evidence_type values collected so far */
    evidenceTypes?: string[];
    /** Problem statement (free text) */
    problemText?: string | null;
}

export interface MethodSuggestion {
    method: RCAMethod;
    /** Facts that fired the rule, in plain words. Empty only for the default. */
    reasons: string[];
    /** Which of the four questions answered it (1..4). */
    rule: 1 | 2 | 3 | 4;
}

const SERIOUS_SAFETY = new Set(['tier_1', 'tier_2', 'lti']);
const WIDE_WORDS = /\b(intermittent|unknown|unclear|multiple|several|random|sporadic|various)\b/i;

export function suggestRcaMethod(s: MethodSignals): MethodSuggestion {
    // 1. Could someone have been hurt?
    const safety: string[] = [];
    if (s.safetyTier && SERIOUS_SAFETY.has(s.safetyTier)) safety.push(`a ${s.safetyTier.replace('_', ' ').toUpperCase()} safety event was recorded`);
    if (s.category === 'safety') safety.push('the investigation is safety-based');
    if ((s.criticality || '').toUpperCase() === 'A') safety.push('the asset is criticality A (safety critical)');
    if (safety.length) return { method: 'fault_tree', reasons: safety, rule: 1 };

    // 2. Has it happened before?
    const repeat: string[] = [];
    const prior = s.priorRcaCount ?? 0;
    if (prior > 0) repeat.push(`this asset has ${prior} prior RCA${prior === 1 ? '' : 's'}`);
    if (s.triggerType === 'recurrence' || s.triggerType === 'pareto') repeat.push(`it was triggered by ${s.triggerType === 'pareto' ? 'Pareto (bad actor)' : 'recurrence'}`);
    const cm = s.cmCount12mo ?? 0;
    if (cm >= 3) repeat.push(`${cm} corrective work orders in 12 months`);
    if (repeat.length) return { method: 'logic_tree', reasons: repeat, rule: 2 };

    // 3. Is the cause space wide?
    const wide: string[] = [];
    const types = new Set((s.evidenceTypes || []).filter(Boolean));
    if (types.size >= 3) wide.push(`evidence spans ${types.size} different types`);
    if (s.category === 'process') wide.push('the investigation is process-based');
    const m = (s.problemText || '').match(WIDE_WORDS);
    if (m) wide.push(`the statement says "${m[0].toLowerCase()}"`);
    if (wide.length) return { method: 'fishbone', reasons: wide, rule: 3 };

    // 4. One thread to pull.
    return { method: 'five_why', reasons: [], rule: 4 };
}

/** The four questions, for display beside the chooser. */
export const METHOD_QUESTIONS: { rule: 1 | 2 | 3 | 4; question: string; method: RCAMethod }[] = [
    { rule: 1, question: 'Could someone have been hurt?', method: 'fault_tree' },
    { rule: 2, question: 'Has it happened before?', method: 'logic_tree' },
    { rule: 3, question: 'Is the cause space wide?', method: 'fishbone' },
    { rule: 4, question: 'Otherwise: one thread to pull', method: 'five_why' },
];
