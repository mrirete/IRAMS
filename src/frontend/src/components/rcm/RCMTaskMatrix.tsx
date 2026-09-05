/**
 * RCMTaskMatrix — the Maintenance Plan: what the strategy decisions produce
 * One row per failure mode: consequence → chosen strategy → task, interval,
 * owner — and the PM it became in Work Management. PMs are created per row,
 * the way a corrective WO is raised per row: the plan is built one decision
 * at a time, with the reason spelled out when a row is not ready. The
 * Specialist's program review lives here too (gated: no strategies, nothing
 * to review).
 */
import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Wrench, Sparkles, Lock, RefreshCw, CheckCircle, X,
  AlertTriangle, BarChart3, ArrowUpRight, ArrowRight, Plus,
} from 'lucide-react';
import type { RCMTaskMatrixProps } from './types';
import { strategyLabel } from './types';
import { strategyProducesPM, parseIntervalText } from '../../eam/services/rcmPlan';

export const RCMTaskMatrix: React.FC<RCMTaskMatrixProps> = ({
  study, taskSummaries, decisions, aiLoading, aiReport,
  onCreatePM, pmGateFor, onAIOptimize, optimizeGate, onGoToStrategy, onCloseReport,
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
      const s = strategyLabel(code) || { label: code === 'UNRESOLVED' ? 'No strategy' : code, color: 'bg-slate-100 text-slate-500', icon: '❓' };
      dist.push({ code, label: s.label, color: s.color, icon: s.icon, count });
    });
    return dist.sort((a, b) => b.count - a.count);
  }, [decisions]);

  const maxCount = Math.max(...stratDist.map(s => s.count), 1);
  const resolvedCount = taskSummaries.filter(t => t.recommended_strategy_code).length;
  const pmCount = taskSummaries.filter(t => t.recurring_work_id).length;
  const readyCount = taskSummaries.filter(t => !t.recurring_work_id && pmGateFor(t.failure_mode_id).ok).length;
  const wmQuery = `RCM-${study.id.slice(0, 8)}`;

  // Corrective WO drill-through — seed asset only when it's a register UUID
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const assetSeed = study.asset_id && UUID_RE.test(study.asset_id) ? `&asset=${study.asset_id}` : '';
  const raiseWOUrl = (desc: string) =>
    `/work-orders?action=create&type=CM${assetSeed}&title=${encodeURIComponent(`Corrective — ${desc}`)}`;

  const intervalCell = (raw: string | null) => {
    const p = parseIntervalText(raw);
    if (!raw) return <span className="text-slate-300">—</span>;
    if (p.n === null) return <span className="text-amber-700" title={raw}>needs value + unit</span>;
    return <span className="whitespace-nowrap">{p.n} {p.unit}</span>;
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      {/* Actions Bar */}
      <div className="flex items-center gap-3 flex-wrap">
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
        <div className="ml-auto flex items-center gap-3 text-xs text-slate-500 font-medium">
          <span className="flex items-center gap-1.5"><BarChart3 size={14} className="text-slate-400" /><strong className="text-slate-700">{resolvedCount}</strong> / {taskSummaries.length} decided</span>
          <span><strong className="text-slate-700">{pmCount}</strong> PM{pmCount !== 1 ? 's' : ''}{readyCount > 0 ? <span className="text-primary-600"> · {readyCount} ready</span> : null}</span>
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
                const style = strategyLabel(task.recommended_strategy_code) || { label: '—', color: 'bg-slate-100 text-slate-500', icon: '' };
                const missing = !task.recommended_strategy_code;
                const gate = pmGateFor(task.failure_mode_id);
                const busy = aiLoading === `pm-${task.failure_mode_id}`;
                const stale = !!task.recurring_work_id && !!task.pm_created_at && !!task.decision_updated_at
                  && new Date(task.decision_updated_at).getTime() > new Date(task.pm_created_at).getTime() + 5000;
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
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md whitespace-nowrap ${style.color}`}>
                          {style.icon} {style.label}
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-400 italic">No strategy</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600 max-w-[260px]"><span className="line-clamp-2" title={task.task_description || ''}>{task.task_description || '—'}</span></td>
                    <td className="px-4 py-3 text-slate-500">{intervalCell(task.task_interval)}</td>
                    <td className="px-4 py-3 text-slate-500">{task.task_owner_craft || '—'}</td>
                    <td className="px-4 py-3 text-center">
                      {task.recurring_work_id ? (
                        <div className="inline-flex flex-col items-center gap-0.5">
                          <Link
                            to={`/recurring-work?q=${task.recurring_work_id}`}
                            title={`Open ${task.recurring_work_id} in Work Management`}
                            className="inline-flex items-center gap-1 text-emerald-600 hover:text-emerald-700 hover:underline"
                          >
                            <CheckCircle size={14} />
                            <ArrowUpRight size={10} />
                          </Link>
                          {stale && (
                            <span className="text-[9px] font-bold text-amber-600 whitespace-nowrap" title="The decision was edited after this PM was generated — update the PM in Work Management or revise the study">changed since</span>
                          )}
                        </div>
                      ) : strategyProducesPM(task.recommended_strategy_code) ? (
                        <button
                          type="button"
                          onClick={() => onCreatePM(task.failure_mode_id)}
                          aria-disabled={busy}
                          title={gate.reason}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[10px] font-bold transition-colors ${
                            gate.ok
                              ? 'bg-accent-cyan/10 border-accent-cyan/40 text-slate-800 hover:bg-accent-cyan/20'
                              : 'bg-slate-50 border-slate-200 text-slate-400 hover:bg-slate-100'
                          }`}
                        >
                          {busy ? <RefreshCw size={11} className="animate-spin" /> : gate.ok ? <Plus size={11} /> : <Lock size={11} />}
                          {gate.ok ? 'Create' : (gate.missing[0]?.split(' (')[0] || 'Not ready')}
                        </button>
                      ) : (
                        <span className="text-slate-300" title={task.recommended_strategy_code === 'RTF' ? 'Run-to-Failure schedules nothing' : task.recommended_strategy_code === 'REDESIGN' ? 'Redesign is a one-off change, not a PM' : task.recommended_strategy_code ? '"Combined" is retired — choose one strategy' : 'No strategy yet'}>—</span>
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
