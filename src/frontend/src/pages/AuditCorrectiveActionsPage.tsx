/**
 * ═══════════════════════════════════════════════════════════════════════
 *  AUDIT CORRECTIVE ACTIONS PAGE
 *  ISO 55001:2024 §10.1 — Nonconformity & Corrective Action
 *
 *  Live view over audit_corrective_actions (0132, standalone CAs per 0211):
 *  - Log corrective / preventive / improvement actions
 *  - Owner & due-date tracking with overdue detection
 *  - Convert to a real work order (CA → WO pipeline, wo_id link)
 *  - Status lifecycle through completion & verification
 * ═══════════════════════════════════════════════════════════════════════
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    AlertTriangle, CheckCircle, Search, User, Calendar,
    Target, Wrench, Shield, Plus, X, Loader2, ExternalLink,
} from 'lucide-react';
import { AuditService } from '../eam/services/AuditService';
import { DatabaseService } from '../eam/services/DatabaseService';
import { buildWorkOrder } from '../eam/lib/workOrder';
import { useToast } from '../eam/contexts/ToastContext';
import { useAssetLookup } from '../hooks/useAssetLookup';
import type { AuditCorrectiveAction, AuditCAStatus, CAType } from '../types/audit';

const TYPE_CONFIG: Record<CAType, { label: string; color: string; bg: string; border: string; icon: React.ReactNode }> = {
    corrective: { label: 'Corrective', color: 'text-red-700', bg: 'bg-red-50', border: 'border-l-red-500', icon: <AlertTriangle size={14} /> },
    preventive: { label: 'Preventive', color: 'text-blue-700', bg: 'bg-blue-50', border: 'border-l-blue-400', icon: <Shield size={14} /> },
    improvement: { label: 'Improvement', color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-l-emerald-400', icon: <Target size={14} /> },
};

const STATUS_CONFIG: Record<AuditCAStatus, { label: string; color: string; bg: string }> = {
    open: { label: 'Open', color: 'text-blue-700', bg: 'bg-blue-100' },
    in_progress: { label: 'In Progress', color: 'text-amber-700', bg: 'bg-amber-100' },
    completed: { label: 'Completed', color: 'text-green-700', bg: 'bg-green-100' },
    verified: { label: 'Verified', color: 'text-emerald-700', bg: 'bg-emerald-100' },
    overdue: { label: 'Overdue', color: 'text-red-700', bg: 'bg-red-100' },
    cancelled: { label: 'Cancelled', color: 'text-slate-500', bg: 'bg-slate-100' },
};

const CLOSED_STATUSES: AuditCAStatus[] = ['completed', 'verified', 'cancelled'];

const emptyForm = { description: '', action_type: 'corrective' as CAType, assigned_to_name: '', assigned_to_company: '', due_date: '' };

// ═══════════════════════════════════════════════════════════════
//  COMPONENT
// ═══════════════════════════════════════════════════════════════

export const AuditCorrectiveActionsPage: React.FC = () => {
    const navigate = useNavigate();
    const { showToast } = useToast();
    const { assetOptions } = useAssetLookup();
    const auditService = AuditService.getInstance();

    const [actions, setActions] = useState<AuditCorrectiveAction[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [typeFilter, setTypeFilter] = useState<string>('');
    const [statusFilter, setStatusFilter] = useState<string>('');
    const [showNew, setShowNew] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [saving, setSaving] = useState(false);
    // CA id whose "convert to WO" asset picker is open, and the in-flight id
    const [convertingId, setConvertingId] = useState<string | null>(null);
    const [convertBusy, setConvertBusy] = useState(false);
    const [convertAssetId, setConvertAssetId] = useState('');

    useEffect(() => {
        auditService.getAllCorrectiveActions()
            .then(setActions)
            .finally(() => setLoading(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const isOverdue = (a: AuditCorrectiveAction) =>
        a.status === 'overdue' ||
        (!CLOSED_STATUSES.includes(a.status) && !!a.due_date && new Date(a.due_date).getTime() < Date.now());

    const filtered = useMemo(() => actions.filter(a => {
        const q = search.toLowerCase();
        const matchSearch = !q || a.description.toLowerCase().includes(q)
            || (a.assigned_to_name || '').toLowerCase().includes(q)
            || a.ca_number.toLowerCase().includes(q);
        const matchType = !typeFilter || a.action_type === typeFilter;
        const matchStatus = !statusFilter || (statusFilter === 'overdue' ? isOverdue(a) : a.status === statusFilter);
        return matchSearch && matchType && matchStatus;
    }), [actions, search, typeFilter, statusFilter]);

    const counts = {
        total: actions.length,
        open: actions.filter(a => a.status === 'open' || a.status === 'in_progress').length,
        overdue: actions.filter(isOverdue).length,
        closed: actions.filter(a => a.status === 'completed' || a.status === 'verified').length,
        withWo: actions.filter(a => a.wo_id).length,
    };

    const handleCreate = async () => {
        if (!form.description.trim() || !form.assigned_to_name.trim()) return;
        setSaving(true);
        const created = await auditService.createCorrectiveAction({
            finding_id: null,
            ca_number: `CA-${Date.now().toString(36).toUpperCase()}`,
            action_type: form.action_type,
            description: form.description.trim(),
            assigned_to_name: form.assigned_to_name.trim(),
            assigned_to_company: form.assigned_to_company.trim() || undefined,
            due_date: form.due_date || null,
            status: 'open',
            escalated: false,
        } as Omit<AuditCorrectiveAction, 'id' | 'created_at'>);
        setSaving(false);
        if (created) {
            setActions(prev => [created, ...prev]);
            setForm(emptyForm);
            setShowNew(false);
        } else {
            showToast("Couldn't save the corrective action — nothing was stored. Check your connection and try again.", 'error', 6000);
        }
    };

    const handleStatusChange = async (a: AuditCorrectiveAction, status: AuditCAStatus) => {
        const prev = a.status;
        setActions(list => list.map(x => x.id === a.id ? { ...x, status } : x));
        const ok = await auditService.updateCAStatus(a.id, status);
        if (!ok) {
            setActions(list => list.map(x => x.id === a.id ? { ...x, status: prev } : x));
            showToast("Couldn't update the status — it was not stored.", 'error', 5000);
        }
    };

    const handleConvertToWO = async (a: AuditCorrectiveAction) => {
        if (!convertAssetId) return;
        setConvertBusy(true);
        try {
            const wo = await DatabaseService.getInstance().createWorkOrder(buildWorkOrder({
                title: `CA ${a.ca_number} — ${a.description.slice(0, 60)}`,
                description: `Raised from corrective action ${a.ca_number} (${a.action_type}).\n\n${a.description}`,
                assetId: convertAssetId,
                type: 'CM',
                priorityCode: a.action_type === 'corrective' ? 'HIGH' : 'MEDIUM',
                status: 'OPEN',
                ...(a.due_date ? { dueDate: a.due_date } : {}),
            }), a.assigned_to_name || 'audit-ca');
            if (!wo?.id) throw new Error('Work order creation returned no id');
            const linked = await auditService.linkCAToWorkOrder(a.id, wo.id, wo.wo_number || '');
            if (!linked) throw new Error('WO created but CA link failed');
            setActions(list => list.map(x => x.id === a.id ? { ...x, wo_id: wo.id, wo_number: wo.wo_number } : x));
            showToast(`Work order ${wo.wo_number || ''} raised from ${a.ca_number}.`, 'success');
            setConvertingId(null);
            setConvertAssetId('');
        } catch (e) {
            console.error('CA → WO failed:', e);
            showToast("Couldn't raise the work order. Check your connection and try again.", 'error', 6000);
        }
        setConvertBusy(false);
    };

    return (
        <div className="h-full overflow-y-auto p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-black text-slate-800">Corrective Actions</h1>
                    <p className="text-sm text-slate-500 mt-1">ISO 55001 §10.1 — Nonconformity tracking, remediation & WO conversion</p>
                </div>
                <button onClick={() => setShowNew(true)} className="btn-primary"><Plus size={16} className="mr-2" />Log Corrective Action</button>
            </div>

            {/* KPI Bar */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
                <KpiCard label="Total Actions" value={counts.total} color="#6366f1" />
                <KpiCard label="Open / Active" value={counts.open} color="#f59e0b" />
                <KpiCard label="Overdue" value={counts.overdue} color="#ef4444" />
                <KpiCard label="Closed" value={counts.closed} color="#22c55e" />
                <KpiCard label="Linked to WO" value={counts.withWo} color="#0ea5e9" />
            </div>

            {/* Filters */}
            <div className="flex gap-3 mb-4">
                <div className="flex-1 relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search by CA number, owner, or description..."
                        className="w-full pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-blue-400"
                    />
                </div>
                <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-700">
                    <option value="">All Types</option>
                    {Object.entries(TYPE_CONFIG).map(([key, cfg]) => (
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
            {loading ? (
                <div className="flex items-center justify-center py-20 text-slate-400">
                    <Loader2 size={24} className="animate-spin mr-2" /> Loading corrective actions…
                </div>
            ) : filtered.length === 0 ? (
                <div className="text-center py-20">
                    <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
                        <CheckCircle size={28} className="text-slate-300" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-600 mb-2">No corrective actions</h3>
                    <p className="text-sm text-slate-400">{actions.length === 0 ? 'Log the first corrective action to start tracking nonconformities' : 'Adjust your filters'}</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {filtered.map(action => {
                        const typeCfg = TYPE_CONFIG[action.action_type] || TYPE_CONFIG.corrective;
                        const overdue = isOverdue(action);
                        const stCfg = overdue && !CLOSED_STATUSES.includes(action.status) ? STATUS_CONFIG.overdue : STATUS_CONFIG[action.status];
                        const daysUntilDue = action.due_date ? Math.ceil((new Date(action.due_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;

                        return (
                            <div
                                key={action.id}
                                className={`bg-white border border-slate-200 border-l-4 ${typeCfg.border} rounded-xl p-5 hover:shadow-md hover:border-slate-300 transition-all ${overdue ? 'ring-1 ring-red-200' : ''}`}
                            >
                                <div className="flex items-start gap-4">
                                    <div className={`w-10 h-10 rounded-xl ${typeCfg.bg} flex items-center justify-center shrink-0 ${typeCfg.color}`}>
                                        {typeCfg.icon}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                                            <span className="text-xs font-mono text-slate-400">{action.ca_number}</span>
                                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md uppercase ${typeCfg.bg} ${typeCfg.color}`}>{typeCfg.label}</span>
                                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md uppercase ${stCfg.bg} ${stCfg.color}`}>{stCfg.label}</span>
                                            {action.wo_id && (
                                                <button
                                                    onClick={() => navigate(`/work-orders/${action.wo_id}`)}
                                                    className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-primary-100 text-primary-700 flex items-center gap-0.5 hover:bg-primary-200 transition-colors"
                                                    title="Open work order"
                                                >
                                                    <Wrench size={8} /> {action.wo_number || 'WO'} <ExternalLink size={8} />
                                                </button>
                                            )}
                                            {action.assessment_id && (
                                                <button
                                                    onClick={() => navigate('/audits')}
                                                    className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-violet-100 text-violet-700 flex items-center gap-0.5 hover:bg-violet-200 transition-colors"
                                                    title="Raised from a scored finding in the 6M assessment"
                                                >
                                                    <Target size={8} /> {action.assessment_number || 'Assessment'} <ExternalLink size={8} />
                                                </button>
                                            )}
                                        </div>
                                        <p className="text-sm font-medium text-slate-800">{action.description}</p>
                                        <div className="flex items-center gap-4 mt-2 text-[11px] text-slate-400 flex-wrap">
                                            {action.assigned_to_name && (
                                                <span className="flex items-center gap-1"><User size={10} /> {action.assigned_to_name}{action.assigned_to_company ? ` (${action.assigned_to_company})` : ''}</span>
                                            )}
                                            {action.due_date && (
                                                <span className={`flex items-center gap-1 ${overdue ? 'text-red-500 font-bold' : daysUntilDue != null && daysUntilDue <= 14 && !CLOSED_STATUSES.includes(action.status) ? 'text-amber-500 font-medium' : ''}`}>
                                                    <Calendar size={10} />
                                                    Due: {new Date(action.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                    {overdue && daysUntilDue != null && ` (${Math.abs(daysUntilDue)}d overdue)`}
                                                </span>
                                            )}
                                            {action.verified_at && (
                                                <span className="flex items-center gap-1 text-emerald-600"><CheckCircle size={10} /> Verified {new Date(action.verified_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Row actions */}
                                    <div className="flex flex-col items-end gap-2 shrink-0">
                                        <select
                                            value={action.status}
                                            onChange={e => handleStatusChange(action, e.target.value as AuditCAStatus)}
                                            className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-700 focus:outline-none focus:border-primary-400"
                                            title="Change status"
                                        >
                                            {Object.entries(STATUS_CONFIG).filter(([k]) => k !== 'overdue').map(([key, cfg]) => (
                                                <option key={key} value={key}>{cfg.label}</option>
                                            ))}
                                        </select>
                                        {!action.wo_id && (
                                            convertingId === action.id ? (
                                                <div className="flex items-center gap-1.5">
                                                    <select
                                                        value={convertAssetId}
                                                        onChange={e => setConvertAssetId(e.target.value)}
                                                        className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-700 max-w-[180px] focus:outline-none focus:border-primary-400"
                                                    >
                                                        <option value="">Select asset…</option>
                                                        {assetOptions.map(a => <option key={a.id} value={a.id}>{a.tag} — {a.name}</option>)}
                                                    </select>
                                                    <button
                                                        onClick={() => handleConvertToWO(action)}
                                                        disabled={!convertAssetId || convertBusy}
                                                        className="px-2 py-1.5 text-[11px] font-bold text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-40 transition-colors"
                                                    >
                                                        {convertBusy ? <Loader2 size={11} className="animate-spin" /> : 'Raise'}
                                                    </button>
                                                    <button onClick={() => { setConvertingId(null); setConvertAssetId(''); }} className="p-1 text-slate-400 hover:text-slate-600"><X size={12} /></button>
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => { setConvertingId(action.id); setConvertAssetId(''); }}
                                                    className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
                                                >
                                                    <Wrench size={11} /> Convert to WO
                                                </button>
                                            )
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Log CA modal */}
            {showNew && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowNew(false)}>
                    <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-primary-50 rounded-lg text-primary-600"><Target size={20} /></div>
                                <div>
                                    <h2 className="text-lg font-bold text-slate-800">Log Corrective Action</h2>
                                    <p className="text-xs text-slate-500 mt-0.5">ISO 55001 §10.1 nonconformity remediation</p>
                                </div>
                            </div>
                            <button onClick={() => setShowNew(false)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"><X size={18} /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Description</label>
                                <textarea
                                    value={form.description}
                                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                                    rows={3}
                                    placeholder="What must be corrected, and to what standard…"
                                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 resize-none"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Type</label>
                                    <select value={form.action_type} onChange={e => setForm(f => ({ ...f, action_type: e.target.value as CAType }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-primary-500">
                                        <option value="corrective">Corrective</option>
                                        <option value="preventive">Preventive</option>
                                        <option value="improvement">Improvement</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Due Date</label>
                                    <input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-primary-500" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Owner</label>
                                    <input type="text" value={form.assigned_to_name} onChange={e => setForm(f => ({ ...f, assigned_to_name: e.target.value }))} placeholder="e.g. J. Martinez" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-primary-500" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Department / Company</label>
                                    <input type="text" value={form.assigned_to_company} onChange={e => setForm(f => ({ ...f, assigned_to_company: e.target.value }))} placeholder="e.g. Inspection" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-primary-500" />
                                </div>
                            </div>
                        </div>
                        <div className="p-6 border-t border-slate-200 flex justify-end space-x-3">
                            <button onClick={() => setShowNew(false)} className="px-4 py-2.5 text-sm text-slate-500 hover:text-slate-700 transition-colors">Cancel</button>
                            <button
                                onClick={handleCreate}
                                disabled={!form.description.trim() || !form.assigned_to_name.trim() || saving}
                                className="px-6 py-2.5 bg-primary-600 text-white text-sm font-semibold rounded-lg hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                                {saving ? <Loader2 size={14} className="animate-spin" /> : 'Log Action'}
                            </button>
                        </div>
                    </div>
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
