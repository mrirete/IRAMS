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

const WORKFLOW_STEPS = [
    { icon: <BarChart3 size={14} />, label: 'Pareto', desc: 'Identify bad actors', color: '#ef4444', bg: '#2a1215' },
    { icon: <GitMerge size={14} />, label: 'RCA', desc: 'Find root cause', color: '#f59e0b', bg: '#2a2010' },
    { icon: <ClipboardList size={14} />, label: 'DE Task', desc: 'Plan elimination', color: '#3b82f6', bg: '#0f1b33' },
    { icon: <TrendingUp size={14} />, label: 'Track', desc: 'Monitor progress', color: '#8b5cf6', bg: '#1a1033' },
    { icon: <CheckCircle2 size={14} />, label: 'Verify', desc: 'Confirm ROI', color: '#22c55e', bg: '#0f2a1a' },
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* ── Workflow Process Banner ─────────────────── */}
            <div style={{
                background: '#111827',
                borderRadius: 16,
                border: '1px solid #1e293b',
                padding: '20px 24px',
                boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
            }}>
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
                }}>
                    <div style={{
                        width: 30, height: 30, borderRadius: 8,
                        background: '#0e2a3d',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                        <Target size={16} color="#22d3ee" />
                    </div>
                    <div>
                        <span style={{ fontSize: 15, fontWeight: 700, color: '#ffffff', letterSpacing: '0.01em' }}>
                            Defect Elimination Program
                        </span>
                        <div style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>
                            Systematic removal of chronic defects (80/20 rule)
                        </div>
                    </div>
                </div>

                {/* Step indicators */}
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 0,
                    background: '#0b1120',
                    borderRadius: 12, padding: '12px 16px',
                    border: '1px solid #1e293b',
                }}>
                    {WORKFLOW_STEPS.map((step, i) => (
                        <React.Fragment key={step.label}>
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: 10, flex: 1,
                            }}>
                                <div style={{
                                    width: 32, height: 32, borderRadius: 10,
                                    background: step.bg,
                                    border: `1.5px solid ${step.color}40`,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    color: step.color, flexShrink: 0,
                                }}>
                                    {step.icon}
                                </div>
                                <div style={{ minWidth: 0 }}>
                                    <div style={{ fontSize: 12, fontWeight: 700, color: step.color }}>{step.label}</div>
                                    <div style={{ fontSize: 10, color: '#94a3b8', whiteSpace: 'nowrap' }}>{step.desc}</div>
                                </div>
                            </div>
                            {i < WORKFLOW_STEPS.length - 1 && (
                                <ArrowRight size={14} color="#334155" style={{ flexShrink: 0, margin: '0 8px' }} />
                            )}
                        </React.Fragment>
                    ))}
                </div>
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
