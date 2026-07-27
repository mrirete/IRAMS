/**
 * RCMDecisionWizard — Guided step-by-step SAE JA1012 decision logic (Q6–Q7)
 * Strategy selection and task details per failure mode.
 * Consequence classification (Q5) is handled in RCMFunctionPanel.
 */
import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  GitBranch, Sparkles, RefreshCw, ChevronDown, ChevronUp,
  Check, CheckCircle2, AlertTriangle, ShieldAlert,
} from 'lucide-react';
import { RCMContextualHelp } from './RCMContextualHelp';
import type {
  RCMDecisionWizardProps, RCMFailureMode, RCMDecision,
} from './types';
import { CONSEQUENCE_OPTIONS, STRATEGY_LABELS, parseConsequenceCodes, hasSafetyConsequence } from './types';



// ── Main Component ──────────────────────────────────────────
export const RCMDecisionWizard: React.FC<RCMDecisionWizardProps> = ({
  study, failureModes, functions, decisions, aiLoading, lifeEvidence, onUpdateDecision, onAIRecommend,
}) => {
  const [expandedFM, setExpandedFM] = useState<string | null>(
    failureModes.length > 0 ? failureModes[0].id : null
  );
  const debounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // Bumped when "Use measured" is clicked, so ONLY then does the uncontrolled
  // interval input remount and pick up the applied value.
  const [evidenceApplied, setEvidenceApplied] = useState<Record<string, number>>({});

  const debouncedUpdate = useCallback((fmId: string, field: string, value: any) => {
    const key = `${fmId}-${field}`;
    if (debounceRef.current[key]) clearTimeout(debounceRef.current[key]);
    debounceRef.current[key] = setTimeout(() => {
      onUpdateDecision(fmId, { [field]: value });
    }, 800);
  }, [onUpdateDecision]);



  const fnMap = useMemo(() => new Map(functions.map(f => [f.id, f])), [functions]);

  // Proactively and automatically trigger the Relantern AI strategy recommendation by default
  // when an unresolved failure mode is expanded, providing zero-click predictive RCM suggestions.
  useEffect(() => {
    if (!expandedFM) return;
    const activeFM = failureModes.find(fm => fm.id === expandedFM);
    if (!activeFM) return;

    const activeDecision = decisions.get(expandedFM);
    const hasStrategy = !!activeDecision?.recommended_strategy_code;

    if (!hasStrategy && aiLoading !== `recommend-${expandedFM}`) {
      const timer = setTimeout(() => {
        onAIRecommend(activeFM);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [expandedFM, decisions, failureModes, onAIRecommend, aiLoading]);

  return (
    <div className="space-y-4 animate-in fade-in duration-300">

      {/* Measured life data — the Modelling lab's latest Weibull fit for this asset */}
      {lifeEvidence && (
        <div className="bg-white border border-primary-200 rounded-xl px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 shadow-sm">
          <span className="text-[10px] font-bold text-primary-700 uppercase tracking-wider">Measured life data</span>
          <span className="text-xs text-slate-600">
            β = <strong>{lifeEvidence.beta.toFixed(2)}</strong>
            {lifeEvidence.beta > 1 ? ' (wear-out)' : lifeEvidence.beta < 1 ? ' (infant mortality)' : ' (random)'}
            {' · '}η = <strong>{Math.round(lifeEvidence.eta).toLocaleString()} h</strong>
            {' · '}B10 = <strong>{lifeEvidence.b10.toLocaleString()} h</strong>
          </span>
          <span className="text-xs text-emerald-700 font-semibold">
            Suggested interval ≈ {lifeEvidence.interval.toLocaleString()} h
          </span>
          <span className="text-[10px] text-slate-400 ml-auto" title={lifeEvidence.source}>
            from "{lifeEvidence.source.slice(0, 40)}{lifeEvidence.source.length > 40 ? '…' : ''}" · {new Date(lifeEvidence.date).toLocaleDateString()}
          </span>
        </div>
      )}

      {/* Empty State */}
      {failureModes.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center shadow-sm">
          <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-primary-50 flex items-center justify-center">
            <GitBranch size={28} className="text-primary-300" />
          </div>
          <p className="text-sm font-semibold text-slate-500">No failure modes to evaluate</p>
          <p className="text-xs text-slate-400 mt-1">Define failure modes in the Functions tab first.</p>
        </div>
      ) : (
        failureModes.map((fm, fmIdx) => {
          const decision = decisions.get(fm.id);
          const isExpanded = expandedFM === fm.id;

          const parentFn = fnMap.get(fm.function_id);
          const consOpts = parseConsequenceCodes(decision?.consequence_code)
            .map(code => CONSEQUENCE_OPTIONS.find(c => c.code === code))
            .filter(Boolean);
          const stratOpt = decision?.recommended_strategy_code ? STRATEGY_LABELS[decision.recommended_strategy_code] : null;

          return (
            <div key={fm.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow">
              {/* Card Header */}
              <div
                className="px-5 py-4 cursor-pointer border-b border-slate-100 hover:bg-slate-50/50 transition-colors"
                onClick={() => setExpandedFM(isExpanded ? null : fm.id)}
              >
                <div className="flex items-center gap-3">
                  <span className="text-[9px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md shrink-0">
                    FM-{fmIdx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-800 truncate">
                      {fm.failure_mode_description || 'Unnamed failure mode'}
                    </p>
                    {parentFn && (
                      <p className="text-[10px] text-slate-400 mt-0.5 truncate">
                        {parentFn.function_number}: {parentFn.function_description}
                      </p>
                    )}
                  </div>

                  {/* Status badges */}
                  <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    {consOpts.length > 0 ? (
                      consOpts.map(consOpt => consOpt && (
                        <span key={consOpt.code} className="text-[9px] font-bold px-2 py-0.5 rounded-md border" style={{
                          background: `${consOpt.color}10`,
                          color: consOpt.color,
                          borderColor: `${consOpt.color}30`,
                        }}>
                          {consOpt.icon} {consOpt.label}
                        </span>
                      ))
                    ) : (
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-400 border border-slate-200">
                        Unresolved
                      </span>
                    )}
                    {stratOpt ? (
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded-md ${stratOpt.color}`}>
                        {stratOpt.icon} {stratOpt.label}
                      </span>
                    ) : null}
                  </div>

                  {/* AI button */}
                  <button
                    onClick={(e) => { e.stopPropagation(); onAIRecommend(fm); }}
                    disabled={aiLoading === `recommend-${fm.id}`}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-primary-50 border border-primary-200 rounded-lg text-[10px] font-bold text-primary-700 hover:bg-primary-100 transition-colors disabled:opacity-50 shrink-0"
                  >
                    {aiLoading === `recommend-${fm.id}` ? <RefreshCw size={11} className="animate-spin" /> : <Sparkles size={11} />}
                    AI
                  </button>

                  <div className="text-slate-400 shrink-0">
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>
                </div>
              </div>

              {/* Card Body — Strategy (Q6) + Task Details (Q7) */}
              {isExpanded && (
                <div className="rcm-accordion-body px-5 py-5 space-y-6">

                  {/* Consequence Summary — shows what was classified in Q5 (Functions tab) */}
                  {consOpts.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {consOpts.map(consOpt => consOpt && (
                        <div key={consOpt.code} className="flex items-start gap-2 p-2.5 border rounded-xl flex-1 min-w-[180px]" style={{
                          background: `${consOpt.color}08`,
                          borderColor: `${consOpt.color}25`,
                        }}>
                          <span className="text-lg leading-none mt-0.5">{consOpt.icon}</span>
                          <div className="flex-1 min-w-0">
                            <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: consOpt.color }}>
                              Q5
                            </span>
                            <p className="text-xs font-semibold text-slate-800 mt-0.5">{consOpt.label}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 p-3 bg-amber-50/60 border border-amber-200/50 rounded-xl">
                      <AlertTriangle size={14} className="text-amber-500 shrink-0" />
                      <span className="text-[10px] font-medium text-amber-700">
                        No consequence classified yet — go to <strong>Functions & Failures</strong> tab to complete Q5.
                      </span>
                    </div>
                  )}

                  {/* Step 2: Strategy Selection */}
                  <div className="space-y-3 border-t border-slate-100 pt-5">

                    {/* Failure-Finding hint for hidden failures */}
                    {decision?.is_hidden_failure && (
                      <div className="flex items-start gap-2 p-2.5 bg-primary-50/60 border border-primary-200/50 rounded-lg">
                        <ShieldAlert size={13} className="text-primary-500 mt-0.5 shrink-0" />
                        <p className="text-[10px] text-primary-700 leading-relaxed">
                          <strong>SAE JA1012:</strong> Hidden failures require a <strong>Failure-Finding</strong> task first. If no failure-finding task is applicable, consider Redesign.
                        </p>
                      </div>
                    )}

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {Object.entries(STRATEGY_LABELS).map(([code, s]) => {
                        const selected = decision?.recommended_strategy_code === code;
                        // RTF is not acceptable for Safety/Environmental consequences — evident OR hidden (SAE JA1012)
                        const isSafetyConsequence = hasSafetyConsequence(decision?.consequence_code);
                        const isRTFBlocked = code === 'RTF' && isSafetyConsequence;
                        // Highlight Failure-Finding for hidden failures
                        const isFFHighlighted = code === 'PM_CONDITION' && decision?.is_hidden_failure;
                        return (
                          <button
                            key={code}
                            onClick={() => !isRTFBlocked && onUpdateDecision(fm.id, { recommended_strategy_code: code })}
                            disabled={isRTFBlocked}
                            className={`relative flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-left transition-all ${
                              isRTFBlocked
                                ? 'border-red-200 bg-red-50/30 opacity-50 cursor-not-allowed'
                                : selected
                                  ? 'border-accent-cyan bg-accent-cyan/5 shadow-sm scale-[1.02]'
                                  : isFFHighlighted
                                    ? 'border-primary-300 bg-primary-50/50 hover:border-primary-400 ring-1 ring-primary-200'
                                    : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
                            }`}
                          >
                            <span className="text-base leading-none">{s.icon}</span>
                            <span className={`text-[10px] font-bold ${selected ? 'text-slate-800' : 'text-slate-600'}`}>
                              {s.label}
                            </span>
                            {selected && (
                              <CheckCircle2 size={12} className="absolute top-1.5 right-1.5 text-accent-cyan" />
                            )}
                            {isRTFBlocked && (
                              <span className="absolute -top-1.5 -right-1.5 text-[7px] font-bold bg-red-500 text-white px-1.5 py-0.5 rounded-full leading-none">N/A</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Step 3: Task Details */}
                  <div className="space-y-3 border-t border-slate-100 pt-5">

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Task Description</label>
                        <textarea
                          defaultValue={decision?.task_description || ''}
                          onChange={e => debouncedUpdate(fm.id, 'task_description', e.target.value)}
                          placeholder="Describe the maintenance task..."
                          rows={2}
                          className="w-full mt-1 px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:border-accent-cyan focus:outline-none resize-none"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Interval</label>
                        <input
                          type="text"
                          key={`${fm.id}-ev${evidenceApplied[fm.id] || 0}`}
                          defaultValue={decision?.task_interval || ''}
                          onChange={e => debouncedUpdate(fm.id, 'task_interval', e.target.value)}
                          placeholder="e.g. Every 3 months"
                          className="w-full mt-1 px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:border-accent-cyan focus:outline-none"
                        />
                        {lifeEvidence && decision?.task_interval !== `${lifeEvidence.interval.toLocaleString()} h` && (
                          <button
                            onClick={() => {
                              onUpdateDecision(fm.id, {
                                task_interval: `${lifeEvidence.interval.toLocaleString()} h`,
                                justification: decision?.justification
                                  ? decision.justification
                                  : `Interval from measured Weibull fit: β=${lifeEvidence.beta.toFixed(2)}, η=${Math.round(lifeEvidence.eta).toLocaleString()} h, B10=${lifeEvidence.b10.toLocaleString()} h ("${lifeEvidence.source}").`,
                              });
                              setEvidenceApplied(p => ({ ...p, [fm.id]: (p[fm.id] || 0) + 1 }));
                            }}
                            title={`Set interval from the measured fit — β=${lifeEvidence.beta.toFixed(2)}, η=${Math.round(lifeEvidence.eta).toLocaleString()} h`}
                            className="mt-1 text-[10px] font-bold text-primary-600 hover:text-primary-700 hover:underline"
                          >
                            Use measured: {lifeEvidence.interval.toLocaleString()} h
                          </button>
                        )}
                      </div>
                      <div>
                        <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Task Owner / Craft</label>
                        <input
                          type="text"
                          defaultValue={decision?.task_owner_craft || ''}
                          onChange={e => debouncedUpdate(fm.id, 'task_owner_craft', e.target.value)}
                          placeholder="e.g. Mechanical Technician"
                          className="w-full mt-1 px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:border-accent-cyan focus:outline-none"
                        />
                      </div>
                    </div>

                    {/* Justification */}
                    <div>
                      <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Justification</label>
                      <textarea
                        defaultValue={decision?.justification || ''}
                        onChange={e => debouncedUpdate(fm.id, 'justification', e.target.value)}
                        placeholder="Cost-benefit rationale for chosen strategy..."
                        rows={2}
                        className="w-full mt-1 px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:border-accent-cyan focus:outline-none resize-none"
                      />
                    </div>
                  </div>

                  {/* AI Recommendation */}
                  {decision?.ai_recommendation && (
                    <div className="bg-gradient-to-r from-primary-50 to-primary-50 border border-primary-200/60 rounded-xl p-4 animate-in fade-in duration-300">
                      <div className="flex items-center gap-2 text-xs font-bold text-primary-700">
                        <Sparkles size={14} />
                        AI Recommendation
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-primary-100 text-primary-600">
                          {((decision.ai_recommendation as any).confidence * 100).toFixed(0)}% confidence
                        </span>
                      </div>
                      <p className="text-[11px] text-primary-600 mt-2 line-clamp-3 leading-relaxed">
                        {(decision.ai_recommendation as any).reasoning}
                      </p>
                      <button
                        onClick={() => {
                          const rec = decision.ai_recommendation as any;
                          onUpdateDecision(fm.id, {
                            recommended_strategy_code: rec.strategy,
                            task_description: `AI: ${rec.reasoning?.substring(0, 200)}`,
                            task_interval: rec.suggested_interval || '',
                            justification: rec.reasoning,
                          });
                        }}
                        className="mt-3 flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 hover:bg-primary-500 text-white text-[10px] font-bold rounded-lg transition-colors"
                      >
                        <Check size={11} /> Accept Recommendation
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
};

export default RCMDecisionWizard;
