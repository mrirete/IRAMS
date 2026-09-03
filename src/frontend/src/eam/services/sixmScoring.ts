/**
 * sixmScoring.ts — Deterministic scoring of the 6M guided checklist.
 *
 * The 5-step assessment wizard collects 30 multiple-choice answers
 * (SixMQuestionBank: 5 questions × 6 dimensions, every option pinned to a
 * maturity level 1–5). Before this module existed those answers were stored
 * and never scored: the report averaged an EMPTY dimension list and printed
 * "NaN / 5.0", and an assessment could never reach `completed`.
 *
 * Everything here is pure and testable. The LLM (AuditAssessor) only writes
 * prose over these numbers — never the reverse. The maturity label is always
 * the deterministic band, so the same answers always give the same score.
 *
 * Maturity scale (ISO 55002 / IAM-style, as used across the audit module):
 *   1 Innocent · 2 Aware · 3 Developing · 4 Competent · 5 Optimizing
 */

import { SIXM_ASSESSMENT_QUESTIONS } from './SixMQuestionBank';
import type { SixMChecklistAnswer, SixMChecklistQuestion } from './SixMQuestionBank';
import { SIXM_DIMENSIONS } from './AuditAssessor';
import type { DimensionResult, DimensionAnswer, RoadmapAction, ImprovementRoadmap } from './AuditAssessor';
import type { ScoredFinding } from './AuditTypes';

const round1 = (n: number) => Math.round(n * 10) / 10;

export const MATURITY_LABELS: Record<number, string> = {
    1: 'Innocent', 2: 'Aware', 3: 'Developing', 4: 'Competent', 5: 'Optimizing',
};

/** Band label for a 1–5 score (same thresholds AuditAssessor used for its fallback). */
export function maturityLabel(score: number): string {
    if (!Number.isFinite(score)) return 'Not assessed';
    if (score >= 4.5) return 'Optimizing';
    if (score >= 3.5) return 'Competent';
    if (score >= 2.5) return 'Developing';
    if (score >= 1.5) return 'Aware';
    return 'Innocent';
}

/** Finding category (AuditTypes.FINDING_CATEGORIES) that each 6M dimension reports under. */
const DIMENSION_CATEGORY: Record<string, string> = {
    man: 'People & Culture',
    machine: 'Asset Integrity',
    method: 'Maintenance & Reliability',
    material: 'Maintenance & Reliability',
    measurement: 'Data & Competence',
    mother_nature: 'Regulatory & Policy',
};

/** 6M root-cause label (AuditTypes.SIXM_CATEGORIES) per dimension key. */
const DIMENSION_SIXM_LABEL: Record<string, string> = {
    man: 'Man', machine: 'Machine', method: 'Method',
    material: 'Material', measurement: 'Measurement', mother_nature: 'Mother Nature',
};

/** Default impact profile per dimension — the assessor edits these; they are starting points. */
const DIMENSION_IMPACT: Record<string, Pick<ScoredFinding, 'businessImpact' | 'safetyImpact' | 'environmentalImpact' | 'productionImpact'>> = {
    man:           { businessImpact: 'Medium', safetyImpact: 'High',   environmentalImpact: 'Low',    productionImpact: 'Medium' },
    machine:       { businessImpact: 'High',   safetyImpact: 'High',   environmentalImpact: 'Medium', productionImpact: 'High' },
    method:        { businessImpact: 'Medium', safetyImpact: 'High',   environmentalImpact: 'Medium', productionImpact: 'Medium' },
    material:      { businessImpact: 'Medium', safetyImpact: 'Low',    environmentalImpact: 'Low',    productionImpact: 'High' },
    measurement:   { businessImpact: 'High',   safetyImpact: 'Low',    environmentalImpact: 'Low',    productionImpact: 'Medium' },
    mother_nature: { businessImpact: 'Medium', safetyImpact: 'Medium', environmentalImpact: 'High',   productionImpact: 'Low' },
};

function questionById(id: string): SixMChecklistQuestion | undefined {
    return SIXM_ASSESSMENT_QUESTIONS.find(q => q.id === id);
}

/** Short, human line for a question: "Competency framework — score 2 (Aware)". */
function shortQuestion(q: SixMChecklistQuestion | undefined, fallback: string): string {
    const text = (q?.text || fallback).replace(/^Does your organization\s+/i, '').replace(/^(Do|Is|Are|How)\s+/i, '');
    const trimmed = text.length > 90 ? text.slice(0, 87).replace(/\s+\S*$/, '') + '…' : text;
    return trimmed.replace(/\?$/, '');
}

/**
 * Score the checklist per dimension. Only dimensions with at least one answer
 * produce a result — an unanswered dimension is honestly absent, not zero.
 */
