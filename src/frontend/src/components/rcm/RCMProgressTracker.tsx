/**
 * RCMProgressTracker — Q1–Q7 horizontal stepper
 * Shows study completion based on actual data presence.
 */
import React, { useMemo } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { RCM_STEPS } from './types';
import type { RCMProgressTrackerProps } from './types';

export const RCMProgressTracker: React.FC<RCMProgressTrackerProps> = ({
  functions, failureModes, decisions, activeTab, onNavigate,
}) => {
  const stepStates = useMemo(() => {
    const hasDecisions = Array.from(decisions.values());
    return RCM_STEPS.map((q) => {
      let done = false;
      switch (q.number) {
        case 1: done = functions.length > 0; break;
        case 2: done = functions.some(f => !!f.functional_failure); break;
        case 3: done = failureModes.length > 0; break;
        case 4: done = failureModes.some(fm => !!fm.end_effect || !!fm.failure_effect_local); break;
        case 5: done = hasDecisions.some(d => !!d.consequence_code); break;
        case 6: done = hasDecisions.some(d => !!d.recommended_strategy_code); break;
        case 7: done = hasDecisions.some(d => !!d.recommended_strategy_code); break;
      }
      return { ...q, done };
    });
  }, [functions, failureModes, decisions]);

  // Active step = first incomplete, or the one matching the current tab
  const activeStepIdx = useMemo(() => {
    const tabIdx = stepStates.findIndex(s => s.tab === activeTab);
    if (tabIdx >= 0) return tabIdx;
    const firstIncomplete = stepStates.findIndex(s => !s.done);
    return firstIncomplete >= 0 ? firstIncomplete : stepStates.length - 1;
  }, [stepStates, activeTab]);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      {/* Desktop: full stepper */}
      <div className="hidden sm:block">
        <div className="rcm-progress-bar">
          {stepStates.map((step, i) => {
            const state = step.done ? 'done' : i === activeStepIdx ? 'active' : 'pending';
            return (
              <div
                key={step.id}
                className={`rcm-progress-step ${state === 'done' ? 'rcm-step--done' : ''} ${state === 'active' ? 'rcm-step--active' : ''}`}
                onClick={() => onNavigate(step.tab)}
                title={step.question}
              >
                <div className={`rcm-progress-circle rcm-progress-circle--${state}`}>
                  {state === 'done' ? <CheckCircle2 size={14} /> : step.number}
                </div>
                <span className="rcm-progress-label">{step.shortLabel}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile: compact current step */}
      <div className="sm:hidden flex items-center justify-between">
        <button
          onClick={() => {
            const prev = Math.max(0, activeStepIdx - 1);
            onNavigate(stepStates[prev].tab);
          }}
          className="p-1.5 text-slate-400 hover:text-accent-cyan"
          disabled={activeStepIdx === 0}
        >
          ‹
        </button>
        <div className="text-center">
          <div className={`mx-auto w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
            stepStates[activeStepIdx].done
              ? 'bg-emerald-500 text-white'
              : 'bg-accent-cyan text-brand-900'
          }`}>
            {stepStates[activeStepIdx].done ? <CheckCircle2 size={14} /> : stepStates[activeStepIdx].number}
          </div>
          <p className="text-[10px] font-bold text-slate-500 mt-1">{stepStates[activeStepIdx].shortLabel}</p>
          <p className="text-[9px] text-slate-400 mt-0.5 max-w-[200px] mx-auto">{stepStates[activeStepIdx].question}</p>
        </div>
        <button
          onClick={() => {
            const next = Math.min(stepStates.length - 1, activeStepIdx + 1);
            onNavigate(stepStates[next].tab);
          }}
          className="p-1.5 text-slate-400 hover:text-accent-cyan"
          disabled={activeStepIdx === stepStates.length - 1}
        >
          ›
        </button>
      </div>
    </div>
  );
};

export default RCMProgressTracker;
