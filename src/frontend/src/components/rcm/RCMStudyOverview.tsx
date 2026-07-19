/**
 * RCMStudyOverview — the Dashboard tab inside a selected study.
 * A calm health card: completion, stage counts, risk profile, WM link, next step.
 */
import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Layers, GitBranch, Wrench, Users, ArrowUpRight, ArrowRight,
  AlertTriangle, FileText, Boxes,
} from 'lucide-react';
import { AvatarStack } from '../analyze/CollaboratorPicker';
import { computeCompletionPct } from '../../eam/services/RCMService';
import type {
  RCMStudy, RCMFunction, RCMFailureMode, RCMDecision, RCMTaskSummary, StudyCollaborator,
} from './types';

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

export const RCMStudyOverview: React.FC<RCMStudyOverviewProps> = ({
  study, functions, failureModes, decisions, taskSummaries, collaborators,
  onNavigate, onInviteTeam, onEditStudy,
}) => {
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

      {/* Risk profile */}
      {riskTotal > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-sm">
          <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">Risk Profile (RPN)</h3>
          <div className="flex h-3 rounded-full overflow-hidden bg-slate-100">
            {risk.critical > 0 && <div style={{ flex: risk.critical }} className="bg-red-500" title={`Critical: ${risk.critical}`} />}
            {risk.high > 0 && <div style={{ flex: risk.high }} className="bg-amber-500" title={`High: ${risk.high}`} />}
            {risk.medium > 0 && <div style={{ flex: risk.medium }} className="bg-blue-500" title={`Medium: ${risk.medium}`} />}
            {risk.low > 0 && <div style={{ flex: risk.low }} className="bg-emerald-500" title={`Low: ${risk.low}`} />}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5 text-[10px] text-slate-500">
            {([['Critical', risk.critical, 'bg-red-500'], ['High', risk.high, 'bg-amber-500'], ['Medium', risk.medium, 'bg-blue-500'], ['Low', risk.low, 'bg-emerald-500']] as const)
              .filter(([, n]) => n > 0)
              .map(([label, n, dot]) => (
                <span key={label} className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${dot}`} /> {label} <strong className="text-slate-700">{n}</strong>
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
              className="flex items-center gap-1.5 px-3 py-2 text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
            >
              Raise WO <ArrowUpRight size={12} />
            </Link>
          </div>
        </div>
      </div>

      {/* Operating context */}
      {study.operating_context && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-sm">
          <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <FileText size={11} /> Operating Context
          </h3>
          <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">{study.operating_context}</p>
        </div>
      )}
    </div>
  );
};

export default RCMStudyOverview;
