import { describe, it, expect } from 'vitest';
import { computeSixMResults, scoreSummary, draftFindingsFromAnswers, maturityLabel, deterministicRoadmap } from './sixmScoring';
import { SIXM_ASSESSMENT_QUESTIONS } from './SixMQuestionBank';
import type { SixMChecklistAnswer } from './SixMQuestionBank';

function answerAll(score: number | ((i: number) => number)): SixMChecklistAnswer[] {
    return SIXM_ASSESSMENT_QUESTIONS.map((q, i) => {
        const s = typeof score === 'function' ? score(i) : score;
        const opt = q.options.find(o => o.score === s)!;
        return { questionId: q.id, dimensionKey: q.dimensionKey, selectedScore: s, optionText: opt.text };
    });
}

describe('computeSixMResults', () => {
    it('produces one result per dimension with the mean of its answers', () => {
        const results = computeSixMResults(answerAll(3));
        expect(results).toHaveLength(6);
        for (const r of results) {
            expect(r.averageScore).toBe(3);
            expect(r.answers).toHaveLength(5);
            expect(r.keyGaps).toHaveLength(0);
            expect(r.keyStrengths).toHaveLength(0);
        }
    });

    it('omits dimensions with no answers instead of scoring them zero', () => {
        const only = answerAll(4).filter(a => a.dimensionKey === 'man');
        const results = computeSixMResults(only);
        expect(results).toHaveLength(1);
        expect(results[0].dimensionKey).toBe('man');
    });

    it('classifies gaps (≤2) and strengths (≥4) and carries the standard reference', () => {
        const results = computeSixMResults(answerAll(i => (i % 5 === 0 ? 1 : 5)));
        const man = results.find(r => r.dimensionKey === 'man')!;
        expect(man.keyGaps).toHaveLength(1);
        expect(man.keyStrengths).toHaveLength(4);
        expect(man.answers.every(a => a.standardRef.length > 0)).toBe(true);
    });

    it('appends assessor notes to the dimension summary', () => {
        const results = computeSixMResults(answerAll(2), { man: 'Crew turnover is the issue.' });
        expect(results.find(r => r.dimensionKey === 'man')!.summary).toContain('Crew turnover');
    });
});

describe('scoreSummary', () => {
    it('never yields NaN — empty input reads as not assessed', () => {
        const s = scoreSummary([]);
        expect(s.overallScore).toBe(0);
        expect(s.overallPercentage).toBe(0);
        expect(s.maturityLevel).toBe('Not assessed');
    });

    it('averages dimension means equally and bands the label deterministically', () => {
        const s = scoreSummary(computeSixMResults(answerAll(i => (i < 15 ? 2 : 4))));
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
    it('drafts one finding per answer at level 2 or below, worst first', () => {
        const drafts = draftFindingsFromAnswers(answerAll(i => (i % 3 === 0 ? 1 : i % 3 === 1 ? 2 : 4)));
        expect(drafts).toHaveLength(20);
        expect(drafts[0].rating).toBe('major_gap');
        expect(drafts[drafts.length - 1].rating).toBe('minor_gap');
        expect(drafts.every(d => d.isoReference.length > 0)).toBe(true);
        expect(drafts.every(d => d.recommendedAction.startsWith('Move to level'))).toBe(true);
    });

    it('drafts nothing when every answer is Developing or better', () => {
        expect(draftFindingsFromAnswers(answerAll(3))).toHaveLength(0);
    });
});

describe('deterministicRoadmap', () => {
    it('places level-1 gaps in 30 days and level-2 gaps in 90 days', () => {
        const rm = deterministicRoadmap(computeSixMResults(answerAll(i => (i === 0 ? 1 : i === 1 ? 2 : 4))));
        expect(rm.thirtyDayActions).toHaveLength(1);
        expect(rm.ninetyDayActions).toHaveLength(1);
        expect(rm.thirtyDayActions[0].priority).toBe('critical');
    });
});
