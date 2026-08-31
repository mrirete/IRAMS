import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
    ClipboardCheck, Loader2, Trash2, Eye, Archive, RotateCcw,
    Search, AlertTriangle, Edit3, MoreHorizontal, CheckCircle,
    Calendar, Building2, MapPin, Clock, Users, Filter
} from 'lucide-react';
import { AuditWizard } from '../components/audit/AuditWizard';
import { assessmentService } from '../eam/services/AssessmentService';
import { useAuth } from '../eam/contexts/AuthContext';
import { supabase } from '../eam/lib/supabase';
import type { AssessmentListItem, AssessmentSummary } from '../eam/services/AssessmentService';
import type { AuditAssessmentState } from '../eam/services/AuditTypes';
import { MaturityGapCard } from '../components/specialist/MaturityGapCard';

type Phase = 'list' | 'wizard';
type AuditScope = 'all' | 'mine';

export const AuditsPage: React.FC = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const { profile } = useAuth() as any;
    const currentUserId = profile?.id || '';
    const currentUsername = profile?.username || '';
    const currentEmail = profile?.email || '';

    const [phase, setPhase] = useState<Phase>('list');
    const [editingState, setEditingState] = useState<AuditAssessmentState | undefined>();

    // List state
    const [assessments, setAssessments] = useState<AssessmentListItem[]>([]);
    const [summary, setSummary] = useState<AssessmentSummary | null>(null);
    const [listLoading, setListLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [actionMenuOpen, setActionMenuOpen] = useState<string | null>(null);

    // Collaboration state
    const [auditScope, setAuditScope] = useState<AuditScope>('all');
    const [myCollaborations, setMyCollaborations] = useState<Set<string>>(new Set());

    // ─── Auto-launch from "Start Audit" on Templates page ────
    useEffect(() => {
        const state = location.state as { action?: string; templateName?: string; isoReference?: string; templateId?: string } | null;
        if (state?.action === 'start_from_template') {
            // Build pre-populated intake with template context
            const templateState: AuditAssessmentState = {
                currentStep: 1,
                status: 'in_progress',
                intake: {
                    firstName: '', lastName: '', username: '', autoUsername: true,
                    fullName: '', jobTitle: '', company: '', email: '',
                    mobileCountryCode: '', mobile: '', siteName: '',
                    industrySector: 'Oil & Gas (Upstream)', assetClass: 'Mixed / All Classes',
                    auditDate: new Date().toISOString().slice(0, 10),
                    auditObjective: `${state.templateName || 'Audit'} — ${state.isoReference || ''}`.trim(),
                    reportingLine: '', keyRisks: [], keyOpportunities: [],
                    orgVision: '', orgMission: '', orgStrategicObjectives: '',
                    orgAMPolicy: '', orgSAMP: '', orgRolesAuthorities: '',
                    orgRiskFramework: '', orgBudgetAlignment: '',
                    isoAlignment: {
                        iso55010_financial_alignment: '', iso55010_register_alignment: '', iso55010_capex_integration: '',
                        iso55011_regulatory_mapping: '', iso55011_policy_engagement: '',
                        iso55012_competence_framework: '', iso55012_cultural_factors: '', iso55012_outsourced_competence: '',
                        iso55013_data_governance: '', iso55013_data_quality: '', iso55013_data_asset_distinction: '',
                    },
                },
                documentReview: [],
                siteVerification: [],
                interviews: [],
                dimensionResults: [],
                dimensionsCompleted: 0,
                scoredFindings: [],
                overallMaturity: null,
                overallPercentage: null,
                maturityLevel: null,
                reportData: null,
                roadmapData: null,
                notes: `Template: ${state.templateId || ''} — ${state.templateName || ''}`,
            };
            setEditingState(templateState);
            setPhase('wizard');
            // Clear location state to prevent re-triggering on back navigation
            navigate(location.pathname, { replace: true, state: null });
        }
    }, [location.state, location.pathname, navigate]);

    // ─── Load List ──────────────────────────────────────────
    const loadList = useCallback(async () => {
        setListLoading(true);
        const [items, sum] = await Promise.all([
            assessmentService.listAssessments({ search: search || undefined, status: statusFilter || undefined }),
            assessmentService.getSummary(),
        ]);
        setAssessments(items);
        setSummary(sum);
        setListLoading(false);
    }, [search, statusFilter]);

    useEffect(() => {
        if (phase === 'list') loadList();
    }, [phase, loadList]);

    // ─── Load collaborations for current user ───────────────
    useEffect(() => {
        if (!currentEmail && !currentUsername) return;
        const loadCollabs = async () => {
            try {
                const { data } = await supabase
                    .from('audit_assessment_collaborators')
                    .select('assessment_id')
                    .or(`email.ilike.%${currentEmail}%${currentUsername ? `,invited_by.eq.${currentUsername}` : ''}`);
                if (data) {
                    setMyCollaborations(new Set(data.map((d: any) => d.assessment_id)));
                }
            } catch (e) {
                console.warn('[AuditsPage] Could not load collaborations:', e);
            }
        };
        loadCollabs();
    }, [currentEmail, currentUsername, phase]);

    // ─── Filtered list based on scope ───────────────────────
    const displayedAssessments = useMemo(() => {
        if (auditScope === 'all') return assessments;
        return assessments.filter(a =>
            myCollaborations.has(a.id) ||
            a.assessor_name?.toLowerCase().includes(currentUsername.toLowerCase())
        );
    }, [assessments, auditScope, myCollaborations, currentUsername]);

    // Close action menus on click outside
    useEffect(() => {
        const handleClick = () => setActionMenuOpen(null);
        document.addEventListener('click', handleClick);
        return () => document.removeEventListener('click', handleClick);
    }, []);

    // ─── Handlers ───────────────────────────────────────────
    const handleStartNew = () => {
        setEditingState(undefined);
        setPhase('wizard');
    };

    const handleSaved = () => {
        setPhase('list');
        setEditingState(undefined);
    };

    /**
     * Edit/Resume: Load the full state from DB and open in wizard
     */
    const handleEdit = async (id: string) => {
        setActionLoading(id);
        try {
            const state = await assessmentService.loadState(id);
            if (state) {
                setEditingState(state);
                setPhase('wizard');
            }
        } catch (e) {
            console.error('[AuditsPage] Failed to load assessment:', e);
        }
        setActionLoading(null);
    };

    /**
     * View (read-only): Same as edit but could set a read-only flag.
     * For now, opens in edit mode — view-only mode is a future enhancement.
     */
    const handleView = async (id: string) => {
        await handleEdit(id);
    };

    const handleDelete = async (id: string) => {
        setActionLoading(id);
        const ok = await assessmentService.deleteAssessment(id);
        if (ok) {
            setDeleteConfirm(null);
            loadList();
        }
        setActionLoading(null);
    };

    const handleArchive = async (id: string) => {
        setActionLoading(id);
        await assessmentService.archiveAssessment(id);
        loadList();
        setActionLoading(null);
    };

    const handleRestore = async (id: string) => {
        setActionLoading(id);
        await assessmentService.restoreAssessment(id);
        loadList();
        setActionLoading(null);
    };

    // ─── Wizard Phase ───────────────────────────────────────
    if (phase === 'wizard') {
        return (
            <AuditWizard
                existingState={editingState}
                onExit={() => setPhase('list')}
                onSaved={handleSaved}
            />
        );
    }

    // ─── List View ──────────────────────────────────────────
    return (
        <div className="h-full overflow-y-auto p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-black text-slate-800">Integrated Audit Assessments</h1>
                    <p className="text-sm text-slate-500 mt-1">ISO 55000:2024 Series · AMS · AIM · PSM — 7-Step Audit Engine</p>
                </div>
                <button
                    onClick={handleStartNew}
                    className="px-5 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white font-bold rounded-xl shadow-lg shadow-blue-500/20 hover:shadow-xl hover:scale-[1.02] transition-all flex items-center gap-2"
                >
                    <ClipboardCheck size={18} />
                    New Audit
                </button>
            </div>

            {/* RF-01/AU: the audit's read of the plant, held against the live record */}
            <div className="mb-6"><MaturityGapCard /></div>

            {/* Summary Cards */}
            {summary && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
                    <SummaryCard label="Total" value={summary.total} color="#6366f1" />
                    <SummaryCard label="In Progress" value={summary.in_progress} color="#f59e0b" />
                    <SummaryCard label="Completed" value={summary.completed} color="#22c55e" />
                    <SummaryCard label="Archived" value={summary.archived} color="#94a3b8" />
                    <SummaryCard label="Avg Maturity" value={summary.avg_maturity != null ? `${summary.avg_maturity.toFixed(1)}/5` : '—'} color="#8b5cf6" />
                </div>
            )}

            {/* Search & Filter */}
            <div className="flex gap-3 mb-4">
                <div className="flex-1 relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search by name, company, or number..."
                        className="w-full pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-blue-400"
                    />
                </div>
                <select
                    value={statusFilter}
                    onChange={e => setStatusFilter(e.target.value)}
                    className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-700"
                >
                    <option value="">All Status</option>
                    <option value="in_progress">In Progress</option>
                    <option value="completed">Completed</option>
                    <option value="archived">Archived</option>
                </select>
                {/* Scope Toggle */}
                <div className="flex rounded-xl bg-white border border-slate-200 p-0.5">
                    <button
                        onClick={() => setAuditScope('all')}
                        className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                            auditScope === 'all'
                                ? 'bg-blue-50 text-blue-700 shadow-sm'
                                : 'text-slate-400 hover:text-slate-600'
                        }`}
                    >
                        <ClipboardCheck size={13} /> All
                    </button>
                    <button
                        onClick={() => setAuditScope('mine')}
                        className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                            auditScope === 'mine'
                                ? 'bg-blue-50 text-blue-700 shadow-sm'
                                : 'text-slate-400 hover:text-slate-600'
                        }`}
                    >
                        <Users size={13} /> My Audits
                        {myCollaborations.size > 0 && (
                            <span className="text-[9px] font-bold bg-blue-200 text-blue-700 px-1.5 py-0.5 rounded-full">
                                {myCollaborations.size}
                            </span>
                        )}
                    </button>
                </div>
            </div>

            {/* Assessment List */}
            {listLoading ? (
                <div className="flex items-center justify-center py-16 text-slate-400">
                    <Loader2 size={24} className="animate-spin mr-3" />
                    <span className="text-sm">Loading assessments...</span>
                </div>
            ) : displayedAssessments.length === 0 ? (
                <div className="text-center py-20">
                    <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
                        {auditScope === 'mine' ? <Users size={28} className="text-slate-300" /> : <ClipboardCheck size={28} className="text-slate-300" />}
                    </div>
                    <h3 className="text-lg font-bold text-slate-600 mb-2">
                        {auditScope === 'mine' ? 'No audits assigned to you' : 'No audits yet'}
                    </h3>
                    <p className="text-sm text-slate-400 mb-6">
                        {auditScope === 'mine'
                            ? 'You haven\'t been invited to any audits yet'
                            : 'Start your first integrated 7-step audit assessment'
                        }
                    </p>
                    {auditScope === 'mine' ? (
                        <button
                            onClick={() => setAuditScope('all')}
                            className="text-sm text-blue-500 hover:underline font-semibold"
                        >
                            Show all audits →
                        </button>
                    ) : (
                        <button
                            onClick={handleStartNew}
                            className="px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white font-bold rounded-xl shadow-md"
                        >
                            Begin Audit
                        </button>
                    )}
                </div>
            ) : (
                <div className="space-y-2">
                    {displayedAssessments.map(a => (
                        <div
                            key={a.id}
                            className="bg-white border border-slate-200 rounded-xl p-4 hover:shadow-md hover:border-slate-300 transition-all group cursor-pointer"
                            onClick={() => handleEdit(a.id)}
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4 flex-1 min-w-0">
                                    {/* Status Indicator */}
                                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                                        a.status === 'completed' ? 'bg-green-400'
                                        : a.status === 'in_progress' ? 'bg-amber-400 animate-pulse'
                                        : 'bg-slate-300'
                                    }`} />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2 mb-0.5">
                                            <span className="text-xs font-mono text-slate-400">{a.assessment_number}</span>
                                            <StatusBadge status={a.status} />
                                            {a.status === 'in_progress' && (
                                                <StepBadge step={a.current_step} />
                                            )}
                                            {myCollaborations.has(a.id) && (
                                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md uppercase bg-blue-100 text-blue-700 border border-blue-200">
                                                    INVITED
                                                </span>
                                            )}
                                        </div>
                                        <h3 className="text-sm font-bold text-slate-800 truncate">{a.assessor_name} — {a.assessor_company}</h3>
                                        <div className="flex items-center gap-3 mt-1">
                                            <span className="text-xs text-slate-500 flex items-center gap-1">
                                                <Building2 size={11} />
                                                {a.industry_sector}
                                            </span>
                                            {a.assessor_site && (
                                                <span className="text-xs text-slate-400 flex items-center gap-1">
                                                    <MapPin size={11} />
                                                    {a.assessor_site}
                                                </span>
                                            )}
                                            <span className="text-xs text-slate-400 flex items-center gap-1">
                                                <Calendar size={11} />
                                                {new Date(a.created_at).toLocaleDateString()}
                                            </span>
                                            {a.updated_at !== a.created_at && (
                                                <span className="text-xs text-slate-400 flex items-center gap-1">
                                                    <Clock size={11} />
                                                    Updated {new Date(a.updated_at).toLocaleDateString()}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Score */}
                                <div className="text-center px-4">
                                    {a.overall_maturity != null ? (
                                        <>
                                            <span className="text-lg font-black" style={{ color: getMaturityColor(a.overall_maturity) }}>
                                                {a.overall_maturity.toFixed(1)}
                                            </span>
                                            <span className="text-xs text-slate-400">/5</span>
                                            <p className="text-[10px] font-bold" style={{ color: getMaturityColor(a.overall_maturity) }}>{a.maturity_level}</p>
                                        </>
                                    ) : (
                                        <div className="flex flex-col items-center">
                                            <div className="flex gap-0.5">
                                                {[1,2,3,4,5,6,7].map(s => (
                                                    <div key={s} className={`w-1.5 h-4 rounded-sm ${s <= (a.current_step || 1) ? 'bg-blue-400' : 'bg-slate-200'}`} />
                                                ))}
                                            </div>
                                            <span className="text-[10px] text-slate-400 mt-1">Step {a.current_step || 1}/7</span>
                                        </div>
                                    )}
                                </div>

                                {/* Actions */}
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                                    {actionLoading === a.id ? (
                                        <Loader2 size={16} className="animate-spin text-slate-400 mx-2" />
                                    ) : (
                                        <>
                                            {/* Edit / Resume */}
                                            <button
                                                onClick={() => handleEdit(a.id)}
                                                className="p-2 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-colors"
                                                title={a.status === 'in_progress' ? 'Resume Audit' : 'Edit Audit'}
                                            >
                                                <Edit3 size={16} />
                                            </button>

                                            {/* More actions menu */}
                                            <div className="relative">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setActionMenuOpen(actionMenuOpen === a.id ? null : a.id);
                                                    }}
                                                    className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                                                >
                                                    <MoreHorizontal size={16} />
                                                </button>

                                                {actionMenuOpen === a.id && (
                                                    <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-20 py-1 min-w-[180px]"
                                                         onClick={e => e.stopPropagation()}
                                                    >
                                                        <button
                                                            onClick={() => { handleView(a.id); setActionMenuOpen(null); }}
                                                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                                                        >
                                                            <Eye size={14} /> View Details
                                                        </button>

                                                        {a.status === 'completed' && (
                                                            <button
                                                                onClick={() => { handleArchive(a.id); setActionMenuOpen(null); }}
                                                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-amber-700 hover:bg-amber-50"
                                                            >
                                                                <Archive size={14} /> Archive
                                                            </button>
                                                        )}

                                                        {a.status === 'archived' && (
                                                            <button
                                                                onClick={() => { handleRestore(a.id); setActionMenuOpen(null); }}
                                                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-green-700 hover:bg-green-50"
                                                            >
                                                                <RotateCcw size={14} /> Restore
                                                            </button>
                                                        )}

                                                        <div className="border-t border-slate-100 my-1" />

                                                        {deleteConfirm === a.id ? (
                                                            <div className="px-3 py-2">
                                                                <p className="text-xs text-red-600 font-bold mb-2 flex items-center gap-1">
                                                                    <AlertTriangle size={12} /> Confirm deletion?
                                                                </p>
                                                                <div className="flex gap-2">
                                                                    <button
                                                                        onClick={() => { handleDelete(a.id); setActionMenuOpen(null); }}
                                                                        className="flex-1 text-xs font-bold text-white bg-red-500 hover:bg-red-600 rounded-lg py-1.5 transition-colors"
                                                                    >
                                                                        Yes, Delete
                                                                    </button>
                                                                    <button
                                                                        onClick={() => setDeleteConfirm(null)}
                                                                        className="flex-1 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg py-1.5 transition-colors"
                                                                    >
                                                                        Cancel
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <button
                                                                onClick={() => setDeleteConfirm(a.id)}
                                                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                                                            >
                                                                <Trash2 size={14} /> Delete
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

// ─── Shared Widgets ─────────────────────────────────────────

function SummaryCard({ label, value, color }: { label: string; value: string | number; color: string }) {
    return (
        <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{label}</p>
            <p className="text-2xl font-black mt-1" style={{ color }}>{value}</p>
        </div>
    );
}

function StatusBadge({ status }: { status: string }) {
    const styles: Record<string, string> = {
        in_progress: 'bg-amber-100 text-amber-700',
        completed: 'bg-green-100 text-green-700',
        archived: 'bg-slate-100 text-slate-500',
    };
    const labels: Record<string, string> = {
        in_progress: 'In Progress',
        completed: 'Completed',
        archived: 'Archived',
    };
    return (
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md uppercase ${styles[status] || 'bg-slate-100 text-slate-500'}`}>
            {labels[status] || status}
        </span>
    );
}

function StepBadge({ step }: { step: number }) {
    const STEP_LABELS: Record<number, string> = {
        1: 'Intake', 2: 'Documents', 3: 'Site Walk', 4: 'Interviews',
        5: '6M Assessment', 6: 'Findings', 7: 'Report',
    };
    return (
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-600 uppercase">
            Step {step}: {STEP_LABELS[step] || 'Unknown'}
        </span>
    );
}

function getMaturityColor(score: number): string {
    if (score >= 4) return '#22c55e';
    if (score >= 3) return '#f59e0b';
    if (score >= 2) return '#f97316';
    return '#ef4444';
}
