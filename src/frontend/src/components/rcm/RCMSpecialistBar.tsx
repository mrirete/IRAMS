/**
 * RCMSpecialistBar — the Reliability Specialist as a role, not a button
 * ════════════════════════════════════════════════════════════════════
 * Sits above the FMEA worksheet. Shows what the Specialist has to work with,
 * what it still needs, and the two things it can do: draft the worksheet, and
 * finish the rows the team has started.
 *
 * Every action is gated by eam/services/rcmReadiness.ts. A locked action stays
 * clickable — clicking explains what to fill instead of burning an AI call.
 */
import React from 'react';
import { Sparkles, Lock, RefreshCw, Check, BrainCircuit, Wand2 } from 'lucide-react';
import type { RCMReadinessResult, ActionGate } from '../../eam/services/rcmReadiness';

interface Props {
  readiness: RCMReadinessResult;
  draftGate: ActionGate;
  /** Rows that are named but unfinished — what "finish the study" would cost. */
  completableCount: number;
  /** Rows already fully filled, for the progress line. */
  completeCount: number;
  totalRows: number;
  aiLoading: string | null;
  onDraft: () => void;
  onFillGaps: () => void;
  onBlocked: (reason: string) => void;
}

const ScoreRing: React.FC<{ score: number; ready: boolean }> = ({ score, ready }) => {
  const ring = ready ? '#10b981' : score >= 50 ? '#f59e0b' : '#ef4444';
  return (
    <div className="relative w-11 h-11 shrink-0" title={`Specialist has ${score}% of the data it needs`}>
      <div className="w-11 h-11 rounded-full" style={{ background: `conic-gradient(${ring} ${score * 3.6}deg, #e2e8f0 0deg)` }} />
      <div className="absolute inset-[3px] rounded-full bg-white flex items-center justify-center text-[11px] font-extrabold text-slate-700">
        {score}
      </div>
    </div>
  );
};

export const RCMSpecialistBar: React.FC<Props> = ({
  readiness, draftGate, completableCount, completeCount, totalRows,
  aiLoading, onDraft, onFillGaps, onBlocked,
}) => {
  const drafting = aiLoading === 'suggest';
  const filling = aiLoading === 'fill-gaps';
  const busy = drafting || filling;
  const locked = !draftGate.ok;

  const headline = locked
    ? 'I need a bit more before I can help with this study.'
    : totalRows === 0
      ? "Ready. I'll draft the functions, failure modes and effects for this asset."
      : completableCount > 0
        ? `${completeCount} of ${totalRows} rows complete — I can finish ${completableCount}.`
        : `All ${totalRows} rows complete. Move on to Decision Logic (Q6–Q7).`;

  return (
    <div className={`rounded-xl border p-3 md:p-4 transition-colors ${
      locked ? 'bg-amber-50/50 border-amber-200' : 'bg-gradient-to-r from-primary-50/70 via-white to-white border-primary-200'
    }`}>
      <div className="flex items-start gap-3 flex-wrap md:flex-nowrap">
        <ScoreRing score={readiness.score} ready={readiness.requiredMet} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <BrainCircuit size={15} className={locked ? 'text-amber-500' : 'text-primary-600'} />
            <span className="text-sm font-bold text-slate-800">Reliability Specialist</span>
            <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${
              locked ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
            }`}>
              {locked ? 'Needs data' : 'On duty'}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">{headline}</p>

          {/* Data chips — what it has, what it still needs */}
          <div className="flex items-center gap-1.5 flex-wrap mt-2">
            {readiness.items.map(it => (
              <span
                key={it.id}
                title={it.hint}
                className={`text-[10px] font-semibold px-2 py-1 rounded-full border flex items-center gap-1 cursor-help ${
                  it.met
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : it.severity === 'required'
                      ? 'bg-white text-amber-700 border-amber-300'
                      : 'bg-white text-slate-400 border-slate-200'
                }`}
              >
                {it.met ? <Check size={10} /> : <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />}
                {it.label}
                {!it.met && it.severity === 'recommended' && <span className="opacity-60 font-normal">· optional</span>}
              </span>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap md:ml-auto shrink-0">
          {completableCount > 0 && (
            <button
              onClick={() => (locked ? onBlocked(draftGate.reason) : onFillGaps())}
              // A locked action stays operable on purpose — it explains itself.
              // Only a call already in flight is genuinely un-actionable.
              aria-disabled={busy}
              title={locked ? draftGate.reason : `Complete ${completableCount} started row${completableCount !== 1 ? 's' : ''} — cause, effects, severity and consequence`}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border transition-all ${
                locked
                  ? 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'
                  : 'bg-white text-primary-700 border-primary-200 hover:bg-primary-50 shadow-sm'
              }`}
            >
              {filling ? <RefreshCw size={13} className="animate-spin" /> : locked ? <Lock size={13} /> : <Wand2 size={13} />}
              Finish {completableCount} row{completableCount !== 1 ? 's' : ''}
            </button>
          )}
          <button
            onClick={() => (locked ? onBlocked(draftGate.reason) : onDraft())}
            aria-disabled={busy}
            title={draftGate.reason}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              locked
                ? 'bg-slate-100 text-slate-500 border border-slate-200 hover:bg-slate-200'
                : 'bg-gradient-to-r from-primary-500 to-primary-600 text-white hover:from-primary-600 hover:to-primary-700 shadow-md shadow-primary-500/25'
            }`}
          >
            {drafting ? <RefreshCw size={13} className="animate-spin" /> : locked ? <Lock size={13} /> : <Sparkles size={13} />}
            {totalRows === 0 ? 'Draft the worksheet' : 'Draft more functions'}
          </button>
        </div>
      </div>

      {/* Blocked explanation — teach rather than grey out silently */}
      {locked && (
        <p className="text-[11px] text-amber-800 bg-amber-100/60 border border-amber-200/70 rounded-lg px-2.5 py-1.5 mt-2.5">
          {draftGate.reason} <span className="text-amber-700/80">Open <strong>Edit study</strong> to add them.</span>
        </p>
      )}
    </div>
  );
};

export default RCMSpecialistBar;
