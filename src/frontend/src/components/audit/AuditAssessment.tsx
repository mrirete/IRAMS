import React, { useState, useEffect, useRef } from 'react';
import { Send, Loader2, CheckCircle, ChevronRight, Users, Cog, ClipboardList, Package, Gauge, Cloud, AlertTriangle, RefreshCw } from 'lucide-react';
import { auditAssessor, SIXM_DIMENSIONS } from '../../eam/services/AuditAssessor';
import type { AuditRegistration, DimensionQuestion, DimensionAnswer, DimensionResult, SixMDimension } from '../../eam/services/AuditAssessor';

const ICON_MAP: Record<string, React.ComponentType<{size?: number; className?: string}>> = { Users, Cog, ClipboardList, Package, Gauge, Cloud };

interface Props {
  registration: AuditRegistration;
  onComplete: (results: DimensionResult[]) => void;
}

export const AuditAssessment: React.FC<Props> = ({ registration, onComplete }) => {
  const [dimIndex, setDimIndex] = useState(0);
  const [questions, setQuestions] = useState<DimensionQuestion[]>([]);
  const [qIndex, setQIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [answers, setAnswers] = useState<DimensionAnswer[]>([]);
  const [allResults, setAllResults] = useState<DimensionResult[]>([]);
  const [lastFeedback, setLastFeedback] = useState<DimensionAnswer | null>(null);
  const [questionError, setQuestionError] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const currentDim = SIXM_DIMENSIONS[dimIndex];
  const totalDimensions = SIXM_DIMENSIONS.length;
  const totalProgress = ((dimIndex * 5 + qIndex) / 30) * 100;

  // Load questions when dimension changes
  const loadDimensionQuestions = async () => {
    setLoadingQuestions(true);
    setQuestions([]);
    setQIndex(0);
    setAnswers([]);
    setLastFeedback(null);
    setAnswer('');
    setQuestionError(null);
    try {
      const qs = await auditAssessor.generateQuestions(currentDim, registration);
      if (!qs || qs.length === 0) {
        setQuestionError('No questions were generated. The AI service may be unavailable.');
      } else {
        setQuestions(qs);
      }
    } catch (e: any) {
      console.error('Failed to load questions:', e);
      setQuestionError(e?.message || 'Failed to generate assessment questions. Please check your API configuration and try again.');
    }
    setLoadingQuestions(false);
  };

  useEffect(() => {
    if (dimIndex < totalDimensions) loadDimensionQuestions();
  }, [dimIndex]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [answers, lastFeedback, loading]);

  const handleSubmitAnswer = async () => {
    if (!answer.trim() || loading) return;
    const currentQ = questions[qIndex];
    if (!currentQ) return;

    setLoading(true);
    setLastFeedback(null);
    const userAnswer = answer.trim();
    setAnswer('');

    try {
      const scored = await auditAssessor.scoreAnswer(currentDim, currentQ, userAnswer, registration);
      const newAnswers = [...answers, scored];
      setAnswers(newAnswers);
      setLastFeedback(scored);

      // Check if dimension is complete
      if (qIndex + 1 >= questions.length) {
        // Summarize dimension
        const summary = await auditAssessor.summarizeDimension(currentDim, newAnswers, registration);
        const dimResult: DimensionResult = {
          dimensionKey: currentDim.key,
          dimensionCode: currentDim.code,
          dimensionLabel: currentDim.label,
          averageScore: newAnswers.reduce((s, a) => s + a.score, 0) / newAnswers.length,
          answers: newAnswers,
          ...summary,
        };
        const updatedResults = [...allResults, dimResult];
        setAllResults(updatedResults);

        // Move to next dimension or complete
        if (dimIndex + 1 >= totalDimensions) {
          setTimeout(() => onComplete(updatedResults), 1500);
        } else {
          // Auto-advance after brief pause to show feedback
          setTimeout(() => setDimIndex(d => d + 1), 2000);
        }
      } else {
        setTimeout(() => {
          setQIndex(q => q + 1);
          setLastFeedback(null);
        }, 1800);
      }
    } catch (e) {
      console.error('Scoring failed:', e);
    }
    setLoading(false);
  };

  const Icon = ICON_MAP[currentDim?.icon] || ClipboardList;

  return (
    <div className="max-w-3xl mx-auto py-6 px-4 flex flex-col" style={{ minHeight: 'calc(100vh - 160px)' }}>
      {/* Progress Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${currentDim.gradient} flex items-center justify-center shadow-sm`}>
              <Icon size={20} className="text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">{currentDim.code}: {currentDim.label}</h2>
              <p className="text-xs text-slate-500">{currentDim.description}</p>
            </div>
          </div>
          <div className="text-right">
            <span className="text-xs font-mono text-slate-400">Q{qIndex + 1}/5 · Dimension {dimIndex + 1}/{totalDimensions}</span>
          </div>
        </div>
        {/* Progress Bar */}
        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-700 bg-gradient-to-r from-blue-500 to-blue-500" style={{ width: `${totalProgress}%` }} />
        </div>
        {/* Dimension Pills */}
        <div className="flex gap-1.5 mt-3">
          {SIXM_DIMENSIONS.map((d, i) => {
            const DIcon = ICON_MAP[d.icon] || ClipboardList;
            const done = i < dimIndex;
            const active = i === dimIndex;
            return (
              <div key={d.key} className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold transition-all ${done ? 'bg-green-50 text-green-600' : active ? 'bg-white border-2 text-slate-800 shadow-sm' : 'bg-slate-50 text-slate-300'}`}
                style={active ? { borderColor: d.color } : {}}>
                {done ? <CheckCircle size={12} /> : <DIcon size={12} />}
                {d.code}
              </div>
            );
          })}
        </div>
      </div>

      {/* Conversation Area */}
      <div className="flex-1 bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col">
        <div className="flex-1 overflow-y-auto p-5 space-y-4" style={{ maxHeight: 'calc(100vh - 400px)' }}>
          {loadingQuestions ? (
            <div className="flex items-center justify-center py-12 text-slate-400">
              <Loader2 size={24} className="animate-spin mr-3" />
              <span className="text-sm">Preparing {currentDim.label} assessment questions...</span>
            </div>
          ) : questionError ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-14 h-14 rounded-xl bg-red-50 flex items-center justify-center mb-4">
                <AlertTriangle size={24} className="text-red-400" />
              </div>
              <h3 className="text-sm font-bold text-slate-700 mb-1">Unable to Load Assessment Questions</h3>
              <p className="text-xs text-slate-500 max-w-md mb-4 leading-relaxed">{questionError}</p>
              <button
                onClick={loadDimensionQuestions}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-600 text-sm font-semibold rounded-xl border border-blue-200 transition-colors"
              >
                <RefreshCw size={14} /> Retry
              </button>
            </div>
          ) : (
            <>
              {/* Completed Q&A pairs */}
              {answers.map((a, i) => (
                <div key={i} className="space-y-3">
                  {/* AI Question */}
                  <div className="flex gap-3">
                    <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${currentDim.gradient} flex items-center justify-center shrink-0 mt-0.5`}>
                      <Icon size={14} className="text-white" />
                    </div>
                    <div className="bg-slate-50 border border-slate-100 rounded-xl rounded-tl-sm px-4 py-3 max-w-[85%]">
                      <p className="text-sm text-slate-700 leading-relaxed">{a.questionText}</p>
                    </div>
                  </div>
                  {/* User Answer */}
                  <div className="flex gap-3 justify-end">
                    <div className="bg-blue-50 border border-blue-100 rounded-xl rounded-tr-sm px-4 py-3 max-w-[85%]">
                      <p className="text-sm text-slate-700">{a.answer}</p>
                    </div>
                  </div>
                  {/* Score Feedback */}
                  <div className="flex gap-3">
                    <div className="w-8 h-8 shrink-0" />
                    <div className="bg-gradient-to-r from-slate-50 to-white border border-slate-100 rounded-xl px-4 py-3 max-w-[85%]">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-bold text-white px-2 py-0.5 rounded-md" style={{ backgroundColor: getScoreColor(a.score) }}>
                          {a.score}/5
                        </span>
                        <span className="text-[10px] font-mono text-slate-400">{a.standardRef}</span>
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">{a.feedback}</p>
                    </div>
                  </div>
                </div>
              ))}

              {/* Current question (if not showing feedback for last answer) */}
              {questions[qIndex] && !lastFeedback && answers.length < questions.length && (
                <div className="flex gap-3">
                  <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${currentDim.gradient} flex items-center justify-center shrink-0 mt-0.5`}>
                    <Icon size={14} className="text-white" />
                  </div>
                  <div className="bg-slate-50 border border-slate-100 rounded-xl rounded-tl-sm px-4 py-3 max-w-[85%]">
                    <p className="text-sm text-slate-700 leading-relaxed">{questions[qIndex].questionText}</p>
                  </div>
                </div>
              )}

              {/* Dimension complete message */}
              {answers.length === 5 && (
                <div className="text-center py-4">
                  <div className="inline-flex items-center gap-2 px-4 py-2 bg-green-50 border border-green-200 rounded-xl">
                    <CheckCircle size={16} className="text-green-500" />
                    <span className="text-sm font-semibold text-green-700">{currentDim.label} complete — Average: {(answers.reduce((s, a) => s + a.score, 0) / 5).toFixed(1)}/5</span>
                  </div>
                </div>
              )}

              {loading && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 shrink-0" />
                  <div className="bg-slate-50 border border-slate-100 rounded-xl px-4 py-3">
                    <div className="flex items-center gap-2 text-slate-400">
                      <Loader2 size={14} className="animate-spin" />
                      <span className="text-xs">Analyzing your response...</span>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div className="border-t border-slate-100 p-4">
          <div className="flex gap-3">
            <textarea
              value={answer}
              onChange={e => setAnswer(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmitAnswer(); } }}
              placeholder={answers.length >= 5 ? 'Dimension complete. Moving to next...' : 'Describe your organization\'s approach...'}
              disabled={loading || loadingQuestions || answers.length >= 5}
              rows={2}
              className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm resize-none focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30 disabled:opacity-50 text-slate-800 placeholder:text-slate-400"
            />
            <button
              onClick={handleSubmitAnswer}
              disabled={!answer.trim() || loading || answers.length >= 5}
              className="px-4 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl hover:shadow-md disabled:opacity-40 transition-all self-end"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
            </button>
          </div>
          <p className="text-[10px] text-slate-400 mt-2 text-center">
            Press Enter to submit · Shift+Enter for new line · {currentDim.standards.join(' · ')}
          </p>
        </div>
      </div>
    </div>
  );
};

function getScoreColor(score: number): string {
  if (score >= 5) return '#22c55e';
  if (score >= 4) return '#84cc16';
  if (score >= 3) return '#f59e0b';
  if (score >= 2) return '#f97316';
  return '#ef4444';
}