export function computeSixMResults(
    answers: SixMChecklistAnswer[] | undefined,
    notes: Record<string, string> | undefined = {},
): DimensionResult[] {
    const list = (answers || []).filter(a => a && Number.isFinite(a.selectedScore));
    const results: DimensionResult[] = [];

    for (const dim of SIXM_DIMENSIONS) {
        const dimAnswers = list.filter(a => a.dimensionKey === dim.key);
        if (dimAnswers.length === 0) continue;

        const questions = SIXM_ASSESSMENT_QUESTIONS.filter(q => q.dimensionKey === dim.key);
        const paired = dimAnswers
            .map(a => ({ a, q: questionById(a.questionId) }))
            .sort((x, y) => (x.q ? questions.indexOf(x.q) : 99) - (y.q ? questions.indexOf(y.q) : 99));
        const detailed: DimensionAnswer[] = paired.map(({ a, q }) => ({
            questionNumber: q ? questions.indexOf(q) + 1 : 0,
            questionText: q?.text || a.questionId,
            answer: a.optionText,
            score: a.selectedScore,
            feedback: `${MATURITY_LABELS[a.selectedScore] || 'Unrated'} (${a.selectedScore}/5)` + (a.notes ? ` — ${a.notes}` : ''),
            standardRef: q?.isoRef || '',
        }));

        const avg = round1(detailed.reduce((s, d) => s + d.score, 0) / detailed.length);
        const keyStrengths = paired.filter(p => p.a.selectedScore >= 4).map(p => `${shortQuestion(p.q, p.a.questionId)} — ${MATURITY_LABELS[p.a.selectedScore]}`);
        const keyGaps = paired.filter(p => p.a.selectedScore <= 2).map(p => `${shortQuestion(p.q, p.a.questionId)} — ${MATURITY_LABELS[p.a.selectedScore]}`);

        const band = maturityLabel(avg);
        const coverage = detailed.length < questions.length ? ` ${detailed.length} of ${questions.length} questions answered.` : '';
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

/** Overall score = mean of dimension means (each dimension weighs equally, as the 6M model intends). */
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
 * Draft one finding per answer at Aware level or below (score ≤ 2).
 * The recommended action is the NEXT rung of the same question — the option
 * text for score+1 — because the question bank already describes what
 * "one level better" looks like in the organisation's own terms.
 */
export function draftFindingsFromAnswers(answers: SixMChecklistAnswer[] | undefined): ScoredFinding[] {
    const list = (answers || []).filter(a => a && Number.isFinite(a.selectedScore) && a.selectedScore <= 2);
    const drafts: ScoredFinding[] = [];
    for (const a of list) {
        const q = questionById(a.questionId);
        if (!q) continue;
        const next = q.options.find(o => o.score === a.selectedScore + 1);
        const target = q.options.find(o => o.score === 3);
        const impact = DIMENSION_IMPACT[a.dimensionKey] || DIMENSION_IMPACT.method;
        drafts.push({
            id: `sixm-${q.id}`,
            sourceQuestionId: q.id,
            finding: `${shortQuestion(q, q.text)}: current state is "${a.optionText}" (${MATURITY_LABELS[a.selectedScore]}, ${a.selectedScore}/5).`,
            category: DIMENSION_CATEGORY[a.dimensionKey] || 'Maintenance & Reliability',
            rating: a.selectedScore === 1 ? 'major_gap' : 'minor_gap',
            riskRank: a.selectedScore === 1 ? 16 : 9,
            ...impact,
            isoReference: q.isoRef,
            recommendedAction:
                (next ? `Move to level ${next.score}: ${next.text}` : '') +
                (target && target.score !== next?.score ? ` Target within 12 months (level 3): ${target.text}` : ''),
            owner: '',
            dueDate: '',
            sixmCategory: DIMENSION_SIXM_LABEL[a.dimensionKey] || 'Method',
        });
    }
    // Worst first, then by dimension order.
    const order = SIXM_DIMENSIONS.map(d => d.key);
    return drafts.sort((x, y) => (y.riskRank - x.riskRank) || (order.indexOf(keyOf(x)) - order.indexOf(keyOf(y))));
}

function keyOf(f: ScoredFinding): string {
    const q = f.sourceQuestionId ? questionById(f.sourceQuestionId) : undefined;
    return q?.dimensionKey || '';
}

// ─── Deterministic prose fallbacks (used when the AI proxy is off or fails) ──

export function deterministicKeyFindings(results: DimensionResult[]): string[] {
    if (results.length === 0) return ['No 6M dimension has been scored yet.'];
    const sorted = [...results].sort((a, b) => a.averageScore - b.averageScore);
    const out: string[] = [];
    for (const r of sorted.slice(0, 3)) {
        out.push(`${r.dimensionCode} ${r.dimensionLabel} is the ${out.length === 0 ? 'weakest' : 'next weakest'} dimension at ${r.averageScore.toFixed(1)}/5 (${maturityLabel(r.averageScore)})${r.keyGaps[0] ? `: ${r.keyGaps[0]}` : '.'}`);
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
