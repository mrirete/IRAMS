/**
 * RCMTaskMatrix — Premium task output grid with strategy distribution
 */
import React, { useMemo } from 'react';
import {
  Wrench, Brain, RefreshCw, CheckCircle, X,
  AlertTriangle, BarChart3,
} from 'lucide-react';
import type { RCMTaskMatrixProps } from './types';
import { STRATEGY_LABELS } from './types';

export const RCMTaskMatrix: React.FC<RCMTaskMatrixProps> = ({
  study, taskSummaries, decisions, aiLoading, aiReport,
  onGeneratePM, onAIOptimize, onCloseReport,
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

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      {/* Actions Bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={onGeneratePM}
          disabled={aiLoading === 'pm'}
          className="flex items-center gap-2 px-5 py-2.5 bg-accent-cyan hover:bg-cyan-400 text-brand-900 font-bold rounded-lg text-sm transition-colors shadow-[0_0_15px_rgba(6,182,212,0.2)] disabled:opacity-50"
        >
          {aiLoading === 'pm' ? <RefreshCw size={14} className="animate-spin" /> : <Wrench size={14} />}
          Generate PM Schedule
        </button>
        <button
          onClick={onAIOptimize}
          disabled={aiLoading === 'optimize'}
          className="flex items-center gap-2 px-4 py-2.5 bg-purple-50 border border-purple-200 rounded-lg text-sm font-medium text-purple-700 hover:bg-purple-100 transition-colors disabled:opacity-50 shadow-sm"
        >
          {aiLoading === 'optimize' ? <RefreshCw size={14} className="animate-spin" /> : <Brain size={14} />}
          AI Optimize Study
        </button>
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
                        <CheckCircle size={14} className="text-emerald-500 mx-auto" />
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
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
            <p className="text-sm font-semibold text-slate-500">No task recommendations yet</p>
            <p className="text-xs text-slate-400 mt-1">Complete the Decision Logic tab first.</p>
          </div>
        )}
      </div>

      {/* AI Optimization Report */}
      {aiReport && (
        <div className="bg-white border border-purple-200 rounded-xl p-5 shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-purple-800 flex items-center gap-2">
              <Brain size={16} /> AI Strategy Optimization Report
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
