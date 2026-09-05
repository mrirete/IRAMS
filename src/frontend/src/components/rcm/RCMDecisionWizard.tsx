/**
 * RCMDecisionWizard — Guided step-by-step SAE JA1012 decision logic (Q6–Q7)
 * Strategy selection and task details per failure mode, and the PM each
 * decision becomes. Consequence classification (Q5) is handled on the Worksheet.
 */
import React, { useState, useMemo, useEffect, useRef, useLayoutEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  GitBranch, Sparkles, RefreshCw, ChevronDown, ChevronUp, Lock,
  Check, CheckCircle2, AlertTriangle, ShieldAlert, Clock, Activity, BrainCircuit,
  Zap, Wrench, Shuffle, ArrowUpRight, X,
} from 'lucide-react';
import type { RCMDecisionWizardProps } from './types';
import {
  CONSEQUENCE_OPTIONS, STRATEGY_LABELS, STRATEGY_TONES, parseConsequenceCodes, hasSafetyConsequence,
} from './types';
import { canSpecialistRecommendStrategy } from '../../eam/services/rcmReadiness';
import {
  INTERVAL_UNITS, parseIntervalText, canonicalInterval, strategyProducesPM, UUID_RE,
  type IntervalUnit, type AIRecommendation,
} from '../../eam/services/rcmPlan';

const STRATEGY_ICONS: Record<string, React.ReactNode> = {
  PM_TIME: <Clock size={13} />,
  PM_CONDITION: <Activity size={13} />,
  PM_PREDICTIVE: <BrainCircuit size={13} />,
  RTF: <Zap size={13} />,
  REDESIGN: <Wrench size={13} />,
  COMBINATION: <Shuffle size={13} />,
};

// ── Synced task field ───────────────────────────────────────
// Local state so the caret never jumps, debounced commit, and a re-sync when
// the stored value changes underneath while the field isn't focused — which is
// exactly what happens when the Specialist's recommendation (or "Use measured")
// writes task_description/interval/justification.
//
// Textareas grow with their content (between minRows and maxRows) — a fixed
// two-line box meant scrolling to read each sentence of a justification.
const SyncedField: React.FC<{
  value: string | null | undefined;
  onCommit: (v: string) => void;
  placeholder?: string;
  minRows?: number;
  maxRows?: number;
  label: string;
}> = ({ value, onCommit, placeholder, minRows, maxRows = 14, label }) => {
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
    'aria-label': label,
    onFocus: () => { focused.current = true; },
    onBlur: () => { focused.current = false; if (timer.current) clearTimeout(timer.current); commit(local); },
    className: 'w-full mt-1 px-3 py-2 text-sm leading-relaxed text-slate-800 bg-white border border-slate-200 rounded-lg focus:border-accent-cyan focus:ring-2 focus:ring-accent-cyan/20 focus:outline-none placeholder:text-slate-400',
  };
  return minRows
    ? <textarea ref={areaRef} {...shared} rows={minRows} onChange={e => handleChange(e.target.value)} style={{ resize: 'none' }} />
    : <input type="text" {...shared} onChange={e => handleChange(e.target.value)} />;
};

