/**
 * ═══════════════════════════════════════════════════════════════════════
 *  AUDIT CORRECTIVE ACTIONS PAGE
 *  ISO 55001:2024 §10.1 — Nonconformity & Corrective Action
 *  
 *  Tracks findings from audits that require corrective action:
 *  - Finding origin (assessment, site walk, PSM element)
 *  - Severity classification (Critical, Major, Minor, Observation)
 *  - Responsible owner & due dates
 *  - Work Order conversion pipeline
 *  - Verification & close-out tracking
 * ═══════════════════════════════════════════════════════════════════════
 */

import React, { useState } from 'react';
import {
    AlertTriangle, CheckCircle, Clock, Plus, Search, Filter,
    ArrowRight, User, Calendar, Building2, MapPin, Eye,
    FileText, Target, Wrench, ChevronRight, MoreHorizontal,
    XCircle, Shield, TrendingUp, ClipboardCheck, Loader2
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────
type CASeverity = 'critical' | 'major' | 'minor' | 'observation';
type CAStatus = 'open' | 'in_progress' | 'pending_verification' | 'closed' | 'overdue';

interface CorrectiveAction {
    id: string;
    findingRef: string;
    auditRef: string;
    title: string;
    description: string;
    severity: CASeverity;
    status: CAStatus;
    category: string;
    isoReference: string;
    responsiblePerson: string;
    responsibleDept: string;
    raisedDate: string;
    dueDate: string;
    closedDate?: string;
    site: string;
    workOrderId?: string;
    rootCause?: string;
    verifiedBy?: string;
    percentComplete: number;
}

const SEVERITY_CONFIG: Record<CASeverity, { label: string; color: string; bg: string; border: string; icon: React.ReactNode }> = {
    critical:    { label: 'Critical',    color: 'text-red-700',    bg: 'bg-red-50',     border: 'border-l-red-500',    icon: <AlertTriangle size={14} /> },
    major:       { label: 'Major',       color: 'text-amber-700',  bg: 'bg-amber-50',   border: 'border-l-amber-500',  icon: <Shield size={14} /> },
    minor:       { label: 'Minor',       color: 'text-blue-700',   bg: 'bg-blue-50',    border: 'border-l-blue-400',   icon: <Target size={14} /> },
    observation: { label: 'Observation', color: 'text-slate-600',  bg: 'bg-slate-50',   border: 'border-l-slate-300',  icon: <Eye size={14} /> },
};

const STATUS_CONFIG: Record<CAStatus, { label: string; color: string; bg: string }> = {
    open:                   { label: 'Open',              color: 'text-blue-700',   bg: 'bg-blue-100' },
    in_progress:            { label: 'In Progress',       color: 'text-amber-700',  bg: 'bg-amber-100' },
    pending_verification:   { label: 'Pending Verif.',    color: 'text-purple-700', bg: 'bg-purple-100' },
    closed:                 { label: 'Closed',            color: 'text-green-700',  bg: 'bg-green-100' },
    overdue:                { label: 'Overdue',           color: 'text-red-700',    bg: 'bg-red-100' },
};

// ─── Seed Data ───────────────────────────────────────────────
const SEED_ACTIONS: CorrectiveAction[] = [
    {
        id: 'CA-001', findingRef: 'F-012', auditRef: 'AUD-2026-003', title: 'No documented SAMP aligned to ISO 55001 §4.4',
        description: 'Organization lacks a formal Strategic Asset Management Plan. Current asset strategies exist as informal spreadsheets with no traceability to organizational objectives.',
        severity: 'critical', status: 'in_progress', category: 'Strategic Planning',
        isoReference: 'ISO 55001:2024 §4.4', responsiblePerson: 'J. Martinez', responsibleDept: 'Asset Management',
        raisedDate: '2026-03-04', dueDate: '2026-06-30', site: 'Permian Basin',
        workOrderId: 'WO-2026-1847', rootCause: 'No dedicated AM function — responsibilities distributed across operations and maintenance without formal mandate.',
        percentComplete: 35,
    },
    {
        id: 'CA-002', findingRef: 'F-018', auditRef: 'AUD-2026-003', title: 'PSV testing overdue — 14 devices past inspection interval',
        description: '14 of 52 pressure safety valves exceed API 576 recommended test intervals. Oldest overdue by 18 months.',
        severity: 'critical', status: 'overdue', category: 'Mechanical Integrity',
        isoReference: 'API 576, OSHA PSM §1910.119(j)', responsiblePerson: 'K. Syrus', responsibleDept: 'Inspection',
        raisedDate: '2026-03-04', dueDate: '2026-04-30', site: 'Permian Basin',
        workOrderId: 'WO-2026-1902', percentComplete: 60,
    },
    {
        id: 'CA-003', findingRef: 'F-025', auditRef: 'AUD-2026-003', title: 'Competence framework not aligned to AM roles',
        description: 'Training records exist but are generic. No competence matrix maps skills to specific asset management roles per ISO 55012.',
        severity: 'major', status: 'open', category: 'People & Competence',
        isoReference: 'ISO 55012', responsiblePerson: 'R. Okafor', responsibleDept: 'HR / Training',
        raisedDate: '2026-03-04', dueDate: '2026-08-31', site: 'All Sites',
        percentComplete: 0,
    },
    {
        id: 'CA-004', findingRef: 'F-031', auditRef: 'AUD-2026-002', title: 'Financial and technical asset registers not reconciled',
        description: 'Fixed asset register in Finance contains 4,200 items vs 3,800 in CMMS. 400+ items unreconciled — potential ghost assets.',
        severity: 'major', status: 'in_progress', category: 'Financial Alignment',
        isoReference: 'ISO 55010', responsiblePerson: 'A. Chen', responsibleDept: 'Finance / Engineering',
        raisedDate: '2026-01-15', dueDate: '2026-07-15', site: 'Houston Refinery',
        percentComplete: 45,
    },
    {
        id: 'CA-005', findingRef: 'F-042', auditRef: 'AUD-2026-002', title: 'KPI dashboards lack leading indicators',
        description: 'Current KPIs are lagging only (MTBF, MTTR, downtime). No leading indicators (PM compliance, backlog health, schedule compliance) tracked.',
        severity: 'minor', status: 'pending_verification', category: 'Performance Measurement',
        isoReference: 'ISO 55001:2024 §9.1', responsiblePerson: 'J. Martinez', responsibleDept: 'Reliability',
        raisedDate: '2026-01-15', dueDate: '2026-03-31', site: 'Houston Refinery',
        closedDate: '2026-03-28', verifiedBy: 'A. Chen', percentComplete: 100,
    },
    {
        id: 'CA-006', findingRef: 'SV-008', auditRef: 'AUD-2026-001', title: 'Equipment tagging inconsistent in tank farm',
        description: 'Site walk identified 12 equipment items with illegible or missing tags. Asset register accuracy cannot be verified on-site.',
        severity: 'observation', status: 'closed', category: 'Asset Register',
        isoReference: 'ISO 55013', responsiblePerson: 'K. Syrus', responsibleDept: 'Operations',
        raisedDate: '2025-11-20', dueDate: '2026-01-31', site: 'Houston Refinery',
        closedDate: '2026-01-28', verifiedBy: 'J. Martinez', percentComplete: 100,
    },
];

// ═══════════════════════════════════════════════════════════════
//  COMPONENT
// ═══════════════════════════════════════════════════════════════

export const AuditCorrectiveActionsPage: React.FC = () => {
    const [actions] = useState<CorrectiveAction[]>(SEED_ACTIONS);
    const [search, setSearch] = useState('');
    const [severityFilter, setSeverityFilter] = useState<string>('');
    const [statusFilter, setStatusFilter] = useState<string>('');

    const filtered = actions.filter(a => {
        const matchSearch = !search || a.title.toLowerCase().includes(search.toLowerCase()) || a.responsiblePerson.toLowerCase().includes(search.toLowerCase());
        const matchSeverity = !severityFilter || a.severity === severityFilter;
        const matchStatus = !statusFilter || a.status === statusFilter;
        return matchSearch && matchSeverity && matchStatus;
    });

    const counts = {
        total: actions.length,
        open: actions.filter(a => a.status === 'open' || a.status === 'in_progress').length,
        overdue: actions.filter(a => a.status === 'overdue').length,
        closed: actions.filter(a => a.status === 'closed').length,
        critical: actions.filter(a => a.severity === 'critical' && a.status !== 'closed').length,
    };

    return (
        <div className="h-full overflow-y-auto p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-black text-slate-800">Corrective Actions</h1>
                    <p className="text-sm text-slate-500 mt-1">ISO 55001 §10.1 — Nonconformity tracking, root cause, remediation & WO conversion</p>
                </div>
                <button className="px-5 py-2.5 bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-bold rounded-xl shadow-lg shadow-indigo-500/20 hover:shadow-xl hover:scale-[1.02] transition-all flex items-center gap-2">
                    <Plus size={18} /> Log Finding
                </button>
            </div>

            {/* KPI Bar */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
                <KpiCard label="Total Actions" value={counts.total} color="#6366f1" />
                <KpiCard label="Open / Active" value={counts.open} color="#f59e0b" />
                <KpiCard label="Overdue" value={counts.overdue} color="#ef4444" />
                <KpiCard label="Closed" value={counts.closed} color="#22c55e" />
                <KpiCard label="Open Critical" value={counts.critical} color="#dc2626" />
            </div>

            {/* Filters */}
            <div className="flex gap-3 mb-4">
                <div className="flex-1 relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search by finding, owner, or description..."
                        className="w-full pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-indigo-400"
                    />
                </div>
                <select value={severityFilter} onChange={e => setSeverityFilter(e.target.value)} className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-700">
                    <option value="">All Severity</option>
                    {Object.entries(SEVERITY_CONFIG).map(([key, cfg]) => (
                        <option key={key} value={key}>{cfg.label}</option>
                    ))}
                </select>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-700">
                    <option value="">All Status</option>
                    {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                        <option key={key} value={key}>{cfg.label}</option>
                    ))}
                </select>
            </div>

            {/* Action Items */}
            {filtered.length === 0 ? (
                <div className="text-center py-20">
                    <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
                        <CheckCircle size={28} className="text-slate-300" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-600 mb-2">No corrective actions</h3>
                    <p className="text-sm text-slate-400">All findings have been addressed — or adjust your filters</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {filtered.map(action => {
                        const sevCfg = SEVERITY_CONFIG[action.severity];
                        const stCfg = STATUS_CONFIG[action.status];
                        const isOverdue = action.status === 'overdue';
                        const daysUntilDue = Math.ceil((new Date(action.dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));

                        return (
                            <div
                                key={action.id}
                                className={`bg-white border border-slate-200 border-l-4 ${sevCfg.border} rounded-xl p-5 hover:shadow-md hover:border-slate-300 transition-all group cursor-pointer ${isOverdue ? 'ring-1 ring-red-200' : ''}`}
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex items-start gap-4 flex-1 min-w-0">
                                        {/* Severity Icon */}
                                        <div className={`w-10 h-10 rounded-xl ${sevCfg.bg} flex items-center justify-center shrink-0 ${sevCfg.color}`}>
                                            {sevCfg.icon}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                                                <span className="text-xs font-mono text-slate-400">{action.id}</span>
                                                <span className="text-[9px] text-slate-400 font-mono">ref: {action.findingRef}</span>
                                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md uppercase ${sevCfg.bg} ${sevCfg.color}`}>{sevCfg.label}</span>
                                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md uppercase ${stCfg.bg} ${stCfg.color}`}>{stCfg.label}</span>
                                                {action.workOrderId && (
                                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-cyan-100 text-cyan-700 flex items-center gap-0.5">
                                                        <Wrench size={8} /> {action.workOrderId}
                                                    </span>
                                                )}
                                            </div>
                                            <h3 className="text-sm font-bold text-slate-800">{action.title}</h3>
                                            <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{action.description}</p>
                                            <div className="flex items-center gap-4 mt-2 text-[11px] text-slate-400">
                                                <span className="flex items-center gap-1"><User size={10} /> {action.responsiblePerson} ({action.responsibleDept})</span>
                                                <span className="flex items-center gap-1"><MapPin size={10} /> {action.site}</span>
                                                <span className="flex items-center gap-1"><FileText size={10} /> {action.isoReference}</span>
                                                <span className={`flex items-center gap-1 ${isOverdue ? 'text-red-500 font-bold' : daysUntilDue <= 14 && action.status !== 'closed' ? 'text-amber-500 font-medium' : ''}`}>
                                                    <Calendar size={10} />
                                                    Due: {new Date(action.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                    {isOverdue && ` (${Math.abs(daysUntilDue)}d overdue)`}
                                                </span>
                                            </div>

                                            {/* Progress Bar */}
                                            {action.status !== 'closed' && (
                                                <div className="mt-3 flex items-center gap-3">
                                                    <div className="flex-1 bg-slate-100 rounded-full h-1.5">
                                                        <div
                                                            className={`h-1.5 rounded-full transition-all ${action.percentComplete >= 100 ? 'bg-green-400' : action.percentComplete > 50 ? 'bg-blue-400' : 'bg-amber-400'}`}
                                                            style={{ width: `${action.percentComplete}%` }}
                                                        />
                                                    </div>
                                                    <span className="text-[10px] font-mono text-slate-400 w-8 text-right">{action.percentComplete}%</span>
                                                </div>
                                            )}

                                            {action.status === 'closed' && action.verifiedBy && (
                                                <p className="text-[10px] text-green-600 mt-2 flex items-center gap-1">
                                                    <CheckCircle size={10} /> Verified by {action.verifiedBy} on {new Date(action.closedDate!).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                </p>
                                            )}
                                        </div>
                                    </div>

                                    {/* Quick Actions */}
                                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button className="p-2 rounded-lg hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 transition-colors" title="View Details">
                                            <Eye size={16} />
                                        </button>
                                        {!action.workOrderId && action.status !== 'closed' && (
                                            <button className="p-2 rounded-lg hover:bg-cyan-50 text-slate-400 hover:text-cyan-600 transition-colors" title="Convert to Work Order">
                                                <Wrench size={16} />
                                            </button>
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
