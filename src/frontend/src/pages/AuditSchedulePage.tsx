/**
 * ═══════════════════════════════════════════════════════════════════════
 *  AUDIT SCHEDULE PAGE
 *  ISO 55001:2024 §9.2 — Audit Programme Planning & Scheduling
 *  
 *  Calendar-driven view of upcoming and past audits with:
 *  - Recurring audit programs
 *  - Auditor assignments
 *  - Site/facility targeting
 *  - Due date tracking & overdue alerts
 * ═══════════════════════════════════════════════════════════════════════
 */

import React, { useState } from 'react';
import {
    Calendar, Search, Clock, MapPin, User, Building2,
    AlertTriangle, CheckCircle, ChevronLeft, ChevronRight,
    Filter, MoreHorizontal, FileText, RefreshCw, Repeat,
    Target, Bell
} from 'lucide-react';
import { PreviewBanner } from '../components/common/PreviewBanner';

// ─── Types ───────────────────────────────────────────────────
type AuditScheduleStatus = 'scheduled' | 'in_progress' | 'completed' | 'overdue' | 'cancelled';
type RecurrenceType = 'one-time' | 'quarterly' | 'semi-annual' | 'annual' | 'biennial';

interface ScheduledAudit {
    id: string;
    title: string;
    templateName: string;
    scheduledDate: string;
    endDate?: string;
    site: string;
    facility: string;
    leadAuditor: string;
    teamSize: number;
    status: AuditScheduleStatus;
    recurrence: RecurrenceType;
    priority: 'critical' | 'high' | 'standard';
    isoRef: string;
    notes?: string;
}

const STATUS_CONFIG: Record<AuditScheduleStatus, { label: string; color: string; bg: string; dot: string }> = {
    scheduled:   { label: 'Scheduled',   color: 'text-blue-700',   bg: 'bg-blue-100',   dot: 'bg-blue-400' },
    in_progress: { label: 'In Progress', color: 'text-amber-700',  bg: 'bg-amber-100',  dot: 'bg-amber-400 animate-pulse' },
    completed:   { label: 'Completed',   color: 'text-green-700',  bg: 'bg-green-100',  dot: 'bg-green-400' },
    overdue:     { label: 'Overdue',     color: 'text-red-700',    bg: 'bg-red-100',    dot: 'bg-red-500' },
    cancelled:   { label: 'Cancelled',   color: 'text-slate-500',  bg: 'bg-slate-100',  dot: 'bg-slate-400' },
};

const PRIORITY_STYLES: Record<string, string> = {
    critical: 'border-l-red-500',
    high:     'border-l-amber-500',
    standard: 'border-l-blue-400',
};

// ─── Seed Data ───────────────────────────────────────────────
const SEED_SCHEDULE: ScheduledAudit[] = [
    {
        id: 'SCH-001', title: 'Annual ISO 55001 Full Assessment', templateName: 'ISO 55001:2024 Full Assessment',
        scheduledDate: '2026-06-15', endDate: '2026-06-19', site: 'Houston Refinery', facility: 'Crude Unit',
        leadAuditor: 'J. Martinez', teamSize: 3, status: 'scheduled', recurrence: 'annual',
        priority: 'critical', isoRef: 'ISO 55001:2024 §9.2',
    },
    {
        id: 'SCH-002', title: 'PSM Element 10 — MI Audit', templateName: 'Mechanical Integrity Program Audit',
        scheduledDate: '2026-05-20', endDate: '2026-05-21', site: 'Houston Refinery', facility: 'Compressor Station',
        leadAuditor: 'K. Syrus', teamSize: 2, status: 'in_progress', recurrence: 'semi-annual',
        priority: 'high', isoRef: 'OSHA PSM §1910.119(j)',
    },
    {
        id: 'SCH-003', title: 'Q1 Process Safety Audit', templateName: 'Process Safety Management (PSM)',
        scheduledDate: '2026-03-01', endDate: '2026-03-04', site: 'Permian Basin', facility: 'Gas Processing Plant',
        leadAuditor: 'A. Chen', teamSize: 4, status: 'completed', recurrence: 'quarterly',
        priority: 'high', isoRef: 'API RP 75',
    },
    {
        id: 'SCH-004', title: 'Environmental Screening — Tank Farm', templateName: 'Environmental Compliance Screening',
        scheduledDate: '2026-04-10', site: 'Houston Refinery', facility: 'Tank Farm',
        leadAuditor: 'R. Okafor', teamSize: 1, status: 'overdue', recurrence: 'annual',
        priority: 'standard', isoRef: 'ISO 14001:2015',
        notes: 'Delayed due to turnaround scheduling conflict',
    },
    {
        id: 'SCH-005', title: 'Turnaround Readiness Check', templateName: 'Operator Rounds — Turnaround Readiness',
        scheduledDate: '2026-07-01', site: 'Permian Basin', facility: 'All Units',
        leadAuditor: 'J. Martinez', teamSize: 2, status: 'scheduled', recurrence: 'one-time',
        priority: 'critical', isoRef: 'Internal SOP',
    },
];

