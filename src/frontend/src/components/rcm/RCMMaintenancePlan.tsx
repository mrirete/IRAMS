/**
 * RCMMaintenancePlan — step 3: make each decision real in the right module.
 *
 * Strategy (step 2) answers "what should we do". This tab answers "make it
 * real", one failure mode at a time, with the same rail-beside-a-card shape.
 * The card is a short checklist read off the strategy and task type
 * (eam/services/rcmImplementation.ts):
 *
 *   Time-Based             → Create the PM                     (Work Management)
 *   On-condition, a person → Monitoring point, inspection PM   (Condition Data + Work Management)
 *   On-condition, a sensor → Monitoring point, sensor + alert  (Condition Data + Predict)
 *   Failure-finding        → Failure-finding PM                (Work Management)
 *   Run-to-Failure         → Confirm the spare is stocked      (Inventory)
 *   Redesign               → Raise the work order              (Work Management)
 *
 * Every step carries the study's data — task, interval, craft, job plan,
 * spares, technology, bands, P-F interval — and once done becomes a link into
 * the record it created. Problems are fixed where they show: an interval that
 * will not parse is editable on the card; a PM that fell behind its decision
 * gets "Sync PM". No chart, no table, no per-row corrective work order.
 */
import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import {
  Wrench, Sparkles, Lock, RefreshCw, CheckCircle2, X, AlertTriangle, ArrowUpRight, ArrowRight,
  ChevronLeft, ChevronRight, Radio, Cpu, Package, ClipboardList, GitBranch, Check,
} from 'lucide-react';
import type { RCMMaintenancePlanProps, RCMFailureMode, ReadingPointSetup } from './types';
import type { SuggestedPoint } from '../../lib/predict/limitLibrary';
import { CONSEQUENCE_OPTIONS, strategyLabel, parseConsequenceCodes } from './types';
import { RCMModeRail, groupModesByFunction, modeTitle, type RailTone } from './RCMModeRail';
import { IntervalField, SyncedField } from './RCMFields';
import { implementationSteps, implementationState, dueState, type ImplStep, type ImplState } from '../../eam/services/rcmImplementation';
import { parseIntervalText, TASK_TYPE_LABELS, isTaskTypeCode, UUID_RE } from '../../eam/services/rcmPlan';
import type { RCMTaskSummary } from '../../eam/services/RCMService';

const MODULE_NAME: Record<ImplStep['module'], string> = {
  work: 'Work Management',
  readings: 'Condition Data',
  predict: 'Predict',
  inventory: 'Inventory',
};
const MODULE_ICON: Record<ImplStep['module'], React.ReactNode> = {
  work: <Wrench size={12} />,
  readings: <Radio size={12} />,
  predict: <Cpu size={12} />,
  inventory: <Package size={12} />,
};

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