// ── Structured interval ─────────────────────────────────────
// The interval is the program's executable output — free text like "when
// needed" can't schedule anything. Value + unit compose a canonical string
// ("1700 Hours") that the PM generator parses losslessly. Legacy free text
// that doesn't parse is surfaced, not silently discarded.
const IntervalField: React.FC<{
  value: string | null | undefined;
  onCommit: (v: string | null) => void;
}> = ({ value, onCommit }) => {
  const parsed = parseIntervalText(value);
  const unparseable = !!parsed.raw && parsed.n === null;
  const isProse = parsed.n !== null && parsed.raw.length > 20;

  const commit = (n: number | null, unit: IntervalUnit) => onCommit(canonicalInterval(n, unit));

  return (
    <div>
      <div className="flex items-center gap-1.5 mt-1">
        <input
          type="number" min={1} aria-label="Interval value"
          value={parsed.n ?? ''}
          placeholder="e.g. 3"
          onChange={e => commit(e.target.value === '' ? null : Math.max(1, parseInt(e.target.value, 10) || 0), parsed.unit)}
          className="w-20 px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:border-accent-cyan focus:outline-none text-center font-semibold tabular-nums"
        />
        <select
          aria-label="Interval unit"
          value={parsed.unit}
          onChange={e => commit(parsed.n ?? 1, e.target.value as IntervalUnit)}
          className="flex-1 px-2 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:border-accent-cyan focus:outline-none cursor-pointer"
        >
          {INTERVAL_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>
      {unparseable && (
        <p className="text-[11px] text-amber-600 mt-1" title={parsed.raw}>
          Was "{parsed.raw.slice(0, 40)}{parsed.raw.length > 40 ? '…' : ''}" — set a value and unit so the PM generator can schedule it.
        </p>
      )}
      {isProse && (
        <button
          type="button"
          onClick={() => commit(parsed.n, parsed.unit)}
          className="text-[11px] text-amber-700 mt-1 text-left hover:underline"
          title={parsed.raw}
        >
          Stored as prose ("{parsed.raw.slice(0, 40)}…") — tap to keep just <strong>{parsed.n} {parsed.unit}</strong>.
        </button>
      )}
      {parsed.unit === 'Hours' && parsed.n !== null && (
        <p className="text-[11px] text-slate-500 mt-1">Running-hours cadence — the PM is served by meter readings, not the calendar.</p>
      )}
    </div>
  );
};

// ── Reasoning renderer ──────────────────────────────────────
// The Specialist writes "**bold**" and numbered steps in one paragraph. Break
// it into readable blocks instead of a three-line clamp nobody could read.
function reasoningBlocks(text: string): string[] {
  const t = String(text || '').replace(/\r/g, '').trim();
  if (!t) return [];
  const byLine = t.split(/\n+/).map(s => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const line of byLine) {
    // Split "1. **Q** … 2. **Q** …" run-ons into one block per step.
    const parts = line.split(/\s(?=\d+\.\s+\*\*)/);
    parts.forEach(p => { if (p.trim()) out.push(p.trim()); });
  }
  return out;
}

const Inline: React.FC<{ text: string }> = ({ text }) => {
  const segs = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {segs.map((seg, i) => seg.startsWith('**') && seg.endsWith('**')
        ? <strong key={i} className="font-semibold text-slate-800">{seg.slice(2, -2)}</strong>
        : <React.Fragment key={i}>{seg}</React.Fragment>)}
    </>
  );
};

const Reasoning: React.FC<{ text: string }> = ({ text }) => {
  const [open, setOpen] = useState(false);
  const blocks = useMemo(() => reasoningBlocks(text), [text]);
  if (blocks.length === 0) return null;
  const shown = open ? blocks : blocks.slice(0, 2);
  return (
    <div className="mt-2">
      <ol className="space-y-1.5">
        {shown.map((b, i) => (
          <li key={i} className="text-[13px] leading-relaxed text-slate-700"><Inline text={b} /></li>
        ))}
      </ol>
      {blocks.length > 2 && (
        <button type="button" onClick={() => setOpen(o => !o)} className="mt-1.5 text-[11px] font-bold text-primary-600 hover:underline">
          {open ? 'Show less' : `Show full reasoning (${blocks.length - 2} more step${blocks.length - 2 !== 1 ? 's' : ''})`}
        </button>
      )}
    </div>
  );
};

