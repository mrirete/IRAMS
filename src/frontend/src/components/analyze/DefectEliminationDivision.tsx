/**
 * Defect Elimination Division — "How do we fix it?"
 *
 * Simplified to focus only on elimination tasks.
 * Pareto identification now lives in the RCA tab (Step 1).
 * Flow: RCA → Create DE Task → Track here → ROI
 */
import React from 'react';
import { Target, BarChart3, GitMerge, ClipboardList, TrendingUp, CheckCircle2, ArrowRight } from 'lucide-react';
import DefectEliminationPanel, { type DefectEliminationTask } from './DefectEliminationPanel';
import BadActorHunterPanel from './BadActorHunterPanel';
import type { StudyCollaborator } from '../../eam/services/AnalyzeService';

interface DefectEliminationDivisionProps {
    deTasks: DefectEliminationTask[];
    onCreateTask: (task: Omit<DefectEliminationTask, 'id' | 'createdAt'>) => void;
    onUpdateTaskStatus: (taskId: string, status: DefectEliminationTask['status']) => void;
    onEditTask?: (taskId: string, updates: Partial<DefectEliminationTask>) => void;
    onDeleteTask?: (taskId: string) => void;
    onNavigateToRCA: (assetId: string) => void;
    onUpdateTaskCollaborators?: (taskId: string, collaborators: StudyCollaborator[]) => void;
    onGenerateWO?: (taskId: string, woData: { title: string; description: string; type: string; priority: string; asset_id: string | null; due_date?: string }) => void;
    onCreatePM?: (taskId: string, pmData: { code: string; description: string; asset_id: string; schedule_type: string; frequency_interval: number; frequency_unit: string; work_type: string; estimated_hours: number }) => void;
    linkedWOs?: Record<string, { id: string; wo_number: string; title: string; status: string; type: string; created_at: string }[]>;
    badActors?: any[];
    criteria?: 'cost' | 'downtime' | 'wo_frequency';
}

// The five steps of the elimination loop. Rendered as one quiet strip — this is a
// legend, not a feature, so it gets a line of the page, not a panel.
const WORKFLOW_STEPS = [
    { icon: <BarChart3 size={13} />, label: 'Pareto', desc: 'Identify bad actors', color: '#ef4444' },
    { icon: <GitMerge size={13} />, label: 'RCA', desc: 'Find root cause', color: '#f59e0b' },
    { icon: <ClipboardList size={13} />, label: 'DE Task', desc: 'Plan elimination', color: '#3b82f6' },
    { icon: <TrendingUp size={13} />, label: 'Track', desc: 'Monitor progress', color: '#8b5cf6' },
    { icon: <CheckCircle2 size={13} />, label: 'Verify', desc: 'Confirm ROI', color: '#22c55e' },
];

export const DefectEliminationDivision: React.FC<DefectEliminationDivisionProps> = ({
    deTasks,
    onCreateTask,
    onUpdateTaskStatus,
    onEditTask,
    onDeleteTask,
    onNavigateToRCA,
    onUpdateTaskCollaborators,
    onGenerateWO,
    onCreatePM,
    linkedWOs,
    badActors = [],
    criteria = 'cost',
}) => {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* ── Elimination loop — one quiet strip, wraps instead of overflowing.
                   Was a full-height dark panel that ate the top of every mobile screen
                   and clipped its own steps. ─────────────────────────────────── */}
            <div className="flex items-center gap-x-1.5 gap-y-2 flex-wrap px-1">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 mr-1">
                    <Target size={13} className="text-primary-500" />
                    Elimination loop
                </span>
                {WORKFLOW_STEPS.map((step, i) => (
                    <React.Fragment key={step.label}>
                        {i > 0 && <ArrowRight size={11} className="text-slate-300 shrink-0" />}
                        <span
                            title={step.desc}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-slate-200 shrink-0"
                        >
                            <span style={{ color: step.color, display: 'inline-flex' }}>{step.icon}</span>
                            <span className="text-[11px] font-semibold text-slate-600">{step.label}</span>
                        </span>
                    </React.Fragment>
                ))}
            </div>

            {/* ── Bad Actor Hunter (AI) — ranks worst assets, drafts DE tasks ── */}
            <BadActorHunterPanel onApprove={onCreateTask} />

            {/* ── Defect Elimination Panel — task list + detail ── */}
            <DefectEliminationPanel
                badActors={badActors}
                tasks={deTasks}
                criteria={criteria}
                onCreateTask={onCreateTask}
                onUpdateTaskStatus={onUpdateTaskStatus}
                onEditTask={onEditTask}
                onDeleteTask={onDeleteTask}
                onNavigateToRCA={onNavigateToRCA}
                onUpdateTaskCollaborators={onUpdateTaskCollaborators}
                onGenerateWO={onGenerateWO}
                onCreatePM={onCreatePM}
                linkedWOs={linkedWOs}
            />
        </div>
    );
};

export default DefectEliminationDivision;
