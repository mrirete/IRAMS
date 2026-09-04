/**
 * maturityScoring.ts — Deterministic scoring of the guided maturity checklist.
 *
 * The 5-step assessment wizard collects the answers to MaturityQuestionBank
 * (six ISO 55001 / GFMAM groups, every anchor pinned to a maturity level 1–5).
 * Everything here is pure and testable. The LLM (AuditAssessor) only writes
 * prose over these numbers — never the reverse. The maturity label is always
 * the deterministic band, so the same answers always give the same score.
 *
 * Grouping is re-derived from the bank by question id, never trusted from the
 * stored answer: answers saved under the earlier 6M grouping (sixm-v1) score
 * under the new groups without migration, and retired questions simply drop.
 * A "not applicable" answer is excluded from its group's mean and reported.
 *
 * Maturity scale (ISO 55002 / IAM-style):
 *   1 Innocent · 2 Aware · 3 Developing · 4 Competent · 5 Optimizing
 */

import { MATURITY_DIMENSIONS, MATURITY_QUESTIONS, questionById } from './MaturityQuestionBank';
import type { MaturityAnswer, MaturityDimensionKey, MaturityQuestion } from './MaturityQuestionBank';
import type { DimensionResult, DimensionAnswer, RoadmapAction, ImprovementRoadmap } from './AuditAssessor';
import type { ScoredFinding } from './AuditTypes';

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Framework id stamped on every stored result (audit_assessments.maturity_framework,
 * org_context.maturity_framework, audit_maturity_snapshots.maturity_framework — 0316).
 * Trends and "previous run" deltas only compare rows of the same framework.
 *   sixm-v1  — the 30-question bank grouped by the six Ishikawa categories (retired 2026-09-04)
 *   gfmam-v1 — this bank: 36 questions in the six GFMAM subject groups
 */
export const MATURITY_FRAMEWORK = 'gfmam-v1';
export const LEGACY_FRAMEWORK_SIXM = 'sixm-v1';

export const MATURITY_LABELS: Record<number, string> = {
    1: 'Innocent', 2: 'Aware', 3: 'Developing', 4: 'Competent', 5: 'Optimizing',
};

/** Band label for a 1–5 score (same thresholds the audit module has always used). */
export function maturityLabel(score: number): string {
    if (!Number.isFinite(score)) return 'Not assessed';
    if (score >= 4.5) return 'Optimizing';
    if (score >= 3.5) return 'Competent';
    if (score >= 2.5) return 'Developing';
    if (score >= 1.5) return 'Aware';
    return 'Innocent';
}

/** Finding category (AuditTypes.FINDING_CATEGORIES) that each group reports under. */
const DIMENSION_CATEGORY: Record<MaturityDimensionKey, string> = {
    strategy: 'Governance & Strategy',
    decisions: 'Financial Alignment',
    lifecycle: 'Maintenance & Reliability',
    information: 'Data & Competence',
    people: 'People & Culture',
    risk: 'Regulatory & Policy',
};

/**
 * Default Ishikawa cause tag for a drafted finding (AuditTypes.SIXM_CATEGORIES).
 * The tag is the one place 6M survives in the assessment: it is the vocabulary
 * the RCA fishbone uses, so a finding and an investigation can share a "why".
 * The assessor edits it; this is only a starting point.
 */
const DIMENSION_CAUSE_TAG: Record<MaturityDimensionKey, string> = {
    strategy: 'Method', decisions: 'Method', lifecycle: 'Method',
    information: 'Measurement', people: 'Man', risk: 'Mother Nature',
};

/** Default impact profile per group — the assessor edits these; they are starting points. */
const DIMENSION_IMPACT: Record<MaturityDimensionKey, Pick<ScoredFinding, 'businessImpact' | 'safetyImpact' | 'environmentalImpact' | 'productionImpact'>> = {
    strategy:    { businessImpact: 'High',   safetyImpact: 'Low',    environmentalImpact: 'Low',    productionImpact: 'Medium' },
    decisions:   { businessImpact: 'High',   safetyImpact: 'Medium', environmentalImpact: 'Low',    productionImpact: 'High' },
    lifecycle:   { businessImpact: 'Medium', safetyImpact: 'High',   environmentalImpact: 'Medium', productionImpact: 'High' },
    information: { businessImpact: 'High',   safetyImpact: 'Low',    environmentalImpact: 'Low',    productionImpact: 'Medium' },
    people:      { businessImpact: 'Medium', safetyImpact: 'High',   environmentalImpact: 'Low',    productionImpact: 'Medium' },
    risk:        { businessImpact: 'Medium', safetyImpact: 'High',   environmentalImpact: 'High',   productionImpact: 'Low' },
};

