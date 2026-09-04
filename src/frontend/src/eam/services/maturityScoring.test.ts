import { describe, it, expect } from 'vitest';
import {
    computeMaturityResults, scoreSummary, draftFindingsFromAnswers, maturityLabel,
    deterministicRoadmap, MATURITY_FRAMEWORK,
} from './maturityScoring';
import { MATURITY_QUESTIONS, MATURITY_DIMENSIONS, questionsFor, RETIRED_QUESTION_IDS } from './MaturityQuestionBank';
import type { MaturityAnswer, MaturityQuestion } from './MaturityQuestionBank';

function answerAll(score: number | ((i: number, q: MaturityQuestion) => number)): MaturityAnswer[] {
    return MATURITY_QUESTIONS.map((q, i) => {
        const s = typeof score === 'function' ? score(i, q) : score;
        const opt = q.options.find(o => o.score === s)!;
        return { questionId: q.id, dimensionKey: q.dimensionKey, selectedScore: s, optionText: opt.text };
    });
}

describe('MaturityQuestionBank', () => {
    it('is the gfmam-v1 bank: six groups, unique ids, five anchors 1–5 each, at least five questions per group', () => {
        expect(MATURITY_FRAMEWORK).toBe('gfmam-v1');
        expect(MATURITY_DIMENSIONS).toHaveLength(6);
        expect(new Set(MATURITY_QUESTIONS.map(q => q.id)).size).toBe(MATURITY_QUESTIONS.length);
        for (const q of MATURITY_QUESTIONS) {
            expect(q.options.map(o => o.score)).toEqual([1, 2, 3, 4, 5]);
            expect(q.isoRef.length).toBeGreaterThan(0);
        }
        for (const d of MATURITY_DIMENSIONS) expect(questionsFor(d.key).length).toBeGreaterThanOrEqual(5);
        for (const id of RETIRED_QUESTION_IDS) expect(MATURITY_QUESTIONS.find(q => q.id === id)).toBeUndefined();
    });

    it('marks exactly the two industry-specific questions as not-applicable-capable (decision 7.2)', () => {
        expect(MATURITY_QUESTIONS.filter(q => q.allowNotApplicable).map(q => q.id).sort()).toEqual(['d6_shutdown', 'm6_q3']);
    });
});

describe('computeMaturityResults', () => {
    it('produces one result per group with the mean of its answers', () => {
        const results = computeMaturityResults(answerAll(3));
        expect(results).toHaveLength(6);
        for (const r of results) {
            expect(r.averageScore).toBe(3);
            expect(r.answers).toHaveLength(questionsFor(r.dimensionKey as any).length);
            expect(r.keyGaps).toHaveLength(0);
            expect(r.keyStrengths).toHaveLength(0);
        }
    });

    it('omits groups with no answers instead of scoring them zero', () => {
        const only = answerAll(4).filter(a => a.dimensionKey === 'people');
        const results = computeMaturityResults(only);
        expect(results).toHaveLength(1);
        expect(results[0].dimensionKey).toBe('people');
    });

    it('classifies gaps (≤2) and strengths (≥4) and carries the standard reference', () => {
        const results = computeMaturityResults(answerAll((i, q) => (q.dimensionKey === 'people' && q.id === 'm1_q1' ? 1 : 5)));
        const people = results.find(r => r.dimensionKey === 'people')!;
        expect(people.keyGaps).toHaveLength(1);
        expect(people.keyStrengths).toHaveLength(4);
        expect(people.answers.every(a => a.standardRef.length > 0)).toBe(true);
    });

    it('appends assessor notes to the group summary', () => {
        const results = computeMaturityResults(answerAll(2), { people: 'Crew turnover is the issue.' });
        expect(results.find(r => r.dimensionKey === 'people')!.summary).toContain('Crew turnover');
    });

    it('excludes a not-applicable answer from the mean and says so in the summary', () => {
        const answers = answerAll(4).map(a => a.questionId === 'm6_q3'
            ? { ...a, selectedScore: null, notApplicable: true, optionText: 'Not applicable' }
            : a);
        const risk = computeMaturityResults(answers).find(r => r.dimensionKey === 'risk')!;
        expect(risk.averageScore).toBe(4);
        expect(risk.answers).toHaveLength(questionsFor('risk').length - 1);
        expect(risk.summary).toMatch(/1 marked not applicable/);
    });

    it('regroups sixm-v1 answers by question id and drops retired ids — no migration needed', () => {
        const legacy: MaturityAnswer[] = [
            { questionId: 'm1_q1', dimensionKey: 'man', selectedScore: 2, optionText: 'x' },       // now people
            { questionId: 'm2_q1', dimensionKey: 'machine', selectedScore: 4, optionText: 'x' },   // now information
            { questionId: 'm4_q4', dimensionKey: 'material', selectedScore: 3, optionText: 'x' },  // retired
        ];
        const results = computeMaturityResults(legacy);
        expect(results.map(r => r.dimensionKey).sort()).toEqual(['information', 'people']);
        expect(results.find(r => r.dimensionKey === 'people')!.averageScore).toBe(2);
    });
});

