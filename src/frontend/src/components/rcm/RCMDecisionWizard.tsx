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
import React, { useState, useMemo, useEffect, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import {
  GitBranch, Sparkles, RefreshCw, Lock, ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  Check, CheckCircle2, AlertTriangle, ShieldAlert, Clock, Activity, BrainCircuit,
  Zap, Wrench, ArrowUpRight, X, Maximize2, Radio, BookOpen,
} from 'lucide-react';
import type { RCMDecisionWizardProps, RCMFailureMode, RCMFunction } from './types';
import {
  CONSEQUENCE_OPTIONS, STRATEGY_LABELS, STRATEGY_TONES, strategyLabel, parseConsequenceCodes, hasSafetyConsequence,
} from './types';
import { canSpecialistRecommendStrategy } from '../../eam/services/rcmReadiness';
import {
  INTERVAL_UNITS, parseIntervalText, canonicalInterval, strategyProducesPM, isLegacyStrategyCode,
  taskTypesFor, TASK_TYPE_LABELS, UUID_RE, normalizeRecommendation, looksLikeReasoning,
  type IntervalUnit, type AIRecommendation,
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
  PM_TIME: <Clock size={13} />,
  PM_CONDITION: <Activity size={13} />,
  PM_PREDICTIVE: <BrainCircuit size={13} />,
  RTF: <Zap size={13} />,
  REDESIGN: <Wrench size={13} />,
};

// ── Synced task field ───────────────────────────────────────
// Local state so the caret never jumps, debounced commit, and a re-sync when
// the stored value changes underneath while the field isn't focused — which is
// exactly what happens when the Specialist's recommendation (or "Use measured")
// writes task_description/interval/justification.
const SyncedField: React.FC<{
  value: string | null | undefined;
  onCommit: (v: string) => void;
  placeholder?: string;
  minRows?: number;
  maxRows?: number;
  label: string;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
}> = ({ value, onCommit, placeholder, minRows, maxRows = 14, label, disabled, autoFocus, className }) => {
  const incoming = value ?? '';
  const [local, setLocal] = useState(incoming);
  const focused = useRef(false);
  const committed = useRef(incoming);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!focused.current && incoming !== committed.current) {
      committed.current = incoming;
      setLocal(incoming);
    }
  }, [incoming]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // Auto-grow: measure after every render that changed the text.
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const line = 22; // text-sm leading-relaxed ≈ 22px
    const max = maxRows * line + 20;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [local, maxRows]);

  const commit = (v: string) => {
    if (v === committed.current) return;
    committed.current = v;
    onCommit(v);
  };
  const handleChange = (v: string) => {
    setLocal(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => commit(v), 700);
  };
  const shared = {
    value: local,
    placeholder,
    disabled,
    autoFocus,
    'aria-label': label,
    onFocus: () => { focused.current = true; },
    onBlur: () => { focused.current = false; if (timer.current) clearTimeout(timer.current); commit(local); },
    className: `w-full mt-1 px-3 py-2 text-sm leading-relaxed text-slate-800 bg-white border border-slate-200 rounded-lg focus:border-accent-cyan focus:ring-2 focus:ring-accent-cyan/20 focus:outline-none placeholder:text-slate-400 disabled:bg-slate-50 disabled:text-slate-500 ${className || ''}`,
  };
  return minRows
    ? <textarea ref={areaRef} {...shared} rows={minRows} onChange={e => handleChange(e.target.value)} style={{ resize: 'none' }} />
    : <input type="text" {...shared} onChange={e => handleChange(e.target.value)} />;
};

