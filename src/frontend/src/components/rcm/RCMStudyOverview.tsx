/**
 * RCMStudyOverview — the Dashboard tab inside a selected study.
 * A calm health card: completion, stage counts, risk profile, WM link, next step,
 * and (0317) the operating context the study was analysed against.
 */
import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Layers, GitBranch, Wrench, Users, ArrowUpRight, ArrowRight,
  AlertTriangle, FileText, Boxes, Gauge, RefreshCw,
} from 'lucide-react';
import { AvatarStack } from '../analyze/CollaboratorPicker';
import { computeCompletionPct } from '../../eam/services/RCMService';
import type {
  RCMStudy, RCMFunction, RCMFailureMode, RCMDecision, RCMTaskSummary, StudyCollaborator,
} from './types';
import {
  contextChangedSince, contextCompleteness, deviationFlag, utilisationOf, hasAnyValue,
  OPERATING_MODES, REDUNDANCY_OPTIONS, type AssetOperatingContext,
} from '../../lib/operatingContext';
import { breakdownCoverage, isEmptyBreakdown, type AssetBreakdown } from '../../lib/rcmBreakdown';

interface RCMStudyOverviewProps {
  study: RCMStudy;
  functions: RCMFunction[];
  failureModes: RCMFailureMode[];
  decisions: Map<string, RCMDecision>;
  taskSummaries: RCMTaskSummary[];
  collaborators: StudyCollaborator[];
  onNavigate: (tab: 'functions' | 'decisions' | 'tasks' | 'evidence') => void;
  onInviteTeam: () => void;
  onEditStudy: () => void;
  /** The asset's CURRENT register context (0317) — compared with the study's snapshot. */
  liveContext?: AssetOperatingContext | null;
  /** Re-snapshot from the register; absent when the study has no register asset. */
  onRefreshContext?: () => void;
  /** 0318 — the asset's registered components + BOM, for the coverage card. */
  breakdown?: AssetBreakdown;
}

const StatChip: React.FC<{
  label: string; value: string; icon: React.ReactNode; onClick: () => void; done: boolean;
}> = ({ label, value, icon, onClick, done }) => (
  <button
    onClick={onClick}
    className="flex items-center gap-2.5 p-3 bg-white border border-slate-200 rounded-xl shadow-sm hover:border-accent-cyan/50 hover:shadow-md transition-all text-left min-w-0"
  >
    <div className={`p-2 rounded-lg shrink-0 ${done ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-50 text-slate-400'}`}>
      {icon}
    </div>
    <div className="min-w-0">
      <p className="text-base font-bold text-slate-800 tabular-nums leading-tight">{value}</p>
      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider truncate">{label}</p>
    </div>
  </button>
);

