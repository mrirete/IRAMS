/**
 * RCMDecisionWizard — Guided SAE JA1012 decision logic (Q6–Q7), one failure
 * mode at a time. Strategy, task type, task, interval, craft, job plan,
 * spares, justification — and the PM the decision becomes. Consequence
 * classification (Q5) is handled on the Worksheet.
 *
 * Layout: a mode RAIL (the study's failure modes grouped under their
 * functions, one status dot each) beside ONE quiet card for the current
 * mode. The rail is the segmentation and the navigation — click a row, use
 * the arrow keys, or take "Next" at the foot of the card. There is no filter
 * bar and no jump list: the dots say where every mode stands.
 *
 * The card shows the three decisions and nothing else: which strategy, what
 * task and interval, then the PM. Job plan and spares fold away until wanted;
 * the justification lives in its pop-up.
 */
import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  GitBranch, Sparkles, RefreshCw, Lock, ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  Check, CheckCircle2, AlertTriangle, ShieldAlert, Clock, Activity,
  Zap, Wrench, ArrowRight, X, Maximize2, BookOpen,
} from 'lucide-react';
import type { RCMDecisionWizardProps, RCMFailureMode } from './types';
import { RCMModeRail, groupModesByFunction, modeTitle, type RailTone } from './RCMModeRail';
import { SyncedField, IntervalField } from './RCMFields';
import {
  CONSEQUENCE_OPTIONS, STRATEGY_LABELS, STRATEGY_TONES, strategyLabel, parseConsequenceCodes, hasSafetyConsequence,
} from './types';
import { canSpecialistRecommendStrategy } from '../../eam/services/rcmReadiness';
import {
  parseIntervalText, strategyProducesPM, isLegacyStrategyCode,
  taskTypesFor, TASK_TYPE_LABELS, normalizeRecommendation, looksLikeReasoning, canonicalStrategyCode,
  type AIRecommendation,
} from '../../eam/services/rcmPlan';
import type { SpareRequirement } from '../../eam/services/RCMService';
import type { BreakdownPart } from '../../lib/rcmBreakdown';