// ── Structured interval ─────────────────────────────────────
// The interval is the program's executable output — free text like "when
// needed" can't schedule anything. Value + unit compose a canonical string
// ("1700 Hours") that the PM generator parses losslessly. Legacy free text
// that doesn't parse is kept in the field's tooltip (amber border) rather
// than as a sentence under it.
const IntervalField: React.FC<{
  value: string | null | undefined;
  onCommit: (v: string | null) => void;
  disabled?: boolean;
}> = ({ value, onCommit, disabled }) => {
  const parsed = parseIntervalText(value);
  const unparseable = !!parsed.raw && parsed.n === null;
  const isProse = parsed.n !== null && parsed.raw.length > 20;
  const flagged = unparseable || isProse;

  const commit = (n: number | null, unit: IntervalUnit) => onCommit(canonicalInterval(n, unit));
  const tip = unparseable
    ? `The draft said "${parsed.raw}" — set a value and unit so the PM can be scheduled.`
    : isProse
      ? `Stored as prose: "${parsed.raw}". Re-enter the value to keep just ${parsed.n} ${parsed.unit}.`
      : parsed.unit === 'Hours' && parsed.n !== null
        ? 'Running-hours cadence — the PM is served by meter readings, not the calendar.'
        : undefined;

  return (
    <div className="flex items-center gap-1.5 mt-1" title={tip}>
      <input
        type="number" min={1} aria-label="Interval value" disabled={disabled}
        value={parsed.n ?? ''}
        placeholder="e.g. 3"
        onChange={e => commit(e.target.value === '' ? null : Math.max(1, parseInt(e.target.value, 10) || 0), parsed.unit)}
        className={`w-20 px-3 py-2 text-sm bg-white border rounded-lg focus:border-accent-cyan focus:outline-none text-center font-semibold tabular-nums disabled:bg-slate-50 ${flagged ? 'border-amber-300' : 'border-slate-200'}`}
      />
      <select
        aria-label="Interval unit" disabled={disabled}
        value={parsed.unit}
        onChange={e => commit(parsed.n ?? 1, e.target.value as IntervalUnit)}
        className={`flex-1 px-2 py-2 text-sm bg-white border rounded-lg focus:border-accent-cyan focus:outline-none cursor-pointer disabled:bg-slate-50 ${flagged ? 'border-amber-300' : 'border-slate-200'}`}
      >
        {INTERVAL_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
      </select>
    </div>
  );
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
const STAGE_DOT: Record<Stage, string> = {
  done: 'bg-emerald-500',
  needs_strategy: 'bg-slate-300',
  needs_q5: 'bg-amber-400',
};
const STAGE_TITLE: Record<Stage, string> = {
  done: 'Decided',
  needs_strategy: 'Strategy still to choose',
  needs_q5: 'Consequence not classified on the Worksheet',
};
const StageDot: React.FC<{ stage: Stage; className?: string }> = ({ stage, className }) => (
  <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${STAGE_DOT[stage]} ${className || ''}`} aria-label={STAGE_TITLE[stage]} />
);

// ── Main Component ──────────────────────────────────────────
export const RCMDecisionWizard: React.FC<RCMDecisionWizardProps> = ({
  study, failureModes, functions, decisions, aiLoading, lifeEvidence, breakdown, libraryTasks, locked,
  onUpdateDecision, onAIRecommend, onAcceptRecommendation, onDismissRecommendation, onCreatePM, pmGateFor, onCreateReadingPoint,
}) => {
  const stageOf = (fmId: string): Stage => {
    const d = decisions.get(fmId);
    if (!d?.consequence_code) return 'needs_q5';
    if (!d.recommended_strategy_code) return 'needs_strategy';
    return 'done';
  };

  // The rail's order: every function in worksheet order with its modes under
  // it, then any mode whose function is gone. This is also the walking order.
  const groups = useMemo(() => {
    const seen = new Set<string>();
    const out: { fn: RCMFunction | null; modes: RCMFailureMode[] }[] = [];
    for (const fn of functions) {
      const modes = failureModes.filter(m => m.function_id === fn.id);
      if (modes.length === 0) continue;
      modes.forEach(m => seen.add(m.id));
      out.push({ fn, modes });
    }
    const orphans = failureModes.filter(m => !seen.has(m.id));
    if (orphans.length) out.push({ fn: null, modes: orphans });
    return out;
  }, [functions, failureModes]);
  const ordered = useMemo(() => groups.flatMap(g => g.modes), [groups]);
  const fmNumber = (m: RCMFailureMode) => failureModes.indexOf(m) + 1;
  const decidedCount = ordered.filter(m => stageOf(m.id) === 'done').length;

  // One mode per page.
  const [currentId, setCurrentId] = useState<string | null>(ordered[0]?.id ?? null);
  const index = Math.max(0, ordered.findIndex(m => m.id === currentId));
  const fm = ordered[index] ?? null;
  useEffect(() => {
    if (!fm && ordered.length > 0) setCurrentId(ordered[0].id);
  }, [fm, ordered]);
  const goTo = (i: number) => { const t = ordered[Math.min(Math.max(0, i), ordered.length - 1)]; if (t) setCurrentId(t.id); };
  const next = ordered[index + 1] ?? null;
  const prev = ordered[index - 1] ?? null;

  // ← / → walk the rail when no field has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); goTo(index + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(index - 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, ordered]);

  const [justOpen, setJustOpen] = useState(false);
  // Job plan + spares fold away; a mode with either already set opens them.
  const [detailsOverride, setDetailsOverride] = useState<Record<string, boolean>>({});
  const fnMap = useMemo(() => new Map(functions.map(f => [f.id, f])), [functions]);
  const hasRegisteredAsset = !!study.asset_id && UUID_RE.test(study.asset_id);
  const raiseWOUrl = (desc: string) =>
    `/work-orders?action=create&type=CM${hasRegisteredAsset ? `&asset=${study.asset_id}` : ''}&title=${encodeURIComponent(`Redesign — ${desc}`)}`;

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
  const stratCode = decision?.recommended_strategy_code || null;
  const legacyStrategy = isLegacyStrategyCode(stratCode);
  // Normalised: old rows carry prose-only shapes and the retired "Combined" code.
  const rec: AIRecommendation | null = normalizeRecommendation(decision?.ai_recommendation);
  const recPending = !!rec && !rec.accepted_at;
  const pmGate = fm ? pmGateFor(fm) : { ok: false, missing: [], reason: '' };
  const pmBusy = !!fm && aiLoading === `pm-${fm.id}`;
  const linkedPM = decision?.recurring_work_id || null;
  const linkedPoint = decision?.reading_definition_id || null;
  const pointBusy = !!fm && aiLoading === `point-${fm.id}`;
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

  const modeTitle = (m: RCMFailureMode) => m.failure_mode_description || 'Unnamed failure mode';
  const railRow = (m: RCMFailureMode) => {
    const current = m.id === fm?.id;
    const stage = stageOf(m.id);
    return (
      <button
        key={m.id}
        type="button"
        onClick={() => setCurrentId(m.id)}
        aria-current={current ? 'true' : undefined}
        title={`${STAGE_TITLE[stage]} — ${modeTitle(m)}`}
        className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors ${
          current ? 'bg-primary-50 text-primary-800 ring-1 ring-primary-200' : 'text-slate-600 hover:bg-slate-50'
        }`}
      >
        <StageDot stage={stage} />
        <span className="text-[10px] font-bold text-slate-400 tabular-nums shrink-0 w-9">FM-{fmNumber(m)}</span>
        <span className="text-xs truncate">{modeTitle(m)}</span>
      </button>
    );
  };

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

        {/* ═══ Mode rail — desktop: a column beside the card ═══ */}
        <nav aria-label="Failure modes" className="hidden lg:block lg:w-60 xl:w-64 shrink-0 lg:sticky lg:top-3">
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-2">
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Failure modes</span>
              <span className="text-[10px] font-semibold text-slate-500 tabular-nums" title={`${decidedCount} of ${ordered.length} decided`}>{decidedCount}/{ordered.length}</span>
            </div>
            <div className="space-y-2 mt-1">
              {groups.map(g => (
                <div key={g.fn?.id ?? 'orphans'}>
                  <p className="px-2 pt-1 pb-0.5 text-[10px] font-bold text-slate-500 truncate" title={g.fn ? `${g.fn.function_number}: ${g.fn.function_description}` : 'Function removed'}>
                    {g.fn ? <><span className="text-primary-600">{g.fn.function_number}</span> · {g.fn.function_description}</> : 'No function'}
                  </p>
                  <div className="space-y-0.5">{g.modes.map(railRow)}</div>
                </div>
              ))}
            </div>
          </div>
        </nav>

        {/* ═══ Mode rail — phone: a strip above the card ═══ */}
        <div className="lg:hidden flex items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1" role="tablist" aria-label="Failure modes">
          {ordered.map(m => {
            const current = m.id === fm?.id;
            const stage = stageOf(m.id);
            return (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={current}
                onClick={() => setCurrentId(m.id)}
                title={`${STAGE_TITLE[stage]} — ${modeTitle(m)}`}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-bold whitespace-nowrap shrink-0 ${
                  current ? 'bg-primary-600 border-primary-600 text-white' : 'bg-white border-slate-200 text-slate-600'
                }`}
              >
                <StageDot stage={stage} className={current ? 'ring-1 ring-white/70' : ''} />
                FM-{fmNumber(m)}
              </button>
            );
          })}
        </div>

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

              {/* 3 · The PM this decision becomes — and the way to the next mode */}
              <div className="border-t border-slate-100 pt-4 flex items-center gap-2 flex-wrap">
                {linkedPM ? (
                  <Link
                    to={`/recurring-work?q=${linkedPM}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100"
                    title="Open this PM in Recurring Work"
                  >
                    <CheckCircle2 size={12} /> PM {linkedPM} <ArrowUpRight size={11} />
                  </Link>
                ) : stratCode === 'REDESIGN' ? (
                  <Link
                    to={raiseWOUrl(fm.failure_mode_description)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-red-50 border border-red-200 text-red-700 hover:bg-red-100"
                    title="Redesign is a one-off change — raise a work order (or MOC) rather than a schedule"
                  >
                    <Wrench size={12} /> Raise redesign work order <ArrowUpRight size={11} />
                  </Link>
                ) : stratCode === 'RTF' ? (
                  <span className="text-[11px] text-slate-500">Run-to-Failure schedules nothing — corrective work is raised when it fails.</span>
                ) : stratCode ? (
                  <button
                    type="button"
                    onClick={() => onCreatePM(fm)}
                    aria-disabled={pmBusy}
                    title={pmGate.ok ? pmGate.reason : `Still missing: ${pmGate.missing.join(', ')}`}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-colors ${
                      pmGate.ok
                        ? 'bg-accent-cyan/10 border-accent-cyan/40 text-slate-800 hover:bg-accent-cyan/20'
                        : 'bg-slate-100 border-slate-200 text-slate-500 hover:bg-slate-200'
                    }`}
                  >
                    {pmBusy ? <RefreshCw size={12} className="animate-spin" /> : pmGate.ok ? <Wrench size={12} /> : <Lock size={12} />}
                    Create PM
                  </button>
                ) : null}
                {(stratCode === 'PM_CONDITION' || stratCode === 'PM_PREDICTIVE') && hasRegisteredAsset && (
                  linkedPoint ? (
                    <Link
                      to={`/readings?asset=${study.asset_id}&point=${linkedPoint}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100"
                      title="Open the measurement point this decision monitors in Condition Data — trend, bands, cadence"
                    >
                      <Radio size={12} /> Open reading point <ArrowUpRight size={11} />
                    </Link>
                  ) : onCreateReadingPoint ? (
                    <button
                      type="button"
                      onClick={() => { if (!pointBusy) onCreateReadingPoint(fm); }}
                      aria-disabled={pointBusy}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-white border border-slate-200 text-slate-700 hover:border-slate-300"
                      title="An on-condition task needs a measurement point behind it — create the reading definition this decision monitors"
                    >
                      {pointBusy ? <RefreshCw size={12} className="animate-spin" /> : <Radio size={12} />} Create reading point
                    </button>
                  ) : null
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
