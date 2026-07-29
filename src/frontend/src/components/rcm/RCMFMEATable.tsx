/**
 * RCMFMEATable — the classical FMEA / RCM Information Worksheet
 * ════════════════════════════════════════════════════════════
 * One row per failure mode, columns in the order a reliability engineer reads
 * them: mode → cause → local/system/end effect → S × O = RPN → consequence.
 * Function and functional failure are the merged band above their rows, exactly
 * as they merge on a paper worksheet — and that band is the collapse handle, so
 * a 60-row study stays navigable.
 *
 * Two levels of collapse:
 *   • Function band  — folds the whole block of rows away.
 *   • Row chevron    — opens the JA1012 consequence classification and the risk
 *                      detail that will not fit in a cell.
 *
 * Q1–Q5 of SAE JA1011. Q6–Q7 live in the Decision Logic tab.
 */
import React, { useState, useCallback, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import {
  Plus, Trash2, ChevronDown, ChevronRight, Layers, Sparkles, Lock,
  RefreshCw, EyeOff, ShieldAlert, CheckCircle2, Info, ChevronsDownUp, ChevronsUpDown,
} from 'lucide-react';
import { RCMContextualHelp } from './RCMContextualHelp';
import type { RCMStudy, RCMFunction, RCMFailureMode, RCMDecision } from './types';
import { EVIDENT_CONSEQUENCES, HIDDEN_CONSEQUENCES, CONSEQUENCE_OPTIONS, STRATEGY_LABELS, parseConsequenceCodes } from './types';
import {
  canSpecialistCompleteRow, canSpecialistExpandFunction, isRowComplete,
} from '../../eam/services/rcmReadiness';

// ── Function type accent colors ────────────────────────────
const FN_ACCENTS: Record<string, string> = {
  primary: '#3b82f6',
  secondary: '#f59e0b',
  protective: '#8b5cf6',
};

const rpnBand = (rpn: number) => (
  rpn > 80 ? { label: 'Critical', bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', bar: '#ef4444' }
  : rpn > 50 ? { label: 'High', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', bar: '#f59e0b' }
  : rpn > 25 ? { label: 'Medium', bg: 'bg-primary-50', text: 'text-primary-700', border: 'border-primary-200', bar: '#3b82f6' }
  : { label: 'Low', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', bar: '#10b981' }
);

// ── Grid cell editor ───────────────────────────────────────
// Local state so the caret never jumps, debounced commit so every keystroke
// isn't a round-trip, and a re-sync when the value changes underneath (the
// Specialist filling the row) while the cell isn't being typed in.
const GridCell: React.FC<{
  value: string | number | null | undefined;
  onCommit: (v: string) => void;
  placeholder?: string;
  numeric?: boolean;
  tone?: 'default' | 'warn';
  label: string;
}> = ({ value, onCommit, placeholder, numeric, tone = 'default', label }) => {
  const incoming = value == null ? '' : String(value);
  const [local, setLocal] = useState(incoming);
  const focused = useRef(false);
  const committed = useRef(incoming);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Worksheet cells grow to their content — a clipped effect description is a
  // description nobody reads, and paper FMEA sheets wrap.
  const autoSize = useCallback(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(38, el.scrollHeight)}px`;
  }, []);
  useLayoutEffect(autoSize, [local, autoSize]);
  useEffect(() => {
    window.addEventListener('resize', autoSize);
    return () => window.removeEventListener('resize', autoSize);
  }, [autoSize]);

  // Re-sync only when the stored value actually moved and the cell isn't being
  // typed in. Guarded by the ref, so it settles in one pass and can't cascade.
  useEffect(() => {
    if (!focused.current && incoming !== committed.current) {
      committed.current = incoming;
      setLocal(incoming);
    }
  }, [incoming]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const commit = useCallback((v: string) => {
    if (v === committed.current) return;
    committed.current = v;
    onCommit(v);
  }, [onCommit]);

  const handleChange = (v: string) => {
    setLocal(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => commit(v), 700);
  };

  const base = `w-full bg-transparent border border-transparent rounded px-1.5 py-1 text-[11px] leading-snug
    text-slate-700 placeholder:text-slate-300 transition-colors
    hover:border-slate-200 hover:bg-slate-50/60
    focus:bg-white focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-500/20
    ${tone === 'warn' ? 'text-red-700' : ''}`;

  if (numeric) {
    return (
      <input
        type="number" min={1} max={10} aria-label={label} title={label}
        value={local} placeholder={placeholder}
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; if (timer.current) clearTimeout(timer.current); commit(local); }}
        onChange={e => handleChange(e.target.value)}
        className={`${base} text-center font-semibold tabular-nums [appearance:textfield]
          [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
      />
    );
  }

  return (
    <textarea
      ref={taRef}
      rows={2} aria-label={label} title={label}
      value={local} placeholder={placeholder}
      onFocus={() => { focused.current = true; }}
      onBlur={() => { focused.current = false; if (timer.current) clearTimeout(timer.current); commit(local); }}
      onChange={e => handleChange(e.target.value)}
      className={`${base} resize-none overflow-hidden min-h-[38px]`}
    />
  );
};

// ── Consequence summary chip shown in the worksheet cell ───
const ConsequenceCell: React.FC<{ decision?: RCMDecision; onOpen: () => void }> = ({ decision, onOpen }) => {
  const codes = parseConsequenceCodes(decision?.consequence_code);
  const hidden = !!decision?.is_hidden_failure;

  if (codes.length === 0) {
    return (
      <button
        onClick={onOpen}
        className="w-full text-[10px] font-semibold text-slate-400 border border-dashed border-slate-300 rounded px-2 py-1.5 hover:border-primary-400 hover:text-primary-600 transition-colors"
        title="Classify the consequence (JA1012 Q5)"
      >
        Classify…
      </button>
    );
  }

  return (
    <button onClick={onOpen} className="w-full flex flex-col items-start gap-1" title="Edit consequence classification">
      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${
        hidden ? 'bg-primary-50 text-primary-700 border-primary-200' : 'bg-slate-50 text-slate-600 border-slate-200'
      }`}>
        {hidden ? 'Hidden' : 'Evident'}
      </span>
      <span className="flex flex-wrap gap-1">
        {codes.map(code => {
          const c = CONSEQUENCE_OPTIONS.find(o => o.code === code);
          if (!c) return null;
          return (
            <span
              key={code} title={c.label}
              className="text-[9px] font-bold px-1.5 py-0.5 rounded border flex items-center gap-1"
              style={{ background: `${c.color}14`, color: c.color, borderColor: `${c.color}45` }}
            >
              <span className="leading-none">{c.icon}</span>
              {c.label.split(' ')[0]}
            </span>
          );
        })}
      </span>
    </button>
  );
};

// ── Expanded row detail — Q5 classification + risk reading ─
const RowDetail: React.FC<{
  fm: RCMFailureMode;
  decision?: RCMDecision;
  gate: ReturnType<typeof canSpecialistCompleteRow>;
  aiLoading: string | null;
  onUpdateDecision: (fmId: string, updates: Partial<RCMDecision>) => void;
  onSpecialistComplete: (fm: RCMFailureMode) => void;
  onBlocked: (reason: string) => void;
  onGoToStrategy: () => void;
}> = ({ fm, decision, gate, aiLoading, onUpdateDecision, onSpecialistComplete, onBlocked, onGoToStrategy }) => {
  const rpn = (fm.severity || 0) * (fm.occurrence || 0);
  const band = rpnBand(rpn);
  const hidden = !!decision?.is_hidden_failure;
  const options = hidden ? HIDDEN_CONSEQUENCES : EVIDENT_CONSEQUENCES;
  const activeCodes = parseConsequenceCodes(decision?.consequence_code);
  const busy = aiLoading === `complete-${fm.id}`;

  const toggleCode = (code: string) => {
    const updated = activeCodes.includes(code)
      ? activeCodes.filter(x => x !== code)
      : [...activeCodes, code];
    onUpdateDecision(fm.id, { consequence_code: updated.length > 0 ? updated.join(',') : null });
  };

  return (
    <div className="bg-slate-50/70 border-l-2 border-primary-400 px-4 py-3 grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-4">
      {/* Q5 — consequence classification */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[9px] font-bold text-red-600 uppercase tracking-wider">Q5 — Does the failure matter?</span>
          <RCMContextualHelp
            question="Classify the consequence: is the failure hidden or evident? Then categorise by Safety, Operational, or Economic impact."
            standard="SAE JA1012 Step 5"
          />
        </div>

        <div className="flex items-center gap-2 mb-2">
          <EyeOff size={12} className="text-primary-500 shrink-0" />
          <span className="text-[9px] font-bold text-primary-600 uppercase">Evident to operators?</span>
          {[{ label: 'Evident', value: false }, { label: 'Hidden', value: true }].map(opt => (
            <button
              key={opt.label}
              onClick={() => onUpdateDecision(fm.id, { is_hidden_failure: opt.value, consequence_code: null })}
              className={`px-3 py-1 text-[10px] font-bold rounded-md border transition-all ${
                hidden === opt.value
                  ? opt.value
                    ? 'bg-primary-500 text-white border-primary-500'
                    : 'bg-accent-cyan text-brand-900 border-accent-cyan'
                  : 'bg-white border-slate-300/80 text-slate-500 hover:border-slate-400 hover:text-slate-700'
              }`}
            >
              {opt.label}
            </button>
          ))}
          <span className="relative group ml-1">
            <Info size={11} className="text-slate-300 cursor-help" />
            <span className="absolute bottom-full left-0 mb-1.5 hidden group-hover:block z-50">
              <span className="block bg-slate-800 text-white text-[9px] leading-relaxed rounded-lg px-3 py-2 w-[220px] shadow-lg">
                <strong>Evident</strong> = operators notice under normal conditions.<br />
                <strong>Hidden</strong> = requires inspection or testing to discover.
              </span>
            </span>
          </span>
        </div>

        {hidden && (
          <p className="text-[9px] text-primary-500 font-medium italic mb-1.5">
            If combined with another failure, could it threaten safety?
          </p>
        )}

        <div className="flex flex-wrap gap-1.5">
          {options.map(c => {
            const selected = activeCodes.includes(c.code);
            return (
              <button
                key={c.code}
                onClick={() => toggleCode(c.code)}
                title={c.desc}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[10px] font-bold transition-all ${
                  selected ? 'border-2 shadow-sm' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                }`}
                style={selected ? { background: `${c.color}18`, borderColor: c.color, color: c.color } : undefined}
              >
                <span className="text-sm leading-none">{c.icon}</span>
                {c.label}
                {selected && <CheckCircle2 size={12} className="text-emerald-500" />}
              </button>
            );
          })}
        </div>

        {activeCodes.includes('HIDDEN_SAFETY') && (
          <div className="flex items-center gap-1.5 px-2 py-1 bg-red-50/60 border border-red-200/50 rounded-md mt-2">
            <ShieldAlert size={11} className="text-red-500 shrink-0" />
            <span className="text-[9px] text-red-700"><strong>SAE JA1012:</strong> Failure-Finding mandatory. No task → redesign compulsory.</span>
          </div>
        )}

        {/* Where this row goes next — the whole point of the FMEA is the
            maintenance strategy that answers it (Q6–Q7 on the Strategy tab). */}
        {activeCodes.length > 0 && (
          decision?.recommended_strategy_code && STRATEGY_LABELS[decision.recommended_strategy_code] ? (
            <button
              onClick={onGoToStrategy}
              className="mt-2.5 flex items-center gap-2 px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg hover:border-primary-300 transition-colors"
              title="Open this failure mode on the Strategy tab"
            >
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Strategy</span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${STRATEGY_LABELS[decision.recommended_strategy_code].color}`}>
                {STRATEGY_LABELS[decision.recommended_strategy_code].icon} {STRATEGY_LABELS[decision.recommended_strategy_code].label}
              </span>
              {decision.task_interval && <span className="text-[10px] text-slate-500">{decision.task_interval}</span>}
              <ChevronRight size={12} className="text-slate-400" />
            </button>
          ) : (
            <button
              onClick={onGoToStrategy}
              className="mt-2.5 flex items-center gap-1.5 px-2.5 py-1.5 bg-accent-cyan/5 border border-dashed border-accent-cyan/40 rounded-lg text-[10px] font-bold text-slate-700 hover:bg-accent-cyan/10 transition-colors"
            >
              Next: choose the maintenance strategy (Q6–Q7)
              <ChevronRight size={12} className="text-accent-cyan" />
            </button>
          )
        )}
      </div>

      {/* Risk reading + Specialist action */}
      <div className="lg:border-l lg:border-slate-200 lg:pl-4">
        <span className="text-[9px] font-bold text-primary-600 uppercase tracking-wider">Risk</span>
        <div className="flex items-center gap-2 mt-1.5">
          <span className={`px-2.5 py-1 rounded-lg border-2 text-sm font-bold tabular-nums ${band.bg} ${band.text} ${band.border}`}>
            {rpn || '—'}
          </span>
          <div className="flex-1 min-w-0">
            <div className="h-2 bg-slate-200/70 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(rpn, 100)}%`, background: band.bar }} />
            </div>
            <div className="flex justify-between text-[8px] text-slate-400 mt-0.5">
              <span>0</span><span>25</span><span>50</span><span>75</span><span>100</span>
            </div>
          </div>
        </div>
        <p className="text-[10px] text-slate-400 mt-1.5">
          Severity × Occurrence, 1–10 each. {rpn > 0 ? `${band.label} risk band.` : 'Score the row to rank it.'}
        </p>

        <button
          onClick={() => (gate.ok ? onSpecialistComplete(fm) : onBlocked(gate.reason))}
          aria-disabled={busy}
          title={gate.reason}
          className={`w-full mt-3 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-bold border transition-all ${
            gate.ok
              ? 'bg-white text-primary-700 border-primary-200 hover:bg-primary-50 shadow-sm'
              : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'
          }`}
        >
          {busy ? <RefreshCw size={12} className="animate-spin" /> : gate.ok ? <Sparkles size={12} /> : <Lock size={12} />}
          Specialist: fill this row's blanks
        </button>
        <p className="text-[9px] text-slate-400 mt-1 text-center leading-relaxed">
          Writes cause, effects, S·O and consequence into empty cells only — your entries are never overwritten.
        </p>
        {fm.data_source !== 'manual' && (
          <p className="text-[9px] text-slate-400 mt-1.5 text-center">
            Source: {fm.data_source === 'ai_generated' ? 'Reliability Specialist' : fm.data_source === 'fmea_import' ? 'Imported FMEA' : 'Work order history'}
          </p>
        )}
      </div>
    </div>
  );
};