// ═══════════════════════════════════════════════════════════════
//  COMPONENT
// ═══════════════════════════════════════════════════════════════

export const AuditSchedulePage: React.FC = () => {
    const [schedule] = useState<ScheduledAudit[]>(SEED_SCHEDULE);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('');

    const filtered = schedule.filter(s => {
        const matchSearch = !search || s.title.toLowerCase().includes(search.toLowerCase()) || s.leadAuditor.toLowerCase().includes(search.toLowerCase());
        const matchStatus = !statusFilter || s.status === statusFilter;
        return matchSearch && matchStatus;
    });

    const counts = {
        total: schedule.length,
        upcoming: schedule.filter(s => s.status === 'scheduled').length,
        inProgress: schedule.filter(s => s.status === 'in_progress').length,
        overdue: schedule.filter(s => s.status === 'overdue').length,
        completed: schedule.filter(s => s.status === 'completed').length,
    };

    return (
        <div className="h-full overflow-y-auto p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-black text-slate-800">Audit Schedule</h1>
                    <p className="text-sm text-slate-500 mt-1">ISO 55001 §9.2 — Audit Programme Planning, Scheduling & Tracking</p>
                </div>
            </div>

            <div className="mb-6">
                <PreviewBanner message="Preview — the audit schedule shown is illustrative and not yet connected to assessments." />
            </div>

            {/* KPI Bar */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
                <KpiCard label="Total Scheduled" value={counts.total} color="#6366f1" />
                <KpiCard label="Upcoming" value={counts.upcoming} color="#3b82f6" />
                <KpiCard label="In Progress" value={counts.inProgress} color="#f59e0b" />
                <KpiCard label="Overdue" value={counts.overdue} color="#ef4444" />
                <KpiCard label="Completed" value={counts.completed} color="#22c55e" />
            </div>

            {/* Filters */}
            <div className="flex gap-3 mb-4">
                <div className="flex-1 relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search by audit title or auditor..."
                        className="w-full pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-blue-400"
                    />
                </div>
                <select
                    value={statusFilter}
                    onChange={e => setStatusFilter(e.target.value)}
                    className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-700"
                >
                    <option value="">All Status</option>
                    {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                        <option key={key} value={key}>{cfg.label}</option>
                    ))}
                </select>
            </div>

            {/* Schedule Timeline */}
            {filtered.length === 0 ? (
                <div className="text-center py-20">
                    <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
                        <Calendar size={28} className="text-slate-300" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-600 mb-2">No audits scheduled</h3>
                    <p className="text-sm text-slate-400">Schedule your first audit to start building your programme</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {filtered.map(audit => {
                        const stCfg = STATUS_CONFIG[audit.status];
                        const borderClass = PRIORITY_STYLES[audit.priority] || 'border-l-slate-300';
                        const isOverdue = audit.status === 'overdue';

                        return (
                            <div
                                key={audit.id}
                                className={`bg-white border border-slate-200 border-l-4 ${borderClass} rounded-xl p-5 hover:shadow-md hover:border-slate-300 transition-all group cursor-pointer ${isOverdue ? 'ring-1 ring-red-200' : ''}`}
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex items-start gap-4 flex-1 min-w-0">
                                        {/* Status Dot */}
                                        <div className={`w-3 h-3 rounded-full mt-1 shrink-0 ${stCfg.dot}`} />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-xs font-mono text-slate-400">{audit.id}</span>
                                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md uppercase ${stCfg.bg} ${stCfg.color}`}>{stCfg.label}</span>
                                                {audit.priority === 'critical' && (
                                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md uppercase bg-red-100 text-red-700 flex items-center gap-0.5">
                                                        <AlertTriangle size={8} /> CRITICAL
                                                    </span>
                                                )}
                                                {audit.recurrence !== 'one-time' && (
                                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-blue-100 text-blue-600 flex items-center gap-0.5">
                                                        <Repeat size={8} /> {audit.recurrence}
                                                    </span>
                                                )}
                                            </div>
                                            <h3 className="text-sm font-bold text-slate-800 truncate">{audit.title}</h3>
                                            <p className="text-xs text-slate-500 mt-0.5">{audit.templateName}</p>
                                            <div className="flex items-center gap-4 mt-2 text-[11px] text-slate-400">
                                                <span className="flex items-center gap-1">
                                                    <Calendar size={10} />
                                                    {new Date(audit.scheduledDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                    {audit.endDate && ` – ${new Date(audit.endDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}
                                                </span>
                                                <span className="flex items-center gap-1"><MapPin size={10} /> {audit.site} — {audit.facility}</span>
                                                <span className="flex items-center gap-1"><User size={10} /> {audit.leadAuditor} (+{audit.teamSize - 1})</span>
                                                <span className="flex items-center gap-1"><FileText size={10} /> {audit.isoRef}</span>
                                            </div>
                                            {audit.notes && (
                                                <p className="text-[10px] text-amber-600 mt-2 flex items-center gap-1">
                                                    <Bell size={10} /> {audit.notes}
                                                </p>
                                            )}
                                        </div>
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
