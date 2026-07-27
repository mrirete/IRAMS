/**
 * DefectEliminationPanel — MaintainX-inspired list + detail pane layout.
 *
 * LIGHT THEME — uses white/light backgrounds aligned with Reliability Modelling tab.
 *
 * Left side: Task list with priority stripes and status pills.
 * Right side: Task detail with Root Cause Diagnosis, financial impact, and action plan.
 *
 * Implements the user rule: monthly automated Pareto for top 5 bad actors.
 */
import React, { useState, useMemo } from 'react';
import {
    Target, DollarSign, Sparkles, AlertTriangle,
    CheckCircle2, Clock, ArrowRight, ArrowLeft, Zap, Shield,
    Edit3, Trash2, X, AlertCircle, ChevronRight, Search, LayoutList,
    FileSearch, Wrench, TrendingUp, ArrowUpRight, Activity,
    Calendar, ExternalLink, Users, UserPlus, RotateCcw
} from 'lucide-react';
import { type ParetoResult } from '../../eam/services/AnalyzeService';
import { confidenceFromScore } from '../../eam/services/AnalyzeService';
import type { StudyCollaborator } from '../../eam/services/AnalyzeService';
import { aiEngine, type DefectPattern, type EliminationPlanDraft } from '../../eam/services/AIAnalysisEngine';
import { TeamPanel, AvatarStack } from './CollaboratorPicker';

export interface DefectEliminationTask {
    id: string;
    assetId: string;
    assetName: string;
    title: string;
    status: 'identified' | 'in_progress' | 'resolved' | 'verified';
    priority: 'critical' | 'high' | 'medium' | 'low';
    annualCost: number;
    estimatedSavings: number;
    implementationCost: number;
    paybackMonths: number;
    rootCauseSummary: string;
    proposedSolution: string;
    rcaId?: string;
    /** 0–100 from the source RCA's cited evidence grades (0218). Null/undefined = unknown. */
    evidenceConfidence?: number | null;
    collaborators?: StudyCollaborator[];
    createdAt: string;
}

interface DefectEliminationPanelProps {
    badActors: ParetoResult[];
    tasks: DefectEliminationTask[];
    onCreateTask?: (task: Omit<DefectEliminationTask, 'id' | 'createdAt'>) => void;
    onUpdateTaskStatus?: (taskId: string, status: DefectEliminationTask['status']) => void;
    onEditTask?: (taskId: string, updates: Partial<DefectEliminationTask>) => void;
    onDeleteTask?: (taskId: string) => void;
    onNavigateToRCA?: (assetId: string) => void;
    onUpdateTaskCollaborators?: (taskId: string, collaborators: StudyCollaborator[]) => void;
    onGenerateWO?: (taskId: string, woData: { title: string; description: string; type: string; priority: string; asset_id: string | null; due_date?: string }) => void;
    onCreatePM?: (taskId: string, pmData: { code: string; description: string; asset_id: string; schedule_type: string; frequency_interval: number; frequency_unit: string; work_type: string; estimated_hours: number }) => void;
    linkedWOs?: Record<string, { id: string; wo_number: string; title: string; status: string; type: string; created_at: string }[]>;
    criteria?: 'cost' | 'downtime' | 'wo_frequency';
}

// === LIGHT-theme color constants (aligned with Reliability Modelling) ===
const BG_CARD      = '#ffffff';   // card background
const BG_DARKER    = '#f8fafc';   // subtle insets
const BG_HEADER    = '#f8fafc';   // section headers
const BORDER       = '#e2e8f0';   // neutral border
const BORDER_LIGHT = '#cbd5e1';   // stronger border
const TEXT_WHITE    = '#1e293b';   // primary text (dark on light)
const TEXT_BRIGHT   = '#334155';  // secondary text
const TEXT_MUTED    = '#64748b';  // muted labels
const TEXT_DIM      = '#94a3b8';  // dim text

const PRIORITY_COLORS: Record<string, string> = {
    critical: '#ef4444', high: '#f59e0b', medium: '#3b82f6', low: '#22c55e',
};
const PRIORITY_BG: Record<string, string> = {
    critical: '#fef2f2', high: '#fffbeb', medium: '#eff6ff', low: '#f0fdf4',
};
const PRIORITY_LABELS: Record<string, string> = {
    critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low',
};
const STATUS_META: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
    identified:  { label: 'Identified',  color: '#d97706', bg: '#fffbeb', icon: <Target size={12} /> },
    in_progress: { label: 'In Progress', color: '#0284c7', bg: '#f0f9ff', icon: <Clock size={12} /> },
    resolved:    { label: 'Resolved',    color: '#059669', bg: '#ecfdf5', icon: <CheckCircle2 size={12} /> },
    verified:    { label: 'Verified',    color: '#16a34a', bg: '#f0fdf4', icon: <Shield size={12} /> },
};

function daysAgo(dateStr: string): string {
    const d = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
    if (d === 0) return 'Today';
    if (d === 1) return '1 day ago';
    if (d < 30) return `${d}d ago`;
    if (d < 365) return `${Math.floor(d / 30)}mo ago`;
    return `${Math.floor(d / 365)}yr ago`;
}

function detectRCAMethod(summary: string): { method: string; label: string; color: string } | null {
    const lower = summary.toLowerCase();
    if (lower.includes('5-why') || lower.includes('five-why') || lower.includes('5 why'))
        return { method: 'five_why', label: '5-Why Analysis', color: '#22c55e' };
    if (lower.includes('fishbone') || lower.includes('ishikawa'))
        return { method: 'fishbone', label: 'Fishbone / Ishikawa', color: '#3b82f6' };
    if (lower.includes('fault tree'))
        return { method: 'fault_tree', label: 'Fault Tree Analysis', color: '#ef4444' };
    if (lower.includes('fmea') || lower.includes('fmeca'))
        return { method: 'fmea', label: 'FMEA / FMECA', color: '#8b5cf6' };
    if (lower.includes('taproot'))
        return { method: 'taproot', label: 'TapRooT®', color: '#f59e0b' };
    return null;
}

function fmt$(val: number): string {
    if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
    if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
    return `$${val.toFixed(0)}`;
}

