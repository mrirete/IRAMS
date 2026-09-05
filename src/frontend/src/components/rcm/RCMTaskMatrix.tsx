/**
 * RCMTaskMatrix — the Maintenance Plan: what the strategy decisions produce
 * One row per failure mode: consequence → chosen strategy → task, interval,
 * owner — and the PM it became in Work Management. The Specialist's program
 * review lives here too (gated: no strategies, nothing to review).
 */
import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Wrench, Sparkles, Lock, RefreshCw, CheckCircle, X,
  AlertTriangle, BarChart3, ArrowUpRight, ArrowRight,
} from 'lucide-react';
import type { RCMTaskMatrixProps } from './types';
import { STRATEGY_LABELS } from './types';
import { canCreatePMForDecision } from '../../eam/services/rcmReadiness';
import { strategyProducesPM } from '../../eam/services/rcmPlan';

export const RCMTaskMatrix: React.FC<RCMTaskMatrixProps> = ({
  study, taskSummaries, decisions, aiLoading, aiReport,
  onGeneratePM, pmGate, onAIOptimize, optimizeGate, onGoToStrategy, onCloseReport,
}) => {
  // Strategy distribution
  const stratDist = useMemo(() => {
    const dist: { code: string; label: string; color: string; icon: string; count: number }[] = [];
    const counts: Record<string, number> = {};
    Array.from(decisions.values()).forEach(d => {
      const key = d.recommended_strategy_code || 'UNRESOLVED';
      counts[key] = (counts[key] || 0) + 1;
    });
    Object.entries(counts).forEach(([code, count]) => {
      const s = STRATEGY_LABELS[code] || { label: code, color: 'bg-slate-100 text-slate-500', icon: '❓' };
      dist.push({ code, label: s.label, color: s.color, icon: s.icon, count });
    });
    return dist.sort((a, b) => b.count - a.count);
  }, [decisions]);

  const maxCount = Math.max(...stratDist.map(s => s.count), 1);
  const resolvedCount = taskSummaries.filter(t => t.recommended_strategy_code).length;
  const pmCount = taskSummaries.filter(t => t.recurring_work_id).length;
  const wmQuery = `RCM-${study.id.slice(0, 8)}`;

  // Corrective WO drill-through — seed asset only when it's a register UUID
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const assetSeed = study.asset_id && UUID_RE.test(study.asset_id) ? `&asset=${study.asset_id}` : '';
  const raiseWOUrl = (desc: string) =>
    `/work-orders?action=create&type=CM${assetSeed}&title=${encodeURIComponent(`Corrective — ${desc}`)}`;

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      {/* Actions Bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={onGeneratePM}
          aria-disabled={aiLoading === 'pm'}
          title={pmGate.reason}
          className={`flex items-center gap-2 px-5 py-2.5 font-bold rounded-lg text-sm transition-colors ${
            pmGate.ok
              ? 'bg-accent-cyan hover:bg-primary-400 text-brand-900 shadow-[0_0_15px_rgba(6,182,212,0.2)]'
              : 'bg-slate-100 text-slate-500 border border-slate-200 hover:bg-slate-200'
          }`}
        >
          {aiLoading === 'pm' ? <RefreshCw size={14} className="animate-spin" /> : pmGate.ok ? <Wrench size={14} /> : <Lock size={14} />}
          Generate PM Schedule
        </button>
        <button
          onClick={onAIOptimize}
          aria-disabled={aiLoading === 'optimize'}
          title={optimizeGate.reason}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors shadow-sm border ${
            optimizeGate.ok
              ? 'bg-primary-50 border-primary-200 text-primary-700 hover:bg-primary-100'
              : 'bg-slate-100 border-slate-200 text-slate-500 hover:bg-slate-200'
          }`}
        >
          {aiLoading === 'optimize' ? <RefreshCw size={14} className="animate-spin" /> : optimizeGate.ok ? <Sparkles size={14} /> : <Lock size={14} />}
          Specialist: review the program
        </button>
        {pmCount > 0 && (
          <Link
            to={`/recurring-work?q=${wmQuery}`}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-sm font-medium text-emerald-700 hover:bg-emerald-100 transition-colors shadow-sm"
          >
            View {pmCount} PM{pmCount !== 1 ? 's' : ''} in Work Mgmt <ArrowUpRight size={13} />
          </Link>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <BarChart3 size={14} className="text-slate-400" />
          <span className="text-xs text-slate-500 font-medium">
            <strong className="text-slate-700">{resolvedCount}</strong> / {taskSummaries.length} tasks resolved
          </span>
        </div>
      </div>

      {/* Strategy Distribution — Horizontal bars */}
      {stratDist.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-4">
            Strategy Distribution
          </h3>
          <div className="space-y-2.5">
            {stratDist.map(s => (
              <div key={s.code} className="flex items-center gap-3">
                <span className="text-base leading-none w-6 text-center">{s.icon}</span>
                <span className="text-xs font-medium text-slate-600 w-28 shrink-0 truncate">{s.label}</span>
                <div className="flex-1 h-5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ease-out ${s.color.split(' ')[0]}`}
                    style={{ width: `${Math.max((s.count / maxCount) * 100, 8)}%` }}
                  />
                </div>
                <span className="text-xs font-bold text-slate-700 w-6 text-right tabular-nums">{s.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Task Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gradient-to-r from-slate-50 to-slate-50/50 border-b border-slate-200 sticky top-0">
                <th className="text-left px-4 py-3 font-bold text-slate-400 uppercase tracking-wider w-8">#</th>
                <th className="text-left px-4 py-3 font-bold text-slate-400 uppercase tracking-wider">Failure Mode</th>
                <th className="text-left px-4 py-3 font-bold text-slate-400 uppercase tracking-wider">Consequence</th>
                <th className="text-left px-4 py-3 font-bold text-slate-400 uppercase tracking-wider">Strategy</th>
                <th className="text-left px-4 py-3 font-bold text-slate-400 uppercase tracking-wider">Task</th>
                <th className="text-left px-4 py-3 font-bold text-slate-400 uppercase tracking-wider">Interval</th>
                <th className="text-left px-4 py-3 font-bold text-slate-400 uppercase tracking-wider">Owner</th>
                <th className="text-center px-4 py-3 font-bold text-slate-400 uppercase tracking-wider">PM</th>
                <th className="text-center px-4 py-3 font-bold text-slate-400 uppercase tracking-wider">WO</th>
              </tr>
            </thead>
            <tbody>
              {taskSummaries.map((task, idx) => {
                const style = STRATEGY_LABELS[task.recommended_strategy_code || ''] || { label: '—', color: 'bg-slate-100 text-slate-500', icon: '' };
                const missing = !task.recommended_strategy_code;
                return (
                  <tr
                    key={task.failure_mode_id}
                    className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${
                      missing ? 'bg-red-50/30' : idx % 2 === 0 ? '' : 'bg-slate-25'
                    }`}
                  >
                    <td className="px-4 py-3 text-slate-400 tabular-nums">{idx + 1}</td>
                    <td className="px-4 py-3 font-medium text-slate-700 max-w-[200px]">
                      <div className="flex items-center gap-1.5">
                        {missing && <AlertTriangle size={11} className="text-amber-500 shrink-0" />}
                        <span className="truncate">{task.failure_mode_description}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{task.consequence_code || '—'}</td>
                    <td className="px-4 py-3">
                      {task.recommended_strategy_code ? (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${style.color}`}>
                          {style.icon} {style.label}
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-400 italic">No strategy</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600 max-w-[200px] truncate">{task.task_description || '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{task.task_interval || '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{task.task_owner_craft || '—'}</td>
                    <td className="px-4 py-3 text-center">
                      {task.recurring_work_id ? (
                        <Link
                          to={`/recurring-work?q=${task.recurring_work_id}`}
                          title={`Open ${task.recurring_work_id} in Work Management`}
                          className="inline-flex items-center gap-1 text-emerald-600 hover:text-emerald-700 hover:underline"
                        >
                          <CheckCircle size={14} />
                          <ArrowUpRight size={10} />
                        </Link>
                      ) : strategyProducesPM(task.recommended_strategy_code) ? (() => {
                        // Say why this row has no PM yet — the generator never skips silently.
                        const g = canCreatePMForDecision(study.asset_id, decisions.get(task.failure_mode_id));
                        return g.ok
                          ? <span className="text-[10px] font-bold text-primary-600" title={g.reason}>ready</span>
                          : <span className="inline-flex items-center gap-0.5 text-amber-600" title={g.reason}><Lock size={11} /><span className="text-[10px]">{g.missing[0]?.split(' (')[0]}</span></span>;
                      })() : (
                        <span className="text-slate-300" title={task.recommended_strategy_code === 'RTF' ? 'Run-to-Failure schedules nothing' : task.recommended_strategy_code === 'REDESIGN' ? 'Redesign is a one-off change, not a PM' : 'No strategy yet'}>—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Link
                        to={raiseWOUrl(task.failure_mode_description)}
                        title="Raise a corrective work order for this failure mode"
                        className="inline-flex items-center gap-0.5 text-slate-400 hover:text-primary-600 transition-colors"
                      >
                        <Wrench size={13} />
                        <ArrowUpRight size={10} />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {taskSummaries.length === 0 && (
          <div className="p-10 text-center">
            <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-slate-50 flex items-center justify-center">
              <Wrench size={24} className="text-slate-300" />
            </div>
            <p className="text-sm font-semibold text-slate-500">The plan is empty</p>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
              Tasks are the output of the strategy decisions — each failure mode on the Worksheet gets a strategy on the Strategy tab, and its task lands here.
            </p>
            <button
              onClick={onGoToStrategy}
              className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-accent-cyan/10 border border-accent-cyan/40 rounded-lg text-xs font-bold text-slate-700 hover:bg-accent-cyan/20 transition-colors"
            >
              Go to 2 · Strategy <ArrowRight size={13} className="text-accent-cyan" />
            </button>
          </div>
        )}
      </div>

      {/* AI Optimization Report */}
      {aiReport && (
        <div className="bg-white border border-primary-200 rounded-xl p-5 shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-primary-800 flex items-center gap-2">
              <Sparkles size={16} /> Specialist Program Review
            </h3>
            <button onClick={onCloseReport} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
              <X size={16} />
            </button>
          </div>
          <div className="prose prose-sm prose-slate max-w-none text-xs whitespace-pre-wrap leading-relaxed">
            {aiReport}
          </div>
        </div>
      )}
    </div>
  );
};

export default RCMTaskMatrix;
