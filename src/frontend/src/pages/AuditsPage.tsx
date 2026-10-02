import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
    ClipboardCheck, Loader2, Trash2, Archive, RotateCcw,
    Search, AlertTriangle, MoreHorizontal, ArrowRight,
    Calendar, Building2, MapPin, Clock, Users, User, X,
} from 'lucide-react';
import { AuditWizard } from '../components/audit/AuditWizard';
import { assessmentService } from '../eam/services/AssessmentService';
import { useAuth } from '../eam/contexts/AuthContext';
import { supabase } from '../eam/lib/supabase';
import type { AssessmentListItem, MaturitySnapshot } from '../eam/services/AssessmentService';
import type { AuditAssessmentState } from '../eam/services/AuditTypes';
import { MaturityGapCard } from '../components/specialist/MaturityGapCard';
import { getAssessmentInvite } from '../eam/services/assessmentInvites';
import { useToast } from '../eam/contexts/ToastContext';
import { AssessPage, AssessHeader, ASSESS_PRIMARY_BTN, fmtDate, onActivate } from '../components/audit/AssessLayout';

type Phase = 'list' | 'wizard';
type AuditScope = 'all' | 'mine';
type StatusTab = '' | 'in_progress' | 'completed' | 'archived';

const STATUS_TABS: { key: StatusTab; label: string }[] = [
    { key: '', label: 'All' },
    { key: 'in_progress', label: 'In progress' },
    { key: 'completed', label: 'Completed' },
    { key: 'archived', label: 'Archived' },
];

