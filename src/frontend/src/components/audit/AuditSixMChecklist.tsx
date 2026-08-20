/**
 * AuditSixMChecklist.tsx — Step 3: 6M Quick Assessment (Guided Multiple-Choice)
 *
 * Replaces the AI conversational Q&A with structured guided assessment.
 * Each of 6 dimensions has 5 questions with 5 selectable answer options
 * mapped to maturity levels 1-5.
 *
 * Users click the answer card that best describes their organization.
 * No typing required — optional notes field per dimension.
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
    ArrowRight, ArrowLeft, Users, Cog, ClipboardList,
    Package, Gauge, Cloud, Info, ChevronRight, CheckCircle2, Circle, Sparkles
} from 'lucide-react';
import { SIXM_ASSESSMENT_QUESTIONS, SIXM_EXPLAINERS } from '../../eam/services/SixMQuestionBank';
import type { SixMChecklistAnswer, SixMDimensionExplainer } from '../../eam/services/SixMQuestionBank';

interface Props {
    initialData?: SixMChecklistAnswer[];
    dimensionNotes?: Record<string, string>;
    onComplete: (answers: SixMChecklistAnswer[], notes: Record<string, string>) => void;
    onBack: () => void;
}

const MATURITY_LABELS: Record<number, string> = {
    1: 'Innocent',
    2: 'Aware',
    3: 'Developing',
    4: 'Competent',
    5: 'Optimizing',
};

const MATURITY_COLORS: Record<number, { bg: string; border: string; text: string; ring: string }> = {
    1: { bg: 'bg-red-50',    border: 'border-red-200',    text: 'text-red-700',    ring: 'ring-red-400' },
    2: { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', ring: 'ring-orange-400' },
    3: { bg: 'bg-amber-50',  border: 'border-amber-200',  text: 'text-amber-700',  ring: 'ring-amber-400' },
    4: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', ring: 'ring-emerald-400' },
    5: { bg: 'bg-green-50',  border: 'border-green-200',  text: 'text-green-700',  ring: 'ring-green-400' },
};

const DIMENSION_ICONS: Record<string, React.ReactNode> = {
    Users: <Users size={20} />,
    Cog: <Cog size={20} />,
    ClipboardList: <ClipboardList size={20} />,
    Package: <Package size={20} />,
    Gauge: <Gauge size={20} />,
    Cloud: <Cloud size={20} />,
};

export const AuditSixMChecklist: React.FC<Props> = ({ initialData, dimensionNotes: initNotes, onComplete, onBack }) => {
    const [answers, setAnswers] = useState<Record<string, SixMChecklistAnswer>>(() => {
        const map: Record<string, SixMChecklistAnswer> = {};
        initialData?.forEach(a => { map[a.questionId] = a; });
        return map;
    });
    const [notes, setNotes] = useState<Record<string, string>>(initNotes || {});
    const [activeDimension, setActiveDimension] = useState(0);

    const dimensions = SIXM_EXPLAINERS;
    const currentDim = dimensions[activeDimension];
    const dimQuestions = SIXM_ASSESSMENT_QUESTIONS.filter(q => q.dimensionKey === currentDim.key);

    // Progress per dimension
    const dimProgress = useMemo(() => {
        return dimensions.map(dim => {
            const qs = SIXM_ASSESSMENT_QUESTIONS.filter(q => q.dimensionKey === dim.key);
            const answered = qs.filter(q => answers[q.id]).length;
            return { total: qs.length, answered, complete: answered === qs.length };
        });
    }, [answers, dimensions]);

    const totalAnswered = Object.keys(answers).length;
    const totalQuestions = SIXM_ASSESSMENT_QUESTIONS.length;

    const selectOption = useCallback((questionId: string, dimensionKey: string, score: number, optionText: string) => {
        setAnswers(prev => ({
            ...prev,
            [questionId]: { questionId, dimensionKey, selectedScore: score, optionText },
        }));
    }, []);

    const handleSubmit = () => {
        onComplete(Object.values(answers), notes);
    };

    return (
        <div className="ers-page-narrow py-8 px-4 space-y-5">
            {/* Header */}
            <div className="text-center mb-2">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-500/20">
                    <Sparkles size={24} className="text-white" />
                </div>
                <h2 className="text-2xl font-black text-slate-800">Step 3 — 6M Assessment</h2>
                <p className="text-sm text-slate-500 mt-1">Select the answer that best describes your organization for each question</p>
                <p className="text-xs text-slate-400 mt-0.5">6 dimensions · 5 questions each · no typing required</p>
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

            {/* Dimension Tabs */}
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

            {/* Active Dimension Explainer */}
            <div className={`bg-gradient-to-r ${currentDim.gradient} rounded-2xl px-6 py-5 text-white shadow-lg`}>
                <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                        {DIMENSION_ICONS[currentDim.icon]}
                    </div>
                    <div>
                        <h3 className="text-lg font-black">{currentDim.code}: {currentDim.label}</h3>
                        <p className="text-sm text-white/80 mt-1 leading-relaxed">{currentDim.meaning}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 mt-3 text-white/60 text-[10px]">
                    <Info size={10} />
                    <span>Select the option that best matches your current state — there are no wrong answers</span>
                </div>
            </div>

            {/* Questions */}
            <div className="space-y-4">
                {dimQuestions.map((q, qIdx) => {
                    const currentAnswer = answers[q.id];
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
                                    {currentAnswer && (
                                        <span className={`shrink-0 px-2 py-0.5 rounded-md text-[10px] font-bold border ${MATURITY_COLORS[currentAnswer.selectedScore].bg} ${MATURITY_COLORS[currentAnswer.selectedScore].border} ${MATURITY_COLORS[currentAnswer.selectedScore].text}`}>
                                            Level {currentAnswer.selectedScore} — {MATURITY_LABELS[currentAnswer.selectedScore]}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Answer Options */}
                            <div className="p-3 space-y-1.5">
                                {q.options.map(opt => {
                                    const isSelected = currentAnswer?.selectedScore === opt.score;
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
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Dimension Notes */}
            <div className="bg-white border border-slate-200 rounded-xl px-5 py-4">
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1.5">
                    Additional Notes for {currentDim.label} (Optional)
                </label>
                <textarea
                    value={notes[currentDim.key] || ''}
                    onChange={e => setNotes(prev => ({ ...prev, [currentDim.key]: e.target.value }))}
                    placeholder={`Any observations about ${currentDim.label.toLowerCase()} in your organization...`}
                    rows={2}
                    className="input-field text-sm resize-none"
                />
            </div>

            {/* Dimension Navigation */}
            <div className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-5 py-3">
                <button
                    onClick={() => setActiveDimension(Math.max(0, activeDimension - 1))}
                    disabled={activeDimension === 0}
                    className="text-xs font-bold text-slate-500 hover:text-slate-700 disabled:opacity-30 flex items-center gap-1"
                >
                    <ArrowLeft size={14} /> Previous Dimension
                </button>
                <span className="text-[10px] text-slate-400">
                    {activeDimension + 1} of {dimensions.length} dimensions
                </span>
                {activeDimension < dimensions.length - 1 ? (
                    <button
                        onClick={() => setActiveDimension(activeDimension + 1)}
                        className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1"
                    >
                        Next Dimension <ChevronRight size={14} />
                    </button>
                ) : (
                    <span className="text-xs text-green-600 font-bold flex items-center gap-1">
                        <CheckCircle2 size={14} /> All dimensions reviewed
                    </span>
                )}
            </div>

            {/* Main Navigation */}
            <div className="flex justify-between pt-2">
                <button onClick={onBack} className="px-5 py-3 border border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-slate-50 flex items-center gap-2">
                    <ArrowLeft size={16} /> Back
                </button>
                <button
                    onClick={handleSubmit}
                    disabled={totalAnswered < 6}
                    className="px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white font-bold rounded-xl shadow-md hover:shadow-lg transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    Generate Findings <ArrowRight size={16} />
                </button>
            </div>
        </div>
    );
};