// ── Props ──────────────────────────────────────────────────
export interface RCMFMEATableProps {
  study: RCMStudy;
  functions: RCMFunction[];
  failureModes: RCMFailureMode[];
  decisions: Map<string, RCMDecision>;
  aiLoading: string | null;
  onAddFunction: () => void;
  onUpdateFunction: (id: string, updates: Partial<RCMFunction>) => void;
  onDeleteFunction: (id: string, name: string) => void;
  onAddFailureMode: (functionId: string) => void;
  onUpdateFailureMode: (id: string, updates: Partial<RCMFailureMode>) => void;
  onDeleteFailureMode: (id: string, name: string) => void;
  onUpdateDecision: (failureModeId: string, updates: Partial<RCMDecision>) => void;
  onSpecialistSuggestModes: (fn: RCMFunction) => void;
  onSpecialistCompleteRow: (fm: RCMFailureMode) => void;
  onBlocked: (reason: string) => void;
  /** Jump to the Strategy tab (Q6–Q7) — where a classified row goes next. */
  onGoToStrategy: () => void;
  /** Rendered above the worksheet — the Specialist bar. */
  header?: React.ReactNode;
}

const COL_COUNT = 12;

export const RCMFMEATable: React.FC<RCMFMEATableProps> = ({
  functions, failureModes, decisions, aiLoading,
  onAddFunction, onUpdateFunction, onDeleteFunction,
  onAddFailureMode, onUpdateFailureMode, onDeleteFailureMode,
  onUpdateDecision, onSpecialistSuggestModes, onSpecialistCompleteRow, onBlocked,
  onGoToStrategy, header,
}) => {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());

  const toggleFn = (id: string) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleRow = (id: string) => setOpenRows(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const allCollapsed = functions.length > 0 && collapsed.size === functions.length;
  const toggleAll = () => setCollapsed(allCollapsed ? new Set() : new Set(functions.map(f => f.id)));

  const modesByFn = useMemo(() => {
    const map = new Map<string, RCMFailureMode[]>();
    failureModes.forEach(fm => {
      const list = map.get(fm.function_id);
      if (list) list.push(fm); else map.set(fm.function_id, [fm]);
    });
    return map;
  }, [failureModes]);

  const th = 'px-2 py-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-500 border border-slate-200 bg-slate-50';

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      {header}

      {/* Worksheet toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="text-sm font-bold text-slate-700">FMEA Worksheet</h3>
        <span className="text-[10px] font-semibold text-slate-400">Q1–Q5 · SAE JA1011</span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-slate-400">
            {functions.length} function{functions.length !== 1 ? 's' : ''} · {failureModes.length} failure mode{failureModes.length !== 1 ? 's' : ''}
          </span>
          {functions.length > 0 && (
            <button
              onClick={toggleAll}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-semibold text-slate-600 hover:border-slate-300 transition-colors"
            >
              {allCollapsed ? <ChevronsUpDown size={12} /> : <ChevronsDownUp size={12} />}
              {allCollapsed ? 'Expand all' : 'Collapse all'}
            </button>
          )}
        </div>
      </div>

      {functions.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center shadow-sm">
          <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-slate-50 flex items-center justify-center">
            <Layers size={28} className="text-slate-300" />
          </div>
          <p className="text-sm font-semibold text-slate-500">The worksheet is empty</p>
          <p className="text-xs text-slate-400 mt-1">Add a function, or let the Reliability Specialist draft the study from the asset and its operating context.</p>
          <button
            onClick={onAddFunction}
            className="mt-4 inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 hover:border-accent-cyan hover:text-accent-cyan transition-colors"
          >
            <Plus size={14} /> Add Function
          </button>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse" style={{ minWidth: 1160 }}>
              <colgroup>
                <col style={{ width: 30 }} />
                <col style={{ width: 38 }} />
                <col style={{ width: '17%' }} />
                <col style={{ width: '16%' }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: 44 }} />
                <col style={{ width: 44 }} />
                <col style={{ width: 56 }} />
                <col style={{ width: 132 }} />
                <col style={{ width: 56 }} />
              </colgroup>

              <thead>
                {/* Band row — the FMEA column families */}
                <tr>
                  <th className={th} colSpan={2} />
                  <th className={`${th} !text-primary-600 !bg-primary-50/60`} colSpan={2}>Failure mode &amp; cause — Q3</th>
                  <th className={`${th} !text-amber-600 !bg-amber-50/60`} colSpan={3}>Failure effects — Q4</th>
                  <th className={`${th} !text-slate-600`} colSpan={3}>Risk (S × O)</th>
                  <th className={`${th} !text-red-600 !bg-red-50/50`}>Consequence — Q5</th>
                  <th className={th} />
                </tr>
                <tr>
                  <th className={th} />
                  <th className={th}>#</th>
                  <th className={`${th} text-left`}>Failure Mode</th>
                  <th className={`${th} text-left`}>Cause</th>
                  <th className={`${th} text-left`}>Local</th>
                  <th className={`${th} text-left`}>System</th>
                  <th className={`${th} text-left !text-red-600`}>End Effect ⚠</th>
                  <th className={th} title="Severity 1–10">S</th>
                  <th className={th} title="Occurrence 1–10">O</th>
                  <th className={th}>RPN</th>
                  <th className={th}>Class</th>
                  <th className={th} />
                </tr>
              </thead>

              {functions.map(fn => {
                const fnFMs = modesByFn.get(fn.id) || [];
                const isOpen = !collapsed.has(fn.id);
                const accent = FN_ACCENTS[fn.function_type] || FN_ACCENTS.primary;
                const expandGate = canSpecialistExpandFunction(fn);
                const suggesting = aiLoading === `modes-${fn.id}`;
                const doneRows = fnFMs.filter(fm => isRowComplete(fm, decisions.get(fm.id))).length;

                return (
                  <tbody key={fn.id} className="border-t-2 border-slate-200">
                    {/* ═══ Function band — Q1 + Q2, merged across the worksheet ═══ */}
                    <tr>
                      <td colSpan={COL_COUNT} className="p-0 border border-slate-200">
                        <div
                          className="px-2 py-2 cursor-pointer hover:bg-slate-50/80 transition-colors"
                          style={{ borderLeft: `4px solid ${accent}`, background: `linear-gradient(90deg, ${accent}0c, transparent 40%)` }}
                          onClick={() => toggleFn(fn.id)}
                        >
                          {/* Q1 — Function */}
                          <div className="flex items-center gap-2">
                            <span className="text-slate-400 shrink-0">
                              {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                            </span>
                            <span
                              className="text-[10px] font-bold px-2 py-0.5 rounded border shrink-0"
                              style={{ background: `${accent}18`, color: accent, borderColor: `${accent}45` }}
                            >
                              {fn.function_number || 'F'}
                            </span>
                            <input
                              type="text"
                              defaultValue={fn.function_description}
                              onClick={e => e.stopPropagation()}
                              onBlur={e => {
                                if (e.target.value !== (fn.function_description || '')) {
                                  onUpdateFunction(fn.id, { function_description: e.target.value });
                                }
                              }}
                              placeholder="Function — what the asset must do, with its performance standard"
                              className="flex-1 min-w-0 text-[13px] font-semibold text-slate-800 bg-transparent border border-transparent rounded px-1.5 py-1 hover:border-slate-200 focus:bg-white focus:border-primary-400 focus:outline-none transition-colors"
                            />
                            <span className="text-[10px] font-semibold text-slate-400 tabular-nums shrink-0 hidden sm:inline">
                              {doneRows}/{fnFMs.length} rows
                            </span>
                            <select
                              value={fn.function_type}
                              onClick={e => e.stopPropagation()}
                              onChange={e => onUpdateFunction(fn.id, { function_type: e.target.value as RCMFunction['function_type'] })}
                              className="text-[9px] font-bold uppercase bg-white border border-slate-200 rounded px-1.5 py-1 text-slate-500 cursor-pointer focus:border-accent-cyan focus:outline-none shrink-0"
                            >
                              <option value="primary">Primary</option>
                              <option value="secondary">Secondary</option>
                              <option value="protective">Protective</option>
                            </select>
                            <button
                              onClick={e => {
                                e.stopPropagation();
                                if (expandGate.ok) onSpecialistSuggestModes(fn);
                                else onBlocked(expandGate.reason);
                              }}
                              title={expandGate.reason}
                              aria-disabled={suggesting}
                              className={`p-1.5 rounded transition-colors shrink-0 ${
                                expandGate.ok ? 'text-primary-500 hover:bg-primary-50' : 'text-slate-300 hover:bg-slate-100'
                              }`}
                            >
                              {suggesting ? <RefreshCw size={13} className="animate-spin" /> : expandGate.ok ? <Sparkles size={13} /> : <Lock size={13} />}
                            </button>
                            <button
                              onClick={e => { e.stopPropagation(); onDeleteFunction(fn.id, `${fn.function_number}: ${fn.function_description || 'Unnamed'}`); }}
                              className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors shrink-0"
                              title="Delete function"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>

                          {/* Q2 — Functional failure */}
                          <div className="flex items-center gap-2 mt-1 pl-[22px]">
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-cyan-50 text-cyan-700 border-cyan-200 shrink-0">
                              {fn.function_number ? fn.function_number.replace(/^F/i, 'FF') : 'FF'}
                            </span>
                            <span className="text-[9px] text-slate-400 italic shrink-0 hidden md:inline">Functional failure — how it fails</span>
                            <input
                              type="text"
                              defaultValue={fn.functional_failure || ''}
                              onClick={e => e.stopPropagation()}
                              onBlur={e => {
                                if (e.target.value !== (fn.functional_failure || '')) {
                                  onUpdateFunction(fn.id, { functional_failure: e.target.value });
                                }
                              }}
                              placeholder="e.g. Unable to separate crude oil into specified fractions"
                              className="flex-1 min-w-0 text-[11px] text-slate-600 bg-transparent border border-transparent rounded px-1.5 py-0.5 hover:border-slate-200 focus:bg-white focus:border-primary-400 focus:outline-none transition-colors"
                            />
                            <RCMContextualHelp
                              question="Identify all the ways the function can fail — total loss, partial loss, or degraded performance."
                              standard="SAE JA1012 Step 2"
                            />
                          </div>
                        </div>
                      </td>
                    </tr>

                    {/* ═══ Failure mode rows — Q3, Q4, risk, Q5 ═══ */}
                    {isOpen && fnFMs.length === 0 && (
                      <tr>
                        <td colSpan={COL_COUNT} className="border border-slate-200 px-4 py-3 text-[11px] text-slate-400 italic bg-slate-50/40">
                          No failure modes yet — add a row, or use the Specialist to propose them for this function.
                        </td>
                      </tr>
                    )}

                    {isOpen && fnFMs.map((fm, idx) => {
                      const decision = decisions.get(fm.id);
                      const rpn = (fm.severity || 0) * (fm.occurrence || 0);
                      const band = rpnBand(rpn);
                      const rowOpen = openRows.has(fm.id);
                      const rowGate = canSpecialistCompleteRow(fn, fm);
                      const complete = isRowComplete(fm, decision);
                      const td = 'border border-slate-200 align-top p-0.5';

                      return (
                        <React.Fragment key={fm.id}>
                          <tr className={`${rowOpen ? 'bg-primary-50/30' : idx % 2 ? 'bg-slate-50/40' : 'bg-white'} hover:bg-primary-50/20 transition-colors group/row`}>
                            <td className={`${td} text-center`}>
                              <button
                                onClick={() => toggleRow(fm.id)}
                                className="p-1 text-slate-300 hover:text-primary-500 rounded transition-colors"
                                title={rowOpen ? 'Hide consequence & risk detail' : 'Show consequence & risk detail'}
                              >
                                {rowOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                              </button>
                            </td>
                            <td className={`${td} text-center`}>
                              <span
                                className={`inline-flex items-center justify-center w-5 h-5 rounded text-[9px] font-bold ${
                                  complete ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                                }`}
                                title={complete ? 'Row complete' : 'Row incomplete'}
                              >
                                {idx + 1}
                              </span>
                            </td>
                            <td className={td}>
                              <GridCell
                                label="Failure mode"
                                value={fm.failure_mode_description}
                                placeholder="What failed? e.g. Shaft seal leaking"
                                onCommit={v => onUpdateFailureMode(fm.id, { failure_mode_description: v })}
                              />
                            </td>
                            <td className={td}>
                              <GridCell
                                label="Cause"
                                value={fm.failure_cause_description}
                                placeholder="Why? e.g. Wear, corrosion, fatigue"
                                onCommit={v => onUpdateFailureMode(fm.id, { failure_cause_description: v })}
                              />
                            </td>
                            <td className={td}>
                              <GridCell
                                label="Local effect"
                                value={fm.failure_effect_local}
                                placeholder="Component level"
                                onCommit={v => onUpdateFailureMode(fm.id, { failure_effect_local: v })}
                              />
                            </td>
                            <td className={td}>
                              <GridCell
                                label="System effect"
                                value={fm.failure_effect_system}
                                placeholder="System level"
                                onCommit={v => onUpdateFailureMode(fm.id, { failure_effect_system: v })}
                              />
                            </td>
                            <td className={td}>
                              {/* Older imported / drafted rows stored the plant-level
                                  effect in failure_effect_plant — read either, and
                                  write both so the two stay in step. */}
                              <GridCell
                                label="End effect"
                                tone="warn"
                                value={fm.end_effect || fm.failure_effect_plant}
                                placeholder="Plant / production impact"
                                onCommit={v => onUpdateFailureMode(fm.id, { end_effect: v, failure_effect_plant: v })}
                              />
                            </td>
                            <td className={td}>
                              <GridCell
                                label="Severity 1–10" numeric
                                value={fm.severity} placeholder="—"
                                onCommit={v => onUpdateFailureMode(fm.id, { severity: v === '' ? null : parseInt(v, 10) || null })}
                              />
                            </td>
                            <td className={td}>
                              <GridCell
                                label="Occurrence 1–10" numeric
                                value={fm.occurrence} placeholder="—"
                                onCommit={v => onUpdateFailureMode(fm.id, { occurrence: v === '' ? null : parseInt(v, 10) || null })}
                              />
                            </td>
                            <td className={`${td} text-center`}>
                              {rpn > 0 ? (
                                <span
                                  className={`inline-block w-full px-1 py-1.5 rounded text-[11px] font-bold tabular-nums border ${band.bg} ${band.text} ${band.border}`}
                                  title={`${band.label} risk`}
                                >
                                  {rpn}
                                </span>
                              ) : (
                                <span className="text-[11px] text-slate-300">—</span>
                              )}
                            </td>
                            <td className={`${td} px-1.5 py-1.5`}>
                              <ConsequenceCell decision={decision} onOpen={() => toggleRow(fm.id)} />
                            </td>
                            <td className={`${td} text-center whitespace-nowrap`}>
                              <button
                                onClick={() => (rowGate.ok ? onSpecialistCompleteRow(fm) : onBlocked(rowGate.reason))}
                                title={rowGate.reason}
                                aria-disabled={aiLoading === `complete-${fm.id}`}
                                className={`p-1 rounded transition-colors ${
                                  rowGate.ok ? 'text-primary-500 hover:bg-primary-50' : 'text-slate-300 hover:bg-slate-100'
                                }`}
                              >
                                {aiLoading === `complete-${fm.id}`
                                  ? <RefreshCw size={12} className="animate-spin" />
                                  : rowGate.ok ? <Sparkles size={12} /> : <Lock size={12} />}
                              </button>
                              <button
                                onClick={() => onDeleteFailureMode(fm.id, fm.failure_mode_description || 'Unnamed')}
                                className="p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                                title="Delete row"
                              >
                                <Trash2 size={12} />
                              </button>
                            </td>
                          </tr>

                          {rowOpen && (
                            <tr>
                              <td colSpan={COL_COUNT} className="border border-slate-200 p-0">
                                <RowDetail
                                  fm={fm}
                                  decision={decision}
                                  gate={rowGate}
                                  aiLoading={aiLoading}
                                  onUpdateDecision={onUpdateDecision}
                                  onSpecialistComplete={onSpecialistCompleteRow}
                                  onBlocked={onBlocked}
                                  onGoToStrategy={onGoToStrategy}
                                />
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}

                    {isOpen && (
                      <tr>
                        <td colSpan={COL_COUNT} className="border border-slate-200 px-2 py-1.5 bg-white">
                          <button
                            onClick={() => onAddFailureMode(fn.id)}
                            className="text-[11px] text-accent-cyan hover:text-primary-500 font-semibold flex items-center gap-1.5 px-2 py-1 rounded hover:bg-accent-cyan/5 transition-colors"
                          >
                            <Plus size={12} /> Add failure mode row
                          </button>
                        </td>
                      </tr>
                    )}
                  </tbody>
                );
              })}
            </table>
          </div>

          {/* Worksheet footer — add function */}
          <div className="px-3 py-2 bg-slate-50/60 border-t border-slate-200">
            <button
              onClick={onAddFunction}
              className="text-[11px] font-semibold text-slate-600 hover:text-accent-cyan flex items-center gap-1.5 px-2 py-1 rounded transition-colors"
            >
              <Plus size={12} /> Add function
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default RCMFMEATable;
