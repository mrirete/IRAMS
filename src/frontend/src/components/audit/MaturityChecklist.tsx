/**
 * MaturityChecklist.tsx — Step 3: guided maturity assessment (multiple choice)
 *
 * Six ISO 55001 / GFMAM groups (MaturityQuestionBank), each question with
 * five anchored answers mapped to maturity levels 1–5. The person answering
 * clicks the anchor that best describes their organisation; two industry-
 * specific questions may be marked "not applicable" (decision 7.2), which
 * leaves them out of the group mean and reports them as such.
 *
 * Submission needs at least one scored answer in EVERY group — the same
 * rule the record uses to count as completed (six dimension results).
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
    ArrowRight, ArrowLeft, Users, Compass, Scale, Wrench, Database, ShieldAlert,
    Info, ChevronRight, CheckCircle2, Circle, ClipboardCheck, Ban,
} from 'lucide-react';
import { MATURITY_QUESTIONS, MATURITY_DIMENSIONS } from '../../eam/services/MaturityQuestionBank';
import type { MaturityAnswer, MaturityDimensionKey } from '../../eam/services/MaturityQuestionBank';

interface Props {
    initialData?: MaturityAnswer[];
    dimensionNotes?: Record<string, string>;
    onComplete: (answers: MaturityAnswer[], notes: Record<string, string>) => void;
    onBack: () => void;
}

const MATURITY_LABELS: Record<number, string> = {
    1: 'Innocent', 2: 'Aware', 3: 'Developing', 4: 'Competent', 5: 'Optimizing',
};

const MATURITY_COLORS: Record<number, { bg: string; border: string; text: string; ring: string }> = {
    1: { bg: 'bg-red-50',     border: 'border-red-200',     text: 'text-red-700',     ring: 'ring-red-400' },
    2: { bg: 'bg-orange-50',  border: 'border-orange-200',  text: 'text-orange-700',  ring: 'ring-orange-400' },
    3: { bg: 'bg-amber-50',   border: 'border-amber-200',   text: 'text-amber-700',   ring: 'ring-amber-400' },
    4: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', ring: 'ring-emerald-400' },
    5: { bg: 'bg-green-50',   border: 'border-green-200',   text: 'text-green-700',   ring: 'ring-green-400' },
};

const DIMENSION_ICONS: Record<string, React.ReactNode> = {
    Compass: <Compass size={20} />,
    Scale: <Scale size={20} />,
    Wrench: <Wrench size={20} />,
    Database: <Database size={20} />,
    Users: <Users size={20} />,
    ShieldAlert: <ShieldAlert size={20} />,
};

export const MaturityChecklist: React.FC<Props> = ({ initialData, dimensionNotes: initNotes, onComplete, onBack }) => {
    // Keyed by question id. Answers whose question no longer exists (retired
    // sixm-v1 ids) are kept in state but never shown or scored.
    const [answers, setAnswers] = useState<Record<string, MaturityAnswer>>(() => {
        const map: Record<string, MaturityAnswer> = {};
        initialData?.forEach(a => { if (a?.questionId) map[a.questionId] = a; });
        return map;
    });
    const [notes, setNotes] = useState<Record<string, string>>(initNotes || {});
    const [activeDimension, setActiveDimension] = useState(0);

    const dimensions = MATURITY_DIMENSIONS;
    const currentDim = dimensions[activeDimension];
    const dimQuestions = MATURITY_QUESTIONS.filter(q => q.dimensionKey === currentDim.key);

    const isScored = (a: MaturityAnswer | undefined) => !!a && !a.notApplicable && Number.isFinite(a.selectedScore as number);

    // Progress per group: answered = scored + not applicable; scored drives the submit gate.
    const dimProgress = useMemo(() => dimensions.map(dim => {
        const qs = MATURITY_QUESTIONS.filter(q => q.dimensionKey === dim.key);
        const answered = qs.filter(q => answers[q.id]).length;
        const scored = qs.filter(q => isScored(answers[q.id])).length;
        return { total: qs.length, answered, scored, complete: answered === qs.length };
    }), [answers, dimensions]);

    const totalQuestions = MATURITY_QUESTIONS.length;
    const totalAnswered = MATURITY_QUESTIONS.filter(q => answers[q.id]).length;
    const groupsWithoutScore = dimensions.filter((_, i) => dimProgress[i].scored === 0);
    const canSubmit = groupsWithoutScore.length === 0;

    const selectOption = useCallback((questionId: string, dimensionKey: MaturityDimensionKey, score: number, optionText: string) => {
        setAnswers(prev => ({
            ...prev,
            [questionId]: { questionId, dimensionKey, selectedScore: score, optionText, notApplicable: false },
        }));
    }, []);

    const selectNotApplicable = useCallback((questionId: string, dimensionKey: MaturityDimensionKey) => {
        setAnswers(prev => ({
            ...prev,
            [questionId]: { questionId, dimensionKey, selectedScore: null, optionText: 'Not applicable to this organisation', notApplicable: true },
        }));
    }, []);

    const handleSubmit = () => {
        if (!canSubmit) return;
        onComplete(Object.values(answers), notes);
    };

    return (
        <div className="ers-page-narrow py-8 px-4 space-y-5">
            {/* Header */}
            <div className="text-center mb-2">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-500/20">
                    <ClipboardCheck size={24} className="text-white" />
                </div>
                <h2 className="text-2xl font-black text-slate-800">Step 3 — Maturity Assessment</h2>
                <p className="text-sm text-slate-500 mt-1">For each question, pick the answer that best describes your organisation today</p>
                <p className="text-xs text-slate-400 mt-0.5">{dimensions.length} groups (ISO 55001 / GFMAM) · {totalQuestions} questions · no typing required</p>
            </div>

            {/* Overall Progress */}
            <div className="bg-white border border-slate-200 rounded-xl px-5 py-3">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-600">Overall Progress</span>
                    <span className="text-xs text-slate-400">{totalAnswered} of {totalQuestions} questions</span>
                </div>
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-gradient-to-r from-blue-500 to-blue-500 rounded-full transition-all duration-500"
                        style={{ width: `${(totalAnswered / totalQuestions) * 100}%` }}
                    />
                </div>
            </div>

            {/* Group Tabs */}
            <div className="flex gap-1.5 overflow-x-auto pb-1">
                {dimensions.map((dim, idx) => {
                    const prog = dimProgress[idx];
                    const isActive = idx === activeDimension;
                    return (
                        <button
                            key={dim.key}
                            onClick={() => setActiveDimension(idx)}
                            className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-bold transition-all whitespace-nowrap ${
                                isActive
                                    ? `bg-gradient-to-r ${dim.gradient} text-white border-transparent shadow-md`
                                    : prog.complete
                                        ? 'bg-green-50 border-green-200 text-green-700'
                                        : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                            }`}
                        >
                            {prog.complete ? <CheckCircle2 size={14} /> : <Circle size={14} />}
                            <span>{dim.code}</span>
                            <span className="hidden sm:inline">{dim.label}</span>
                            {!isActive && <span className="text-[9px] opacity-60">{prog.answered}/{prog.total}</span>}
                        </button>
                    );
                })}
            </div>

            {/* Active Group Explainer */}
            <div className={`bg-gradient-to-r ${currentDim.gradient} rounded-2xl px-6 py-5 text-white shadow-lg`}>
                <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                        {DIMENSION_ICONS[currentDim.icon]}
                    </div>
                    <div>
                        <h3 className="text-lg font-black">{currentDim.code}: {currentDim.label}</h3>
                        <p className="text-sm text-white/80 mt-1 leading-relaxed">{currentDim.meaning}</p>
                        <p className="text-[10px] text-white/60 mt-1.5 font-mono">{currentDim.clauses}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 mt-3 text-white/60 text-[10px]">
                    <Info size={10} />
                    <span>Pick the option that matches your current state — an honest low answer is more useful than a hopeful high one</span>
                </div>
            </div>

            {/* Questions */}
            <div className="space-y-4">
                {dimQuestions.map((q, qIdx) => {
                    const currentAnswer = answers[q.id];
                    const na = !!currentAnswer?.notApplicable;
                    const scored = isScored(currentAnswer);
                    return (
                        <div key={q.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                            {/* Question Header */}
                            <div className="px-5 py-3 bg-slate-50 border-b border-slate-100">
                                <div className="flex items-start gap-3">
                                    <span className="w-7 h-7 rounded-lg bg-slate-200 text-slate-600 flex items-center justify-center text-xs font-black shrink-0 mt-0.5">
                                        Q{qIdx + 1}
                                    </span>
                                    <div className="flex-1">
                                        <p className="text-sm font-semibold text-slate-700 leading-snug">{q.text}</p>
                                        <p className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
                                            📎 {q.isoRef}
                                        </p>
                                    </div>
                                    {scored && currentAnswer && (
                                        <span className={`shrink-0 px-2 py-0.5 rounded-md text-[10px] font-bold border ${MATURITY_COLORS[currentAnswer.selectedScore as number].bg} ${MATURITY_COLORS[currentAnswer.selectedScore as number].border} ${MATURITY_COLORS[currentAnswer.selectedScore as number].text}`}>
                                            Level {currentAnswer.selectedScore} — {MATURITY_LABELS[currentAnswer.selectedScore as number]}
                                        </span>
                                    )}
                                    {na && (
                                        <span className="shrink-0 px-2 py-0.5 rounded-md text-[10px] font-bold border bg-slate-100 border-slate-300 text-slate-500">
                                            Not applicable
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Answer Options */}
                            <div className="p-3 space-y-1.5">
                                {q.options.map(opt => {
                                    const isSelected = scored && currentAnswer?.selectedScore === opt.score;
                                    const colors = MATURITY_COLORS[opt.score];
                                    return (
                                        <button
                                            key={opt.score}
                                            onClick={() => selectOption(q.id, q.dimensionKey, opt.score, opt.text)}
                                            className={`w-full text-left px-4 py-3 rounded-xl border-2 transition-all flex items-start gap-3 ${
                                                isSelected
                                                    ? `${colors.bg} ${colors.border} ring-2 ${colors.ring} ring-offset-1`
                                                    : 'bg-white border-slate-100 hover:border-slate-200 hover:bg-slate-50'
                                            }`}
                                        >
                                            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all ${
                                                isSelected ? `${colors.border} ${colors.bg}` : 'border-slate-300'
                                            }`}>
                                                {isSelected && <div className={`w-2.5 h-2.5 rounded-full ${colors.text.replace('text-', 'bg-')}`} />}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className={`text-sm leading-snug ${isSelected ? colors.text + ' font-semibold' : 'text-slate-600'}`}>
                                                    {opt.text}
                                                </p>
                                            </div>
                                            <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded ${
                                                isSelected ? `${colors.bg} ${colors.text}` : 'text-slate-300'
                                            }`}>
                                                L{opt.score}
                                            </span>
                                        </button>
                                    );
                                })}
                                {q.allowNotApplicable && (
                                    <button
                                        onClick={() => selectNotApplicable(q.id, q.dimensionKey)}
                                        title="Leave this question out of the group score; the report will say it was not applicable"
                                        className={`w-full text-left px-4 py-2.5 rounded-xl border-2 border-dashed transition-all flex items-center gap-3 ${
                                            na ? 'bg-slate-100 border-slate-400 ring-2 ring-slate-300 ring-offset-1' : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                                        }`}
                                    >
                                        <Ban size={14} className={na ? 'text-slate-600' : 'text-slate-400'} />
                                        <span className={`text-sm ${na ? 'text-slate-700 font-semibold' : 'text-slate-500'}`}>Not applicable to this organisation</span>
                                        <span className="ml-auto text-[9px] font-bold text-slate-400">excluded from score</span>
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Group Notes */}
            <div className="bg-white border border-slate-200 rounded-xl px-5 py-4">
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1.5">
                    Additional Notes for {currentDim.label} (Optional)
                </label>
                <textarea
                    value={notes[currentDim.key] || ''}
                    onChange={e => setNotes(prev => ({ ...prev, [currentDim.key]: e.target.value }))}
                    placeholder={`Any observations about ${currentDim.label.toLowerCase()} in your organisation...`}
                    rows={2}
                    className="input-field text-sm resize-none"
                />
            </div>

            {/* Group Navigation */}
            <div className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-5 py-3">
                <button
                    onClick={() => setActiveDimension(Math.max(0, activeDimension - 1))}
                    disabled={activeDimension === 0}
                    className="text-xs font-bold text-slate-500 hover:text-slate-700 disabled:opacity-30 flex items-center gap-1"
                >
                    <ArrowLeft size={14} /> Previous Group
                </button>
                <span className="text-[10px] text-slate-400">
                    {activeDimension + 1} of {dimensions.length} groups
                </span>
                {activeDimension < dimensions.length - 1 ? (
                    <button
                        onClick={() => setActiveDimension(activeDimension + 1)}
                        className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1"
                    >
                        Next Group <ChevronRight size={14} />
                    </button>
                ) : (
                    <span className="text-xs text-green-600 font-bold flex items-center gap-1">
                        <CheckCircle2 size={14} /> All groups reviewed
                    </span>
                )}
            </div>

            {/* Main Navigation */}
            <div className="flex items-center justify-between pt-2 gap-3">
                <button onClick={onBack} className="px-5 py-3 border border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-slate-50 flex items-center gap-2">
                    <ArrowLeft size={16} /> Back
                </button>
                {!canSubmit && (
                    <span className="text-[11px] text-slate-400 text-right flex-1">
                        Score at least one question in every group to continue — still empty: {groupsWithoutScore.map(d => d.label).join(', ')}
                    </span>
                )}
                <button
                    onClick={handleSubmit}
                    disabled={!canSubmit}
                    className="px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white font-bold rounded-xl shadow-md hover:shadow-lg transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    Generate Findings <ArrowRight size={16} />
                </button>
            </div>
        </div>
    );
};
