/**
 * RCMDecisionWizard — Guided step-by-step SAE JA1012 decision logic (Q6–Q7)
 * Strategy selection and task details per failure mode.
 * Consequence classification (Q5) is handled in RCMFunctionPanel.
 */
import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  GitBranch, Sparkles, RefreshCw, ChevronDown, ChevronUp, Lock,
  Check, CheckCircle2, AlertTriangle, ShieldAlert,
} from 'lucide-react';
import type {
  RCMDecisionWizardProps,
} from './types';
import { CONSEQUENCE_OPTIONS, STRATEGY_LABELS, parseConsequenceCodes, hasSafetyConsequence } from './types';
import { canSpecialistRecommendStrategy } from '../../eam/services/rcmReadiness';



// ── Synced task field ───────────────────────────────────────
// Local state so the caret never jumps, debounced commit, and a re-sync when
// the stored value changes underneath while the field isn't focused — which is
// exactly what happens when the Specialist's recommendation (or "Use measured")
// writes task_description/interval/justification. The old `defaultValue`
// fields never re-rendered those writes, so the screen looked frozen even
// though the decision had updated.
const SyncedField: React.FC<{
  value: string | null | undefined;
  onCommit: (v: string) => void;
  placeholder?: string;
  rows?: number;
  label: string;
}> = ({ value, onCommit, placeholder, rows, label }) => {
  const incoming = value ?? '';
  const [local, setLocal] = useState(incoming);
  const focused = useRef(false);
  const committed = useRef(incoming);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!focused.current && incoming !== committed.current) {
      committed.current = incoming;
      setLocal(incoming);
    }
  }, [incoming]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

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
    className: 'w-full mt-1 px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:border-accent-cyan focus:outline-none',
  };
  return rows
    ? <textarea {...shared} rows={rows} onChange={e => handleChange(e.target.value)} style={{ resize: 'none' }} />
    : <input type="text" {...shared} onChange={e => handleChange(e.target.value)} />;
};

// ── Structured interval ─────────────────────────────────────
// The interval is the program's executable output — free text like "when
// needed" can't schedule anything. Value + unit compose a canonical string
// ("1700 Hours") that the PM generator parses losslessly. Legacy free text
// that doesn't parse is surfaced, not silently discarded.
const INTERVAL_UNITS = ['Hours', 'Days', 'Weeks', 'Months', 'Years'] as const;
type IntervalUnit = typeof INTERVAL_UNITS[number];

function parseIntervalText(text: string | null | undefined): { n: number | null; unit: IntervalUnit; raw: string } {
  const raw = (text || '').trim();
  const m = raw.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h\b|days?|d\b|weeks?|wks?|w\b|months?|mos?|years?|yrs?|y\b)/i);
  if (!m) return { n: null, unit: 'Months', raw };
  const u = m[2].toLowerCase();
  const unit: IntervalUnit = u.startsWith('h') ? 'Hours' : u.startsWith('d') ? 'Days' : u.startsWith('w') ? 'Weeks' : u.startsWith('y') ? 'Years' : 'Months';
  return { n: Math.max(1, Math.round(parseFloat(m[1]))), unit, raw };
}