// ── Monitoring point set-up ─────────────────────────────────────────────────
// The point is what an on-condition task actually reads: parameter, unit,
// bands, P-F interval. Collected here, prefilled from the decision, so the
// point is complete when it lands in Condition Data instead of a bare name.
const ReadingPointModal: React.FC<{
  open: boolean;
  fmTitle: string;
  technology: string | null;
  intervalText: string | null;
  onSave: (setup: ReadingPointSetup) => void;
  onClose: () => void;
  /** Cited bands for the asset's class (ISO 20816, …) — prefilled, editable. */
  suggestion?: SuggestedPoint | null;
  assetTag?: string | null;
}> = ({ open, fmTitle, technology, intervalText, onSave, onClose, suggestion, assetTag }) => {
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [minW, setMinW] = useState('');
  const [maxW, setMaxW] = useState('');
  const [minC, setMinC] = useState('');
  const [maxC, setMaxC] = useState('');
  const [pf, setPf] = useState('');
  useEffect(() => {
    if (!open) return;
    // Name the parameter, not the sentence: "K-601 · Bearing vibration (DE)",
    // never "online sensor (pressure, flow) — Dry Gas Seal failure leading to…".
    const inParens = technology?.match(/\(([^)]+)\)/)?.[1]?.trim() || '';
    const stripped = technology ? technology.replace(/\(.*?\)/g, '').replace(/\b(online|on-line|sensor|sensors|monitoring|analysis|continuous|periodic)\b/gi, '').replace(/[,;]+\s*$/, '').replace(/\s+/g, ' ').trim() : '';
    const param = suggestion?.name || stripped || inParens;
    setName(`${assetTag ? `${assetTag} · ` : ''}${param || fmTitle}`.slice(0, 80));
    const s = (v: number | null | undefined) => (v == null ? '' : String(v));
    setUnit(suggestion?.unit || '');
    setMinW(s(suggestion?.bands.minWarning)); setMaxW(s(suggestion?.bands.maxWarning));
    setMinC(s(suggestion?.bands.minCritical)); setMaxC(s(suggestion?.bands.maxCritical));
    setPf('');
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, fmTitle, technology, onClose, suggestion, assetTag]);
  if (!open || typeof document === 'undefined') return null;
  const num = (s: string) => (s.trim() === '' ? null : Number(s));
  const iv = parseIntervalText(intervalText);
  const canSave = name.trim().length > 1 && unit.trim().length > 0;
  const inp = 'w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:border-accent-cyan focus:outline-none';
  const lbl = 'block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1';
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label="Create monitoring point">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg bg-white sm:rounded-2xl rounded-t-2xl shadow-2xl border border-slate-200 flex flex-col max-h-[92vh]">
        <div className="flex items-start gap-3 px-5 py-4 border-b border-slate-100">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Monitoring point · Condition Data</p>
            <p className="text-sm font-bold text-slate-800 truncate">{fmTitle}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100" aria-label="Close"><X size={16} /></button>
        </div>
        <div className="px-5 py-4 overflow-y-auto space-y-3">
          <div>
            <label className={lbl}>What is measured</label>
            <input className={inp} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. DE bearing vibration" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>Unit</label>
              <input className={inp} value={unit} onChange={e => setUnit(e.target.value)} placeholder="mm/s, °C, bar, ppm" />
            </div>
            <div>
              <label className={lbl}>P-F interval (days)</label>
              <input type="number" min={1} className={inp} value={pf} onChange={e => setPf(e.target.value)} placeholder={iv.n && iv.unit === 'Days' ? String(iv.n * 2) : 'e.g. 90'} title="Warning to failure. The reading interval should be at most half of this." />
            </div>
          </div>
          <div>
            <label className={lbl}>Alarm bands</label>
            <div className="grid grid-cols-4 gap-2">
              <input type="number" className={inp} value={minC} onChange={e => setMinC(e.target.value)} placeholder="min crit" title="Critical below" />
              <input type="number" className={inp} value={minW} onChange={e => setMinW(e.target.value)} placeholder="min warn" title="Warning below" />
              <input type="number" className={inp} value={maxW} onChange={e => setMaxW(e.target.value)} placeholder="max warn" title="Warning above" />
              <input type="number" className={inp} value={maxC} onChange={e => setMaxC(e.target.value)} placeholder="max crit" title="Critical above" />
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              {suggestion ? <>Prefilled from <strong>{suggestion.bands.label}</strong> ({suggestion.derivedFrom}). Edit freely — </> : null}
              Leave a band empty if it does not apply. Bands can be refined later under Condition Data.
            </p>
          </div>
          {iv.n !== null && (
            <p className="text-[11px] text-slate-500">The task reads this point every <strong>{iv.n} {iv.unit}</strong>.</p>
          )}
        </div>
        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-2 text-xs font-bold rounded-lg text-slate-600 hover:bg-slate-100">Cancel</button>
          <button
            type="button"
            disabled={!canSave}
            onClick={() => onSave({ name: name.trim(), unit: unit.trim(), minWarning: num(minW), maxWarning: num(maxW), minCritical: num(minC), maxCritical: num(maxC), pfIntervalDays: num(pf) })}
            className="px-4 py-2 text-xs font-bold rounded-lg bg-primary-600 text-white hover:bg-primary-500 disabled:opacity-50"
          >
            Create point
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