// ── Spares from the BOM ─────────────────────────────────────────────────────
const SparesPicker: React.FC<{
  spares: SpareRequirement[];
  parts: BreakdownPart[];
  /** the BOM line the failure mode itself is pinned to — offered first */
  pinnedPartId: string | null;
  onChange: (next: SpareRequirement[]) => void;
}> = ({ spares, parts, pinnedPartId, onChange }) => {
  const has = (p: BreakdownPart) => spares.some(s => (p.partNumber && s.part_number === p.partNumber) || (!p.partNumber && s.description === p.description));
  const toReq = (p: BreakdownPart): SpareRequirement => ({ part_number: p.partNumber || '', description: p.description, qty: p.qty || 1 });
  const pinned = pinnedPartId ? parts.find(p => p.id === pinnedPartId) : null;
  const add = (p: BreakdownPart) => { if (!has(p)) onChange([...spares, toReq(p)]); };
  const remove = (i: number) => onChange(spares.filter((_, j) => j !== i));
  const setQty = (i: number, qty: number) => onChange(spares.map((s, j) => (j === i ? { ...s, qty } : s)));
  return (
    <div>
      <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Spares</label>
      <div className="mt-1 space-y-1">
        {spares.map((s, i) => (
          <div key={`${s.part_number}|${s.description}|${i}`} className="flex items-center gap-2 text-xs">
            <span className="flex-1 min-w-0 truncate text-slate-700">{s.part_number ? <span className="font-mono text-slate-500">{s.part_number} · </span> : null}{s.description}</span>
            <span className="text-slate-400">×</span>
            <input type="number" min={1} value={s.qty || 1} onChange={e => setQty(i, Math.max(1, Number(e.target.value) || 1))} className="w-14 text-xs border border-slate-200 rounded px-1.5 py-0.5 tabular-nums" />
            <button type="button" onClick={() => remove(i)} className="text-slate-300 hover:text-red-500" title="Remove"><X size={12} /></button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {pinned && !has(pinned) && (
            <button type="button" onClick={() => add(pinned)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary-700 bg-primary-50 border border-primary-200 rounded-full px-2.5 py-0.5 hover:bg-primary-100" title="The BOM line this failure mode is pinned to">
              + {pinned.partNumber || pinned.description}
            </button>
          )}
          {parts.length > 0 && (
            <select
              value=""
              onChange={e => { const p = parts.find(x => x.id === e.target.value); if (p) add(p); }}
              className="text-[11px] border border-dashed border-slate-300 rounded-full px-2 py-0.5 bg-white text-slate-500"
            >
              <option value="">Add from BOM…</option>
              {parts.map(p => (
                <option key={p.id} value={p.id} disabled={has(p)}>{p.partNumber ? `${p.partNumber} — ` : ''}{p.description}{p.critical ? ' ★' : ''}</option>
              ))}
            </select>
          )}
        </div>
      </div>
    </div>
  );
};

const STRATEGY_ICONS: Record<string, React.ReactNode> = {
  PM_CONDITION: <Activity size={13} />,
  PM_TIME: <Clock size={13} />,
  RTF: <Zap size={13} />,
  REDESIGN: <Wrench size={13} />,
};

// ── Justification pop-up ────────────────────────────────────
// Rendered through a portal so it sits above the mobile bottom nav (z-50)
// and every page overlay. The field itself is a large textarea: the
// justification is written to be read, so give it a page, not a slot.
const JustificationModal: React.FC<{
  open: boolean;
  title: string;
  value: string | null | undefined;
  onCommit: (v: string) => void;
  onClose: () => void;
  disabled?: boolean;
}> = ({ open, title, value, onCommit, onClose, disabled }) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label="Justification">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative w-full sm:max-w-2xl bg-white sm:rounded-2xl rounded-t-2xl shadow-2xl border border-slate-200 flex flex-col max-h-[92vh]">
        <div className="flex items-start gap-3 px-5 py-4 border-b border-slate-100">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Justification</p>
            <p className="text-sm font-bold text-slate-800 truncate">{title}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100" aria-label="Close"><X size={16} /></button>
        </div>
        <div className="px-5 py-4 overflow-y-auto">
          <SyncedField
            label="Justification"
            value={value}
            onCommit={onCommit}
            disabled={disabled}
            autoFocus
            minRows={10}
            maxRows={40}
            className="!mt-0 text-[15px]"
            placeholder="Why this task type and interval — failure pattern, P-F interval, consequence, cost-benefit."
          />
        </div>
        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between gap-3">
          <span className="text-[11px] text-slate-400">Saves as you type.</span>
          <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-bold rounded-lg bg-primary-600 text-white hover:bg-primary-500">Done</button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

// ── Where a mode stands in the Q5→Q7 flow ───────────────────
type Stage = 'needs_q5' | 'needs_strategy' | 'done';
const STAGE_TONE: Record<Stage, RailTone> = { done: 'emerald', needs_strategy: 'slate', needs_q5: 'amber' };
const STAGE_TITLE: Record<Stage, string> = {
  done: 'Decided',
  needs_strategy: 'Strategy still to choose',
  needs_q5: 'Consequence not classified on the Worksheet',
};

// ── Main Component ──────────────────────────────────────────
export const RCMDecisionWizard: React.FC<RCMDecisionWizardProps> = ({
  study, failureModes, functions, decisions, aiLoading, lifeEvidence, breakdown, libraryTasks, locked, initialFailureModeId,
  onUpdateDecision, onAIRecommend, onAcceptRecommendation, onDismissRecommendation, onGoToPlan,
}) => {
  const stageOf = (fmId: string): Stage => {
    const d = decisions.get(fmId);
    if (!d?.consequence_code) return 'needs_q5';
    if (!d.recommended_strategy_code) return 'needs_strategy';
    return 'done';
  };

  // The rail's order is the walking order: functions in worksheet order, their modes under them.
  const groups = useMemo(() => groupModesByFunction(functions, failureModes), [functions, failureModes]);
  const ordered = useMemo(() => groups.flatMap(g => g.modes), [groups]);
  const fmNumber = (m: RCMFailureMode) => failureModes.indexOf(m) + 1;
  const decidedCount = ordered.filter(m => stageOf(m.id) === 'done').length;

  // One mode per page.
  const [currentId, setCurrentId] = useState<string | null>(initialFailureModeId ?? ordered[0]?.id ?? null);
  useEffect(() => { if (initialFailureModeId) setCurrentId(initialFailureModeId); }, [initialFailureModeId]);
  const index = Math.max(0, ordered.findIndex(m => m.id === currentId));
  const fm = ordered[index] ?? null;
  useEffect(() => {
    if (!fm && ordered.length > 0) setCurrentId(ordered[0].id);
  }, [fm, ordered]);
  const goTo = (i: number) => { const t = ordered[Math.min(Math.max(0, i), ordered.length - 1)]; if (t) setCurrentId(t.id); };
  const next = ordered[index + 1] ?? null;
  const prev = ordered[index - 1] ?? null;

  const [justOpen, setJustOpen] = useState(false);
  // Job plan + spares fold away; a mode with either already set opens them.
  const [detailsOverride, setDetailsOverride] = useState<Record<string, boolean>>({});
  const fnMap = useMemo(() => new Map(functions.map(f => [f.id, f])), [functions]);

  if (failureModes.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center shadow-sm">
        <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-primary-50 flex items-center justify-center">
          <GitBranch size={28} className="text-primary-300" />
        </div>
        <p className="text-sm font-semibold text-slate-500">No failure modes to evaluate</p>
        <p className="text-xs text-slate-400 mt-1">Fill the Worksheet (step 1) first — each failure mode found there gets its strategy decided here.</p>
      </div>
    );
  }

  const decision = fm ? decisions.get(fm.id) : undefined;
  const parentFn = fm ? fnMap.get(fm.function_id) : undefined;
  const consOpts = parseConsequenceCodes(decision?.consequence_code)
    .map(code => CONSEQUENCE_OPTIONS.find(c => c.code === code))
    .filter(Boolean);
  // Old rows may still say PM_PREDICTIVE — shown and saved as Condition-Based (0325).
  const stratCode = canonicalStrategyCode(decision?.recommended_strategy_code);
  const legacyStrategy = isLegacyStrategyCode(stratCode);
  // Normalised: old rows carry prose-only shapes and the retired "Combined" code.
  const rec: AIRecommendation | null = normalizeRecommendation(decision?.ai_recommendation);
  const recPending = !!rec && !rec.accepted_at;
  const linkedPM = decision?.recurring_work_id || null;
  const taskTypes = taskTypesFor(stratCode, !!decision?.is_hidden_failure);
  const producesPM = !!stratCode && strategyProducesPM(stratCode);
  const showJobPlan = producesPM && (libraryTasks?.length ?? 0) > 0;
  const showSpares = producesPM && ((breakdown?.parts.length ?? 0) > 0 || (decision?.spares_requirements?.length ?? 0) > 0);
  const detailsHaveContent = !!decision?.task_library_item_id || (decision?.spares_requirements?.length ?? 0) > 0;
  const detailsOpen = fm ? (detailsOverride[fm.id] ?? detailsHaveContent) : false;
  const justification = decision?.justification || '';
  const hasJustification = justification.replace(/\*\*/g, '').trim().length > 0;
  // Duty the measured life data was collected under (0317 snapshot): a β/η
  // fitted at 76 % of rated flow does not transfer to a pump run at 100 %.
  const dutyNote = (() => {
    const c = study.context_snapshot?.context;
    if (!c) return null;
    const bits: string[] = [];
    if (c.mode) bits.push(`${c.mode} duty`);
    if (c.utilisation_pct != null) bits.push(`${c.utilisation_pct}% utilisation`);
    const keyed = (c.parameters || []).filter(p => p.design != null && p.operating != null && Number(p.design) > 0 && Number.isFinite(Number(p.operating)));
    const lead = keyed.find(p => ['flow', 'load', 'power', 'rated_power', 'capacity', 'current'].includes(p.key)) || keyed[0];
    if (lead) bits.push(`${lead.label.toLowerCase()} at ${Math.round((Number(lead.operating) / Number(lead.design)) * 100)}% of design`);
    return bits.length ? `Measured under: ${bits.join(', ')} — re-fit if the duty changes.` : null;
  })();

  return (
    <div className="space-y-3 animate-in fade-in duration-300">

      {/* Measured life data — the Modelling lab's latest Weibull fit for this asset */}
      {lifeEvidence && (
        <div className="bg-white border border-primary-200 rounded-xl px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 shadow-sm">
          <span className="text-[10px] font-bold text-primary-700 uppercase tracking-wider">Measured life data</span>
          <span className="text-xs text-slate-600">
            β = <strong>{lifeEvidence.beta.toFixed(2)}</strong>
            {lifeEvidence.beta > 1 ? ' (wear-out)' : lifeEvidence.beta < 1 ? ' (infant mortality)' : ' (random)'}
            {' · '}η = <strong>{Math.round(lifeEvidence.eta).toLocaleString()} h</strong>
            {' · '}B10 = <strong>{lifeEvidence.b10.toLocaleString()} h</strong>
          </span>
          <span className="text-xs text-emerald-700 font-semibold">Suggested interval ≈ {lifeEvidence.interval.toLocaleString()} h</span>
          {dutyNote && <span className="text-[11px] text-slate-500 basis-full">{dutyNote}</span>}
        </div>
      )}

      {locked && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800">
          <Lock size={13} className="shrink-0" />
          This study is approved (rev {study.revision ?? 1}) and frozen. Creating the PMs it calls for is allowed; to change a decision choose <strong className="mx-1">Revise</strong> on the study header.
        </div>
      )}

      <div className="flex flex-col lg:flex-row lg:items-start gap-3">

        <RCMModeRail
          groups={groups}
          fmNumber={fmNumber}
          currentId={fm?.id ?? null}
          onSelect={setCurrentId}
          statusOf={m => ({ tone: STAGE_TONE[stageOf(m.id)], title: STAGE_TITLE[stageOf(m.id)] })}
          headerRight={`${decidedCount}/${ordered.length}`}
          headerRightTitle={`${decidedCount} of ${ordered.length} decided`}
        />

        {/* ═══ The one card ═══ */}
        {!fm ? (
          <div className="flex-1 bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-400">
            Pick a failure mode.
          </div>
        ) : (
          <div className="flex-1 min-w-0 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            {/* Header — which mode, which function, its consequence */}
            <div className="px-4 sm:px-5 py-4 border-b border-slate-100">
              <div className="flex items-start gap-3">
                <span className="text-[9px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md shrink-0 mt-0.5">
                  FM-{fmNumber(fm)}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-800">{modeTitle(fm)}</p>
                  {parentFn && (
                    <p className="text-[11px] text-slate-400 mt-0.5 truncate" title={`${parentFn.function_number}: ${parentFn.function_description}`}>{parentFn.function_number}: {parentFn.function_description}</p>
                  )}
                  <div className="flex items-center gap-1.5 flex-wrap mt-2">
                    {consOpts.map(consOpt => consOpt && (
                      <span key={consOpt.code} className="text-[10px] font-bold px-2 py-0.5 rounded-md border" style={{ background: `${consOpt.color}10`, color: consOpt.color, borderColor: `${consOpt.color}30` }}>
                        {consOpt.icon} {consOpt.label}
                      </span>
                    ))}
                    {decision?.is_hidden_failure && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-primary-50 text-primary-700 border border-primary-200"><ShieldAlert size={10} /> Hidden</span>
                    )}
                  </div>
                </div>
                {(() => {
                  const recGate = canSpecialistRecommendStrategy(fm, decision);
                  const recBusy = aiLoading === `recommend-${fm.id}`;
                  return (
                    <button
                      type="button"
                      onClick={() => onAIRecommend(fm)}
                      aria-disabled={recBusy || locked}
                      title={locked ? 'Study is approved — Revise to change decisions' : recGate.reason}
                      className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-colors shrink-0 border ${
                        recGate.ok && !locked
                          ? 'bg-primary-50 border-primary-200 text-primary-700 hover:bg-primary-100'
                          : 'bg-slate-100 border-slate-200 text-slate-500 hover:bg-slate-200'
                      }`}
                    >
                      {recBusy ? <RefreshCw size={11} className="animate-spin" /> : recGate.ok && !locked ? <Sparkles size={11} /> : <Lock size={11} />}
                      Specialist
                    </button>
                  );
                })()}
              </div>
            </div>

            <div className="px-4 sm:px-5 py-4 space-y-4">
              {consOpts.length === 0 && (
                <div className="flex items-center gap-2 p-3 bg-amber-50/60 border border-amber-200/50 rounded-xl">
                  <AlertTriangle size={14} className="text-amber-500 shrink-0" />
                  <span className="text-[11px] font-medium text-amber-700">
                    Classify the consequence (Q5) on the <strong>Worksheet</strong> first — the strategy branches on it.
                  </span>
                </div>
              )}

              {/* Accept recommendation — the only trace of the Specialist's draft */}
              {recPending && (
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => onAcceptRecommendation(fm)}
                    disabled={locked}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold rounded-lg bg-primary-600 hover:bg-primary-500 text-white disabled:opacity-50"
                    title={`Writes the Specialist's strategy, task, interval and justification into the fields below${rec?.confidence ? ` (${Math.round(rec.confidence * 100)}% confidence)` : ''}`}
                  >
                    <Sparkles size={12} /> Accept recommendation
                    {rec?.confidence ? <span className="opacity-80 font-medium">· {Math.round(rec.confidence * 100)}%</span> : null}
                  </button>
                  {rec?.strategy && strategyLabel(rec.strategy) && (
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${strategyLabel(rec.strategy)!.color}`}>{strategyLabel(rec.strategy)!.label}</span>
                  )}
                  <button type="button" onClick={() => onDismissRecommendation(fm)} className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100" title="Dismiss the recommendation" aria-label="Dismiss recommendation"><X size={12} /></button>
                </div>
              )}

              {/* 1 · Strategy (Q6–Q7) — the pills carry their own hints */}
              <div className="space-y-2">
                {decision?.is_hidden_failure && (
                  <p className="text-[11px] text-primary-700 leading-relaxed">
                    <strong>SAE JA1012:</strong> hidden failures take a <strong>failure-finding</strong> task first (Condition-Based → Failure-finding). If none is applicable, consider Redesign.
                  </p>
                )}
                {legacyStrategy && (
                  <p className="text-[11px] text-amber-700"><strong>"Combined" is retired.</strong> Pick the one strategy that controls the dominant failure mechanism — the PM can only schedule one task type.</p>
                )}
                <div className="flex flex-wrap gap-2">
                  {Object.entries(STRATEGY_LABELS).map(([code, s]) => {
                    const selected = stratCode === code;
                    const tone = STRATEGY_TONES[code];
                    const isRTFBlocked = code === 'RTF' && hasSafetyConsequence(decision?.consequence_code);
                    const isFFHighlighted = code === 'PM_CONDITION' && decision?.is_hidden_failure && !selected;
                    return (
                      <button
                        key={code}
                        type="button"
                        onClick={() => !isRTFBlocked && !locked && onUpdateDecision(fm.id, { recommended_strategy_code: code, task_type_code: taskTypesFor(code, !!decision?.is_hidden_failure)[0] ?? null })}
                        disabled={isRTFBlocked || locked}
                        title={isRTFBlocked ? 'Run-to-Failure is not acceptable for safety or environmental consequences (SAE JA1012)' : s.hint}
                        aria-pressed={selected}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11px] font-bold transition-all ${
                          isRTFBlocked
                            ? 'border-slate-200 bg-slate-50 text-slate-400 line-through cursor-not-allowed'
                            : selected
                              ? `${tone.selected} shadow-sm`
                              : `bg-white ${tone.idle} ${isFFHighlighted ? 'ring-2 ring-offset-1 ring-cyan-300' : ''} ${locked ? 'opacity-60' : ''}`
                        }`}
                      >
                        {selected ? <Check size={12} /> : STRATEGY_ICONS[code]}
                        {s.label}
                      </button>
                    );
                  })}
                </div>
                {/* JA1012 task type — only when the strategy leaves a choice */}
                {taskTypes.length > 1 && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {taskTypes.map(tt => {
                      const sel = (decision?.task_type_code || taskTypes[0]) === tt;
                      return (
                        <button
                          key={tt}
                          type="button"
                          disabled={locked}
                          onClick={() => onUpdateDecision(fm.id, { task_type_code: tt })}
                          title={TASK_TYPE_LABELS[tt].hint}
                          aria-pressed={sel}
                          className={`px-2.5 py-1 rounded-md border text-[11px] font-semibold ${sel ? 'bg-slate-800 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'}`}
                        >
                          {TASK_TYPE_LABELS[tt].label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 2 · The task — what, how often, who */}
              {stratCode && (
                <div className="space-y-3 border-t border-slate-100 pt-4">
                  <div>
                    <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Task</label>
                    <SyncedField
                      label="Task description"
                      value={decision?.task_description}
                      disabled={locked}
                      onCommit={v => onUpdateDecision(fm.id, { task_description: v || null })}
                      placeholder="One instruction for the technician — e.g. Replace ignitor plug and verify spark gap 2.0 mm"
                      minRows={2}
                      maxRows={4}
                    />
                    {/* An older draft wrote the JA1012 argument here. One click files it where it belongs. */}
                    {!locked && looksLikeReasoning(decision?.task_description) && (
                      <button
                        type="button"
                        onClick={() => onUpdateDecision(fm.id, {
                          task_description: null,
                          justification: decision?.justification?.trim() ? decision.justification : (decision?.task_description || null),
                        })}
                        className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 hover:underline"
                        title="This reads as reasoning, not a task. Move it to the justification and leave the task line for the instruction."
                      >
                        <AlertTriangle size={11} /> This is reasoning — move it to Justification
                      </button>
                    )}
                  </div>

                  {producesPM && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Interval</label>
                        <IntervalField
                          value={decision?.task_interval}
                          disabled={locked}
                          onCommit={v => onUpdateDecision(fm.id, { task_interval: v })}
                        />
                        {lifeEvidence && !locked && parseIntervalText(decision?.task_interval).n !== lifeEvidence.interval && (
                          <button
                            type="button"
                            onClick={() => {
                              onUpdateDecision(fm.id, {
                                task_interval: `${lifeEvidence.interval} Hours`,
                                justification: decision?.justification
                                  ? decision.justification
                                  : `Interval from measured Weibull fit: β=${lifeEvidence.beta.toFixed(2)}, η=${Math.round(lifeEvidence.eta).toLocaleString()} h, B10=${lifeEvidence.b10.toLocaleString()} h ("${lifeEvidence.source}").`,
                              });
                            }}
                            title={`Set interval from the measured fit — β=${lifeEvidence.beta.toFixed(2)}, η=${Math.round(lifeEvidence.eta).toLocaleString()} h`}
                            className="mt-1 text-[11px] font-bold text-primary-600 hover:text-primary-700 hover:underline"
                          >
                            Use measured: {lifeEvidence.interval.toLocaleString()} h
                          </button>
                        )}
                      </div>
                      <div>
                        <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Craft</label>
                        <SyncedField
                          label="Task owner / craft"
                          value={decision?.task_owner_craft}
                          disabled={locked}
                          onCommit={v => onUpdateDecision(fm.id, { task_owner_craft: v || null })}
                          placeholder="e.g. Mechanical Technician"
                        />
                      </div>
                    </div>
                  )}

                  {/* Doors to the rest: justification pop-up, folded job plan + spares */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setJustOpen(true)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-colors ${
                        hasJustification ? 'bg-white border-slate-200 text-slate-700 hover:border-slate-300' : 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
                      }`}
                      title={hasJustification ? 'Open the justification' : 'No justification written yet'}
                    >
                      <Maximize2 size={12} /> {hasJustification ? 'Justification' : 'Write justification'}
                    </button>
                    {(showJobPlan || showSpares) && (
                      <button
                        type="button"
                        onClick={() => setDetailsOverride(prev => ({ ...prev, [fm.id]: !detailsOpen }))}
                        aria-expanded={detailsOpen}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-colors ${
                          detailsHaveContent ? 'bg-white border-slate-200 text-slate-700 hover:border-slate-300' : 'bg-white border-dashed border-slate-300 text-slate-500 hover:border-slate-400'
                        }`}
                        title="Job plan from the Task Library and the spares the task consumes — both travel into the PM"
                      >
                        <BookOpen size={12} /> {showJobPlan && showSpares ? 'Job plan & spares' : showJobPlan ? 'Job plan' : 'Spares'}
                        {detailsOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>
                    )}
                  </div>

                  {detailsOpen && (showJobPlan || showSpares) && (
                    <div className="space-y-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                      {showJobPlan && (
                        <div>
                          <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Job plan</label>
                          <select
                            aria-label="Job plan"
                            disabled={locked}
                            value={decision?.task_library_item_id || ''}
                            onChange={e => onUpdateDecision(fm.id, { task_library_item_id: e.target.value || null })}
                            className="w-full mt-1 text-sm bg-white border border-slate-200 rounded-lg px-2 py-2 focus:border-accent-cyan focus:outline-none disabled:bg-slate-50"
                          >
                            <option value="">None — the PM carries only the task line</option>
                            {libraryTasks!.map(t => (
                              <option key={t.id} value={t.id}>{t.code} — {t.title}{t.estimatedDuration ? ` (${t.estimatedDuration} h)` : ''}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      {showSpares && (
                        <SparesPicker
                          spares={decision?.spares_requirements || []}
                          parts={breakdown?.parts || []}
                          pinnedPartId={fm.bom_item_id || null}
                          onChange={next => { if (!locked) onUpdateDecision(fm.id, { spares_requirements: next }); }}
                        />
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 3 · Implementation lives on the Maintenance Plan — one door to it, and the way to the next mode */}
              <div className="border-t border-slate-100 pt-4 flex items-center gap-2 flex-wrap">
                {stratCode && (
                  <button
                    type="button"
                    onClick={() => onGoToPlan(fm)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-colors ${
                      linkedPM ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100' : 'bg-accent-cyan/10 border-accent-cyan/40 text-slate-800 hover:bg-accent-cyan/20'
                    }`}
                    title={linkedPM ? `Implemented as PM ${linkedPM} — open the Maintenance Plan for this mode` : 'Make this decision real on the Maintenance Plan: PM, monitoring point, sensor or work order'}
                  >
                    {linkedPM ? <CheckCircle2 size={12} /> : <Wrench size={12} />}
                    {linkedPM ? `PM ${linkedPM}` : 'Implement on the Plan'} <ArrowRight size={12} />
                  </button>
                )}
                <div className="ml-auto flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => goTo(index - 1)}
                    disabled={!prev}
                    aria-label="Previous failure mode"
                    title={prev ? `FM-${fmNumber(prev)} · ${modeTitle(prev)}` : undefined}
                    className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => goTo(index + 1)}
                    disabled={!next}
                    title={next ? modeTitle(next) : 'Last failure mode'}
                    className="inline-flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-lg border text-[11px] font-bold bg-white border-slate-200 text-slate-700 hover:border-slate-300 disabled:opacity-40 max-w-[52vw] sm:max-w-xs"
                  >
                    {next ? (
                      <>
                        <span className="shrink-0">Next</span>
                        <span className="text-slate-400 font-medium truncate">FM-{fmNumber(next)} · {modeTitle(next)}</span>
                      </>
                    ) : <span>Last mode</span>}
                    <ChevronRight size={14} className="shrink-0" />
                  </button>
                </div>
              </div>
            </div>

            <JustificationModal
              open={justOpen}
              title={modeTitle(fm)}
              value={decision?.justification}
              disabled={locked}
              onCommit={v => onUpdateDecision(fm.id, { justification: v || null })}
              onClose={() => setJustOpen(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default RCMDecisionWizard;