const IntervalField: React.FC<{
  value: string | null | undefined;
  onCommit: (v: string | null) => void;
}> = ({ value, onCommit }) => {
  const parsed = parseIntervalText(value);
  const unparseable = !!parsed.raw && parsed.n === null;

  const commit = (n: number | null, unit: IntervalUnit) => {
    onCommit(n && n > 0 ? `${n} ${unit}` : null);
  };

  return (
    <div>
      <div className="flex items-center gap-1.5 mt-1">
        <input
          type="number" min={1} aria-label="Interval value"
          value={parsed.n ?? ''}
          placeholder="e.g. 3"
          onChange={e => commit(e.target.value === '' ? null : Math.max(1, parseInt(e.target.value, 10) || 0), parsed.unit)}
          className="w-20 px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:border-accent-cyan focus:outline-none text-center font-semibold tabular-nums"
        />
        <select
          aria-label="Interval unit"
          value={parsed.unit}
          onChange={e => commit(parsed.n ?? 1, e.target.value as IntervalUnit)}
          className="flex-1 px-2 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:border-accent-cyan focus:outline-none cursor-pointer"
        >
          {INTERVAL_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>
      {unparseable && (
        <p className="text-[10px] text-amber-600 mt-1" title={parsed.raw}>
          Was "{parsed.raw.slice(0, 30)}{parsed.raw.length > 30 ? '…' : ''}" — set a value and unit so the PM generator can schedule it.
        </p>
      )}
    </div>
  );
};

// ── Main Component ──────────────────────────────────────────
export const RCMDecisionWizard: React.FC<RCMDecisionWizardProps> = ({
  study, failureModes, functions, decisions, aiLoading, lifeEvidence, onUpdateDecision, onAIRecommend,
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

  // The Specialist recommends on request only. This used to auto-fire a paid AI
  // call for every unresolved failure mode the moment its card was expanded —
  // paging through a 16-mode study burned 16 Gemini calls with zero clicks.

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
        visibleModes.map((fm, fmIdx) => {
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
                        No consequence classified yet — answer Q5 on the <strong>Worksheet</strong> tab first. The strategy decision (and the Specialist) branch on it.
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

                  {/* Step 3: Task Details — HOW the chosen strategy is executed */}
                  <div className="space-y-3 border-t border-slate-100 pt-5">
                    <p className="text-[10px] text-slate-400 leading-relaxed">
                      {decision?.recommended_strategy_code
                        ? <>The task below is how <strong className="text-slate-600">{STRATEGY_LABELS[decision.recommended_strategy_code]?.label || 'the chosen strategy'}</strong> gets executed — switching strategy never rewrites your task text. Write it yourself, or use the <strong className="text-primary-600">Specialist</strong> button above to draft task, interval and justification together.</>
                        : <>Pick the strategy above first — the task below describes how it will be executed. Everything here autosaves as you type.</>}
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Task Description</label>
                        <SyncedField
                          label="Task description"
                          value={decision?.task_description}
                          onCommit={v => onUpdateDecision(fm.id, { task_description: v || null })}
                          placeholder="Describe the maintenance task..."
                          rows={2}
                        />
                      </div>
                      <div>
                        <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Interval</label>
                        <IntervalField
                          value={decision?.task_interval}
                          onCommit={v => onUpdateDecision(fm.id, { task_interval: v })}
                        />
                        {lifeEvidence && parseIntervalText(decision?.task_interval).n !== lifeEvidence.interval && (
                          <button
                            onClick={() => {
                              onUpdateDecision(fm.id, {
                                // Canonical structured form — what the PM generator parses.
                                task_interval: `${lifeEvidence.interval} Hours`,
                                justification: decision?.justification
                                  ? decision.justification
                                  : `Interval from measured Weibull fit: β=${lifeEvidence.beta.toFixed(2)}, η=${Math.round(lifeEvidence.eta).toLocaleString()} h, B10=${lifeEvidence.b10.toLocaleString()} h ("${lifeEvidence.source}").`,
                              });
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
                        <SyncedField
                          label="Task owner / craft"
                          value={decision?.task_owner_craft}
                          onCommit={v => onUpdateDecision(fm.id, { task_owner_craft: v || null })}
                          placeholder="e.g. Mechanical Technician"
                        />
                      </div>
                    </div>

                    {/* Justification */}
                    <div>
                      <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Justification</label>
                      <SyncedField
                        label="Justification"
                        value={decision?.justification}
                        onCommit={v => onUpdateDecision(fm.id, { justification: v || null })}
                        placeholder="Cost-benefit rationale for chosen strategy..."
                        rows={2}
                      />
                    </div>
                  </div>

                  {/* Specialist recommendation */}
                  {decision?.ai_recommendation && (
                    <div className="bg-gradient-to-r from-primary-50 to-primary-50 border border-primary-200/60 rounded-xl p-4 animate-in fade-in duration-300">
                      <div className="flex items-center gap-2 text-xs font-bold text-primary-700">
                        <Sparkles size={14} />
                        Specialist Recommendation
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
                            task_description: rec.reasoning?.substring(0, 200),
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
        )
      )}
    </div>
  );
};

export default RCMDecisionWizard;