// ── Main Component ──────────────────────────────────────────
export const RCMDecisionWizard: React.FC<RCMDecisionWizardProps> = ({
  study, failureModes, functions, decisions, aiLoading, lifeEvidence,
  onUpdateDecision, onAIRecommend, onAcceptRecommendation, onDismissRecommendation, onCreatePM, pmGateFor,
}) => {
  const [expandedFM, setExpandedFM] = useState<string | null>(
    failureModes.length > 0 ? failureModes[0].id : null
  );

  // Where each mode stands in the Q5→Q7 flow — drives the filter chips so a
  // 16-mode study doesn't mean scrolling to find the unresolved ones.
  type StageFilter = 'all' | 'needs_q5' | 'needs_strategy' | 'done';
  const [stageFilter, setStageFilter] = useState<StageFilter>('all');
  const stageOf = (fmId: string): Exclude<StageFilter, 'all'> => {
    const d = decisions.get(fmId);
    if (!d?.consequence_code) return 'needs_q5';
    if (!d.recommended_strategy_code) return 'needs_strategy';
    return 'done';
  };
  const stageCounts = useMemo(() => {
    const c = { all: failureModes.length, needs_q5: 0, needs_strategy: 0, done: 0 };
    failureModes.forEach(fm => { c[stageOf(fm.id)]++; });
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failureModes, decisions]);
  const visibleModes = useMemo(
    () => stageFilter === 'all' ? failureModes : failureModes.filter(fm => stageOf(fm.id) === stageFilter),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [failureModes, decisions, stageFilter],
  );

  const fnMap = useMemo(() => new Map(functions.map(f => [f.id, f])), [functions]);
  const hasRegisteredAsset = !!study.asset_id && UUID_RE.test(study.asset_id);
  const raiseWOUrl = (desc: string) =>
    `/work-orders?action=create&type=CM${hasRegisteredAsset ? `&asset=${study.asset_id}` : ''}&title=${encodeURIComponent(`Redesign — ${desc}`)}`;

  // The Specialist recommends on request only. This used to auto-fire a paid AI
  // call for every unresolved failure mode the moment its card was expanded.

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

      {/* Stage filter — jump straight to the modes that still need work */}
      {failureModes.length > 1 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {([
            ['all', 'All', 'text-slate-700 border-slate-300 bg-white'],
            ['needs_q5', 'Needs consequence (Q5)', 'text-amber-700 border-amber-300 bg-amber-50'],
            ['needs_strategy', 'Needs strategy (Q6–Q7)', 'text-primary-700 border-primary-300 bg-primary-50'],
            ['done', 'Decided', 'text-emerald-700 border-emerald-300 bg-emerald-50'],
          ] as const).map(([key, label, tone]) => (
            <button
              key={key}
              onClick={() => setStageFilter(key)}
              className={`px-3 py-1.5 rounded-full border text-[11px] font-bold transition-all ${
                stageFilter === key ? `${tone} ring-2 ring-offset-1 ring-slate-300/60` : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
              }`}
            >
              {label} <span className="tabular-nums opacity-70">{stageCounts[key]}</span>
            </button>
          ))}
        </div>
      )}

      {/* Empty State */}
      {failureModes.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center shadow-sm">
          <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-primary-50 flex items-center justify-center">
            <GitBranch size={28} className="text-primary-300" />
          </div>
          <p className="text-sm font-semibold text-slate-500">No failure modes to evaluate</p>
          <p className="text-xs text-slate-400 mt-1">Fill the Worksheet (step 1) first — each failure mode found there gets its strategy decided here.</p>
        </div>
      ) : (
        visibleModes.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-400">
            Nothing in this stage — switch the filter above.
          </div>
        ) : (
        visibleModes.map((fm) => {
          const decision = decisions.get(fm.id);
          const isExpanded = expandedFM === fm.id;

          const parentFn = fnMap.get(fm.function_id);
          const consOpts = parseConsequenceCodes(decision?.consequence_code)
            .map(code => CONSEQUENCE_OPTIONS.find(c => c.code === code))
            .filter(Boolean);
          const stratCode = decision?.recommended_strategy_code || null;
          const stratOpt = stratCode ? STRATEGY_LABELS[stratCode] : null;
          const rec = (decision?.ai_recommendation ?? null) as AIRecommendation | null;
          const recApplied = !!rec?.accepted_at;
          const recStrat = rec?.strategy ? STRATEGY_LABELS[rec.strategy] : null;
          const pmGate = pmGateFor(fm);
          const pmBusy = aiLoading === `pm-${fm.id}`;
          const linkedPM = decision?.recurring_work_id || null;

          return (
            <div key={fm.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow">
              {/* Card Header */}
              <div
                className="px-5 py-4 cursor-pointer border-b border-slate-100 hover:bg-slate-50/50 transition-colors"
                onClick={() => setExpandedFM(isExpanded ? null : fm.id)}
              >
                <div className="flex items-center gap-3">
                  {/* Number by position in the full study, not the filtered view */}
                  <span className="text-[9px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md shrink-0">
                    FM-{failureModes.indexOf(fm) + 1}
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
                    {linkedPM && (
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200" title={`PM ${linkedPM} in Work Management`}>
                        ✓ PM
                      </span>
                    )}
                  </div>

                  {/* Specialist — gated on Q5 being answered; the page-level
                      handler re-checks and toasts the reason when blocked. */}
                  {(() => {
                    const recGate = canSpecialistRecommendStrategy(fm, decision);
                    const recBusy = aiLoading === `recommend-${fm.id}`;
                    return (
                      <button
                        onClick={(e) => { e.stopPropagation(); onAIRecommend(fm); }}
                        aria-disabled={recBusy}
                        title={recGate.reason}
                        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-colors shrink-0 border ${
                          recGate.ok
                            ? 'bg-primary-50 border-primary-200 text-primary-700 hover:bg-primary-100'
                            : 'bg-slate-100 border-slate-200 text-slate-500 hover:bg-slate-200'
                        }`}
                      >
                        {recBusy ? <RefreshCw size={11} className="animate-spin" /> : recGate.ok ? <Sparkles size={11} /> : <Lock size={11} />}
                        Specialist
                      </button>
                    );
                  })()}

                  <div className="text-slate-400 shrink-0">
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>
                </div>
              </div>

              {/* Card Body — Strategy (Q6) + Task Details (Q7) + the PM */}
              {isExpanded && (
                <div className="rcm-accordion-body px-5 py-5 space-y-5">

                  {/* Q5 summary — what was classified on the Worksheet */}
                  {consOpts.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Q5 consequence</span>
                      {consOpts.map(consOpt => consOpt && (
                        <span key={consOpt.code} className="inline-flex items-center gap-1.5 px-2.5 py-1 border rounded-lg text-xs font-semibold" style={{
                          background: `${consOpt.color}08`,
                          borderColor: `${consOpt.color}30`,
                          color: consOpt.color,
                        }}>
                          <span className="leading-none">{consOpt.icon}</span>
                          {consOpt.label}
                        </span>
                      ))}
                      {decision?.is_hidden_failure && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-primary-50 text-primary-700 border border-primary-200">
                          <ShieldAlert size={11} /> Hidden failure
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 p-3 bg-amber-50/60 border border-amber-200/50 rounded-xl">
                      <AlertTriangle size={14} className="text-amber-500 shrink-0" />
                      <span className="text-[11px] font-medium text-amber-700">
                        No consequence classified yet — answer Q5 on the <strong>Worksheet</strong> tab first. The strategy decision (and the Specialist) branch on it.
                      </span>
                    </div>
                  )}

                  {/* Q6–Q7: Strategy — compact pills, one colour each */}
                  <div className="space-y-2.5 border-t border-slate-100 pt-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Q6–Q7 · Maintenance strategy</span>
                      {stratOpt && <span className="text-[11px] text-slate-500">{stratOpt.hint}</span>}
                    </div>

                    {decision?.is_hidden_failure && (
                      <div className="flex items-start gap-2 p-2.5 bg-primary-50/60 border border-primary-200/50 rounded-lg">
                        <ShieldAlert size={13} className="text-primary-500 mt-0.5 shrink-0" />
                        <p className="text-[11px] text-primary-700 leading-relaxed">
                          <strong>SAE JA1012:</strong> hidden failures need a <strong>failure-finding</strong> task first (a Condition-Based check that the protective device still works). If none is applicable, consider Redesign.
                        </p>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      {Object.entries(STRATEGY_LABELS).map(([code, s]) => {
                        const selected = stratCode === code;
                        const tone = STRATEGY_TONES[code];
                        // RTF is not acceptable for Safety/Environmental consequences — evident OR hidden (SAE JA1012)
                        const isRTFBlocked = code === 'RTF' && hasSafetyConsequence(decision?.consequence_code);
                        const isFFHighlighted = code === 'PM_CONDITION' && decision?.is_hidden_failure && !selected;
                        return (
                          <button
                            key={code}
                            type="button"
                            onClick={() => !isRTFBlocked && onUpdateDecision(fm.id, { recommended_strategy_code: code })}
                            disabled={isRTFBlocked}
                            title={isRTFBlocked ? 'Run-to-Failure is not acceptable for safety or environmental consequences (SAE JA1012)' : s.hint}
                            aria-pressed={selected}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11px] font-bold transition-all ${
                              isRTFBlocked
                                ? 'border-slate-200 bg-slate-50 text-slate-400 line-through cursor-not-allowed'
                                : selected
                                  ? `${tone.selected} shadow-sm`
                                  : `bg-white ${tone.idle} ${isFFHighlighted ? 'ring-2 ring-offset-1 ring-cyan-300' : ''}`
                            }`}
                          >
                            {selected ? <Check size={12} /> : STRATEGY_ICONS[code]}
                            {s.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Task — HOW the chosen strategy is executed */}
                  <div className="space-y-3 border-t border-slate-100 pt-4">
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      {stratCode
                        ? <>How <strong className="text-slate-700">{STRATEGY_LABELS[stratCode]?.label || 'the chosen strategy'}</strong> gets executed. Switching strategy never rewrites your task text. Write it yourself, or let the <strong className="text-primary-600">Specialist</strong> draft task, interval and justification together.</>
                        : <>Pick the strategy above first — the task below describes how it will be executed. Everything here autosaves as you type.</>}
                    </p>

                    <div>
                      <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Task Description</label>
                      <SyncedField
                        label="Task description"
                        value={decision?.task_description}
                        onCommit={v => onUpdateDecision(fm.id, { task_description: v || null })}
                        placeholder="One imperative task for the technician — e.g. Replace ignitor plug and verify spark gap 2.0 mm"
                        minRows={2}
                        maxRows={6}
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Interval</label>
                        <IntervalField
                          value={decision?.task_interval}
                          onCommit={v => onUpdateDecision(fm.id, { task_interval: v })}
                        />
                        {lifeEvidence && parseIntervalText(decision?.task_interval).n !== lifeEvidence.interval && (
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
                        <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Task Owner / Craft</label>
                        <SyncedField
                          label="Task owner / craft"
                          value={decision?.task_owner_craft}
                          onCommit={v => onUpdateDecision(fm.id, { task_owner_craft: v || null })}
                          placeholder="e.g. Mechanical Technician"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Justification</label>
                      <SyncedField
                        label="Justification"
                        value={decision?.justification}
                        onCommit={v => onUpdateDecision(fm.id, { justification: v || null })}
                        placeholder="Why this task type and interval — failure pattern, P-F interval, consequence, cost-benefit."
                        minRows={3}
                        maxRows={14}
                      />
                    </div>
                  </div>

                  {/* Specialist recommendation */}
                  {rec && (
                    <div className={`border rounded-xl p-4 animate-in fade-in duration-300 ${recApplied ? 'bg-emerald-50/40 border-emerald-200/70' : 'bg-primary-50/50 border-primary-200/70'}`}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="flex items-center gap-1.5 text-xs font-bold text-primary-700">
                          <Sparkles size={14} /> Specialist Recommendation
                        </span>
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-primary-100 text-primary-600">
                          {Math.round((rec.confidence ?? 0) * 100)}% confidence
                        </span>
                        {recApplied && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-700 inline-flex items-center gap-1">
                            <CheckCircle2 size={10} /> Applied
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => onDismissRecommendation(fm)}
                          className="ml-auto p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-white/70"
                          title="Dismiss this recommendation"
                          aria-label="Dismiss recommendation"
                        >
                          <X size={13} />
                        </button>
                      </div>

                      {/* The draft — what Accept writes into the fields above */}
                      <div className="mt-3 grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 sm:pt-0.5">Strategy</span>
                        <span>
                          {recStrat
                            ? <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold ${recStrat.color}`}>{recStrat.icon} {recStrat.label}</span>
                            : <span className="text-slate-500">{rec.strategy || '—'}</span>}
                          {rec.suggested_technology && <span className="ml-2 text-slate-500">· {rec.suggested_technology}</span>}
                        </span>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 sm:pt-0.5">Task</span>
                        <span className="text-slate-800">{rec.task_description || <span className="text-slate-400 italic">not drafted — write it above</span>}</span>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 sm:pt-0.5">Interval</span>
                        <span className="text-slate-800">
                          {canonicalInterval(rec.interval_value, rec.interval_unit)
                            || (rec.suggested_interval ? <span className="text-amber-700" title={rec.suggested_interval}>"{rec.suggested_interval.slice(0, 60)}{rec.suggested_interval.length > 60 ? '…' : ''}" — no single value; set it above</span> : <span className="text-slate-400 italic">none (default action)</span>)}
                          {rec.task_owner_craft && <span className="ml-2 text-slate-500">· {rec.task_owner_craft}</span>}
                        </span>
                        {rec.justification && (
                          <>
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 sm:pt-0.5">Why</span>
                            <span className="text-slate-700 leading-relaxed">{rec.justification}</span>
                          </>
                        )}
                      </div>

                      <Reasoning text={rec.reasoning} />

                      <div className="mt-3 flex items-center gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={() => onAcceptRecommendation(fm)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold rounded-lg transition-colors ${
                            recApplied
                              ? 'bg-white border border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                              : 'bg-primary-600 hover:bg-primary-500 text-white'
                          }`}
                          title={recApplied ? 'Write the recommendation into the fields again (overwrites your edits)' : 'Write strategy, task, interval, craft and justification into the fields above'}
                        >
                          <Check size={12} /> {recApplied ? 'Re-apply' : 'Accept recommendation'}
                        </button>
                        <span className="text-[11px] text-slate-500">
                          {recApplied ? 'Fields above hold this draft — edit them freely.' : 'Fills the fields above; nothing is created in Work Management yet.'}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* The PM this decision becomes */}
                  <div className="border-t border-slate-100 pt-4 flex items-center gap-3 flex-wrap">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Work Management</span>
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
                      <span className="text-[11px] text-slate-500">Run-to-Failure schedules no task — corrective work is raised when it fails.</span>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => onCreatePM(fm)}
                          aria-disabled={pmBusy}
                          title={pmGate.reason}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-colors ${
                            pmGate.ok
                              ? 'bg-accent-cyan/10 border-accent-cyan/40 text-slate-800 hover:bg-accent-cyan/20'
                              : 'bg-slate-100 border-slate-200 text-slate-500 hover:bg-slate-200'
                          }`}
                        >
                          {pmBusy ? <RefreshCw size={12} className="animate-spin" /> : pmGate.ok ? <Wrench size={12} /> : <Lock size={12} />}
                          Create PM in Work Management
                        </button>
                        {!pmGate.ok && strategyProducesPM(stratCode) && (
                          <span className="text-[11px] text-slate-500">Still missing: {pmGate.missing.join(', ')}.</span>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })
        )
      )}
    </div>
  );
};

export default RCMDecisionWizard;