describe('scoreSummary', () => {
    it('never yields NaN — empty input reads as not assessed', () => {
        const s = scoreSummary([]);
        expect(s.overallScore).toBe(0);
        expect(s.overallPercentage).toBe(0);
        expect(s.maturityLevel).toBe('Not assessed');
    });

    it('averages group means equally regardless of group size and bands the label deterministically', () => {
        const low = new Set(['strategy', 'decisions', 'lifecycle']);
        const s = scoreSummary(computeMaturityResults(answerAll((_i, q) => (low.has(q.dimensionKey) ? 2 : 4))));
        expect(s.overallScore).toBe(3);
        expect(s.overallPercentage).toBe(60);
        expect(s.maturityLevel).toBe('Developing');
        expect(s.dimensionsScored).toBe(6);
    });

    it('bands match the audit module thresholds', () => {
        expect(maturityLabel(1.4)).toBe('Innocent');
        expect(maturityLabel(1.5)).toBe('Aware');
        expect(maturityLabel(3.5)).toBe('Competent');
        expect(maturityLabel(4.5)).toBe('Optimizing');
        expect(maturityLabel(NaN)).toBe('Not assessed');
    });
});

describe('draftFindingsFromAnswers', () => {
    it('drafts one finding per scored answer at level 2 or below, worst first, never for not-applicable', () => {
        const answers = answerAll(i => (i % 3 === 0 ? 1 : i % 3 === 1 ? 2 : 4))
            .map(a => a.questionId === 'd6_shutdown' ? { ...a, selectedScore: null, notApplicable: true } : a);
        const drafts = draftFindingsFromAnswers(answers);
        const expected = answers.filter(a => !a.notApplicable && (a.selectedScore as number) <= 2).length;
        expect(drafts).toHaveLength(expected);
        expect(drafts[0].rating).toBe('major_gap');
        expect(drafts[drafts.length - 1].rating).toBe('minor_gap');
        expect(drafts.every(d => d.isoReference.length > 0)).toBe(true);
        expect(drafts.every(d => d.recommendedAction.startsWith('Move to level'))).toBe(true);
        expect(drafts.every(d => ['Man', 'Machine', 'Method', 'Material', 'Measurement', 'Mother Nature'].includes(d.sixmCategory))).toBe(true);
    });

    it('drafts nothing when every answer is Developing or better', () => {
        expect(draftFindingsFromAnswers(answerAll(3))).toHaveLength(0);
    });
});

describe('deterministicRoadmap', () => {
    it('places level-1 gaps in 30 days and level-2 gaps in 90 days', () => {
        const rm = deterministicRoadmap(computeMaturityResults(answerAll(i => (i === 0 ? 1 : i === 1 ? 2 : 4))));
        expect(rm.thirtyDayActions).toHaveLength(1);
        expect(rm.ninetyDayActions).toHaveLength(1);
        expect(rm.thirtyDayActions[0].priority).toBe('critical');
    });
});