const Chip: React.FC<{ tone?: 'muted' | 'warn' | 'danger'; children: React.ReactNode }> = ({ tone = 'muted', children }) => (
  <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${
    tone === 'danger' ? 'bg-red-50 text-red-700 border-red-200'
      : tone === 'warn' ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
    {children}
  </span>
);

export const RCMStudyOverview: React.FC<RCMStudyOverviewProps> = ({
  study, functions, failureModes, decisions, taskSummaries, collaborators,
  onNavigate, onInviteTeam, onEditStudy, liveContext, onRefreshContext, breakdown,
}) => {
  // Physical-breakdown coverage (0318): which registered components have a failure mode
  const coverage = useMemo(() => breakdownCoverage(breakdown, failureModes), [breakdown, failureModes]);
  const hasBreakdown = !isEmptyBreakdown(breakdown);
  // Structured context the study was analysed against (0317)
  const snap = study.context_snapshot?.context ?? null;
  const snapDone = contextCompleteness(snap);
  const contextStale = contextChangedSince(study.context_snapshot, liveContext);
  const snapParams = (snap?.parameters || []).filter(hasAnyValue);
  const aboveDesign = snapParams.filter(p => deviationFlag(p) === 'above_design');
  const decisionList = useMemo(() => Array.from(decisions.values()), [decisions]);
  const decidedCount = decisionList.filter(d => !!d.consequence_code).length;
  const strategyCount = decisionList.filter(d => !!d.recommended_strategy_code).length;
  const pmCount = decisionList.filter(d => !!d.recurring_work_id).length;
  const fmCount = failureModes.length;

  const completion = computeCompletionPct(functions.length, fmCount, decidedCount, strategyCount);

  // RPN risk profile
  const risk = useMemo(() => {
    const buckets = { critical: 0, high: 0, medium: 0, low: 0 };
    failureModes.forEach(fm => {
      const rpn = (fm.severity || 0) * (fm.occurrence || 0);
      if (rpn === 0) return;
      if (rpn > 80) buckets.critical++;
      else if (rpn > 50) buckets.high++;
      else if (rpn > 25) buckets.medium++;
      else buckets.low++;
    });
    return buckets;
  }, [failureModes]);
  const riskTotal = risk.critical + risk.high + risk.medium + risk.low;

  // Next step nudge — first incomplete stage of the workflow
  const nextStep = useMemo(() => {
    if (functions.length === 0) return { tab: 'functions' as const, label: 'Define the asset functions (Q1)' };
    if (fmCount === 0) return { tab: 'functions' as const, label: 'Capture failure modes (Q3)' };
    if (decidedCount < fmCount) return { tab: 'functions' as const, label: `Classify consequences — ${fmCount - decidedCount} remaining (Q5)` };
    if (strategyCount < fmCount) return { tab: 'decisions' as const, label: `Select strategies — ${fmCount - strategyCount} remaining (Q6–Q7)` };
    if (pmCount === 0) return { tab: 'tasks' as const, label: 'Generate the PM schedule into Work Management' };
    return { tab: 'evidence' as const, label: 'Check the study against live asset data' };
  }, [functions.length, fmCount, decidedCount, strategyCount, pmCount]);

  const wmQuery = `RCM-${study.id.slice(0, 8)}`;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const hasRegisteredAsset = !!study.asset_id && UUID_RE.test(study.asset_id);

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      {/* No-asset warning — Evidence + PM generation need a registered asset */}
      {!study.asset_id && (
        <button
          onClick={onEditStudy}
          className="w-full flex items-center gap-2.5 px-3.5 py-3 bg-amber-50 border border-amber-200 rounded-xl text-left hover:bg-amber-100/70 transition-colors"
        >
          <AlertTriangle size={16} className="text-amber-500 shrink-0" />
          <span className="text-xs text-amber-800 min-w-0">
            <strong>No asset linked.</strong> PM generation and the Evidence check need one — tap to edit the study and link an asset.
          </span>
        </button>
      )}
      {/* Completion card */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Study Completion</p>
            <p className="text-2xl font-bold text-slate-800 tabular-nums mt-0.5">{completion}%</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {collaborators.length > 0
              ? <AvatarStack collaborators={collaborators} max={4} size="sm" />
              : (
                <button onClick={onInviteTeam} className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold text-primary-600 bg-primary-50 border border-primary-200 rounded-lg hover:bg-primary-100 transition-colors">
                  <Users size={12} /> Invite Team
                </button>
              )}
          </div>
        </div>
        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden mt-3">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${completion}%`,
              background: completion > 75 ? '#10b981' : completion > 40 ? '#3b82f6' : '#f59e0b',
            }}
          />
        </div>
        {/* Next step */}
        <button
          onClick={() => onNavigate(nextStep.tab)}
          className="mt-3 w-full flex items-center justify-between gap-2 px-3 py-2.5 bg-accent-cyan/5 border border-dashed border-accent-cyan/40 rounded-lg hover:bg-accent-cyan/10 transition-colors text-left"
        >
          <span className="text-xs font-semibold text-slate-700 min-w-0 truncate">
            <span className="text-accent-cyan font-bold">Next:</span> {nextStep.label}
          </span>
          <ArrowRight size={14} className="text-accent-cyan shrink-0" />
        </button>
      </div>

      {/* Stage stats — tap to jump */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        <StatChip label="Functions" value={`${functions.length}`} icon={<Layers size={16} />} done={functions.length > 0} onClick={() => onNavigate('functions')} />
        <StatChip label="Failure Modes" value={`${fmCount}`} icon={<AlertTriangle size={16} />} done={fmCount > 0} onClick={() => onNavigate('functions')} />
        <StatChip label="Decisions" value={`${strategyCount}/${fmCount}`} icon={<GitBranch size={16} />} done={fmCount > 0 && strategyCount === fmCount} onClick={() => onNavigate('decisions')} />
        <StatChip label="PM Tasks" value={`${pmCount}`} icon={<Wrench size={16} />} done={pmCount > 0} onClick={() => onNavigate('tasks')} />
      </div>

      {/* Risk profile — counts of failure modes per RPN band, not RPN values.
          The old legend ("Low 2") read like an RPN of 2. */}
      {riskTotal > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-sm">
          <div className="flex items-baseline justify-between gap-2 mb-3 flex-wrap">
            <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Risk Profile</h3>
            <span className="text-[10px] text-slate-400">
              {riskTotal} of {fmCount} failure mode{fmCount !== 1 ? 's' : ''} scored (RPN = S × O)
              {riskTotal < fmCount && <> · <button onClick={() => onNavigate('functions')} className="font-bold text-accent-cyan hover:underline">score the rest</button></>}
            </span>
          </div>
          <div className="flex h-3 rounded-full overflow-hidden bg-slate-100">
            {risk.critical > 0 && <div style={{ flex: risk.critical }} className="bg-red-500" title={`Critical (RPN > 80): ${risk.critical} modes`} />}
            {risk.high > 0 && <div style={{ flex: risk.high }} className="bg-amber-500" title={`High (RPN 51–80): ${risk.high} modes`} />}
            {risk.medium > 0 && <div style={{ flex: risk.medium }} className="bg-primary-500" title={`Medium (RPN 26–50): ${risk.medium} modes`} />}
            {risk.low > 0 && <div style={{ flex: risk.low }} className="bg-emerald-500" title={`Low (RPN 1–25): ${risk.low} modes`} />}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5 text-[10px] text-slate-500">
            {([['Critical', '> 80', risk.critical, 'bg-red-500'], ['High', '51–80', risk.high, 'bg-amber-500'], ['Medium', '26–50', risk.medium, 'bg-primary-500'], ['Low', '1–25', risk.low, 'bg-emerald-500']] as const)
              .filter(([, , n]) => n > 0)
              .map(([label, range, n, dot]) => (
                <span key={label} className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${dot}`} />
                  {label} <span className="text-slate-400">(RPN {range})</span>
                  <strong className="text-slate-700">{n} mode{n !== 1 ? 's' : ''}</strong>
                </span>
              ))}
          </div>
        </div>
      )}

      {/* Work Management link */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`p-2 rounded-lg shrink-0 ${pmCount > 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-50 text-slate-400'}`}>
              <Boxes size={18} />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-700">Work Management</p>
              <p className="text-[10px] text-slate-400 mt-0.5 truncate">
                {pmCount > 0
                  ? `${pmCount} PM task${pmCount !== 1 ? 's' : ''} generated from this study`
                  : 'No PM tasks generated yet — complete decisions, then generate the schedule'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {pmCount > 0 ? (
              <Link
                to={`/recurring-work?q=${wmQuery}`}
                className="flex items-center gap-1.5 px-3 py-2 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors"
              >
                View PMs <ArrowUpRight size={12} />
              </Link>
            ) : (
              <button
                onClick={() => onNavigate('tasks')}
                className="flex items-center gap-1.5 px-3 py-2 text-[10px] font-bold text-slate-600 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors"
              >
                Task Output <ArrowRight size={12} />
              </button>
            )}
            <Link
              to={`/work-orders?action=create&type=CM${hasRegisteredAsset ? `&asset=${study.asset_id}` : ''}&title=${encodeURIComponent(`Corrective — ${study.title}`)}`}
              title="Raise a corrective work order against this asset"
              className="flex items-center gap-1.5 px-3 py-2 text-[10px] font-bold text-primary-700 bg-primary-50 border border-primary-200 rounded-lg hover:bg-primary-100 transition-colors"
            >
              Raise WO <ArrowUpRight size={12} />
            </Link>
          </div>
        </div>
      </div>

      {/* Physical breakdown — ISO 14224 L7–L9 coverage (0318) */}
      {hasBreakdown && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-sm">
          <div className="flex items-baseline justify-between gap-2 mb-2 flex-wrap">
            <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Boxes size={11} /> Physical breakdown
            </h3>
            <span className="text-[10px] text-slate-400">
              {breakdown!.components.length} component{breakdown!.components.length !== 1 ? 's' : ''} · {breakdown!.parts.length} BOM line{breakdown!.parts.length !== 1 ? 's' : ''}
              {breakdown!.components.length > 0 && <> · <strong className={coverage.pct === 100 ? 'text-emerald-600' : 'text-slate-600'}>{coverage.pct}%</strong> with a failure mode</>}
            </span>
          </div>
          {breakdown!.components.length > 0 && (
            <>
              <div className="flex h-2 rounded-full overflow-hidden bg-slate-100 mb-2.5">
                <div style={{ width: `${coverage.pct}%` }} className={coverage.pct === 100 ? 'bg-emerald-500' : 'bg-primary-500'} />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {coverage.covered.map(({ component, modeCount }) => (
                  <Chip key={component.id}>{component.tag} · {modeCount} mode{modeCount !== 1 ? 's' : ''}</Chip>
                ))}
                {coverage.uncovered.map(c => (
                  <Chip key={c.id} tone="warn">{c.tag} · none yet</Chip>
                ))}
              </div>
            </>
          )}
          <p className="text-[11px] text-slate-500 mt-2.5">
            {coverage.uncovered.length > 0
              ? <>{coverage.uncovered.length} component{coverage.uncovered.length !== 1 ? 's' : ''} without a failure mode — JA1011 asks whether every reasonably likely mode was identified. Pin modes on the <button onClick={() => onNavigate('functions')} className="font-bold text-accent-cyan hover:underline">Worksheet</button>, or let the Specialist draft through the breakdown.</>
              : coverage.unpinned > 0
                ? <>{coverage.unpinned} failure mode{coverage.unpinned !== 1 ? 's' : ''} not pinned to a component — pin them on the <button onClick={() => onNavigate('functions')} className="font-bold text-accent-cyan hover:underline">Worksheet</button> so the study reads per component.</>
                : breakdown!.parts.length > 0 && coverage.partsReferenced === 0
                  ? <>{breakdown!.parts.filter(p => p.critical).length} critical spare{breakdown!.parts.filter(p => p.critical).length !== 1 ? 's' : ''} on the BOM and no failure mode names one yet.</>
                  : <>Every registered component is covered; {coverage.partsReferenced} BOM line{coverage.partsReferenced !== 1 ? 's' : ''} referenced.</>}
          </p>
        </div>
      )}

      {/* Register context moved on since the study snapshotted it */}
      {contextStale && onRefreshContext && (
        <button
          onClick={onRefreshContext}
          className="w-full flex items-center gap-2.5 px-3.5 py-3 bg-amber-50 border border-amber-200 rounded-xl text-left hover:bg-amber-100/70 transition-colors"
        >
          <RefreshCw size={16} className="text-amber-500 shrink-0" />
          <span className="text-xs text-amber-800 min-w-0">
            <strong>The asset's operating context changed since this study was analysed.</strong> Tap to re-read it from the register — then review functions and failure modes that depend on duty, load or environment.
          </span>
        </button>
      )}

      {/* Operating context — structured snapshot (0317) + narrative */}
      {(study.operating_context || snap) && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-sm">
          <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
            <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <FileText size={11} /> Operating Context
            </h3>
            {study.context_snapshot && (
              <span className="text-[10px] text-slate-400 flex items-center gap-2">
                <span title="Snapshot taken from the asset register (SAE JA1011 §5.1)"><Gauge size={11} className="inline mr-1" />from register · {new Date(study.context_snapshot.taken_at).toLocaleDateString()}</span>
                {onRefreshContext && !contextStale && (
                  <button onClick={onRefreshContext} className="font-bold text-primary-600 hover:underline inline-flex items-center gap-1"><RefreshCw size={10} /> refresh</button>
                )}
              </span>
            )}
          </div>
          {snap && (snap.mode || snapParams.length > 0) && (
            <div className="flex flex-wrap gap-1.5 mb-2.5">
              {snap.mode && <Chip>{OPERATING_MODES.find(m => m.code === snap.mode)?.label || snap.mode}</Chip>}
              {snap.utilisation_pct != null && <Chip>{snap.utilisation_pct}% utilisation</Chip>}
              {snap.hours_per_year != null && <Chip>{snap.hours_per_year.toLocaleString()} h/yr</Chip>}
              {snap.redundancy && <Chip>{REDUNDANCY_OPTIONS.find(r => r.code === snap.redundancy)?.label || snap.redundancy}</Chip>}
              {(snap.environment || []).map(e => <Chip key={e}>{e}</Chip>)}
              {snap.service_medium && <Chip>{snap.service_medium}</Chip>}
              {snapParams.slice(0, 8).map(p => {
                const u = utilisationOf(p);
                const flag = deviationFlag(p);
                return (
                  <Chip key={p.key} tone={flag === 'above_design' ? 'danger' : flag === 'far_below_design' ? 'warn' : 'muted'}>
                    {p.label}: {p.kind === 'design' || p.text ? String(p.design) : `${p.operating ?? '—'}/${p.design ?? '—'}`}{p.unit ? ` ${p.unit}` : ''}{u !== null ? ` (${u}%)` : ''}
                  </Chip>
                );
              })}
              {!snapDone.complete && <Chip tone="warn">incomplete · {snapDone.missing[0]}</Chip>}
            </div>
          )}
          {aboveDesign.length > 0 && (
            <p className="text-[11px] text-red-700 mb-2 flex items-center gap-1"><AlertTriangle size={11} /> Operating above design: {aboveDesign.map(p => p.label).join(', ')} — expect accelerated wear-out patterns.</p>
          )}
          {study.operating_context && <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">{study.operating_context}</p>}
        </div>
      )}
    </div>
  );
};

export default RCMStudyOverview;
