import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, AlertTriangle, ChevronRight } from 'lucide-react';

// ─────────────────────────────────────────────────────────
//  Pipeline Stages
// ─────────────────────────────────────────────────────────

interface PipelineStage {
    key: string;
    label: string;
    count: number;
    overdue: number;
    color: string;
    bgColor: string;
    borderColor: string;
}

const STAGES: PipelineStage[] = [
    { key: 'draft', label: 'Draft', count: 12, overdue: 0, color: 'text-slate-500', bgColor: 'bg-slate-100/30', borderColor: 'border-slate-300' },
    { key: 'planned', label: 'Planned', count: 23, overdue: 2, color: 'text-blue-400', bgColor: 'bg-blue-500/10', borderColor: 'border-blue-500/30' },
    { key: 'scheduled', label: 'Scheduled', count: 18, overdue: 1, color: 'text-purple-400', bgColor: 'bg-purple-500/10', borderColor: 'border-purple-500/30' },
    { key: 'in_progress', label: 'In Progress', count: 28, overdue: 4, color: 'text-accent-cyan', bgColor: 'bg-accent-cyan/10', borderColor: 'border-accent-cyan/30' },
    { key: 'complete', label: 'Complete', count: 6, overdue: 0, color: 'text-accent-safe', bgColor: 'bg-accent-safe/10', borderColor: 'border-accent-safe/30' },
];

// ─────────────────────────────────────────────────────────
//  Component
// ─────────────────────────────────────────────────────────

export const WorkPipeline: React.FC = () => {
    const navigate = useNavigate();
    const totalWOs = STAGES.reduce((s, st) => s + st.count, 0);
    const totalOverdue = STAGES.reduce((s, st) => s + st.overdue, 0);
    const maxCount = Math.max(...STAGES.map(s => s.count));

    return (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-accent-cyan/10 rounded-lg text-accent-cyan">
                        <ClipboardList size={20} />
                    </div>
                    <div>
                        <h3 className="text-base font-semibold text-slate-800">Work Order Pipeline</h3>
                        <p className="text-xs text-slate-400">{totalWOs} active work orders</p>
                    </div>
                </div>
                {totalOverdue > 0 && (
                    <div className="flex items-center gap-1 px-2 py-1 bg-red-500/10 border border-red-500/30 rounded-full text-xs text-red-400 font-bold">
                        <AlertTriangle size={12} /> {totalOverdue} overdue
                    </div>
                )}
            </div>

            {/* Pipeline Stages */}
            <div className="flex items-stretch gap-1">
                {STAGES.map((stage, idx) => {
                    const pct = (stage.count / maxCount) * 100;
                    return (
                        <React.Fragment key={stage.key}>
                            <button
                                onClick={() => navigate('/work')}
                                className={`flex-1 ${stage.bgColor} border ${stage.borderColor} rounded-lg p-3 text-center transition-all hover:scale-[1.03] hover:shadow-lg group relative`}
                            >
                                {/* Count */}
                                <p className={`text-2xl font-bold ${stage.color} font-mono`}>{stage.count}</p>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">{stage.label}</p>

                                {/* Fill bar */}
                                <div className="mt-2 h-1.5 bg-slate-50 rounded-full overflow-hidden">
                                    <div
                                        className={`h-full rounded-full transition-all duration-700`}
                                        style={{
                                            width: `${pct}%`,
                                            backgroundColor: stage.color.replace('text-', '').includes('accent') ? '#06b6d4' :
                                                stage.color.includes('blue') ? '#3b82f6' :
                                                    stage.color.includes('purple') ? '#a855f7' :
                                                        stage.color.includes('safe') ? '#22c55e' : '#64748b'
                                        }}
                                    />
                                </div>

                                {/* Overdue badge */}
                                {stage.overdue > 0 && (
                                    <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.4)]">
                                        {stage.overdue}
                                    </span>
                                )}
                            </button>
                            {idx < STAGES.length - 1 && (
                                <div className="flex items-center text-brand-600">
                                    <ChevronRight size={14} />
                                </div>
                            )}
                        </React.Fragment>
                    );
                })}
            </div>

            {/* Summary bar */}
            <div className="mt-3 flex items-center justify-between text-[10px] text-slate-400">
                <span>Draft → Complete pipeline</span>
                <span className="font-mono">{totalWOs} WOs · {totalOverdue} overdue</span>
            </div>
        </div>
    );
};
