/**
 * ═══════════════════════════════════════════════════════════════════════
 *  AUDIT SCHEDULE PAGE
 *  ISO 55001:2024 §9.2 — Audit Programme Tracking
 *
 *  Live view over audit_assessments (the same engine as /audits):
 *  in-flight and completed assessments by date, stalled detection,
 *  and a working entry point into the assessment wizard. Future-dated
 *  planning/recurrence is on the roadmap (needs a planned status in
 *  the assessment schema).
 * ═══════════════════════════════════════════════════════════════════════
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Calendar, Search, MapPin, User, Building2,
    CheckCircle, Plus, Loader2, Bell, TrendingUp,
} from 'lucide-react';
import { assessmentService, type AssessmentListItem } from '../eam/services/AssessmentService';

const STALLED_DAYS = 30;

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; dot: string }> = {
    in_progress: { label: 'In Progress', color: 'text-amber-700', bg: 'bg-amber-100', dot: 'bg-amber-400 animate-pulse' },
    completed: { label: 'Completed', color: 'text-green-700', bg: 'bg-green-100', dot: 'bg-green-400' },
    archived: { label: 'Archived', color: 'text-slate-500', bg: 'bg-slate-100', dot: 'bg-slate-400' },
};

const isStalled = (a: AssessmentListItem) =>
    a.status === 'in_progress' &&
    (Date.now() - new Date(a.updated_at).getTime()) / 86400000 > STALLED_DAYS;

// ═══════════════════════════════════════════════════════════════
//  COMPONENT
// ═══════════════════════════════════════════════════════════════

export const AuditSchedulePage: React.FC = () => {
    const navigate = useNavigate();
    const [assessments, setAssessments] = useState<AssessmentListItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('');

    useEffect(() => {
        assessmentService.listAssessments()
            .then(setAssessments)
            .finally(() => setLoading(false));
    }, []);

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
                <button onClick={() => navigate('/audits')} className="btn-primary"><Plus size={16} className="mr-2" />Start Audit</button>
            </div>

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
                        const progressPct = Math.round((Math.max(0, (a.current_step || 1) - 1) / 7) * 100);

                        return (
                            <div
                                key={a.id}
                                onClick={() => navigate('/audits')}
                                className={`bg-white border border-slate-200 border-l-4 ${a.status === 'completed' ? 'border-l-green-400' : stalled ? 'border-l-red-500' : 'border-l-amber-400'} rounded-xl p-5 hover:shadow-md hover:border-slate-300 transition-all cursor-pointer ${stalled ? 'ring-1 ring-red-200' : ''}`}
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
                                                <span className="text-[10px] font-mono text-slate-400">Step {a.current_step || 1}/7 · {a.dimensions_completed}/6 dimensions</span>
                                            </div>
                                        )}
                                        {a.status === 'completed' && a.completed_at && (
                                            <p className="text-[10px] text-green-600 mt-2 flex items-center gap-1">
                                                <CheckCircle size={10} /> Assessment complete
                                            </p>
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
