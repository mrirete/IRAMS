/**
 * ═══════════════════════════════════════════════════════════════════════
 *  AUDIT SCHEDULE PAGE
 *  ISO 55001:2024 §9.2 — Audit Programme Tracking
 *
 *  Live view over audit_assessments (the same engine as /audits):
 *  in-flight and completed assessments by date, stalled detection,
 *  and a working entry point into the assessment wizard.
 *
 *  Planning (0306): future-dated, optionally RECURRING assessments —
 *  status='planned' rows with a due date. Starting one rolls the next
 *  occurrence forward. This is also where the annual criticality review
 *  lives (RF-01 dedup ruling): a 12-month recurring plan, not a separate
 *  reminder system.
 * ═══════════════════════════════════════════════════════════════════════
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Calendar, Search, MapPin, User,
    CheckCircle, Plus, Loader2, Bell, TrendingUp, X, Repeat, ArrowRight,
} from 'lucide-react';
import { assessmentService, type AssessmentListItem } from '../eam/services/AssessmentService';
import { useAuth } from '../eam/contexts/AuthContext';
import {
    AssessPage, AssessHeader, StatStrip, ASSESS_PRIMARY_BTN, ASSESS_SECONDARY_BTN, fmtDate, onActivate,
} from '../components/audit/AssessLayout';

const STALLED_DAYS = 30;

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; dot: string }> = {
    planned: { label: 'Planned', color: 'text-sky-700', bg: 'bg-sky-50 border-sky-200', dot: 'bg-sky-400' },
    in_progress: { label: 'In progress', color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200', dot: 'bg-amber-400' },
    completed: { label: 'Completed', color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200', dot: 'bg-emerald-400' },
    archived: { label: 'Archived', color: 'text-slate-500', bg: 'bg-slate-50 border-slate-200', dot: 'bg-slate-400' },
};

/** One-click presets — the recurring programmes plants actually run. */
const PLAN_PRESETS: { label: string; objective: string; recurMonths: number }[] = [
    { label: 'Annual criticality review', recurMonths: 12, objective: 'Annual asset criticality review — re-validate A/B/C/D rankings against the last 12 months of failures, cost and process changes (feeds RCM/FMEA scoping and every criticality-ranked analysis).' },
    { label: 'Annual ISO 55001 self-assessment', recurMonths: 12, objective: 'Annual ISO 55001 self-assessment across the six maturity dimensions — evidence-based, with the say-do gap reviewed against live records.' },
];

const isStalled = (a: AssessmentListItem) =>
    a.status === 'in_progress' &&
    (Date.now() - new Date(a.updated_at).getTime()) / 86400000 > STALLED_DAYS;

// ═══════════════════════════════════════════════════════════════
//  COMPONENT
// ═══════════════════════════════════════════════════════════════