// ── Specialist report pop-up ────────────────────────────────────────────────
const ReportModal: React.FC<{ report: string | null; onClose: () => void }> = ({ report, onClose }) => {
  useEffect(() => {
    if (!report) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [report, onClose]);
  if (!report || typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label="Specialist program review">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative w-full sm:max-w-2xl bg-white sm:rounded-2xl rounded-t-2xl shadow-2xl border border-slate-200 flex flex-col max-h-[92vh]">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
          <Sparkles size={16} className="text-primary-600" />
          <p className="flex-1 text-sm font-bold text-slate-800">Specialist program review</p>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100" aria-label="Close"><X size={16} /></button>
        </div>
        <div className="px-5 py-4 overflow-y-auto prose prose-sm prose-slate max-w-none text-xs whitespace-pre-wrap leading-relaxed">{report}</div>
        <div className="px-5 py-3 border-t border-slate-100 flex justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-bold rounded-lg bg-primary-600 text-white hover:bg-primary-500">Done</button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

// ── Owner and due date (0336) ───────────────────────────────────────────────
// One quiet row: who carries this decision into Work Management, and by when.
// Team members first; anyone else through a short search. Editable in any
// study status — assigning is implementing, not editing.
const OwnerRow: React.FC<{
  ownerId: string | null; ownerName: string | null; dueDate: string | null; state: ImplState;
  team: Array<{ id: string; name: string; role: string }>;
  searchPeople?: (q: string) => Promise<Array<{ id: string; name: string; title?: string }>>;
  onChange: (patch: { ownerContactId?: string | null; ownerName?: string | null; dueDate?: string | null }) => void;
}> = ({ ownerId, ownerName, dueDate, state, team, searchPeople, onChange }) => {
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Array<{ id: string; name: string; title?: string }>>([]);
  useEffect(() => {
    if (!searching || !searchPeople || q.trim().length < 2) { setHits([]); return; }
    let live = true;
    const t = setTimeout(() => { searchPeople(q.trim()).then(r => { if (live) setHits(r.slice(0, 8)); }).catch(() => setHits([])); }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q, searching, searchPeople]);
  const due = dueState(dueDate, state);
  const tone = due === 'overdue' ? 'text-red-700 bg-red-50 border-red-200' : due === 'due-soon' ? 'text-amber-700 bg-amber-50 border-amber-200' : due === 'unscheduled' ? 'text-slate-500 bg-slate-50 border-slate-200' : 'text-emerald-700 bg-emerald-50 border-emerald-200';
  const label = due === 'overdue' ? 'overdue' : due === 'due-soon' ? 'due soon' : due === 'unscheduled' ? 'no date' : due === 'scheduled' ? 'scheduled' : 'done';
  const onTeam = ownerId ? team.some(m => m.id === ownerId) : false;
  const sel = 'text-[11px] bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-slate-700 focus:outline-none focus:border-accent-cyan';
  return (
    <div className="flex items-center gap-2 flex-wrap text-[11px] text-slate-500">
      <span className="font-bold uppercase tracking-wider text-[9px] text-slate-400">Owner</span>
      <select
        className={sel}
        value={searching ? '__search' : (ownerId || '')}
        onChange={e => {
          const v = e.target.value;
          if (v === '__search') { setSearching(true); return; }
          setSearching(false);
          const m = team.find(x => x.id === v);
          onChange({ ownerContactId: v || null, ownerName: m?.name ?? null });
        }}
        title="Who carries this decision into Work Management"
      >
        <option value="">Unassigned</option>
        {team.map(m => <option key={m.id} value={m.id}>{m.name} · {m.role}</option>)}
        {ownerId && !onTeam && <option value={ownerId}>{ownerName || 'Assigned'}</option>}
        {searchPeople && <option value="__search">Someone else…</option>}
      </select>
      {searching && (
        <span className="relative">
          <input autoFocus className={`${sel} w-40`} placeholder="Search people" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { setSearching(false); setQ(''); } }} />
          {hits.length > 0 && (
            <ul className="absolute z-20 mt-1 left-0 w-56 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
              {hits.map(h => (
                <li key={h.id}>
                  <button type="button" className="w-full text-left px-2.5 py-1.5 hover:bg-slate-50" onClick={() => { onChange({ ownerContactId: h.id, ownerName: h.name }); setSearching(false); setQ(''); }}>
                    <span className="font-semibold text-slate-700">{h.name}</span>{h.title ? <span className="text-slate-400"> · {h.title}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </span>
      )}
      <span className="font-bold uppercase tracking-wider text-[9px] text-slate-400 ml-1">Due</span>
      <input type="date" className={sel} value={dueDate || ''} onChange={e => onChange({ dueDate: e.target.value || null })} title="When the implementation is due" />
      {due && <span className={`px-2 py-0.5 rounded-md border font-semibold ${tone}`}>{label}</span>}
    </div>
  );
};

// ── Main ────────────────────────────────────────────────────────────────────
export const RCMMaintenancePlan: React.FC<RCMMaintenancePlanProps> = ({
  study, functions, failureModes, decisions, taskSummaries, breakdown, aiLoading, aiReport, locked, initialFailureModeId,
  onCreatePM, pmGateFor, onSyncPM, onCreateReadingPoint, onCreateRedesignWO, onUpdateDecision,
  onAIOptimize, optimizeGate, onGoToStrategy, onCloseReport, assetHasFeed, pointSuggestions,
  teamMembers, onAssignOwner, searchPeople, assetTag,
}) => {
  const groups = useMemo(() => groupModesByFunction(functions, failureModes), [functions, failureModes]);
  const ordered = useMemo(() => groups.flatMap(g => g.modes), [groups]);
  const fmNumber = (m: RCMFailureMode) => failureModes.indexOf(m) + 1;
  const summaryByFm = useMemo(() => new Map(taskSummaries.map(t => [t.failure_mode_id, t])), [taskSummaries]);

  const [currentId, setCurrentId] = useState<string | null>(initialFailureModeId ?? ordered[0]?.id ?? null);
  useEffect(() => { if (initialFailureModeId) setCurrentId(initialFailureModeId); }, [initialFailureModeId]);
  const index = Math.max(0, ordered.findIndex(m => m.id === currentId));
  const fm = ordered[index] ?? null;
  useEffect(() => { if (!fm && ordered.length > 0) setCurrentId(ordered[0].id); }, [fm, ordered]);
  const prev = ordered[index - 1] ?? null;
  const next = ordered[index + 1] ?? null;

  const [pointOpen, setPointOpen] = useState(false);

  // ── per-mode state ──
  const sparesNamed = (m: RCMFailureMode, t?: RCMTaskSummary) => (t?.spares_requirements?.length ?? 0) > 0 || !!m.bom_item_id;
  const stepsFor = (m: RCMFailureMode): ImplStep[] => {
    const d = decisions.get(m.id);
    if (!d) return [];
    const t = summaryByFm.get(m.id);
    // The point's own feed when it exists, else what the asset has at all.
    const hasFeed = t?.point ? t.point.has_feed : assetHasFeed;
    return implementationSteps(d, { sparesNamed: sparesNamed(m, t), hasFeed });
  };
  /** The cited band suggestion that fits this decision's technology, if the asset's class has one. */
  const suggestionFor = (technology: string | null): SuggestedPoint | null => {
    const list = pointSuggestions || [];
    if (list.length === 0) return null;
    const t = String(technology || '').toLowerCase();
    const pick = (re: RegExp) => list.find(s => re.test(`${s.name} ${s.unit}`.toLowerCase())) || null;
    if (/vibrat/.test(t)) return pick(/vibration|mm\/s/);
    if (/temperat|thermo/.test(t)) return pick(/temperature|°c/);
    if (/pressure/.test(t)) return pick(/pressure|bar/);
    if (/current|amp/.test(t)) return pick(/current|\ba\b/);
    return null;
  };
  const staleFor = (t?: RCMTaskSummary) => !!t?.recurring_work_id && !!t.pm_created_at && !!t.decision_updated_at
    && new Date(t.decision_updated_at).getTime() > new Date(t.pm_created_at).getTime() + 5000;
  const stateFor = (m: RCMFailureMode): ImplState => implementationState(stepsFor(m), !!decisions.get(m.id)?.recommended_strategy_code);
  const statusOf = (m: RCMFailureMode): { tone: RailTone; title: string } => {
    if (staleFor(summaryByFm.get(m.id))) return { tone: 'red', title: 'Decision changed after its PM was generated' };
    const s = stateFor(m);
    const due = dueState(summaryByFm.get(m.id)?.impl_due_date, s);
    if (due === 'overdue') return { tone: 'red', title: `Implementation overdue — due ${fmtDate(summaryByFm.get(m.id)?.impl_due_date)}${summaryByFm.get(m.id)?.impl_owner_name ? ` · ${summaryByFm.get(m.id)?.impl_owner_name}` : ''}` };
    if (s === 'done') return { tone: 'emerald', title: 'Implemented' };
    if (s === 'partial') return { tone: 'primary', title: 'Partly implemented' };
    if (s === 'ready') return { tone: 'slate', title: 'Ready to implement' };
    return { tone: 'amber', title: 'No strategy yet — decide it on Strategy' };
  };
  const decidedCount = ordered.filter(m => !!decisions.get(m.id)?.recommended_strategy_code).length;
  const implementedCount = ordered.filter(m => stateFor(m) === 'done').length;
  const pmCount = taskSummaries.filter(t => t.recurring_work_id).length;
  const wmQuery = `RCM-${study.id.slice(0, 8)}`;
  const hasRegisteredAsset = !!study.asset_id && UUID_RE.test(study.asset_id);

  if (failureModes.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center shadow-sm">
        <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-slate-50 flex items-center justify-center">
          <Wrench size={28} className="text-slate-300" />
        </div>
        <p className="text-sm font-semibold text-slate-500">Nothing to implement yet</p>
        <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">Each failure mode on the Worksheet gets a strategy on the Strategy tab; this tab turns that strategy into a PM, a monitoring point, a sensor or a work order.</p>
        <button onClick={() => onGoToStrategy()} className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-accent-cyan/10 border border-accent-cyan/40 rounded-lg text-xs font-bold text-slate-700 hover:bg-accent-cyan/20 transition-colors">
          Go to 2 · Strategy <ArrowRight size={13} className="text-accent-cyan" />
        </button>
      </div>
    );
  }

  // ── the current mode ──
  const decision = fm ? decisions.get(fm.id) : undefined;
  const summary = fm ? summaryByFm.get(fm.id) : undefined;
  const steps = fm ? stepsFor(fm) : [];
  const stale = staleFor(summary);
  const strat = strategyLabel(decision?.recommended_strategy_code);
  const consOpts = parseConsequenceCodes(decision?.consequence_code).map(c => CONSEQUENCE_OPTIONS.find(o => o.code === c)).filter(Boolean);
  const taskType = isTaskTypeCode(decision?.task_type_code) ? TASK_TYPE_LABELS[decision!.task_type_code as keyof typeof TASK_TYPE_LABELS].label : null;
  const technology = summary?.technology || null;
  const interval = parseIntervalText(decision?.task_interval);
  const needsInterval = steps.some(s => s.kind === 'PM' && !s.done) && interval.n === null;
  const needsTask = steps.some(s => s.kind === 'PM' && !s.done) && String(decision?.task_description || '').trim().length < 3;
  const pinnedPart = fm?.bom_item_id ? breakdown?.parts.find(p => p.id === fm.bom_item_id) : null;
  const gate = fm ? pmGateFor(fm.id) : { ok: false, missing: [], reason: '' };

  const stepAction = (s: ImplStep) => {
    if (!fm) return null;
    const busyKey = s.kind === 'PM' ? `pm-${fm.id}` : s.kind === 'POINT' ? `point-${fm.id}` : s.kind === 'WO' ? `wo-${fm.id}` : '';
    const busy = !!busyKey && aiLoading === busyKey;
    const btn = (ok: boolean) => `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-colors ${
      ok ? 'bg-accent-cyan/10 border-accent-cyan/40 text-slate-800 hover:bg-accent-cyan/20' : 'bg-slate-100 border-slate-200 text-slate-500 hover:bg-slate-200'
    }`;
    const linkCls = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100';

    switch (s.kind) {
      case 'PM': {
        if (s.done && summary?.recurring_work_id) {
          const pm = summary.pm;
          const due = fmtDate(pm?.next_due_date);
          return (
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <Link to={`/recurring-work?q=${summary.recurring_work_id}`} className={linkCls} title="Open this PM in Work Management">
                <CheckCircle2 size={12} /> PM {summary.recurring_work_id} <ArrowUpRight size={11} />
              </Link>
              {(due || pm?.strategy_package || pm?.schedule_type === 'READING') && (
                <span className="text-[11px] text-slate-500">
                  {pm?.schedule_type === 'READING' ? 'served by readings' : due ? `next due ${due}` : ''}{pm?.strategy_package ? ` · package ${pm.strategy_package}` : ''}
                </span>
              )}
              {stale && (
                <button type="button" onClick={() => onSyncPM(fm.id)} aria-disabled={aiLoading === `sync-${fm.id}`} title="The decision changed after this PM was generated — rewrite the PM's title, task, interval and templates from the decision" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-amber-50 border border-amber-200 text-amber-800 hover:bg-amber-100">
                  {aiLoading === `sync-${fm.id}` ? <RefreshCw size={12} className="animate-spin" /> : <RefreshCw size={12} />} Sync PM
                </button>
              )}
            </div>
          );
        }
        return (
          <button type="button" onClick={() => onCreatePM(fm.id)} aria-disabled={busy} title={gate.ok ? gate.reason : `Still missing: ${gate.missing.join(', ')}`} className={btn(gate.ok)}>
            {busy ? <RefreshCw size={12} className="animate-spin" /> : gate.ok ? <Wrench size={12} /> : <Lock size={12} />} Create PM
          </button>
        );
      }
      case 'POINT': {
        if (s.done && summary?.reading_definition_id) {
          const p = summary.point;
          return (
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <Link to={`/readings?asset=${study.asset_id}&point=${summary.reading_definition_id}`} className={linkCls} title="Open this point in Condition Data — trend, bands, cadence">
                <Radio size={12} /> {p?.name || 'Monitoring point'}{p?.unit && p.unit !== '—' ? ` · ${p.unit}` : ''} <ArrowUpRight size={11} />
              </Link>
              {p && !p.has_bands && <span className="text-[11px] text-amber-700" title="Without alarm bands a reading cannot raise a warning">no alarm bands yet</span>}
              {p && !p.is_active && <span className="text-[11px] text-red-600">deactivated</span>}
            </div>
          );
        }
        return (
          <button type="button" onClick={() => setPointOpen(true)} aria-disabled={busy || !hasRegisteredAsset} title={hasRegisteredAsset ? 'Create the measurement point this task reads — parameter, unit, bands, P-F interval' : 'Link the study to a register asset first'} className={btn(hasRegisteredAsset)}>
            {busy ? <RefreshCw size={12} className="animate-spin" /> : hasRegisteredAsset ? <Radio size={12} /> : <Lock size={12} />} Create monitoring point
          </button>
        );
      }
      case 'SENSOR': {
        const pointId = summary?.reading_definition_id;
        if (!pointId) return <span className="text-[11px] text-slate-400" title="The sensor feeds the point — create the point first">after the point</span>;
        return (
          <Link to={`/predict?asset=${study.asset_id}&point=${pointId}`} className={btn(true)} title="Open Predict on this asset — connect the feed and set the alert that raises the work order">
            <Cpu size={12} /> Open Predict <ArrowUpRight size={11} />
          </Link>
        );
      }
      case 'WO': {
        if (s.done && summary?.work_order_id) {
          const w = summary.wo;
          return (
            <Link to={`/work-orders/${summary.work_order_id}`} className={linkCls} title="Open the redesign work order">
              <CheckCircle2 size={12} /> WO {w?.wo_number || summary.work_order_id.slice(0, 8)}{w?.status ? ` · ${w.status}` : ''} <ArrowUpRight size={11} />
            </Link>
          );
        }
        return (
          <button type="button" onClick={() => onCreateRedesignWO(fm.id)} aria-disabled={busy || !hasRegisteredAsset} title={hasRegisteredAsset ? 'Raise the work order (or MOC) that carries the redesign out; it is linked back to this decision' : 'Link the study to a register asset first'} className={btn(hasRegisteredAsset)}>
            {busy ? <RefreshCw size={12} className="animate-spin" /> : hasRegisteredAsset ? <Wrench size={12} /> : <Lock size={12} />} Raise work order
          </button>
        );
      }
      case 'SPARES': {
        const named = summary?.spares_requirements || [];
        const first = pinnedPart?.partNumber || pinnedPart?.description || named[0]?.part_number || named[0]?.description || '';
        if (s.done) {
          return (
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <span className="text-[11px] text-slate-600 truncate max-w-[28ch]" title={[pinnedPart ? `${pinnedPart.partNumber} ${pinnedPart.description}` : '', ...named.map(n => `${n.part_number} ${n.description}`)].filter(Boolean).join('; ')}>
                {pinnedPart ? `${pinnedPart.partNumber || pinnedPart.description}${pinnedPart.critical ? ' ★' : ''}` : `${named.length} spare${named.length !== 1 ? 's' : ''} named`}
              </span>
              <Link to={`/inventory?q=${encodeURIComponent(first)}`} className={btn(true)} title="Check stock and reorder point in Inventory">
                <Package size={12} /> Check stock <ArrowUpRight size={11} />
              </Link>
            </div>
          );
        }
        return (
          <button type="button" onClick={() => onGoToStrategy(fm.id)} className={btn(true)} title="Name the spare on Strategy › Job plan & spares, or pin the failure mode to its BOM line on the Worksheet">
            <ClipboardList size={12} /> Name the spare
          </button>
        );
      }
      default:
        return null;
    }
  };

  return (
    <div className="space-y-3 animate-in fade-in duration-300">
      {/* Program-level actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => (optimizeGate.ok ? onAIOptimize() : undefined)}
          aria-disabled={aiLoading === 'optimize' || !optimizeGate.ok}
          title={optimizeGate.reason}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-semibold border transition-colors ${
            optimizeGate.ok ? 'bg-white border-primary-200 text-primary-700 hover:bg-primary-50' : 'bg-white border-slate-200 text-slate-400'
          }`}
        >
          {aiLoading === 'optimize' ? <RefreshCw size={12} className="animate-spin" /> : optimizeGate.ok ? <Sparkles size={12} /> : <Lock size={12} />}
          Specialist: review the program
        </button>
        {pmCount > 0 && (
          <Link to={`/recurring-work?q=${wmQuery}`} className="flex items-center gap-1.5 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100">
            View {pmCount} PM{pmCount !== 1 ? 's' : ''} in Work Management <ArrowUpRight size={12} />
          </Link>
        )}
        <span className="ml-auto text-[11px] text-slate-500 tabular-nums">
          <strong className="text-slate-700">{implementedCount}</strong> of {decidedCount} decided implemented{ordered.length - decidedCount > 0 ? <> · <span className="text-amber-700">{ordered.length - decidedCount} undecided</span></> : null}
        </span>
      </div>

      <div className="flex flex-col lg:flex-row lg:items-start gap-3">
        <RCMModeRail
          groups={groups}
          fmNumber={fmNumber}
          currentId={fm?.id ?? null}
          onSelect={setCurrentId}
          statusOf={statusOf}
          headerRight={`${implementedCount}/${decidedCount}`}
          headerRightTitle={`${implementedCount} of ${decidedCount} decided modes implemented`}
        />

        {!fm ? (
          <div className="flex-1 bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-400">Pick a failure mode.</div>
        ) : (
          <div className="flex-1 min-w-0 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            {/* Header — the decision this card implements */}
            <div className="px-4 sm:px-5 py-4 border-b border-slate-100">
              <div className="flex items-start gap-3">
                <span className="text-[9px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md shrink-0 mt-0.5">FM-{fmNumber(fm)}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-800">{modeTitle(fm)}</p>
                  {summary?.function_description && (
                    <p className="text-[11px] text-slate-400 mt-0.5 truncate" title={summary.function_description}>{summary.function_description}</p>
                  )}
                  <div className="flex items-center gap-1.5 flex-wrap mt-2">
                    {consOpts.map(c => c && (
                      <span key={c.code} className="text-[10px] font-bold px-2 py-0.5 rounded-md border" style={{ background: `${c.color}10`, color: c.color, borderColor: `${c.color}30` }}>{c.icon} {c.label}</span>
                    ))}
                    {strat && <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${strat.color}`}>{strat.icon} {strat.label}</span>}
                    {taskType && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-slate-800 text-white">{taskType}</span>}
                    {technology && strat && decision?.recommended_strategy_code !== 'PM_TIME' && (
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 max-w-[36ch] truncate" title={technology}>{technology}</span>
                    )}
                  </div>
                </div>
                <button type="button" onClick={() => onGoToStrategy(fm.id)} className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold border bg-white border-slate-200 text-slate-600 hover:border-slate-300" title="Change the decision on the Strategy tab">
                  <GitBranch size={11} /> Strategy
                </button>
              </div>
            </div>

            <div className="px-4 sm:px-5 py-4 space-y-4">
              {!decision?.recommended_strategy_code ? (
                <div className="flex items-center gap-3 p-4 bg-amber-50/60 border border-amber-200/50 rounded-xl">
                  <AlertTriangle size={16} className="text-amber-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-amber-800">No strategy yet</p>
                    <p className="text-[11px] text-amber-700">Nothing can be implemented until the Strategy tab has answered Q6–Q7 for this failure mode.</p>
                  </div>
                  <button type="button" onClick={() => onGoToStrategy(fm.id)} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-amber-600 text-white hover:bg-amber-500">
                    Decide it <ArrowRight size={12} />
                  </button>
                </div>
              ) : (
                <>
                  <OwnerRow
                    ownerId={summary?.impl_owner_contact_id ?? null}
                    ownerName={summary?.impl_owner_name ?? null}
                    dueDate={summary?.impl_due_date ?? null}
                    state={stateFor(fm)}
                    team={(teamMembers || []).filter(m => m.type === 'contact').map(m => ({ id: m.ref_id, name: m.name, role: m.role }))}
                    searchPeople={searchPeople}
                    onChange={patch => onAssignOwner(fm.id, patch)}
                  />
                  {/* The task as it will travel */}
                  {steps.some(s => s.kind === 'PM' || s.kind === 'POINT' || s.kind === 'SENSOR') && (
                    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 space-y-2">
                      {needsTask ? (
                        <div>
                          <label className="text-[9px] font-bold text-amber-700 uppercase tracking-wider">Task — needed before the PM</label>
                          <SyncedField label="Task description" value={decision.task_description} disabled={locked} minRows={2} maxRows={4} placeholder="One instruction for the technician" onCommit={v => onUpdateDecision(fm.id, { task_description: v || null })} />
                        </div>
                      ) : String(decision.task_description || '').trim() ? (
                        <p className="text-sm text-slate-800">{decision.task_description}</p>
                      ) : (
                        <p className="text-sm text-slate-400 italic">No task line on the decision — the PM carries only its title. <button type="button" onClick={() => onGoToStrategy(fm.id)} className="not-italic font-bold text-primary-600 hover:underline">Write it on Strategy</button></p>
                      )}
                      <div className="flex items-center gap-x-4 gap-y-2 flex-wrap text-[11px] text-slate-500">
                        {needsInterval ? (
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] font-bold text-amber-700 uppercase tracking-wider">Interval — needed before the PM</span>
                            <div className="w-56"><IntervalField compact value={decision.task_interval} disabled={locked} onCommit={v => onUpdateDecision(fm.id, { task_interval: v })} /></div>
                          </div>
                        ) : interval.n !== null ? (
                          <span>every <strong className="text-slate-700">{interval.n} {interval.unit}</strong></span>
                        ) : (
                          <span className="text-amber-700" title="The PM was generated without a parseable interval on the decision — set one on Strategy and Sync PM">interval not set on the decision</span>
                        )}
                        {decision.task_owner_craft && <span>craft <strong className="text-slate-700">{decision.task_owner_craft}</strong></span>}
                        {summary?.task_library_item_id && <span title="Job plan from the Task Library travels into the PM">job plan attached</span>}
                        {(summary?.spares_requirements?.length ?? 0) > 0 && <span>{summary!.spares_requirements.length} spare{summary!.spares_requirements.length !== 1 ? 's' : ''}</span>}
                      </div>
                    </div>
                  )}

                  {/* The checklist */}
                  <ol className="space-y-2">
                    {steps.map((s, i) => (
                      <li key={s.kind} className={`flex items-start gap-3 p-3 rounded-xl border ${s.done ? 'border-emerald-100 bg-emerald-50/30' : 'border-slate-200 bg-white'}`}>
                        <span className={`mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold shrink-0 ${s.done ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-600'}`}>
                          {s.done ? <Check size={13} /> : i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-slate-800">{s.label}</p>
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400" title={`Lands in ${MODULE_NAME[s.module]}`}>{MODULE_ICON[s.module]} {MODULE_NAME[s.module]}</span>
                          </div>
                          <p className="text-[11px] text-slate-500 mt-0.5">{s.hint}</p>
                        </div>
                        <div className="shrink-0 pt-0.5">{stepAction(s)}</div>
                      </li>
                    ))}
                    {steps.length === 0 && (
                      <li className="p-3 rounded-xl border border-slate-200 text-[11px] text-slate-500">This strategy is retired. Choose the one that applies on Strategy.</li>
                    )}
                  </ol>
                  {decision.recommended_strategy_code === 'RTF' && (
                    <p className="text-[11px] text-slate-500">Run-to-Failure schedules nothing. When it fails, the corrective work order is raised from the failure, not from here.</p>
                  )}
                </>
              )}

              {/* Walk the plan */}
              <div className="border-t border-slate-100 pt-3 flex items-center justify-end gap-1.5">
                <button type="button" onClick={() => prev && setCurrentId(prev.id)} disabled={!prev} aria-label="Previous failure mode" title={prev ? `FM-${fmNumber(prev)} · ${modeTitle(prev)}` : undefined} className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40">
                  <ChevronLeft size={16} />
                </button>
                <button type="button" onClick={() => next && setCurrentId(next.id)} disabled={!next} title={next ? modeTitle(next) : 'Last failure mode'} className="inline-flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-lg border text-[11px] font-bold bg-white border-slate-200 text-slate-700 hover:border-slate-300 disabled:opacity-40 max-w-[52vw] sm:max-w-xs">
                  {next ? (<><span className="shrink-0">Next</span><span className="text-slate-400 font-medium truncate">FM-{fmNumber(next)} · {modeTitle(next)}</span></>) : <span>Last mode</span>}
                  <ChevronRight size={14} className="shrink-0" />
                </button>
              </div>
            </div>

            <ReadingPointModal
              open={pointOpen}
              fmTitle={modeTitle(fm)}
              technology={technology}
              intervalText={decision?.task_interval || null}
              suggestion={suggestionFor(technology)}
              assetTag={assetTag ?? study.asset_tag ?? null}
              onSave={setup => { setPointOpen(false); onCreateReadingPoint(fm.id, setup); }}
              onClose={() => setPointOpen(false)}
            />
          </div>
        )}
      </div>

      <ReportModal report={aiReport} onClose={onCloseReport} />
    </div>
  );
};

export default RCMMaintenancePlan;