const DefectEliminationPanel: React.FC<DefectEliminationPanelProps> = ({
    badActors,
    tasks,
    onCreateTask,
    onUpdateTaskStatus: _onUpdateTaskStatus,
    onEditTask,
    onDeleteTask,
    onNavigateToRCA,
    onUpdateTaskCollaborators,
    onGenerateWO,
    onCreatePM,
    linkedWOs,
    criteria: _criteria = 'cost',
}) => {
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(tasks[0]?.id || null);
    const [editingTask, setEditingTask] = useState<DefectEliminationTask | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
    const [aiInsights, setAiInsights] = useState<Map<string, DefectPattern>>(new Map());
    const [aiLoading, setAiLoading] = useState<Set<string>>(new Set());
    const [draftPlan, setDraftPlan] = useState<EliminationPlanDraft | null>(null);
    const [draftAssetId, setDraftAssetId] = useState<string | null>(null);
    const [showTeamPanel, setShowTeamPanel] = useState(false);
    const [showPMModal, setShowPMModal] = useState(false);
    const [pmForm, setPMForm] = useState({
        code: '', description: '', schedule_type: 'calendar',
        frequency_interval: 3, frequency_unit: 'months',
        work_type: 'PM', estimated_hours: 2,
    });

    // ─── Portfolio → Workspace state ──────────────────────────
    const [viewMode, setViewMode] = useState<'portfolio' | 'workspace'>('portfolio');
    const [deSearch, setDeSearch] = useState('');
    const [deFilter, setDeFilter] = useState<string>('all');

    const openTaskWorkspace = (taskId: string) => {
        setSelectedTaskId(taskId);
        setViewMode('workspace');
    };
    const backToPortfolio = () => {
        setViewMode('portfolio');
        setSelectedTaskId(null);
    };

    const filteredTasks = useMemo(() => {
        let list = [...tasks];
        if (deFilter !== 'all') list = list.filter(t => t.status === deFilter);
        if (deSearch.trim()) {
            const q = deSearch.toLowerCase();
            list = list.filter(t =>
                t.title.toLowerCase().includes(q) ||
                t.assetName.toLowerCase().includes(q)
            );
        }
        return list;
    }, [tasks, deSearch, deFilter]);

    const selectedTask = useMemo(() => tasks.find(t => t.id === selectedTaskId) || null, [tasks, selectedTaskId]);

    React.useEffect(() => {
        if (!selectedTaskId && tasks.length > 0) setSelectedTaskId(tasks[0].id);
    }, [tasks, selectedTaskId]);

    const top5 = useMemo(() => badActors.slice(0, 5), [badActors]);
    const totalSavings = useMemo(() =>
        tasks.filter(t => t.status === 'resolved' || t.status === 'verified')
            .reduce((sum, t) => sum + t.estimatedSavings, 0),
        [tasks]
    );

    const handleAcceptPlan = () => {
        if (!draftPlan || !draftAssetId || !onCreateTask) return;
        const actor = badActors.find(a => a.asset_id === draftAssetId);
        onCreateTask({
            assetId: draftAssetId,
            assetName: actor?.asset_name || '',
            title: draftPlan.title,
            status: 'identified',
            priority: draftPlan.priority,
            annualCost: actor?.metric_value || 0,
            estimatedSavings: draftPlan.estimatedSavingsPerYear,
            implementationCost: draftPlan.estimatedImplementationCost,
            paybackMonths: draftPlan.paybackMonths,
            rootCauseSummary: draftPlan.rootCauseSummary,
            proposedSolution: draftPlan.proposedSolution,
        });
        setDraftPlan(null);
        setDraftAssetId(null);
    };

    // ─── RENDER ──────────────────────────────────────────────
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* ════ KPI CARDS ═══════════════════════════════════
                4-up on desktop, 2-up on phones. Forcing repeat(4, 1fr) at 412px gave
                each card ~85px, which wrapped every label to shreds ("Bad / Act…") and
                clipped the savings figure. The label now sits above the icon+value row,
                so the widest thing in the card is the number itself. */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3.5">
                {[
                    { label: 'Bad Actors', value: top5.length, sub: 'Top Pareto offenders', icon: <AlertTriangle size={16} />, color: '#ef4444', bgCard: '#fef2f2' },
                    { label: 'Active Tasks', value: tasks.filter(t => t.status === 'identified' || t.status === 'in_progress').length, sub: 'In progress', icon: <Target size={16} />, color: '#f59e0b', bgCard: '#fffbeb' },
                    { label: 'Resolved', value: tasks.filter(t => t.status === 'resolved' || t.status === 'verified').length, sub: 'Defects eliminated', icon: <CheckCircle2 size={16} />, color: '#22c55e', bgCard: '#f0fdf4' },
                    { label: 'Est. Savings', value: fmt$(totalSavings), sub: 'Annual savings', icon: <DollarSign size={16} />, color: '#818cf8', bgCard: '#eef2ff' },
                ].map(kpi => (
                    <div key={kpi.label} className="relative overflow-hidden rounded-xl px-3 py-3 sm:px-4 sm:py-3.5"
                        style={{
                            background: kpi.bgCard,
                            border: `1px solid ${kpi.color}25`,
                            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                        }}>
                        {/* Top accent bar */}
                        <div style={{
                            position: 'absolute', top: 0, left: 0, right: 0, height: 3,
                            background: kpi.color,
                        }} />
                        <div className="flex items-center gap-1.5 mb-2">
                            <span style={{ color: kpi.color, display: 'inline-flex' }}>{kpi.icon}</span>
                            <span className="text-[11px] sm:text-xs font-semibold truncate" style={{ color: TEXT_BRIGHT }}>
                                {kpi.label}
                            </span>
                        </div>
                        <div className="text-2xl sm:text-3xl font-extrabold leading-none truncate" style={{ color: TEXT_WHITE }}>
                            {kpi.value}
                        </div>
                        <div className="text-[10px] sm:text-[11px] mt-1.5 font-medium truncate" style={{ color: TEXT_MUTED }} title={kpi.sub}>
                            {kpi.sub}
                        </div>
                    </div>
                ))}
            </div>

            {/* ════ PORTFOLIO VIEW: TASK TABLE ═══════════════════ */}
            {viewMode === 'portfolio' && (
                <div style={{
                    background: BG_CARD, borderRadius: 16, border: `1px solid ${BORDER}`,
                    overflow: 'hidden', boxShadow: '0 2px 16px rgba(0,0,0,0.06)',
                }}>
                    {/* Table Header — stacks on mobile; the search was a fixed 200px which,
                        next to the title and status filter, forced the row wider than a phone. */}
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3"
                        style={{ padding: '12px 16px', borderBottom: `1px solid ${BORDER}`, background: BG_HEADER }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                            <div style={{
                                width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                                background: 'linear-gradient(135deg, #ecfdf5, #d1fae5)', border: '1px solid #a7f3d0',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                                <Target size={14} color="#059669" />
                            </div>
                            <span style={{ fontSize: 15, fontWeight: 700, color: TEXT_WHITE, whiteSpace: 'nowrap' }}>Elimination Tasks</span>
                            <span style={{
                                background: '#f0f9ff', color: '#0891b2', fontSize: 12, fontWeight: 700,
                                padding: '3px 12px', borderRadius: 12, border: '1px solid #a5f3fc', flexShrink: 0,
                            }}>{filteredTasks.length}</span>
                        </div>
                        <div className="flex items-center gap-2 w-full sm:w-auto">
                            <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
                                <Search size={14} color="#94a3b8" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                                <input
                                    value={deSearch} onChange={e => setDeSearch(e.target.value)}
                                    placeholder="Search tasks..."
                                    className="w-full sm:w-[200px]"
                                    style={{
                                        padding: '7px 12px 7px 32px', fontSize: 13, border: `1px solid ${BORDER}`,
                                        borderRadius: 8, outline: 'none', background: '#fff', color: TEXT_WHITE,
                                    }}
                                />
                            </div>
                            <select
                                value={deFilter} onChange={e => setDeFilter(e.target.value)}
                                style={{
                                    padding: '7px 10px', fontSize: 13, border: `1px solid ${BORDER}`,
                                    borderRadius: 8, background: '#fff', color: TEXT_WHITE, cursor: 'pointer',
                                    outline: 'none', flexShrink: 0,
                                }}
                            >
                                <option value="all">All Statuses</option>
                                <option value="identified">Identified</option>
                                <option value="in_progress">In Progress</option>
                                <option value="resolved">Resolved</option>
                                <option value="verified">Verified</option>
                            </select>
                        </div>
                    </div>

                    {/* Mobile: stacked cards — the 8-column table forced sideways scrolling */}
                    <div className="sm:hidden">
                        {filteredTasks.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '40px 24px', color: TEXT_DIM }}>
                                <div style={{
                                    width: 56, height: 56, borderRadius: '50%', background: '#f1f5f9',
                                    margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}>
                                    <Target size={24} color={TEXT_DIM} />
                                </div>
                                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6, color: TEXT_MUTED }}>No elimination tasks yet</div>
                                <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                                    Run a Pareto analysis to identify bad actors, then create DE tasks from RCA findings.
                                </div>
                            </div>
                        ) : filteredTasks.map((task, idx) => {
                            const sm = STATUS_META[task.status];
                            return (
                                <div key={task.id}
                                    onClick={() => openTaskWorkspace(task.id)}
                                    style={{
                                        padding: '14px 16px', cursor: 'pointer',
                                        borderTop: idx === 0 ? 'none' : '1px solid #e2e8f0',
                                        background: idx % 2 === 1 ? '#fbfcfd' : '#fff',
                                    }}
                                >
                                    {/* Title + number */}
                                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                                        <span style={{
                                            flexShrink: 0, minWidth: 22, height: 22, borderRadius: 6,
                                            background: '#f1f5f9', border: '1px solid #e2e8f0', color: '#64748b',
                                            fontSize: 11, fontWeight: 800, display: 'inline-flex',
                                            alignItems: 'center', justifyContent: 'center', padding: '0 5px', marginTop: 1,
                                        }}>{idx + 1}</span>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontWeight: 600, color: TEXT_WHITE, fontSize: 14, lineHeight: 1.35 }}>
                                                {task.title}
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
                                                <Activity size={11} color={TEXT_DIM} />
                                                <span style={{
                                                    fontSize: 12, color: TEXT_BRIGHT,
                                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                                }}>{task.assetName}</span>
                                            </div>
                                        </div>
                                        <ArrowRight size={16} color="#cbd5e1" style={{ flexShrink: 0, marginTop: 2 }} />
                                    </div>

                                    {/* Badges */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                                        <span style={{
                                            padding: '3px 10px', borderRadius: 10, fontSize: 11, fontWeight: 700,
                                            background: PRIORITY_BG[task.priority], color: PRIORITY_COLORS[task.priority],
                                            border: `1px solid ${PRIORITY_COLORS[task.priority]}35`,
                                        }}>{PRIORITY_LABELS[task.priority]}</span>
                                        <span style={{
                                            display: 'inline-flex', alignItems: 'center', gap: 5,
                                            padding: '3px 10px', borderRadius: 10, fontSize: 11, fontWeight: 700,
                                            background: sm.bg, color: sm.color, border: `1px solid ${sm.color}40`,
                                        }}>{sm.icon} {sm.label}</span>
                                        {/* Evidence confidence inherited from the source RCA (0218) */}
                                        {task.evidenceConfidence != null && (() => {
                                            const c = confidenceFromScore(task.evidenceConfidence);
                                            return (
                                                <span style={{
                                                    padding: '3px 10px', borderRadius: 10, fontSize: 11, fontWeight: 700,
                                                    background: c.bg, color: c.color, border: `1px solid ${c.color}35`,
                                                }} title={`Root-cause evidence confidence ${c.score}% — from cited evidence grades in the RCA`}>
                                                    {c.label} · {c.score}%
                                                </span>
                                            );
                                        })()}
                                        {task.collaborators && task.collaborators.length > 0 && (
                                            <AvatarStack collaborators={task.collaborators} max={3} size="sm" />
                                        )}
                                    </div>

                                    {/* Money — the reason this row exists */}
                                    <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 11 }}>
                                        <span style={{ color: TEXT_MUTED }}>
                                            Annual cost <strong style={{ color: '#ef4444', fontSize: 12 }}>{fmt$(task.annualCost)}</strong>
                                        </span>
                                        <span style={{ color: TEXT_MUTED }}>
                                            Est. savings <strong style={{ color: '#059669', fontSize: 12 }}>{fmt$(task.estimatedSavings)}</strong>
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Table Body (tablet / desktop) */}
                    <div className="hidden sm:block" style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                                <tr style={{ background: '#f1f5f9', borderBottom: `1px solid ${BORDER}` }}>
                                    <th style={{ textAlign: 'left', padding: '10px 16px', fontWeight: 600, color: TEXT_MUTED, fontSize: 12 }}>Task</th>
                                    <th style={{ textAlign: 'left', padding: '10px 16px', fontWeight: 600, color: TEXT_MUTED, fontSize: 12 }}>Asset</th>
                                    <th style={{ textAlign: 'left', padding: '10px 16px', fontWeight: 600, color: TEXT_MUTED, fontSize: 12 }}>Priority</th>
                                    <th style={{ textAlign: 'left', padding: '10px 16px', fontWeight: 600, color: TEXT_MUTED, fontSize: 12 }}>Status</th>
                                    <th style={{ textAlign: 'right', padding: '10px 16px', fontWeight: 600, color: TEXT_MUTED, fontSize: 12 }}>Annual Cost</th>
                                    <th style={{ textAlign: 'right', padding: '10px 16px', fontWeight: 600, color: TEXT_MUTED, fontSize: 12 }}>Est. Savings</th>
                                    <th style={{ textAlign: 'center', padding: '10px 16px', fontWeight: 600, color: TEXT_MUTED, fontSize: 12 }}>Team</th>
                                    <th style={{ textAlign: 'right', padding: '10px 16px', fontWeight: 600, color: TEXT_MUTED, fontSize: 12 }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredTasks.length === 0 ? (
                                    <tr>
                                        <td colSpan={8} style={{ textAlign: 'center', padding: '48px 24px', color: TEXT_DIM }}>
                                            <div style={{
                                                width: 56, height: 56, borderRadius: '50%', background: '#f1f5f9',
                                                margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            }}>
                                                <Target size={24} color={TEXT_DIM} />
                                            </div>
                                            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6, color: TEXT_MUTED }}>No elimination tasks yet</div>
                                            <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                                                Run a Pareto analysis to identify bad actors,<br />then create DE tasks from RCA findings.
                                            </div>
                                        </td>
                                    </tr>
                                ) : filteredTasks.map(task => {
                                    const sm = STATUS_META[task.status];
                                    return (
                                        <tr key={task.id}
                                            onClick={() => openTaskWorkspace(task.id)}
                                            style={{ cursor: 'pointer', borderBottom: '1px solid #f1f5f9', transition: 'background .15s' }}
                                            onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                        >
                                            <td style={{ padding: '14px 16px', maxWidth: 260 }}>
                                                <div style={{ fontWeight: 600, color: TEXT_WHITE, lineHeight: 1.4 }}>{task.title}</div>
                                            </td>
                                            <td style={{ padding: '14px 16px', color: TEXT_BRIGHT, fontSize: 12 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                                    <Activity size={11} color={TEXT_DIM} /> {task.assetName}
                                                </div>
                                            </td>
                                            <td style={{ padding: '14px 16px' }}>
                                                <span style={{
                                                    padding: '4px 12px', borderRadius: 10, fontSize: 11, fontWeight: 700,
                                                    background: PRIORITY_BG[task.priority], color: PRIORITY_COLORS[task.priority],
                                                    border: `1px solid ${PRIORITY_COLORS[task.priority]}35`,
                                                }}>{PRIORITY_LABELS[task.priority]}</span>
                                            </td>
                                            <td style={{ padding: '14px 16px' }}>
                                                <span style={{
                                                    display: 'inline-flex', alignItems: 'center', gap: 5,
                                                    padding: '4px 12px', borderRadius: 10, fontSize: 11, fontWeight: 700,
                                                    background: sm.bg, color: sm.color, border: `1px solid ${sm.color}40`,
                                                }}>{sm.icon} {sm.label}</span>
                                            </td>
                                            <td style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 600, color: '#ef4444', fontSize: 12 }}>
                                                {fmt$(task.annualCost)}
                                            </td>
                                            <td style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 600, color: '#059669', fontSize: 12 }}>
                                                {fmt$(task.estimatedSavings)}
                                            </td>
                                            <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                                                {task.collaborators && task.collaborators.length > 0 ? (
                                                    <AvatarStack collaborators={task.collaborators} max={3} size="sm" />
                                                ) : (
                                                    <span style={{ fontSize: 10, color: TEXT_DIM }}>—</span>
                                                )}
                                            </td>
                                            <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                                                <button
                                                    onClick={e => { e.stopPropagation(); openTaskWorkspace(task.id); }}
                                                    style={{
                                                        display: 'inline-flex', alignItems: 'center', gap: 5,
                                                        padding: '5px 12px', background: '#eff6ff', color: '#2563eb',
                                                        border: '1px solid #bfdbfe', borderRadius: 8, fontSize: 12,
                                                        fontWeight: 600, cursor: 'pointer',
                                                    }}
                                                >
                                                    <ArrowRight size={12} /> Open
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ════ WORKSPACE VIEW ═══════════════════════════════ */}
            {viewMode === 'workspace' && selectedTask && (
                <>
                    <button onClick={backToPortfolio} style={{
                        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0',
                        background: 'none', border: 'none', color: '#0891b2', cursor: 'pointer',
                        fontSize: 13, fontWeight: 500,
                    }}>
                        <ArrowLeft size={15} /> Back to Portfolio
                    </button>
                </>
            )}
            {viewMode === 'workspace' && (
            <div style={{ display: 'grid', gridTemplateColumns: selectedTask ? '1fr' : '1fr', gap: 16, minHeight: 540 }}>

                {/* ── LEFT: Task List ────────────────────────────── */}
                <div style={{
                    background: BG_CARD, borderRadius: 16,
                    border: `1px solid ${BORDER}`, overflow: 'hidden',
                    display: 'flex', flexDirection: 'column',
                    boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
                }}>
                    {/* List header */}
                    <div style={{
                        padding: '16px 20px',
                        borderBottom: `1px solid ${BORDER}`,
                        display: 'flex', alignItems: 'center', gap: 10,
                        background: BG_HEADER,
                    }}>
                        <Target size={16} color="#22d3ee" />
                        <span style={{ fontSize: 15, fontWeight: 700, color: TEXT_WHITE }}>
                            Elimination Tasks
                        </span>
                        <span style={{
                            background: '#f0f9ff', color: '#0891b2',
                            fontSize: 12, fontWeight: 700, padding: '3px 12px', borderRadius: 12,
                            border: '1px solid #a5f3fc',
                        }}>
                            {tasks.length}
                        </span>
                    </div>

                    {/* Task rows */}
                    <div style={{ flex: 1, overflowY: 'auto' }}>
                        {tasks.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '52px 24px' }}>
                                <div style={{
                                    width: 56, height: 56, borderRadius: '50%',
                                    background: '#f1f5f9', margin: '0 auto 16px',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}>
                                    <Target size={24} color={TEXT_DIM} />
                                </div>
                                <div style={{ fontWeight: 700, color: TEXT_MUTED, fontSize: 14, marginBottom: 6 }}>No elimination tasks yet</div>
                                <div style={{ fontSize: 12, color: TEXT_DIM, lineHeight: 1.5 }}>
                                    Run a Pareto analysis to identify bad actors,<br />
                                    then create DE tasks from RCA findings.
                                </div>
                            </div>
                        ) : tasks.map(task => {
                            const sm = STATUS_META[task.status];
                            const isSelected = selectedTaskId === task.id;
                            return (
                                <button key={task.id}
                                    onClick={() => setSelectedTaskId(task.id)}
                                    style={{
                                        display: 'flex', width: '100%', textAlign: 'left',
                                        padding: '16px 20px', cursor: 'pointer',
                                        background: isSelected ? '#f0f9ff' : 'transparent',
                                        border: 'none',
                                        borderBottom: `1px solid ${BORDER}`,
                                        borderLeft: `4px solid ${PRIORITY_COLORS[task.priority]}`,
                                        transition: 'background .15s',
                                        gap: 12, alignItems: 'flex-start',
                                    }}
                                    onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#f8fafc'; }}
                                    onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                                >
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{
                                            fontSize: 14, fontWeight: 600,
                                            color: isSelected ? TEXT_WHITE : TEXT_BRIGHT,
                                            lineHeight: 1.5, marginBottom: 6,
                                            overflow: 'hidden', textOverflow: 'ellipsis',
                                            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                                        } as React.CSSProperties}>
                                            {task.title}
                                        </div>
                                        <div style={{ fontSize: 12, color: TEXT_MUTED, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 5 }}>
                                            <Activity size={11} />
                                            {task.assetName}
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                            <span style={{
                                                display: 'inline-flex', alignItems: 'center', gap: 5,
                                                padding: '4px 12px', borderRadius: 10, fontSize: 11, fontWeight: 700,
                                                background: sm.bg, color: sm.color,
                                                border: `1px solid ${sm.color}40`,
                                            }}>
                                                {sm.icon} {sm.label}
                                            </span>
                                            <span style={{
                                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                                padding: '4px 10px', borderRadius: 10, fontSize: 11, fontWeight: 700,
                                                background: PRIORITY_BG[task.priority],
                                                color: PRIORITY_COLORS[task.priority],
                                                border: `1px solid ${PRIORITY_COLORS[task.priority]}35`,
                                            }}>
                                                {PRIORITY_LABELS[task.priority]}
                                            </span>
                                            <span style={{ fontSize: 11, color: TEXT_DIM, marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <Calendar size={10} /> {daysAgo(task.createdAt)}
                                            </span>
                                        </div>
                                    </div>
                                    <ChevronRight size={15} color={isSelected ? '#22d3ee' : TEXT_DIM} style={{ marginTop: 4, flexShrink: 0 }} />
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* ── RIGHT: Task Detail Pane ────────────────────── */}
                {selectedTask && (
                    <div style={{
                        background: BG_CARD, borderRadius: 16,
                        border: `1px solid ${BORDER}`, overflow: 'auto',
                        display: 'flex', flexDirection: 'column',
                        boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
                    }}>
                        {/* ─ Detail Header ─ */}
                        <div style={{
                            padding: '24px 28px',
                            borderBottom: `1px solid ${BORDER}`,
                            background: BG_HEADER,
                        }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                                <div style={{
                                    width: 44, height: 44, borderRadius: 14,
                                    background: PRIORITY_BG[selectedTask.priority],
                                    border: `2px solid ${PRIORITY_COLORS[selectedTask.priority]}50`,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                                }}>
                                    <Target size={22} color={PRIORITY_COLORS[selectedTask.priority]} />
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <h2 style={{ fontSize: 19, fontWeight: 700, color: TEXT_WHITE, margin: 0, lineHeight: 1.35 }}>
                                        {selectedTask.title}
                                    </h2>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                                        <span style={{
                                            display: 'inline-flex', alignItems: 'center', gap: 5,
                                            padding: '5px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700,
                                            background: STATUS_META[selectedTask.status].bg,
                                            color: STATUS_META[selectedTask.status].color,
                                            border: `1px solid ${STATUS_META[selectedTask.status].color}40`,
                                        }}>
                                            {STATUS_META[selectedTask.status].icon}
                                            {STATUS_META[selectedTask.status].label}
                                        </span>
                                        <span style={{
                                            padding: '5px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700,
                                            background: PRIORITY_BG[selectedTask.priority],
                                            color: PRIORITY_COLORS[selectedTask.priority],
                                            border: `1px solid ${PRIORITY_COLORS[selectedTask.priority]}35`,
                                        }}>
                                            {PRIORITY_LABELS[selectedTask.priority]}
                                        </span>
                                        {selectedTask.evidenceConfidence != null && (() => {
                                            const c = confidenceFromScore(selectedTask.evidenceConfidence);
                                            return (
                                                <span style={{
                                                    padding: '5px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700,
                                                    background: c.bg, color: c.color, border: `1px solid ${c.color}35`,
                                                }} title={`Root-cause evidence confidence ${c.score}% — from cited evidence grades in the RCA`}>
                                                    Evidence: {c.label} · {c.score}%
                                                </span>
                                            );
                                        })()}
                                        <span style={{ fontSize: 13, color: TEXT_BRIGHT, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                                            <Activity size={13} color={TEXT_MUTED} />
                                            {selectedTask.assetName}
                                        </span>
                                    </div>
                                </div>
                                {/* Action buttons */}
                                <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                                    {/* Team avatar + invite */}
                                    {selectedTask.collaborators && selectedTask.collaborators.length > 0 && (
                                        <div style={{ marginRight: 4 }}>
                                            <AvatarStack collaborators={selectedTask.collaborators} max={3} size="md" />
                                        </div>
                                    )}
                                    {onUpdateTaskCollaborators && (
                                        <button onClick={() => setShowTeamPanel(true)}
                                            style={{
                                                background: '#f5f3ff', border: '1px solid #c4b5fd',
                                                color: '#7c3aed', padding: '10px 14px', borderRadius: 12, cursor: 'pointer',
                                                display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600,
                                                transition: 'all .15s',
                                            }}
                                            onMouseEnter={e => { e.currentTarget.style.background = '#ede9fe'; }}
                                            onMouseLeave={e => { e.currentTarget.style.background = '#f5f3ff'; }}
                                        >
                                            <Users size={14} />
                                            <span>{selectedTask.collaborators?.length ? `Team (${selectedTask.collaborators.length})` : 'Invite Team'}</span>
                                        </button>
                                    )}
                                    {onEditTask && (
                                        <button onClick={() => setEditingTask(selectedTask)}
                                            style={{
                                                background: '#eff6ff', border: '1px solid #93c5fd50',
                                                color: '#3b82f6', padding: '10px 12px', borderRadius: 12, cursor: 'pointer',
                                                display: 'flex', alignItems: 'center',
                                            }}>
                                            <Edit3 size={16} />
                                        </button>
                                    )}
                                    {onDeleteTask && (
                                        <button onClick={() => setDeleteTarget({ id: selectedTask.id, title: selectedTask.title })}
                                            style={{
                                                background: '#fef2f2', border: '1px solid #fca5a550',
                                                color: '#ef4444', padding: '10px 12px', borderRadius: 12, cursor: 'pointer',
                                                display: 'flex', alignItems: 'center',
                                            }}>
                                            <Trash2 size={16} />
                                        </button>
                                    )}
                                    {onGenerateWO && (
                                        <button onClick={() => {
                                            onGenerateWO(selectedTask.id, {
                                                title: selectedTask.title,
                                                description: `DE Action: ${selectedTask.title}\n\n${selectedTask.proposedSolution}`,
                                                type: 'CM',
                                                priority: selectedTask.priority === 'critical' ? 'EMERGENCY' : selectedTask.priority === 'high' ? 'HIGH' : selectedTask.priority === 'medium' ? 'MEDIUM' : 'LOW',
                                                asset_id: selectedTask.assetId || null,
                                            });
                                        }}
                                            style={{
                                                background: 'linear-gradient(135deg, #4f46e5, #7c3aed)', border: 'none',
                                                color: '#fff', padding: '10px 16px', borderRadius: 12, cursor: 'pointer',
                                                display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 700,
                                                boxShadow: '0 2px 8px rgba(79,70,229,0.3)', transition: 'all .15s',
                                            }}
                                            onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 16px rgba(79,70,229,0.4)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                                            onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 2px 8px rgba(79,70,229,0.3)'; e.currentTarget.style.transform = 'translateY(0)'; }}
                                        >
                                            <Wrench size={14} /> Generate WO
                                        </button>
                                    )}
                                    {onCreatePM && (selectedTask.status === 'resolved' || selectedTask.status === 'verified') && (
                                        <button onClick={() => {
                                            setPMForm({
                                                code: `PM-${selectedTask.assetName.replace(/\s+/g, '-').substring(0, 12).toUpperCase()}-${Date.now().toString(36).slice(-4).toUpperCase()}`,
                                                description: `Preventive Maintenance — ${selectedTask.title}`,
                                                schedule_type: 'calendar',
                                                frequency_interval: 3,
                                                frequency_unit: 'months',
                                                work_type: 'PM',
                                                estimated_hours: 2,
                                            });
                                            setShowPMModal(true);
                                        }}
                                            style={{
                                                background: 'linear-gradient(135deg, #059669, #10b981)', border: 'none',
                                                color: '#fff', padding: '10px 16px', borderRadius: 12, cursor: 'pointer',
                                                display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 700,
                                                boxShadow: '0 2px 8px rgba(5,150,105,0.3)', transition: 'all .15s',
                                            }}
                                            onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 16px rgba(5,150,105,0.4)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                                            onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 2px 8px rgba(5,150,105,0.3)'; e.currentTarget.style.transform = 'translateY(0)'; }}
                                        >
                                            <RotateCcw size={14} /> Create PM Strategy
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* ─ Detail Body ─ */}
                        <div style={{ padding: '24px 28px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 22 }}>

                            {/* ▸ ROOT CAUSE DIAGNOSIS */}
                            <div style={{
                                background: '#fef2f2', borderRadius: 16,
                                border: '1px solid #fecaca50', overflow: 'hidden',
                            }}>
                                <div style={{
                                    padding: '16px 22px',
                                    borderBottom: '1px solid #991b1b20',
                                    display: 'flex', alignItems: 'center', gap: 10,
                                    background: '#fef2f2',
                                }}>
                                    <div style={{
                                        width: 30, height: 30, borderRadius: 10,
                                        background: '#fee2e2', border: '1px solid #fca5a540',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    }}>
                                        <FileSearch size={15} color="#dc2626" />
                                    </div>
                                    <span style={{ fontSize: 14, fontWeight: 700, color: '#dc2626', letterSpacing: '0.05em', textTransform: 'uppercase' as const }}>
                                        Root Cause Diagnosis
                                    </span>
                                    {(() => {
                                        const method = detectRCAMethod(selectedTask.rootCauseSummary);
                                        return method ? (
                                            <span style={{
                                                marginLeft: 'auto',
                                                display: 'inline-flex', alignItems: 'center', gap: 5,
                                                padding: '5px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700,
                                                background: `${method.color}15`, color: method.color,
                                                border: `1px solid ${method.color}30`,
                                            }}>
                                                <Sparkles size={12} /> {method.label}
                                            </span>
                                        ) : null;
                                    })()}
                                </div>
                                <div style={{ padding: '22px' }}>
                                    {/* Flow: Problem → Root Cause → Elimination */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, fontSize: 12, fontWeight: 700 }}>
                                        <span style={{ padding: '5px 14px', borderRadius: 8, background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
                                            PROBLEM
                                        </span>
                                        <ArrowRight size={16} color={TEXT_DIM} />
                                        <span style={{ padding: '5px 14px', borderRadius: 8, background: '#fffbeb', color: '#d97706', border: '1px solid #fde68a' }}>
                                            ROOT CAUSE
                                        </span>
                                        <ArrowRight size={16} color={TEXT_DIM} />
                                        <span style={{ padding: '5px 14px', borderRadius: 8, background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }}>
                                            ELIMINATION
                                        </span>
                                    </div>
                                    <p style={{ fontSize: 15, color: TEXT_WHITE, margin: 0, lineHeight: 1.85, whiteSpace: 'pre-wrap' }}>
                                        {selectedTask.rootCauseSummary}
                                    </p>
                                    {(selectedTask.rcaId || onNavigateToRCA) && (
                                        <button onClick={() => onNavigateToRCA?.(selectedTask.assetId)}
                                            style={{
                                                marginTop: 18, display: 'inline-flex', alignItems: 'center', gap: 7,
                                                padding: '10px 18px', borderRadius: 12, fontSize: 13, fontWeight: 600,
                                                background: '#f0f9ff', border: '1px solid #a5f3fc',
                                                color: '#0891b2', cursor: 'pointer',
                                            }}>
                                            <ExternalLink size={14} /> View Full RCA Investigation
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* ▸ PROPOSED SOLUTION */}
                            <div style={{
                                background: '#f0fdf4', borderRadius: 16,
                                border: '1px solid #bbf7d050', overflow: 'hidden',
                            }}>
                                <div style={{
                                    padding: '16px 22px',
                                    borderBottom: '1px solid #065f4620',
                                    display: 'flex', alignItems: 'center', gap: 10,
                                    background: '#ecfdf5',
                                }}>
                                    <div style={{
                                        width: 30, height: 30, borderRadius: 10,
                                        background: '#dcfce7', border: '1px solid #86efac40',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    }}>
                                        <Wrench size={15} color="#16a34a" />
                                    </div>
                                    <span style={{ fontSize: 14, fontWeight: 700, color: '#16a34a', letterSpacing: '0.05em', textTransform: 'uppercase' as const }}>
                                        Proposed Solution
                                    </span>
                                </div>
                                <div style={{ padding: '22px' }}>
                                    <p style={{ fontSize: 15, color: TEXT_WHITE, margin: 0, lineHeight: 1.85, whiteSpace: 'pre-wrap' }}>
                                        {selectedTask.proposedSolution}
                                    </p>
                                </div>
                            </div>

                            {/* ▸ FINANCIAL IMPACT */}
                            <div style={{
                                background: '#eef2ff', borderRadius: 16,
                                border: '1px solid #c7d2fe30', overflow: 'hidden',
                            }}>
                                <div style={{
                                    padding: '16px 22px',
                                    borderBottom: '1px solid #3730a320',
                                    display: 'flex', alignItems: 'center', gap: 10,
                                    background: '#eef2ff',
                                }}>
                                    <div style={{
                                        width: 30, height: 30, borderRadius: 10,
                                        background: '#e0e7ff', border: '1px solid #a5b4fc40',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    }}>
                                        <TrendingUp size={15} color="#6366f1" />
                                    </div>
                                    <span style={{ fontSize: 14, fontWeight: 700, color: '#6366f1', letterSpacing: '0.05em', textTransform: 'uppercase' as const }}>
                                        Financial Impact
                                    </span>
                                </div>
                                <div style={{ padding: '22px' }}>
                                    {/* Metric cards */}
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 14 }}>
                                        {[
                                            { label: 'Annual Cost',   value: fmt$(selectedTask.annualCost),         color: '#ef4444', bg: '#fef2f2', icon: <AlertTriangle size={18} /> },
                                            { label: 'Est. Savings',  value: fmt$(selectedTask.estimatedSavings),   color: '#16a34a', bg: '#f0fdf4', icon: <TrendingUp size={18} /> },
                                            { label: 'Impl. Cost',    value: fmt$(selectedTask.implementationCost), color: '#d97706', bg: '#fffbeb', icon: <DollarSign size={18} /> },
                                            { label: 'Payback',       value: `${selectedTask.paybackMonths} mo`,    color: '#6366f1', bg: '#eef2ff', icon: <ArrowUpRight size={18} /> },
                                        ].map(m => (
                                            <div key={m.label} style={{
                                                textAlign: 'center', borderRadius: 14, padding: '20px 12px',
                                                background: m.bg, border: `1px solid ${m.color}25`,
                                                position: 'relative', overflow: 'hidden',
                                            }}>
                                                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: m.color }} />
                                                <div style={{ color: m.color, marginBottom: 10, display: 'flex', justifyContent: 'center' }}>{m.icon}</div>
                                                <div style={{ fontSize: 26, fontWeight: 800, color: m.color, lineHeight: 1 }}>{m.value}</div>
                                                <div style={{ fontSize: 12, color: TEXT_BRIGHT, marginTop: 8, fontWeight: 600 }}>{m.label}</div>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Net benefit */}
                                    {selectedTask.estimatedSavings > 0 && (
                                        <div style={{
                                            marginTop: 18, padding: '14px 20px', borderRadius: 12,
                                            background: '#f0fdf4', border: '1px solid #bbf7d050',
                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                        }}>
                                            <span style={{ fontSize: 13, color: TEXT_MUTED, fontWeight: 600 }}>Net Annual Benefit</span>
                                            <span style={{ fontSize: 20, fontWeight: 800, color: '#16a34a' }}>
                                                {fmt$(selectedTask.estimatedSavings - selectedTask.implementationCost)}
                                            </span>
                                        </div>
                                    )}

                                    {/* ROI bar */}
                                    <div style={{ marginTop: 18 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
                                            <span style={{ fontWeight: 600, color: TEXT_BRIGHT }}>Return on Investment</span>
                                            <span style={{ fontWeight: 800, color: '#16a34a', fontSize: 16 }}>
                                                {selectedTask.annualCost > 0 ? `${((selectedTask.estimatedSavings / selectedTask.annualCost) * 100).toFixed(0)}%` : '—'}
                                            </span>
                                        </div>
                                        <div style={{
                                            background: BG_DARKER, borderRadius: 8, height: 12,
                                            overflow: 'hidden', border: `1px solid ${BORDER}`,
                                        }}>
                                            <div style={{
                                                background: 'linear-gradient(90deg, #22c55e, #34d399, #86efac)',
                                                borderRadius: 8, height: 12,
                                                width: `${Math.min(100, selectedTask.annualCost > 0 ? (selectedTask.estimatedSavings / selectedTask.annualCost) * 100 : 0)}%`,
                                                transition: 'width .5s ease',
                                                boxShadow: '0 0 12px rgba(34,197,94,0.5)',
                                            }} />
                                        </div>
                                    </div>

                                    {/* ▸ LINKED WORK ORDERS */}
                                    {(() => {
                                        const wos = linkedWOs?.[selectedTask.id] || [];
                                        return (
                                            <div style={{ marginTop: 22 }}>
                                                <div style={{
                                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                                    marginBottom: 12,
                                                }}>
                                                    <span style={{ fontSize: 13, fontWeight: 700, color: TEXT_BRIGHT, display: 'flex', alignItems: 'center', gap: 6 }}>
                                                        <Wrench size={14} color={TEXT_MUTED} />
                                                        Linked Work Orders
                                                        {wos.length > 0 && (
                                                            <span style={{
                                                                padding: '2px 8px', borderRadius: 8, fontSize: 10, fontWeight: 700,
                                                                background: '#eef2ff', color: '#6366f1', border: '1px solid #c7d2fe',
                                                            }}>{wos.length}</span>
                                                        )}
                                                    </span>
                                                </div>
                                                {wos.length > 0 ? (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                        {wos.map(wo => (
                                                            <div key={wo.id} style={{
                                                                display: 'flex', alignItems: 'center', gap: 10,
                                                                padding: '10px 14px', borderRadius: 10,
                                                                background: BG_DARKER, border: `1px solid ${BORDER}`,
                                                                transition: 'all .15s',
                                                            }}
                                                                onMouseEnter={e => { e.currentTarget.style.background = '#f0f4ff'; e.currentTarget.style.borderColor = '#c7d2fe'; }}
                                                                onMouseLeave={e => { e.currentTarget.style.background = BG_DARKER; e.currentTarget.style.borderColor = BORDER; }}
                                                            >
                                                                <span style={{
                                                                    padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                                                                    background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe',
                                                                    fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap',
                                                                }}>{wo.wo_number}</span>
                                                                <span style={{ flex: 1, fontSize: 13, color: TEXT_BRIGHT, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{wo.title}</span>
                                                                <span style={{
                                                                    padding: '3px 10px', borderRadius: 6, fontSize: 10, fontWeight: 700,
                                                                    background: wo.status === 'CLOSED' || wo.status === 'TECO' ? '#f0fdf4' : wo.status === 'WIP' ? '#fef3c7' : '#eff6ff',
                                                                    color: wo.status === 'CLOSED' || wo.status === 'TECO' ? '#16a34a' : wo.status === 'WIP' ? '#d97706' : '#2563eb',
                                                                    border: `1px solid ${wo.status === 'CLOSED' || wo.status === 'TECO' ? '#bbf7d0' : wo.status === 'WIP' ? '#fde68a' : '#bfdbfe'}`,
                                                                }}>{wo.status}</span>
                                                                <span style={{ fontSize: 10, color: TEXT_DIM }}>{new Date(wo.created_at).toLocaleDateString()}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <div style={{
                                                        padding: '20px', textAlign: 'center', borderRadius: 10,
                                                        background: BG_DARKER, border: `1px dashed ${BORDER}`,
                                                    }}>
                                                        <Wrench size={20} color={TEXT_DIM} style={{ marginBottom: 8 }} />
                                                        <p style={{ fontSize: 13, color: TEXT_DIM, margin: 0 }}>No Work Orders generated yet</p>
                                                        <p style={{ fontSize: 11, color: TEXT_DIM, margin: '4px 0 0', opacity: 0.7 }}>Use "Generate WO" to create executable work from this initiative</p>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })()}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Empty state */}
                {!selectedTask && tasks.length > 0 && (
                    <div style={{
                        background: BG_CARD, borderRadius: 16, border: `1px solid ${BORDER}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{
                                width: 60, height: 60, borderRadius: '50%',
                                background: '#1e293b', margin: '0 auto 16px',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                                <Target size={28} color={TEXT_DIM} />
                            </div>
                            <p style={{ fontWeight: 700, color: TEXT_MUTED, fontSize: 15 }}>Select a task to view details</p>
                            <p style={{ fontSize: 13, color: TEXT_DIM, marginTop: 6 }}>Choose from the list on the left</p>
                        </div>
                    </div>
                )}
            </div>
            )}

            {/* ════ DRAFT PLAN MODAL ═════════════════════════════ */}
            {draftPlan && (
                <div style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
                    backdropFilter: 'blur(6px)',
                }}>
                    <div style={{
                        background: BG_CARD, borderRadius: 20, padding: 28,
                        maxWidth: 560, width: '90%', border: `1px solid #c7d2fe`,
                        boxShadow: '0 24px 64px rgba(0,0,0,0.12)',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
                            <div style={{
                                width: 36, height: 36, borderRadius: 12,
                                background: '#eef2ff', border: '1px solid #c7d2fe',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                                <Sparkles size={18} color="#6366f1" />
                            </div>
                            <span style={{ fontSize: 18, fontWeight: 700, color: TEXT_WHITE }}>AI-Drafted Elimination Plan</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            {[
                                { label: 'Title', value: draftPlan.title },
                                { label: 'Scope', value: draftPlan.scope },
                                { label: 'Root Cause', value: draftPlan.rootCauseSummary },
                                { label: 'Proposed Solution', value: draftPlan.proposedSolution },
                            ].map(row => (
                                <div key={row.label}>
                                    <span style={{ fontSize: 11, color: TEXT_MUTED, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>{row.label}</span>
                                    <p style={{ fontSize: 14, color: TEXT_WHITE, margin: '6px 0 0', lineHeight: 1.7 }}>{row.value}</p>
                                </div>
                            ))}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 4 }}>
                                <div style={{ background: '#f0fdf4', borderRadius: 12, padding: 14, textAlign: 'center', border: '1px solid #bbf7d0' }}>
                                    <span style={{ fontSize: 10, color: TEXT_MUTED, fontWeight: 700 }}>SAVINGS/YR</span>
                                    <div style={{ fontSize: 20, fontWeight: 800, color: '#16a34a', marginTop: 4 }}>{fmt$(draftPlan.estimatedSavingsPerYear)}</div>
                                </div>
                                <div style={{ background: '#fef2f2', borderRadius: 12, padding: 14, textAlign: 'center', border: '1px solid #fecaca' }}>
                                    <span style={{ fontSize: 10, color: TEXT_MUTED, fontWeight: 700 }}>IMPL. COST</span>
                                    <div style={{ fontSize: 20, fontWeight: 800, color: '#ef4444', marginTop: 4 }}>{fmt$(draftPlan.estimatedImplementationCost)}</div>
                                </div>
                                <div style={{ background: '#eef2ff', borderRadius: 12, padding: 14, textAlign: 'center', border: '1px solid #c7d2fe' }}>
                                    <span style={{ fontSize: 10, color: TEXT_MUTED, fontWeight: 700 }}>PAYBACK</span>
                                    <div style={{ fontSize: 20, fontWeight: 800, color: '#6366f1', marginTop: 4 }}>{draftPlan.paybackMonths}mo</div>
                                </div>
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: 10, marginTop: 24, justifyContent: 'flex-end' }}>
                            <button onClick={() => { setDraftPlan(null); setDraftAssetId(null); }}
                                style={{ background: '#f1f5f9', border: `1px solid ${BORDER}`, color: TEXT_MUTED, padding: '10px 20px', borderRadius: 12, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                                Dismiss
                            </button>
                            <button onClick={handleAcceptPlan}
                                style={{ background: '#eef2ff', border: '1px solid #6366f1', color: '#4f46e5', padding: '10px 20px', borderRadius: 12, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                                ✓ Accept & Create Task
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ════ EDIT TASK MODAL ══════════════════════════════ */}
            {editingTask && (
                <div style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
                    backdropFilter: 'blur(6px)',
                }}>
                    <div style={{
                        background: BG_CARD, borderRadius: 20, padding: 28,
                        maxWidth: 520, width: '90%', border: '1px solid #93c5fd',
                        boxShadow: '0 24px 64px rgba(0,0,0,0.12)',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
                            <span style={{ fontSize: 18, fontWeight: 700, color: TEXT_WHITE }}>Edit Task</span>
                            <button onClick={() => setEditingTask(null)}
                                style={{ background: '#f1f5f9', border: 'none', cursor: 'pointer', color: TEXT_MUTED, padding: 6, borderRadius: 8 }}>
                                <X size={18} />
                            </button>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            {[{ label: 'Title', key: 'title', type: 'text' },
                              { label: 'Root Cause', key: 'rootCauseSummary', type: 'textarea' },
                              { label: 'Proposed Solution', key: 'proposedSolution', type: 'textarea' },
                            ].map(f => (
                                <div key={f.key}>
                                    <label style={{ fontSize: 11, color: TEXT_MUTED, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>{f.label}</label>
                                    {f.type === 'textarea' ? (
                                        <textarea value={(editingTask as any)[f.key] || ''}
                                            onChange={e => setEditingTask(prev => prev ? { ...prev, [f.key]: e.target.value } : null)}
                                            rows={3} style={{ width: '100%', background: BG_DARKER, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '12px 16px', color: TEXT_WHITE, fontSize: 14, marginTop: 8, resize: 'vertical' as const, boxSizing: 'border-box', lineHeight: 1.7 }} />
                                    ) : (
                                        <input type="text" value={(editingTask as any)[f.key] || ''}
                                            onChange={e => setEditingTask(prev => prev ? { ...prev, [f.key]: e.target.value } : null)}
                                            style={{ width: '100%', background: BG_DARKER, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '12px 16px', color: TEXT_WHITE, fontSize: 14, marginTop: 8, boxSizing: 'border-box' }} />
                                    )}
                                </div>
                            ))}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                                <div>
                                    <label style={{ fontSize: 11, color: TEXT_MUTED, fontWeight: 700, letterSpacing: '0.06em' }}>STATUS</label>
                                    <select value={editingTask.status}
                                        onChange={e => setEditingTask(prev => prev ? { ...prev, status: e.target.value as DefectEliminationTask['status'] } : null)}
                                        style={{ width: '100%', background: BG_DARKER, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '12px 16px', color: TEXT_WHITE, fontSize: 14, marginTop: 8 }}>
                                        <option value="identified">Identified</option>
                                        <option value="in_progress">In Progress</option>
                                        <option value="resolved">Resolved</option>
                                        <option value="verified">Verified</option>
                                    </select>
                                </div>
                                <div>
                                    <label style={{ fontSize: 11, color: TEXT_MUTED, fontWeight: 700, letterSpacing: '0.06em' }}>PRIORITY</label>
                                    <select value={editingTask.priority}
                                        onChange={e => setEditingTask(prev => prev ? { ...prev, priority: e.target.value as DefectEliminationTask['priority'] } : null)}
                                        style={{ width: '100%', background: BG_DARKER, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '12px 16px', color: TEXT_WHITE, fontSize: 14, marginTop: 8 }}>
                                        <option value="critical">Critical</option>
                                        <option value="high">High</option>
                                        <option value="medium">Medium</option>
                                        <option value="low">Low</option>
                                    </select>
                                </div>
                            </div>
                            {/* Financial Fields */}
                            <div style={{ marginTop: 4 }}>
                                <label style={{ fontSize: 11, color: TEXT_MUTED, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>Financial Impact</label>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 8 }}>
                                    <div>
                                        <label style={{ fontSize: 10, color: TEXT_DIM, fontWeight: 600 }}>Annual Cost ($)</label>
                                        <input type="number" value={editingTask.annualCost || 0}
                                            onChange={e => setEditingTask(prev => prev ? { ...prev, annualCost: Number(e.target.value) } : null)}
                                            style={{ width: '100%', background: BG_DARKER, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '10px 14px', color: TEXT_WHITE, fontSize: 14, marginTop: 4, boxSizing: 'border-box' as const }} />
                                    </div>
                                    <div>
                                        <label style={{ fontSize: 10, color: TEXT_DIM, fontWeight: 600 }}>Est. Savings ($)</label>
                                        <input type="number" value={editingTask.estimatedSavings || 0}
                                            onChange={e => setEditingTask(prev => prev ? { ...prev, estimatedSavings: Number(e.target.value) } : null)}
                                            style={{ width: '100%', background: BG_DARKER, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '10px 14px', color: TEXT_WHITE, fontSize: 14, marginTop: 4, boxSizing: 'border-box' as const }} />
                                    </div>
                                    <div>
                                        <label style={{ fontSize: 10, color: TEXT_DIM, fontWeight: 600 }}>Implementation Cost ($)</label>
                                        <input type="number" value={editingTask.implementationCost || 0}
                                            onChange={e => setEditingTask(prev => prev ? { ...prev, implementationCost: Number(e.target.value) } : null)}
                                            style={{ width: '100%', background: BG_DARKER, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '10px 14px', color: TEXT_WHITE, fontSize: 14, marginTop: 4, boxSizing: 'border-box' as const }} />
                                    </div>
                                    <div>
                                        <label style={{ fontSize: 10, color: TEXT_DIM, fontWeight: 600 }}>Payback Period (months)</label>
                                        <input type="number" value={editingTask.paybackMonths || 0}
                                            onChange={e => setEditingTask(prev => prev ? { ...prev, paybackMonths: Number(e.target.value) } : null)}
                                            style={{ width: '100%', background: BG_DARKER, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '10px 14px', color: TEXT_WHITE, fontSize: 14, marginTop: 4, boxSizing: 'border-box' as const }} />
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: 10, marginTop: 24, justifyContent: 'flex-end' }}>
                            <button onClick={() => setEditingTask(null)}
                                style={{ background: '#f1f5f9', border: `1px solid ${BORDER}`, color: TEXT_MUTED, padding: '10px 20px', borderRadius: 12, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                                Cancel
                            </button>
                            <button onClick={() => {
                                if (editingTask && onEditTask) {
                                    onEditTask(editingTask.id, {
                                        title: editingTask.title,
                                        status: editingTask.status,
                                        priority: editingTask.priority,
                                        rootCauseSummary: editingTask.rootCauseSummary,
                                        proposedSolution: editingTask.proposedSolution,
                                        annualCost: editingTask.annualCost,
                                        estimatedSavings: editingTask.estimatedSavings,
                                        implementationCost: editingTask.implementationCost,
                                        paybackMonths: editingTask.paybackMonths,
                                    });
                                }
                                setEditingTask(null);
                            }}
                                style={{ background: '#eff6ff', border: '1px solid #3b82f6', color: '#1d4ed8', padding: '10px 20px', borderRadius: 12, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                                ✓ Save Changes
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ════ DELETE CONFIRMATION ══════════════════════════ */}
            {deleteTarget && (
                <div style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
                    backdropFilter: 'blur(6px)',
                }}>
                    <div style={{
                        background: BG_CARD, borderRadius: 20, padding: 28,
                        maxWidth: 420, width: '90%', border: '1px solid #fecaca',
                        boxShadow: '0 24px 64px rgba(0,0,0,0.12)',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
                            <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <AlertCircle size={24} color="#ef4444" />
                            </div>
                            <div>
                                <div style={{ fontSize: 16, fontWeight: 700, color: TEXT_WHITE }}>Delete DE Task</div>
                                <div style={{ fontSize: 13, color: TEXT_MUTED }}>This action cannot be undone</div>
                            </div>
                        </div>
                        <p style={{ fontSize: 15, color: TEXT_BRIGHT, marginBottom: 24, lineHeight: 1.6 }}>
                            Are you sure you want to delete <strong style={{ color: TEXT_WHITE }}>"{deleteTarget.title}"</strong>?
                        </p>
                        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                            <button onClick={() => setDeleteTarget(null)}
                                style={{ background: '#f1f5f9', border: `1px solid ${BORDER}`, color: TEXT_MUTED, padding: '10px 20px', borderRadius: 12, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                                Cancel
                            </button>
                            <button onClick={() => { onDeleteTask?.(deleteTarget.id); setDeleteTarget(null); if (selectedTaskId === deleteTarget.id) setSelectedTaskId(null); }}
                                style={{ background: '#fef2f2', border: '1px solid #ef4444', color: '#dc2626', padding: '10px 20px', borderRadius: 12, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ════ PM CREATION MODAL ═════════════════════════════ */}
            {showPMModal && selectedTask && onCreatePM && (
                <div style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
                    backdropFilter: 'blur(6px)',
                }}>
                    <div style={{
                        background: BG_CARD, borderRadius: 20, padding: 28,
                        maxWidth: 540, width: '90%', border: '1px solid #bbf7d0',
                        boxShadow: '0 24px 64px rgba(0,0,0,0.12)',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
                            <div style={{
                                width: 40, height: 40, borderRadius: 14,
                                background: '#ecfdf5', border: '1px solid #86efac',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                                <RotateCcw size={20} color="#059669" />
                            </div>
                            <div>
                                <span style={{ fontSize: 18, fontWeight: 700, color: TEXT_WHITE }}>Create PM Strategy</span>
                                <div style={{ fontSize: 12, color: TEXT_MUTED }}>Lock in the defect elimination with a recurring PM</div>
                            </div>
                            <button onClick={() => setShowPMModal(false)}
                                style={{ marginLeft: 'auto', background: '#f1f5f9', border: 'none', cursor: 'pointer', color: TEXT_MUTED, padding: 6, borderRadius: 8 }}>
                                <X size={18} />
                            </button>
                        </div>

                        {/* PM Info banner */}
                        <div style={{
                            padding: '12px 16px', borderRadius: 12, marginBottom: 20,
                            background: '#f0fdf4', border: '1px solid #bbf7d050',
                            display: 'flex', alignItems: 'center', gap: 10,
                        }}>
                            <CheckCircle2 size={16} color="#059669" />
                            <span style={{ fontSize: 12, color: '#065f46', fontWeight: 500, lineHeight: 1.5 }}>
                                DE Task <strong>"{selectedTask.title}"</strong> is resolved. Creating a PM ensures the improvement is sustained.
                            </span>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            {/* PM Code */}
                            <div>
                                <label style={{ fontSize: 11, color: TEXT_MUTED, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>PM Code</label>
                                <input type="text" value={pmForm.code}
                                    onChange={e => setPMForm(p => ({ ...p, code: e.target.value }))}
                                    style={{ width: '100%', background: BG_DARKER, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '12px 16px', color: TEXT_WHITE, fontSize: 14, marginTop: 8, boxSizing: 'border-box', fontFamily: 'ui-monospace, monospace' }} />
                            </div>
                            {/* Description */}
                            <div>
                                <label style={{ fontSize: 11, color: TEXT_MUTED, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>Description</label>
                                <textarea value={pmForm.description}
                                    onChange={e => setPMForm(p => ({ ...p, description: e.target.value }))}
                                    rows={2} style={{ width: '100%', background: BG_DARKER, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '12px 16px', color: TEXT_WHITE, fontSize: 14, marginTop: 8, resize: 'vertical' as const, boxSizing: 'border-box', lineHeight: 1.7 }} />
                            </div>
                            {/* Schedule row */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
                                <div>
                                    <label style={{ fontSize: 10, color: TEXT_DIM, fontWeight: 600 }}>Schedule Type</label>
                                    <select value={pmForm.schedule_type}
                                        onChange={e => setPMForm(p => ({ ...p, schedule_type: e.target.value }))}
                                        style={{ width: '100%', background: BG_DARKER, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '10px 14px', color: TEXT_WHITE, fontSize: 13, marginTop: 4 }}>
                                        <option value="calendar">Calendar-Based</option>
                                        <option value="meter">Meter/Runtime-Based</option>
                                        <option value="condition">Condition-Based</option>
                                    </select>
                                </div>
                                <div>
                                    <label style={{ fontSize: 10, color: TEXT_DIM, fontWeight: 600 }}>Frequency</label>
                                    <input type="number" min={1} value={pmForm.frequency_interval}
                                        onChange={e => setPMForm(p => ({ ...p, frequency_interval: Number(e.target.value) }))}
                                        style={{ width: '100%', background: BG_DARKER, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '10px 14px', color: TEXT_WHITE, fontSize: 13, marginTop: 4, boxSizing: 'border-box' }} />
                                </div>
                                <div>
                                    <label style={{ fontSize: 10, color: TEXT_DIM, fontWeight: 600 }}>Unit</label>
                                    <select value={pmForm.frequency_unit}
                                        onChange={e => setPMForm(p => ({ ...p, frequency_unit: e.target.value }))}
                                        style={{ width: '100%', background: BG_DARKER, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '10px 14px', color: TEXT_WHITE, fontSize: 13, marginTop: 4 }}>
                                        <option value="days">Days</option>
                                        <option value="weeks">Weeks</option>
                                        <option value="months">Months</option>
                                        <option value="years">Years</option>
                                        <option value="hours">Running Hours</option>
                                    </select>
                                </div>
                            </div>
                            {/* Work Type + Estimated Hours */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                                <div>
                                    <label style={{ fontSize: 10, color: TEXT_DIM, fontWeight: 600 }}>Work Type</label>
                                    <select value={pmForm.work_type}
                                        onChange={e => setPMForm(p => ({ ...p, work_type: e.target.value }))}
                                        style={{ width: '100%', background: BG_DARKER, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '10px 14px', color: TEXT_WHITE, fontSize: 13, marginTop: 4 }}>
                                        <option value="PM">Preventive Maintenance</option>
                                        <option value="PDM">Predictive Maintenance</option>
                                        <option value="INSP">Inspection</option>
                                        <option value="LUB">Lubrication</option>
                                        <option value="CAL">Calibration</option>
                                    </select>
                                </div>
                                <div>
                                    <label style={{ fontSize: 10, color: TEXT_DIM, fontWeight: 600 }}>Est. Hours</label>
                                    <input type="number" min={0.5} step={0.5} value={pmForm.estimated_hours}
                                        onChange={e => setPMForm(p => ({ ...p, estimated_hours: Number(e.target.value) }))}
                                        style={{ width: '100%', background: BG_DARKER, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '10px 14px', color: TEXT_WHITE, fontSize: 13, marginTop: 4, boxSizing: 'border-box' }} />
                                </div>
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: 10, marginTop: 24, justifyContent: 'flex-end' }}>
                            <button onClick={() => setShowPMModal(false)}
                                style={{ background: '#f1f5f9', border: `1px solid ${BORDER}`, color: TEXT_MUTED, padding: '10px 20px', borderRadius: 12, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                                Cancel
                            </button>
                            <button onClick={() => {
                                if (selectedTask && pmForm.code) {
                                    onCreatePM(selectedTask.id, {
                                        ...pmForm,
                                        asset_id: selectedTask.assetId,
                                    });
                                    setShowPMModal(false);
                                }
                            }}
                                disabled={!pmForm.code}
                                style={{
                                    background: pmForm.code ? 'linear-gradient(135deg, #059669, #10b981)' : '#e2e8f0',
                                    border: 'none', color: pmForm.code ? '#fff' : TEXT_DIM,
                                    padding: '10px 20px', borderRadius: 12, cursor: pmForm.code ? 'pointer' : 'default',
                                    fontSize: 13, fontWeight: 700,
                                }}>
                                ✓ Create PM Strategy
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ════ TEAM PANEL SLIDE-OUT ════════════════════════ */}
            {showTeamPanel && selectedTask && onUpdateTaskCollaborators && (
                <TeamPanel
                    collaborators={selectedTask.collaborators || []}
                    onAdd={(collab) => {
                        const updated = [...(selectedTask.collaborators || []), collab];
                        onUpdateTaskCollaborators(selectedTask.id, updated);
                    }}
                    onRemove={(id) => {
                        const updated = (selectedTask.collaborators || []).filter(c => c.id !== id);
                        onUpdateTaskCollaborators(selectedTask.id, updated);
                    }}
                    onUpdateRole={(id, role) => {
                        const updated = (selectedTask.collaborators || []).map(c => c.id === id ? { ...c, role } : c);
                        onUpdateTaskCollaborators(selectedTask.id, updated);
                    }}
                    onClose={() => setShowTeamPanel(false)}
                />
            )}
        </div>
    );
};

export default DefectEliminationPanel;