export const AuditsPage: React.FC = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const { profile } = useAuth() as any;
    const currentUserId = profile?.id || '';
    const currentUsername = profile?.username || '';
    const currentEmail = profile?.email || '';
    const { showToast } = useToast();

    const [phase, setPhase] = useState<Phase>('list');
    const [editingState, setEditingState] = useState<AuditAssessmentState | undefined>();

    // List state — the whole (small) list is fetched once and filtered here,
    // so typing in search no longer refetches, re-counts and flashes the page.
    const [assessments, setAssessments] = useState<AssessmentListItem[]>([]);
    const [trend, setTrend] = useState<MaturitySnapshot[]>([]); // 0309 — oldest first
    const [listLoading, setListLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<StatusTab>('');
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [actionMenuOpen, setActionMenuOpen] = useState<string | null>(null);

    // Collaboration state
    const [auditScope, setAuditScope] = useState<AuditScope>('all');
    const [myCollaborations, setMyCollaborations] = useState<Set<string>>(new Set());

    // ─── Auto-launch from "Start Audit" on Templates page ────
    useEffect(() => {
        const state = location.state as { action?: string; templateName?: string; isoReference?: string; templateId?: string } | null;
        // "Start assessment" from the Programme page lands straight in the wizard.
        if (state?.action === 'start_new') {
            setEditingState(undefined);
            setPhase('wizard');
            navigate(location.pathname, { replace: true, state: null });
            return;
        }
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

    // ─── Deep link: /audits?open=<id> (shared link from the invite panel, notifications) ──
    // ─── Shared invite: /audits?invite=<token> (0338) — resolve, then open the
    //     assessment; the wizard's banner takes the answer.
    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const id = params.get('open');
        const token = params.get('invite');
        if (!id && !token) return;
        navigate(location.pathname, { replace: true });
        if (id) { void handleEdit(id); return; }
        (async () => {
            try {
                const inv = await getAssessmentInvite(token!);
                if (!inv.found || !inv.assessment_id) {
                    showToast('That invitation link is no longer valid — it may have been withdrawn.', 'error');
                    return;
                }
                if (inv.mine === false) {
                    showToast(`This invitation is addressed to ${inv.email}. Sign in with that email to accept it.`, 'error');
                    return;
                }
                await handleEdit(inv.assessment_id);
            } catch (e: any) {
                showToast('Could not open the invitation: ' + (e?.message || 'unknown'), 'error');
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.search]);

    // ─── Load List ──────────────────────────────────────────
    // Only the first load shows the skeleton; a reload after archive/delete
    // swaps the rows in place.
    const loadList = useCallback(async () => {
        const [items, trendRows] = await Promise.all([
            assessmentService.listAssessments(),
            assessmentService.getMaturityTrend(12).catch(() => []),
        ]);
        setAssessments(items);
        setTrend(trendRows);
        setListLoading(false);
    }, []);

    useEffect(() => {
        if (phase === 'list') loadList();
    }, [phase, loadList]);

    // ─── Load collaborations for current user ───────────────
    useEffect(() => {
        if (!currentEmail && !currentUsername) return;
        const loadCollabs = async () => {
            try {
                // invited_by holds the inviter's EMAIL (it was matched against the
                // username before, so the inviter's own scope never matched). A
                // declined invitation is not "mine".
                const { data } = await supabase
                    .from('audit_assessment_collaborators')
                    .select('assessment_id, status, email')
                    .or(`email.ilike.${currentEmail},invited_by.ilike.${currentEmail}`)
                    .neq('status', 'declined');
                if (data) {
                    setMyCollaborations(new Set(data.map((d: any) => d.assessment_id)));
                }
            } catch (e) {
                console.warn('[AuditsPage] Could not load collaborations:', e);
            }
        };
        loadCollabs();
    }, [currentEmail, currentUsername, phase]);

    // ─── Derived list ───────────────────────────────────────
    // Planned rows (0306) belong to the Programme page — they have no intake
    // yet, so opening one here dropped the user into an empty wizard.
    const live = useMemo(() => assessments.filter(a => a.status !== 'planned'), [assessments]);
    const plannedCount = assessments.length - live.length;

    // An empty username used to match every row ("".includes → true).
    const isMine = useCallback((a: AssessmentListItem) =>
        myCollaborations.has(a.id) ||
        (!!currentUsername && !!a.assessor_name?.toLowerCase().includes(currentUsername.toLowerCase())),
    [myCollaborations, currentUsername]);

    const scoped = useMemo(() => auditScope === 'all' ? live : live.filter(isMine), [live, auditScope, isMine]);

    const statusCounts = useMemo(() => {
        const c: Record<StatusTab, number> = { '': scoped.length, in_progress: 0, completed: 0, archived: 0 };
        for (const a of scoped) if (a.status in c) c[a.status as StatusTab]++;
        return c;
    }, [scoped]);

    const displayedAssessments = useMemo(() => {
        const q = search.trim().toLowerCase();
        return scoped.filter(a => {
            if (statusFilter && a.status !== statusFilter) return false;
            if (!q) return true;
            return [a.assessment_number, a.assessor_name, a.assessor_company, a.assessor_site, a.industry_sector, a.audit_objective]
                .some(v => (v || '').toLowerCase().includes(q));
        });
    }, [scoped, statusFilter, search]);

    const mineCount = useMemo(() => live.filter(isMine).length, [live, isMine]);

    // Headline figures: average of scored assessments, first → latest snapshot.
    const scores = live.filter(a => a.overall_maturity != null).map(a => Number(a.overall_maturity));
    const avgMaturity = scores.length ? scores.reduce((x, y) => x + y, 0) / scores.length : null;
    const trendPts = trend.filter(t => t.maturity_overall != null).map(t => Number(t.maturity_overall));
    const trendDelta = trendPts.length >= 2 ? trendPts[trendPts.length - 1] - trendPts[0] : null;
    const filtersActive = !!search.trim() || !!statusFilter;

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
        <AssessPage>
            <AssessHeader
                title="Maturity Assessments"
                subtitle="ISO 55001:2024 · six GFMAM groups · 5-step guided self-assessment"
                actions={
                    <>
                        {avgMaturity != null && (
                            <div className="flex items-center gap-3 pr-3 mr-1 border-r border-slate-200" title={trendPts.length >= 2 ? `${trendPts.length} scored assessments, first → latest` : 'Average of scored assessments'}>
                                <div className="text-right">
                                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 leading-none">Avg maturity</p>
                                    <p className="text-lg font-black tabular-nums leading-tight" style={{ color: getMaturityColor(avgMaturity) }}>
                                        {avgMaturity.toFixed(1)}<span className="text-xs font-semibold text-slate-400">/5</span>
                                    </p>
                                </div>
                                {trendDelta != null && (
                                    <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 border tabular-nums ${trendDelta > 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : trendDelta < 0 ? 'bg-red-50 text-red-600 border-red-100' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                                        {trendPts[0].toFixed(1)} → {trendPts[trendPts.length - 1].toFixed(1)}
                                    </span>
                                )}
                            </div>
                        )}
                        <button onClick={handleStartNew} className={ASSESS_PRIMARY_BTN}>
                            <ClipboardCheck size={16} /> New assessment
                        </button>
                    </>
                }
            />

            {/* RF-01/AU: the audit's read of the plant, held against the live record */}
            <MaturityGapCard />

            {/* Toolbar — search, status (with counts; replaces the KPI boxes), scope */}
            <div className="space-y-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                    <div className="relative flex-1 min-w-0">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Search by number, assessor, company, site or objective…"
                            aria-label="Search assessments"
                            className="w-full pl-9 pr-9 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
                        />
                        {search && (
                            <button onClick={() => setSearch('')} aria-label="Clear search"
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100">
                                <X size={14} />
                            </button>
                        )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <div role="tablist" aria-label="Status" className="flex rounded-xl bg-white border border-slate-200 p-0.5 overflow-x-auto">
                            {STATUS_TABS.map(t => (
                                <button key={t.key || 'all'} role="tab" aria-selected={statusFilter === t.key}
                                    onClick={() => setStatusFilter(t.key)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1.5 ${statusFilter === t.key ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'}`}>
                                    {t.label}
                                    <span className={`tabular-nums text-[10px] ${statusFilter === t.key ? 'text-slate-300' : 'text-slate-400'}`}>{statusCounts[t.key]}</span>
                                </button>
                            ))}
                        </div>
                        <div role="tablist" aria-label="Whose" className="flex rounded-xl bg-white border border-slate-200 p-0.5">
                            <button role="tab" aria-selected={auditScope === 'all'} onClick={() => setAuditScope('all')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${auditScope === 'all' ? 'bg-primary-50 text-primary-700' : 'text-slate-500 hover:text-slate-800'}`}>
                                <ClipboardCheck size={13} /> All
                            </button>
                            <button role="tab" aria-selected={auditScope === 'mine'} onClick={() => setAuditScope('mine')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${auditScope === 'mine' ? 'bg-primary-50 text-primary-700' : 'text-slate-500 hover:text-slate-800'}`}>
                                <Users size={13} /> Mine
                                <span className="tabular-nums text-[10px] text-slate-400">{mineCount}</span>
                            </button>
                        </div>
                    </div>
                </div>
                {plannedCount > 0 && (
                    <button onClick={() => navigate('/audits/schedule')}
                        className="text-xs font-semibold text-primary-600 hover:text-primary-800 inline-flex items-center gap-1">
                        <Calendar size={12} /> {plannedCount} planned assessment{plannedCount === 1 ? '' : 's'} in the programme <ArrowRight size={12} />
                    </button>
                )}
            </div>

            {/* Assessment List */}
            {listLoading ? (
                <div className="space-y-2" aria-busy="true" aria-label="Loading assessments">
                    {[0, 1, 2].map(i => (
                        <div key={i} className="bg-white border border-slate-200 rounded-xl px-5 py-4 animate-pulse">
                            <div className="h-3 w-40 bg-slate-100 rounded mb-2.5" />
                            <div className="h-4 w-72 max-w-full bg-slate-100 rounded mb-2" />
                            <div className="h-3 w-56 max-w-full bg-slate-100 rounded" />
                        </div>
                    ))}
                </div>
            ) : displayedAssessments.length === 0 ? (
                <div className="text-center py-16 bg-white border border-dashed border-slate-200 rounded-xl">
                    <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
                        {filtersActive ? <Search size={24} className="text-slate-300" /> : auditScope === 'mine' ? <Users size={24} className="text-slate-300" /> : <ClipboardCheck size={24} className="text-slate-300" />}
                    </div>
                    <h3 className="text-base font-bold text-slate-700 mb-1">
                        {filtersActive ? 'Nothing matches' : auditScope === 'mine' ? 'No assessments assigned to you' : 'No assessments yet'}
                    </h3>
                    <p className="text-sm text-slate-500 mb-5">
                        {filtersActive
                            ? 'Try another search or status.'
                            : auditScope === 'mine'
                                ? "You haven't started or been invited to an assessment yet."
                                : 'Run your first maturity assessment — five steps, about thirty minutes.'}
                    </p>
                    {filtersActive ? (
                        <button onClick={() => { setSearch(''); setStatusFilter(''); }} className="text-sm text-primary-600 hover:underline font-semibold">
                            Clear filters
                        </button>
                    ) : auditScope === 'mine' ? (
                        <button onClick={() => setAuditScope('all')} className="text-sm text-primary-600 hover:underline font-semibold">
                            Show all assessments →
                        </button>
                    ) : (
                        <button onClick={handleStartNew} className={ASSESS_PRIMARY_BTN}>
                            <ClipboardCheck size={16} /> Begin assessment
                        </button>
                    )}
                </div>
            ) : (
                <div className="space-y-2">
                    {displayedAssessments.map(a => {
                        const objective = a.audit_objective?.trim();
                        const title = objective || `${a.assessor_name} — ${a.assessor_company}`;
                        const byLine = objective ? `${a.assessor_name}${a.assessor_company ? ` · ${a.assessor_company}` : ''}` : null;
                        return (
                        <div
                            key={a.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => handleEdit(a.id)}
                            onKeyDown={onActivate(() => handleEdit(a.id))}
                            className="group bg-white border border-slate-200 rounded-xl px-4 sm:px-5 py-4 hover:shadow-sm hover:border-slate-300 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                        >
                            <div className="flex items-start sm:items-center gap-3 sm:gap-4">
                                {/* Status Indicator */}
                                <div className={`w-2.5 h-2.5 rounded-full shrink-0 mt-1.5 sm:mt-0 ${
                                    a.status === 'completed' ? 'bg-emerald-400'
                                    : a.status === 'in_progress' ? 'bg-amber-400'
                                    : 'bg-slate-300'
                                }`} aria-hidden />
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-1.5 mb-1">
                                        <span className="text-xs font-mono text-slate-400 mr-0.5">{a.assessment_number}</span>
                                        <StatusBadge status={a.status} />
                                        {a.status === 'in_progress' && <StepBadge step={a.current_step} />}
                                        {myCollaborations.has(a.id) && (
                                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md uppercase bg-primary-50 text-primary-700 border border-primary-100">
                                                Invited
                                            </span>
                                        )}
                                    </div>
                                    <h3 className="text-[15px] font-bold text-slate-800 truncate" title={title}>{title}</h3>
                                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-xs text-slate-500">
                                        {byLine && <span className="flex items-center gap-1"><User size={11} className="text-slate-400" />{byLine}</span>}
                                        {a.industry_sector && (
                                            <span className="flex items-center gap-1"><Building2 size={11} className="text-slate-400" />{a.industry_sector}</span>
                                        )}
                                        {a.assessor_site && (
                                            <span className="flex items-center gap-1"><MapPin size={11} className="text-slate-400" />{a.assessor_site}</span>
                                        )}
                                        <span className="flex items-center gap-1"><Calendar size={11} className="text-slate-400" />{fmtDate(a.created_at)}</span>
                                        {a.updated_at !== a.created_at && (
                                            <span className="flex items-center gap-1 text-slate-400"><Clock size={11} />Updated {fmtDate(a.updated_at)}</span>
                                        )}
                                    </div>
                                </div>

                                {/* Score, or progress through the five steps */}
                                <div className="hidden sm:flex flex-col items-center w-20 shrink-0">
                                    {a.overall_maturity != null ? (
                                        <>
                                            <span className="text-lg font-black tabular-nums leading-none" style={{ color: getMaturityColor(a.overall_maturity) }}>
                                                {a.overall_maturity.toFixed(1)}<span className="text-xs font-semibold text-slate-400">/5</span>
                                            </span>
                                            {a.maturity_level && <span className="text-[10px] font-bold mt-1 text-center leading-tight" style={{ color: getMaturityColor(a.overall_maturity) }}>{a.maturity_level}</span>}
                                        </>
                                    ) : (
                                        <>
                                            <div className="flex gap-0.5" aria-hidden>
                                                {[1, 2, 3, 4, 5].map(s => (
                                                    <div key={s} className={`w-2 h-4 rounded-sm ${s <= (a.current_step || 1) ? 'bg-primary-400' : 'bg-slate-200'}`} />
                                                ))}
                                            </div>
                                            <span className="text-[10px] text-slate-400 mt-1">Step {a.current_step || 1} of 5</span>
                                        </>
                                    )}
                                </div>

                                {/* Actions — always visible (hover-only hid them on touch) */}
                                <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                                    {actionLoading === a.id ? (
                                        <Loader2 size={16} className="animate-spin text-slate-400 mx-3" />
                                    ) : (
                                        <>
                                            <button
                                                onClick={() => handleEdit(a.id)}
                                                className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-500 group-hover:text-primary-700 hover:bg-primary-50 transition-colors"
                                            >
                                                {a.status === 'in_progress' ? 'Resume' : 'Open'} <ArrowRight size={12} />
                                            </button>

                                            <div className="relative">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setDeleteConfirm(null);
                                                        setActionMenuOpen(actionMenuOpen === a.id ? null : a.id);
                                                    }}
                                                    aria-label="More actions"
                                                    aria-expanded={actionMenuOpen === a.id}
                                                    className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                                                >
                                                    <MoreHorizontal size={16} />
                                                </button>

                                                {actionMenuOpen === a.id && (
                                                    <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-20 py-1 min-w-[190px]"
                                                         onClick={e => e.stopPropagation()}
                                                    >
                                                        {a.status === 'completed' && (
                                                            <button
                                                                onClick={() => { handleArchive(a.id); setActionMenuOpen(null); }}
                                                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                                                            >
                                                                <Archive size={14} className="text-amber-600" /> Archive
                                                            </button>
                                                        )}

                                                        {a.status === 'archived' && (
                                                            <button
                                                                onClick={() => { handleRestore(a.id); setActionMenuOpen(null); }}
                                                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                                                            >
                                                                <RotateCcw size={14} className="text-emerald-600" /> Restore
                                                            </button>
                                                        )}

                                                        {(a.status === 'completed' || a.status === 'archived') && <div className="border-t border-slate-100 my-1" />}

                                                        {deleteConfirm === a.id ? (
                                                            <div className="px-3 py-2">
                                                                <p className="text-xs text-red-600 font-bold mb-2 flex items-center gap-1">
                                                                    <AlertTriangle size={12} /> Delete {a.assessment_number}?
                                                                </p>
                                                                <div className="flex gap-2">
                                                                    <button
                                                                        onClick={() => { handleDelete(a.id); setActionMenuOpen(null); }}
                                                                        className="flex-1 text-xs font-bold text-white bg-red-500 hover:bg-red-600 rounded-lg py-1.5 transition-colors"
                                                                    >
                                                                        Delete
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
                                                                <Trash2 size={14} /> Delete…
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
                        );
                    })}
                </div>
            )}
        </AssessPage>
    );
};

// ─── Shared Widgets ─────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
    const styles: Record<string, string> = {
        in_progress: 'bg-amber-50 text-amber-700 border-amber-200',
        completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        archived: 'bg-slate-50 text-slate-500 border-slate-200',
    };
    const labels: Record<string, string> = {
        in_progress: 'In progress',
        completed: 'Completed',
        archived: 'Archived',
    };
    return (
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md uppercase border ${styles[status] || 'bg-slate-50 text-slate-500 border-slate-200'}`}>
            {labels[status] || status.replace(/_/g, ' ')}
        </span>
    );
}

function StepBadge({ step }: { step: number }) {
    // Mirrors ASSESSMENT_STEPS (the live 5-step wizard), not the retired 7-step flow.
    const STEP_LABELS: Record<number, string> = {
        1: 'Intake', 2: 'Documents', 3: 'Maturity', 4: 'Findings', 5: 'Report',
    };
    return (
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-primary-50 text-primary-700 border border-primary-100 uppercase">
            Step {step} · {STEP_LABELS[step] || 'Unknown'}
        </span>
    );
}

function getMaturityColor(score: number): string {
    if (score >= 4) return '#16a34a';
    if (score >= 3) return '#d97706';
    if (score >= 2) return '#ea580c';
    return '#dc2626';
}
