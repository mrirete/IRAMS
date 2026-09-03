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

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Calendar, Search, MapPin, User, Building2,
    CheckCircle, Plus, Loader2, Bell, TrendingUp,
} from 'lucide-react';
import { assessmentService, type AssessmentListItem } from '../eam/services/AssessmentService';
import { useAuth } from '../eam/contexts/AuthContext';

const STALLED_DAYS = 30;

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; dot: string }> = {
    planned: { label: 'Planned', color: 'text-sky-700', bg: 'bg-sky-100', dot: 'bg-sky-400' },
    in_progress: { label: 'In Progress', color: 'text-amber-700', bg: 'bg-amber-100', dot: 'bg-amber-400 animate-pulse' },
    completed: { label: 'Completed', color: 'text-green-700', bg: 'bg-green-100', dot: 'bg-green-400' },
    archived: { label: 'Archived', color: 'text-slate-500', bg: 'bg-slate-100', dot: 'bg-slate-400' },
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

    // Planning form (0306)
    const [planOpen, setPlanOpen] = useState(false);
    const [planObjective, setPlanObjective] = useState('');
    const [planDate, setPlanDate] = useState('');
    const [planRecur, setPlanRecur] = useState<number>(0);
    const [planBusy, setPlanBusy] = useState(false);
    const [rowBusy, setRowBusy] = useState<string | null>(null);

    const load = () => assessmentService.listAssessments().then(setAssessments).finally(() => setLoading(false));
    useEffect(() => { void load(); }, []);

    const submitPlan = async () => {
        if (!planObjective.trim() || !planDate) return;
        setPlanBusy(true);
        const ok = await assessmentService.planAssessment({
            objective: planObjective.trim(),
            plannedDate: planDate,
            recurMonths: planRecur > 0 ? planRecur : null,
            assessorName: (user as any)?.username || (user as any)?.email || 'planner',
        });
        if (ok) { setPlanOpen(false); setPlanObjective(''); setPlanDate(''); setPlanRecur(0); await load(); }
        setPlanBusy(false);
    };

    const startPlan = async (a: AssessmentListItem) => {
        setRowBusy(a.id);
        const ok = await assessmentService.startPlanned(a);
        setRowBusy(null);
        if (ok) navigate('/audits');
    };

    const removePlan = async (a: AssessmentListItem) => {
        setRowBusy(a.id);
        await assessmentService.removePlan(a.id);
        await load();
        setRowBusy(null);
    };

    const filtered = assessments.filter(a => {
        const q = search.toLowerCase();
        const matchSearch = !q || a.assessment_number.toLowerCase().includes(q)
            || a.assessor_name.toLowerCase().includes(q)
            || a.assessor_company.toLowerCase().includes(q)
            || (a.assessor_site || '').toLowerCase().includes(q);
        const matchStatus = !statusFilter || (statusFilter === 'stalled' ? isStalled(a) : a.status === statusFilter);
        return matchSearch && matchStatus;
    });

    const maturities = assessments.filter(a => a.overall_maturity != null).map(a => a.overall_maturity as number);
    const counts = {
        total: assessments.length,
        inProgress: assessments.filter(a => a.status === 'in_progress').length,
        completed: assessments.filter(a => a.status === 'completed').length,
        stalled: assessments.filter(isStalled).length,
        avgMaturity: maturities.length ? (maturities.reduce((x, y) => x + y, 0) / maturities.length).toFixed(1) : '—',
    };

    return (
        <div className="h-full overflow-y-auto p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-black text-slate-800">Audit Schedule</h1>
                    <p className="text-sm text-slate-500 mt-1">ISO 55001 §9.2 — Assessment programme tracking across sites and assessors</p>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={() => setPlanOpen(v => !v)}
                        className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-1.5">
                        <Calendar size={15} /> Plan assessment
                    </button>
                    <button onClick={() => navigate('/audits')} className="btn-primary"><Plus size={16} className="mr-2" />Start Audit</button>
                </div>
            </div>

            {/* 0306: plan a future (optionally recurring) assessment */}
            {planOpen && (
                <div className="bg-sky-50/60 border border-sky-200 rounded-xl p-4 mb-6 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold text-slate-600">Presets:</span>
                        {PLAN_PRESETS.map(p => (
                            <button key={p.label}
                                onClick={() => { setPlanObjective(p.objective); setPlanRecur(p.recurMonths); if (!planDate) { const d = new Date(); d.setMonth(d.getMonth() + 1); setPlanDate(d.toISOString().slice(0, 10)); } }}
                                className="text-[11px] font-medium bg-white border border-sky-200 hover:border-sky-400 text-sky-700 rounded-full px-2.5 py-1">
                                {p.label}
                            </button>
                        ))}
                    </div>
                    <textarea value={planObjective} onChange={e => setPlanObjective(e.target.value)}
                        placeholder="What is this assessment for? (becomes the audit objective)"
                        className="w-full h-16 rounded-lg border border-slate-200 p-3 text-sm resize-none bg-white" />
                    <div className="flex flex-wrap items-center gap-3">
                        <label className="text-xs text-slate-600 flex items-center gap-2">Due
                            <input type="date" value={planDate} onChange={e => setPlanDate(e.target.value)}
                                className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm bg-white" />
                        </label>
                        <label className="text-xs text-slate-600 flex items-center gap-2">Repeats
                            <select value={planRecur} onChange={e => setPlanRecur(Number(e.target.value))}
                                className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm bg-white">
                                <option value={0}>never (one-off)</option>
                                <option value={6}>every 6 months</option>
                                <option value={12}>every 12 months</option>
                                <option value={24}>every 24 months</option>
                            </select>
                        </label>
                        <span className="text-[11px] text-slate-400">Starting a recurring plan schedules its next occurrence automatically.</span>
                        <button onClick={() => void submitPlan()} disabled={planBusy || !planObjective.trim() || !planDate}
                            className="ml-auto px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold disabled:opacity-40">
                            {planBusy ? 'Planning…' : 'Add to programme'}
                        </button>
                    </div>
                </div>
            )}

            {/* KPI Bar */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
                <KpiCard label="Total Assessments" value={counts.total} color="#6366f1" />
                <KpiCard label="In Progress" value={counts.inProgress} color="#f59e0b" />
                <KpiCard label="Completed" value={counts.completed} color="#22c55e" />
                <KpiCard label={`Stalled (${STALLED_DAYS}d+)`} value={counts.stalled} color="#ef4444" />
                <KpiCard label="Avg Maturity" value={counts.avgMaturity} color="#0ea5e9" />
            </div>

            {/* Filters */}
            <div className="flex gap-3 mb-4">
                <div className="flex-1 relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search by number, assessor, company, or site..."
                        className="w-full pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-blue-400"
                    />
                </div>
                <select
                    value={statusFilter}
                    onChange={e => setStatusFilter(e.target.value)}
                    className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-700"
                >
                    <option value="">All Status</option>
                    <option value="planned">Planned</option>
                    <option value="in_progress">In Progress</option>
                    <option value="completed">Completed</option>
                    <option value="archived">Archived</option>
                    <option value="stalled">Stalled ({STALLED_DAYS}d+)</option>
                </select>
            </div>

            {/* Programme timeline */}
            {loading ? (
                <div className="flex items-center justify-center py-20 text-slate-400">
                    <Loader2 size={24} className="animate-spin mr-2" /> Loading assessments…
                </div>
            ) : filtered.length === 0 ? (
                <div className="text-center py-20">
                    <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
                        <Calendar size={28} className="text-slate-300" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-600 mb-2">No assessments yet</h3>
                    <p className="text-sm text-slate-400">Start your first audit to build the programme</p>
                    <button onClick={() => navigate('/audits')} className="mt-4 px-4 py-2 text-sm text-white bg-primary-500 rounded-lg hover:bg-primary-600 transition-colors">
                        Start Audit
                    </button>
                </div>
            ) : (
                <div className="space-y-3">
                    {filtered.map(a => {
                        const stCfg = STATUS_CONFIG[a.status] || STATUS_CONFIG.in_progress;
                        const stalled = isStalled(a);
                        const progressPct = a.status === 'completed' ? 100 : Math.round((Math.max(0, (a.current_step || 1) - 1) / 5) * 100);
                        const planOverdue = a.status === 'planned' && a.planned_date && new Date(a.planned_date).getTime() < Date.now();

                        return (
                            <div
                                key={a.id}
                                onClick={() => { if (a.status !== 'planned') navigate('/audits'); }}
                                className={`bg-white border border-slate-200 border-l-4 ${a.status === 'planned' ? (planOverdue ? 'border-l-red-500' : 'border-l-sky-400') : a.status === 'completed' ? 'border-l-green-400' : stalled ? 'border-l-red-500' : 'border-l-amber-400'} rounded-xl p-5 hover:shadow-md hover:border-slate-300 transition-all ${a.status !== 'planned' ? 'cursor-pointer' : ''} ${stalled ? 'ring-1 ring-red-200' : ''}`}
                            >
                                <div className="flex items-start gap-4">
                                    <div className={`w-3 h-3 rounded-full mt-1 shrink-0 ${stCfg.dot}`} />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                                            <span className="text-xs font-mono text-slate-400">{a.assessment_number}</span>
                                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md uppercase ${stCfg.bg} ${stCfg.color}`}>{stCfg.label}</span>
                                            {stalled && (
                                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md uppercase bg-red-100 text-red-700 flex items-center gap-0.5">
                                                    <Bell size={8} /> Stalled
                                                </span>
                                            )}
                                            {a.overall_maturity != null && (
                                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-blue-100 text-blue-700 flex items-center gap-0.5">
                                                    <TrendingUp size={8} /> Maturity {a.overall_maturity}{a.maturity_level ? ` — ${a.maturity_level}` : ''}
                                                </span>
                                            )}
                                        </div>
                                        <h3 className="text-sm font-bold text-slate-800">{a.assessor_company} — {a.industry_sector}</h3>
                                        <div className="flex items-center gap-4 mt-2 text-[11px] text-slate-400 flex-wrap">
                                            <span className="flex items-center gap-1"><User size={10} /> {a.assessor_name}</span>
                                            {a.assessor_site && <span className="flex items-center gap-1"><MapPin size={10} /> {a.assessor_site}</span>}
                                            <span className="flex items-center gap-1"><Building2 size={10} /> {a.assessor_company}</span>
                                            <span className="flex items-center gap-1">
                                                <Calendar size={10} />
                                                Started {new Date(a.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                {a.completed_at && ` · Completed ${new Date(a.completed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`}
                                            </span>
                                        </div>
                                        {a.status === 'in_progress' && (
                                            <div className="mt-3 flex items-center gap-3">
                                                <div className="flex-1 bg-slate-100 rounded-full h-1.5">
                                                    <div className="h-1.5 rounded-full bg-amber-400 transition-all" style={{ width: `${progressPct}%` }} />
                                                </div>
                                                <span className="text-[10px] font-mono text-slate-400">Step {a.current_step || 1}/5 · {a.dimensions_completed}/6 dimensions</span>
                                            </div>
                                        )}
                                        {a.status === 'completed' && a.completed_at && (
                                            <p className="text-[10px] text-green-600 mt-2 flex items-center gap-1">
                                                <CheckCircle size={10} /> Assessment complete
                                            </p>
                                        )}
                                        {a.status === 'planned' && (
                                            <div className="mt-3 flex flex-wrap items-center gap-2">
                                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${planOverdue ? 'bg-red-100 text-red-700' : 'bg-sky-100 text-sky-700'}`}>
                                                    {planOverdue ? 'OVERDUE — ' : 'Due '}
                                                    {a.planned_date ? new Date(a.planned_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                                                    {a.recur_months ? ` · repeats every ${a.recur_months} mo` : ''}
                                                </span>
                                                {a.audit_objective && <span className="text-[11px] text-slate-500 truncate max-w-md">{a.audit_objective}</span>}
                                                <span className="ml-auto flex items-center gap-1.5">
                                                    <button onClick={(e) => { e.stopPropagation(); void startPlan(a); }} disabled={rowBusy !== null}
                                                        className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-sky-600 hover:bg-sky-700 text-white disabled:opacity-40">
                                                        {rowBusy === a.id ? 'Starting…' : 'Start now'}
                                                    </button>
                                                    <button onClick={(e) => { e.stopPropagation(); void removePlan(a); }} disabled={rowBusy !== null}
                                                        className="text-[11px] font-medium px-2 py-1 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40">
                                                        Remove
                                                    </button>
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

// ─── Shared Widgets ──────────────────────────────────────────

function KpiCard({ label, value, color }: { label: string; value: string | number; color: string }) {
    return (
        <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{label}</p>
            <p className="text-2xl font-black mt-1" style={{ color }}>{value}</p>
        </div>
    );
}