/** Short, human line for a question: "Competency framework — score 2 (Aware)". */
function shortQuestion(q: MaturityQuestion | undefined, fallback: string): string {
    const text = (q?.text || fallback)
        .replace(/^(Does|Is there|Is|Are there|Are|Do|Has|How does|How do|How often does|How mature is|How would you rate|How complete and accurate is|How|What|When)\s+(your organization\s+|your organisation\s+|you\s+)?/i, '');
    const trimmed = text.length > 90 ? text.slice(0, 87).replace(/\s+\S*$/, '') + '…' : text;
    const cleaned = trimmed.replace(/\?$/, '');
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

const isScored = (a: MaturityAnswer | undefined | null): a is MaturityAnswer & { selectedScore: number } =>
    !!a && !a.notApplicable && Number.isFinite(a.selectedScore as number);

/**
 * Score the checklist per group. Only groups with at least one scored answer
 * produce a result — an unanswered group is honestly absent, not zero.
 * Answers are bound to a group via the bank (question id), so legacy answers
 * regroup automatically and retired ids are ignored.
 */
export function computeMaturityResults(
    answers: MaturityAnswer[] | undefined,
    notes: Record<string, string> | undefined = {},
): DimensionResult[] {
    const known = (answers || [])
        .map(a => ({ a, q: a ? questionById(a.questionId) : undefined }))
        .filter((p): p is { a: MaturityAnswer; q: MaturityQuestion } => !!p.q);
    const results: DimensionResult[] = [];

    for (const dim of MATURITY_DIMENSIONS) {
        const questions = MATURITY_QUESTIONS.filter(q => q.dimensionKey === dim.key);
        const inDim = known.filter(p => p.q.dimensionKey === dim.key);
        const scored = inDim.filter(p => isScored(p.a)) as { a: MaturityAnswer & { selectedScore: number }; q: MaturityQuestion }[];
        const notApplicable = inDim.length - scored.length;
        if (scored.length === 0) continue;

        const paired = scored.sort((x, y) => questions.indexOf(x.q) - questions.indexOf(y.q));
        const detailed: DimensionAnswer[] = paired.map(({ a, q }) => ({
            questionNumber: questions.indexOf(q) + 1,
            questionText: q.text,
            answer: a.optionText,
            score: a.selectedScore,
            feedback: `${MATURITY_LABELS[a.selectedScore] || 'Unrated'} (${a.selectedScore}/5)` + (a.notes ? ` — ${a.notes}` : ''),
            standardRef: q.isoRef,
        }));

        const avg = round1(detailed.reduce((s, d) => s + d.score, 0) / detailed.length);
        const keyStrengths = paired.filter(p => p.a.selectedScore >= 4).map(p => `${shortQuestion(p.q, p.q.id)} — ${MATURITY_LABELS[p.a.selectedScore]}`);
        const keyGaps = paired.filter(p => p.a.selectedScore <= 2).map(p => `${shortQuestion(p.q, p.q.id)} — ${MATURITY_LABELS[p.a.selectedScore]}`);

        const band = maturityLabel(avg);
        const coverage = detailed.length < questions.length
            ? ` ${detailed.length} of ${questions.length} questions scored${notApplicable ? ` (${notApplicable} marked not applicable)` : ''}.`
            : '';
        const summary =
            `${dim.code} ${dim.label} scores ${avg.toFixed(1)}/5 (${band}).` +
            (keyGaps.length ? ` ${keyGaps.length} gap${keyGaps.length > 1 ? 's' : ''} at Aware level or below.` : ' No gaps below Developing.') +
            (keyStrengths.length ? ` ${keyStrengths.length} practice${keyStrengths.length > 1 ? 's' : ''} at Competent or better.` : '') +
            coverage +
            (notes?.[dim.key]?.trim() ? ` Assessor notes: ${notes[dim.key].trim()}` : '');

        results.push({
            dimensionKey: dim.key,
            dimensionCode: dim.code,
            dimensionLabel: dim.label,
            averageScore: avg,
            answers: detailed,
            summary,
            keyStrengths,
            keyGaps,
        });
    }
    return results;
}

export interface ScoreSummary {
    overallScore: number;        // 1–5, 0 when nothing scored
    overallPercentage: number;   // 0–100
    maturityLevel: string;
    dimensionsScored: number;
}

/** Overall score = mean of group means (each group weighs equally, however many questions it holds). */
export function scoreSummary(results: DimensionResult[]): ScoreSummary {
    const scored = results.filter(r => Number.isFinite(r.averageScore));
    if (scored.length === 0) {
        return { overallScore: 0, overallPercentage: 0, maturityLevel: 'Not assessed', dimensionsScored: 0 };
    }
    const overall = round1(scored.reduce((s, r) => s + r.averageScore, 0) / scored.length);
    return {
        overallScore: overall,
        overallPercentage: Math.round((overall / 5) * 100),
        maturityLevel: maturityLabel(overall),
        dimensionsScored: scored.length,
    };
}

/**
 * Draft one finding per scored answer at Aware level or below (score ≤ 2).
 * The recommended action is the NEXT rung of the same question — the anchor
 * text for score+1 — because the bank already describes what "one level
 * better" looks like in the organisation's own terms.
 */
export function draftFindingsFromAnswers(answers: MaturityAnswer[] | undefined): ScoredFinding[] {
    const drafts: ScoredFinding[] = [];
    for (const a of answers || []) {
        if (!isScored(a) || a.selectedScore > 2) continue;
        const q = questionById(a.questionId);
        if (!q) continue;
        const next = q.options.find(o => o.score === a.selectedScore + 1);
        const target = q.options.find(o => o.score === 3);
        const impact = DIMENSION_IMPACT[q.dimensionKey];
        drafts.push({
            id: `maturity-${q.id}`,
            sourceQuestionId: q.id,
            finding: `${shortQuestion(q, q.text)}: current state is "${a.optionText}" (${MATURITY_LABELS[a.selectedScore]}, ${a.selectedScore}/5).`,
            category: DIMENSION_CATEGORY[q.dimensionKey],
            rating: a.selectedScore === 1 ? 'major_gap' : 'minor_gap',
            riskRank: a.selectedScore === 1 ? 16 : 9,
            ...impact,
            isoReference: q.isoRef,
            recommendedAction:
                (next ? `Move to level ${next.score}: ${next.text}` : '') +
                (target && target.score !== next?.score ? ` Target within 12 months (level 3): ${target.text}` : ''),
            owner: '',
            dueDate: '',
            sixmCategory: DIMENSION_CAUSE_TAG[q.dimensionKey],
        });
    }
    // Worst first, then by group order.
    const order = MATURITY_DIMENSIONS.map(d => d.key as string);
    return drafts.sort((x, y) => (y.riskRank - x.riskRank) || (order.indexOf(keyOf(x)) - order.indexOf(keyOf(y))));
}

function keyOf(f: ScoredFinding): string {
    const q = f.sourceQuestionId ? questionById(f.sourceQuestionId) : undefined;
    return q?.dimensionKey || '';
}

// ─── Deterministic prose fallbacks (used when the AI proxy is off or fails) ──

export function deterministicKeyFindings(results: DimensionResult[]): string[] {
    if (results.length === 0) return ['No maturity group has been scored yet.'];
    const sorted = [...results].sort((a, b) => a.averageScore - b.averageScore);
    const out: string[] = [];
    for (const r of sorted.slice(0, 3)) {
        out.push(`${r.dimensionCode} ${r.dimensionLabel} is the ${out.length === 0 ? 'weakest' : 'next weakest'} group at ${r.averageScore.toFixed(1)}/5 (${maturityLabel(r.averageScore)})${r.keyGaps[0] ? `: ${r.keyGaps[0]}` : '.'}`);
    }
    for (const r of sorted.slice(-2).reverse()) {
        if (r.averageScore >= 3.5) out.push(`${r.dimensionCode} ${r.dimensionLabel} is a strength at ${r.averageScore.toFixed(1)}/5${r.keyStrengths[0] ? `: ${r.keyStrengths[0]}` : '.'}`);
    }
    const gaps = results.reduce((s, r) => s + r.keyGaps.length, 0);
    out.push(`${gaps} of ${results.reduce((s, r) => s + r.answers.length, 0)} assessed practices sit at Aware level or below.`);
    return out;
}

export function deterministicRecommendations(results: DimensionResult[]): string[] {
    const sorted = [...results].sort((a, b) => a.averageScore - b.averageScore);
    const recs: string[] = [];
    for (const r of sorted) {
        for (const g of r.keyGaps.slice(0, 2)) recs.push(`${r.dimensionCode}: close "${g.replace(/ — .*$/, '')}" — lift it one level within 90 days.`);
        if (recs.length >= 6) break;
    }
    if (recs.length === 0) recs.push('Maintain current practices and re-assess in 12 months.');
    return recs;
}

export function deterministicRoadmap(results: DimensionResult[]): ImprovementRoadmap {
    const thirty: RoadmapAction[] = [];
    const ninety: RoadmapAction[] = [];
    const year: RoadmapAction[] = [];
    for (const r of results) {
        for (const a of r.answers) {
            if (a.score === 1) thirty.push({ action: `Establish a minimum practice for: ${shortQuestion(undefined, a.questionText)}`, dimension: r.dimensionCode, priority: 'critical', owner: 'Maintenance / Reliability Manager', expectedOutcome: 'Move from Innocent to Aware; risk made visible.' });
            else if (a.score === 2) ninety.push({ action: `Document and apply consistently: ${shortQuestion(undefined, a.questionText)}`, dimension: r.dimensionCode, priority: 'high', owner: 'Reliability Engineer', expectedOutcome: 'Move from Aware to Developing.' });
        }
        if (r.averageScore < 3.5) year.push({ action: `Raise ${r.dimensionLabel} to Competent (systematic, measured, improved)`, dimension: r.dimensionCode, priority: r.averageScore < 2.5 ? 'high' : 'medium', owner: 'Asset Management Lead', expectedOutcome: `${r.dimensionCode} at ≥ 3.5/5 at the next annual review.` });
    }
    return {
        thirtyDayActions: thirty.slice(0, 5),
        ninetyDayActions: ninety.slice(0, 5),
        yearActions: year.slice(0, 5),
        estimatedInvestment: 'Not estimated — deterministic roadmap (AI narration unavailable)',
        expectedROI: 'Not estimated',
    };
}