export const AuditSchedulePage: React.FC = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [assessments, setAssessments] = useState<AssessmentListItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('');

    // Planning form (0306) — a pop-up, so the programme list stays put
    const [planOpen, setPlanOpen] = useState(false);
    const [planObjective, setPlanObjective] = useState('');
    const [planDate, setPlanDate] = useState('');
    const [planRecur, setPlanRecur] = useState<number>(0);
    const [planBusy, setPlanBusy] = useState(false);
    const [rowBusy, setRowBusy] = useState<string | null>(null);
    const [removeConfirm, setRemoveConfirm] = useState<string | null>(null);

    const load = () => assessmentService.listAssessments().then(setAssessments).finally(() => setLoading(false));
    useEffect(() => { void load(); }, []);

    const closePlan = () => { setPlanOpen(false); setPlanObjective(''); setPlanDate(''); setPlanRecur(0); };

    const submitPlan = async () => {
        if (!planObjective.trim() || !planDate) return;
        setPlanBusy(true);
        const ok = await assessmentService.planAssessment({
            objective: planObjective.trim(),
            plannedDate: planDate,
            recurMonths: planRecur > 0 ? planRecur : null,
            assessorName: (user as any)?.username || (user as any)?.email || 'planner',
        });
        if (ok) { closePlan(); await load(); }
        setPlanBusy(false);
    };

    // Starting a plan opens THAT assessment in the wizard, not the list.
    const startPlan = async (a: AssessmentListItem) => {
        setRowBusy(a.id);
        const ok = await assessmentService.startPlanned(a);
        setRowBusy(null);
        if (ok) navigate(`/audits?open=${a.id}`);
    };

    const removePlan = async (a: AssessmentListItem) => {
        setRowBusy(a.id);
        await assessmentService.removePlan(a.id);
        await load();
        setRowBusy(null);
        setRemoveConfirm(null);
    };

    const filtered = useMemo(() => assessments.filter(a => {
        const q = search.toLowerCase();
        const matchSearch = !q || a.assessment_number.toLowerCase().includes(q)
            || a.assessor_name.toLowerCase().includes(q)
            || a.assessor_company.toLowerCase().includes(q)
            || (a.assessor_site || '').toLowerCase().includes(q)
            || (a.audit_objective || '').toLowerCase().includes(q);
        const matchStatus = !statusFilter || (statusFilter === 'stalled' ? isStalled(a) : a.status === statusFilter);
        return matchSearch && matchStatus;
    }), [assessments, search, statusFilter]);

    // The programme reads forward: what is due next, then what is under way or done.
    const upcoming = filtered
        .filter(a => a.status === 'planned')
        .sort((x, y) => (x.planned_date || '9999').localeCompare(y.planned_date || '9999'));
    const others = filtered.filter(a => a.status !== 'planned');

    const maturities = assessments.filter(a => a.overall_maturity != null).map(a => a.overall_maturity as number);
    const counts = {
        planned: assessments.filter(a => a.status === 'planned').length,
        inProgress: assessments.filter(a => a.status === 'in_progress').length,
        completed: assessments.filter(a => a.status === 'completed').length,
        stalled: assessments.filter(isStalled).length,
        avgMaturity: maturities.length ? (maturities.reduce((x, y) => x + y, 0) / maturities.length).toFixed(1) : '—',
    };
    const toggleStatus = (key: string) => setStatusFilter(f => (f === key ? '' : key));

    const renderRow = (a: AssessmentListItem) => {
        const stCfg = STATUS_CONFIG[a.status] || STATUS_CONFIG.in_progress;
        const stalled = isStalled(a);
        const progressPct = a.status === 'completed' ? 100 : Math.round((Math.max(0, (a.current_step || 1) - 1) / 5) * 100);
        const planned = a.status === 'planned';
        const planOverdue = planned && a.planned_date && new Date(a.planned_date).getTime() < Date.now();
        const open = () => navigate(`/audits?open=${a.id}`);
        // A plan is its objective; a run is who assessed what.
        const title = planned
            ? (a.audit_objective?.trim() || 'Planned assessment')
            : [a.assessor_company, a.industry_sector].filter(Boolean).join(' — ') || a.assessor_name;

        return (
            <div
                key={a.id}
                {...(!planned ? { role: 'button', tabIndex: 0, onClick: open, onKeyDown: onActivate(open) } : {})}
                className={`bg-white border border-slate-200 border-l-4 ${planned ? (planOverdue ? 'border-l-red-500' : 'border-l-sky-400') : a.status === 'completed' ? 'border-l-emerald-400' : stalled ? 'border-l-red-500' : a.status === 'archived' ? 'border-l-slate-300' : 'border-l-amber-400'} rounded-xl px-4 sm:px-5 py-4 transition-all ${!planned ? 'cursor-pointer hover:shadow-sm hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300' : ''} ${stalled ? 'ring-1 ring-red-200' : ''}`}
            >
                <div className="flex items-start gap-3 sm:gap-4">
                    <div className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${stCfg.dot}`} aria-hidden />
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                            <span className="text-xs font-mono text-slate-400 mr-0.5">{a.assessment_number}</span>
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md uppercase border ${stCfg.bg} ${stCfg.color}`}>{stCfg.label}</span>
                            {stalled && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md uppercase bg-red-50 text-red-700 border border-red-200 flex items-center gap-0.5">
                                    <Bell size={9} /> Stalled
                                </span>
                            )}
                            {a.overall_maturity != null && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-primary-50 text-primary-700 border border-primary-100 flex items-center gap-0.5">
                                    <TrendingUp size={9} /> Maturity {Number(a.overall_maturity).toFixed(1)}{a.maturity_level ? ` · ${a.maturity_level}` : ''}
                                </span>
                            )}
                        </div>
                        <h3 className={`text-[15px] font-bold text-slate-800 ${planned ? 'line-clamp-2' : 'truncate'}`}>{title}</h3>

                        {planned ? (
                            <div className="mt-2.5 flex flex-wrap items-center gap-2">
                                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${planOverdue ? 'bg-red-100 text-red-700' : 'bg-sky-100 text-sky-700'}`}>
                                    {planOverdue ? 'Overdue — was due ' : 'Due '}{fmtDate(a.planned_date)}
                                </span>
                                {a.recur_months ? (
                                    <span className="text-[11px] text-slate-500 flex items-center gap-1"><Repeat size={11} /> every {a.recur_months} months</span>
                                ) : null}
                                <span className="ml-auto flex items-center gap-1.5">
                                    {removeConfirm === a.id ? (
                                        <>
                                            <span className="text-[11px] text-slate-500">Remove this plan{a.recur_months ? ' and its recurrence' : ''}?</span>
                                            <button onClick={() => void removePlan(a)} disabled={rowBusy !== null}
                                                className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white disabled:opacity-40">
                                                {rowBusy === a.id ? 'Removing…' : 'Remove'}
                                            </button>
                                            <button onClick={() => setRemoveConfirm(null)}
                                                className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
                                                Keep
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <button onClick={() => setRemoveConfirm(a.id)} disabled={rowBusy !== null}
                                                className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40">
                                                Remove…
                                            </button>
                                            <button onClick={() => void startPlan(a)} disabled={rowBusy !== null}
                                                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white disabled:opacity-40 inline-flex items-center gap-1">
                                                {rowBusy === a.id ? 'Starting…' : <>Start now <ArrowRight size={12} /></>}
                                            </button>
                                        </>
                                    )}
                                </span>
                            </div>
                        ) : (
                            <>
                                <div className="flex items-center gap-x-4 gap-y-1 mt-1.5 text-xs text-slate-500 flex-wrap">
                                    <span className="flex items-center gap-1"><User size={11} className="text-slate-400" /> {a.assessor_name}</span>
                                    {a.assessor_site && <span className="flex items-center gap-1"><MapPin size={11} className="text-slate-400" /> {a.assessor_site}</span>}
                                    <span className="flex items-center gap-1">
                                        <Calendar size={11} className="text-slate-400" />
                                        Started {fmtDate(a.created_at)}
                                        {a.completed_at && ` · completed ${fmtDate(a.completed_at)}`}
                                    </span>
                                </div>
                                {a.status === 'in_progress' && (
                                    <div className="mt-3 flex items-center gap-3">
                                        <div className="flex-1 bg-slate-100 rounded-full h-1.5 max-w-md">
                                            <div className={`h-1.5 rounded-full transition-all ${stalled ? 'bg-red-400' : 'bg-amber-400'}`} style={{ width: `${progressPct}%` }} />
                                        </div>
                                        <span className="text-[11px] text-slate-400 tabular-nums">Step {a.current_step || 1} of 5 · {a.dimensions_completed}/6 groups</span>
                                    </div>
                                )}
                                {a.status === 'completed' && a.completed_at && (
                                    <p className="text-[11px] text-emerald-600 mt-2 flex items-center gap-1">
                                        <CheckCircle size={11} /> Assessment complete
                                    </p>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <AssessPage>
            <AssessHeader
                title="Assessment Programme"
                subtitle="ISO 55001 §9.2 — what is planned, under way and done, across sites and assessors"
                actions={
                    <>
                        <button onClick={() => setPlanOpen(true)} className={ASSESS_SECONDARY_BTN}>
                            <Calendar size={15} /> Plan assessment
                        </button>
                        <button onClick={() => navigate('/audits', { state: { action: 'start_new' } })} className={ASSESS_PRIMARY_BTN}>
                            <Plus size={16} /> Start assessment
                        </button>
                    </>
                }
            />

            {/* Figures double as filters */}
            <StatStrip stats={[
                { key: 'planned', label: 'Planned', value: counts.planned, tone: 'sky', onClick: () => toggleStatus('planned'), active: statusFilter === 'planned' },
                { key: 'in_progress', label: 'In progress', value: counts.inProgress, tone: 'amber', onClick: () => toggleStatus('in_progress'), active: statusFilter === 'in_progress' },
                { key: 'stalled', label: `Stalled (${STALLED_DAYS}d+)`, value: counts.stalled, tone: 'red', onClick: () => toggleStatus('stalled'), active: statusFilter === 'stalled' },
                { key: 'completed', label: 'Completed', value: counts.completed, tone: 'green', onClick: () => toggleStatus('completed'), active: statusFilter === 'completed' },
                { key: 'avg', label: 'Avg maturity', value: counts.avgMaturity, tone: 'violet' },
            ]} />

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1 relative min-w-0">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search by number, assessor, company, site or objective…"
                        aria-label="Search the programme"
                        className="w-full pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
                    />
                </div>
                <select
                    value={statusFilter}
                    onChange={e => setStatusFilter(e.target.value)}
                    aria-label="Status"
                    className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-700"
                >
                    <option value="">All statuses</option>
                    <option value="planned">Planned</option>
                    <option value="in_progress">In progress</option>
                    <option value="completed">Completed</option>
                    <option value="archived">Archived</option>
                    <option value="stalled">Stalled ({STALLED_DAYS}d+)</option>
                </select>
            </div>

            {/* Programme */}
            {loading ? (
                <div className="flex items-center justify-center py-20 text-slate-400">
                    <Loader2 size={24} className="animate-spin mr-2" /> Loading the programme…
                </div>
            ) : filtered.length === 0 ? (
                <div className="text-center py-16 bg-white border border-dashed border-slate-200 rounded-xl">
                    <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
                        <Calendar size={24} className="text-slate-300" />
                    </div>
                    <h3 className="text-base font-bold text-slate-700 mb-1">{assessments.length === 0 ? 'Nothing in the programme yet' : 'Nothing matches'}</h3>
                    <p className="text-sm text-slate-500 mb-5">
                        {assessments.length === 0
                            ? 'Plan a recurring assessment — the annual criticality review is one click — or start one now.'
                            : 'Try another search or status.'}
                    </p>
                    {assessments.length === 0 ? (
                        <div className="flex flex-wrap justify-center gap-2">
                            <button onClick={() => setPlanOpen(true)} className={ASSESS_SECONDARY_BTN}><Calendar size={15} /> Plan assessment</button>
                            <button onClick={() => navigate('/audits', { state: { action: 'start_new' } })} className={ASSESS_PRIMARY_BTN}><Plus size={16} /> Start assessment</button>
                        </div>
                    ) : (
                        <button onClick={() => { setSearch(''); setStatusFilter(''); }} className="text-sm text-primary-600 hover:underline font-semibold">Clear filters</button>
                    )}
                </div>
            ) : (
                <div className="space-y-6">
                    {upcoming.length > 0 && (
                        <section className="space-y-2">
                            <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-1">Upcoming · {upcoming.length}</h2>
                            {upcoming.map(renderRow)}
                        </section>
                    )}
                    {others.length > 0 && (
                        <section className="space-y-2">
                            {upcoming.length > 0 && <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-1">Assessments · {others.length}</h2>}
                            {others.map(renderRow)}
                        </section>
                    )}
                </div>
            )}

            {/* 0306: plan a future (optionally recurring) assessment */}
            {planOpen && (
                <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm" onClick={closePlan}>
                    <div role="dialog" aria-modal="true" aria-labelledby="plan-title"
                        className="bg-white border border-slate-200 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg sm:mx-4 shadow-2xl max-h-[92vh] overflow-y-auto"
                        onClick={e => e.stopPropagation()}>
                        <div className="p-5 border-b border-slate-200 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-sky-50 rounded-lg text-sky-600"><Calendar size={20} /></div>
                                <div>
                                    <h2 id="plan-title" className="text-lg font-bold text-slate-800">Plan an assessment</h2>
                                    <p className="text-xs text-slate-500 mt-0.5">Adds it to the programme with a due date</p>
                                </div>
                            </div>
                            <button onClick={closePlan} aria-label="Close" className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"><X size={18} /></button>
                        </div>
                        <div className="p-5 space-y-4">
                            <div>
                                <span className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Start from a preset</span>
                                <div className="flex flex-wrap gap-2">
                                    {PLAN_PRESETS.map(p => (
                                        <button key={p.label}
                                            onClick={() => { setPlanObjective(p.objective); setPlanRecur(p.recurMonths); if (!planDate) { const d = new Date(); d.setMonth(d.getMonth() + 1); setPlanDate(d.toISOString().slice(0, 10)); } }}
                                            className={`text-xs font-medium border rounded-full px-3 py-1.5 transition-colors ${planObjective === p.objective ? 'bg-sky-50 border-sky-400 text-sky-800' : 'bg-white border-slate-200 hover:border-sky-300 text-slate-600'}`}>
                                            {p.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <label className="block">
                                <span className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Objective</span>
                                <textarea value={planObjective} onChange={e => setPlanObjective(e.target.value)} rows={3}
                                    placeholder="What is this assessment for? It becomes the assessment objective."
                                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-800 resize-none focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100" />
                            </label>
                            <div className="grid grid-cols-2 gap-4">
                                <label className="block">
                                    <span className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Due</span>
                                    <input type="date" value={planDate} onChange={e => setPlanDate(e.target.value)}
                                        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-primary-400" />
                                </label>
                                <label className="block">
                                    <span className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Repeats</span>
                                    <select value={planRecur} onChange={e => setPlanRecur(Number(e.target.value))}
                                        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-primary-400">
                                        <option value={0}>Never (one-off)</option>
                                        <option value={6}>Every 6 months</option>
                                        <option value={12}>Every 12 months</option>
                                        <option value={24}>Every 24 months</option>
                                    </select>
                                </label>
                            </div>
                            {planRecur > 0 && (
                                <p className="text-xs text-slate-500 flex items-center gap-1.5"><Repeat size={12} /> Starting it schedules the next occurrence automatically.</p>
                            )}
                        </div>
                        <div className="p-5 border-t border-slate-200 flex justify-end gap-2">
                            <button onClick={closePlan} className="px-4 py-2.5 text-sm text-slate-500 hover:text-slate-700 transition-colors">Cancel</button>
                            <button onClick={() => void submitPlan()} disabled={planBusy || !planObjective.trim() || !planDate} className={ASSESS_PRIMARY_BTN}>
                                {planBusy ? <Loader2 size={14} className="animate-spin" /> : null}
                                {planBusy ? 'Adding…' : 'Add to programme'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </AssessPage>
    );
};
