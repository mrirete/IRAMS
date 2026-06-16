import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    CalendarDays, CheckCircle, AlertTriangle, List, LayoutGrid, Plus, X,
    Clock, ExternalLink, Play, Pause, Ban, Eye, ChevronRight
} from 'lucide-react';
import { useIntegrity } from '../hooks/useIntegrity';
import { useAssetLookup } from '../hooks/useAssetLookup';
import type { InspectionEvent, InspectionType, InspectionEventStatus } from '../types/integrity';

// ── Status visual config ──
const STATUS_CFG: Record<InspectionEventStatus, { label: string; icon: React.ReactNode; cls: string }> = {
    scheduled: { label: 'Scheduled', icon: <CalendarDays size={10} />, cls: 'text-blue-700 bg-blue-50 border-blue-200' },
    in_progress: { label: 'In Progress', icon: <Play size={10} />, cls: 'text-amber-700 bg-amber-50 border-amber-200' },
    completed: { label: 'Completed', icon: <CheckCircle size={10} />, cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
    overdue: { label: 'Overdue', icon: <AlertTriangle size={10} />, cls: 'text-red-700 bg-red-50 border-red-200' },
    deferred: { label: 'Deferred', icon: <Pause size={10} />, cls: 'text-slate-600 bg-slate-50 border-slate-200' },
    cancelled: { label: 'Cancelled', icon: <Ban size={10} />, cls: 'text-slate-500 bg-slate-50 border-slate-200' },
};

const NDT_COLOR: Record<string, string> = {
    UT: 'bg-blue-500', PAUT: 'bg-primary-500', MFL: 'bg-blue-500', VT: 'bg-green-500',
    PT: 'bg-yellow-500', RT: 'bg-orange-500', MT: 'bg-pink-500', TOFD: 'bg-primary-500',
};

export const InspectionSchedulePage: React.FC = () => {
    const navigate = useNavigate();
    const { inspections, summary, addInspection } = useIntegrity();
    const { assetOptions, getAssetName } = useAssetLookup();
    const [viewMode, setViewMode] = useState<'calendar' | 'list'>('list');
    const [showNew, setShowNew] = useState(false);
    const [statusFilter, setStatusFilter] = useState<InspectionEventStatus | 'all'>('all');
    const [ndeFilter, setNdeFilter] = useState<InspectionType | 'all'>('all');
    const [form, setForm] = useState({
        asset_id: '', inspection_type: 'UT' as InspectionType,
        scheduled_date: '', inspector: '', governing_code: '',
        description: '', approval_mode: 'simple' as 'simple' | 'two_step',
    });

    const handleSubmit = () => {
        if (!form.asset_id || !form.scheduled_date || !form.inspector) return;
        const assetName = getAssetName(form.asset_id);
        const insp: InspectionEvent = {
            id: `insp-${Date.now()}`,
            asset_id: form.asset_id,
            asset_name: assetName !== form.asset_id ? assetName : undefined,
            inspection_type: form.inspection_type,
            scheduled_date: new Date(form.scheduled_date).toISOString(),
            status: 'scheduled',
            findings_count: 0,
            inspector: form.inspector,
            governing_code: (form.governing_code || undefined) as any,
            description: form.description || undefined,
            approval_mode: form.approval_mode,
            findings: [],
            notes: [],
            team: [{
                id: `tm-${Date.now()}`,
                user_id: `usr-${form.inspector.toLowerCase().replace(/\s+/g, '-')}`,
                name: form.inspector,
                role: 'lead_inspector',
                added_at: new Date().toISOString(),
            }],
            checklist_responses: {},
        };
        addInspection(insp);
        setForm({
            asset_id: '', inspection_type: 'UT', scheduled_date: '', inspector: '',
            governing_code: '', description: '', approval_mode: 'simple',
        });
        setShowNew(false);
    };

    // ── Filtered list ──
    const filtered = inspections
        .filter(i => statusFilter === 'all' || i.status === statusFilter)
        .filter(i => ndeFilter === 'all' || i.inspection_type === ndeFilter)
        .sort((a, b) => new Date(a.scheduled_date).getTime() - new Date(b.scheduled_date).getTime());

    // ── Calendar data ──
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const firstDow = startOfMonth.getDay();

    return (
        <div className="space-y-6 pb-20">
            {/* ── Header ── */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Inspection Schedule</h1>
                    <p className="text-slate-500 text-sm mt-1">NDT scheduling, compliance tracking, and inspection execution</p>
                </div>
                <div className="flex items-center space-x-3">
                    <div className="flex space-x-1 bg-slate-100 rounded-xl p-1">
                        <button onClick={() => setViewMode('calendar')} className={`px-3 py-1.5 text-xs rounded-lg transition-all ${viewMode === 'calendar' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}><LayoutGrid size={14} /></button>
                        <button onClick={() => setViewMode('list')} className={`px-3 py-1.5 text-xs rounded-lg transition-all ${viewMode === 'list' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}><List size={14} /></button>
                    </div>
                    <button onClick={() => setShowNew(true)} className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white text-sm font-semibold rounded-lg hover:bg-primary-700 transition-colors shadow-sm">
                        <Plus size={16} />Schedule Inspection
                    </button>
                </div>
            </div>

            {/* ── KPI Row ── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Kpi label="Scheduled" value={summary.inspections_scheduled} icon={CalendarDays} color="text-blue-500" bg="bg-blue-50" />
                <Kpi label="Completed YTD" value={summary.inspections_completed_ytd} icon={CheckCircle} color="text-emerald-500" bg="bg-emerald-50" />
                <Kpi label="Overdue" value={summary.inspections_overdue} icon={AlertTriangle} color="text-red-500" bg="bg-red-50" />
                <Kpi label="Compliance" value={`${summary.inspections_overdue === 0 ? 100 : Math.round(((summary.inspections_scheduled + summary.inspections_completed_ytd) / (summary.inspections_scheduled + summary.inspections_completed_ytd + summary.inspections_overdue)) * 100)}%`} icon={Clock} />
            </div>

            {/* ── NDE Legend + Filters ── */}
            <div className="flex flex-wrap items-center gap-3">
                <div className="flex flex-wrap gap-2 flex-1">
                    {Object.entries(NDT_COLOR).map(([k, v]) => (
                        <button key={k} onClick={() => setNdeFilter(prev => prev === k ? 'all' : k as InspectionType)}
                            className={`flex items-center text-[10px] font-medium px-2 py-1 rounded-md border transition-all ${ndeFilter === k ? 'border-primary-400 bg-primary-50 text-primary-700' : 'border-transparent text-slate-600 hover:bg-slate-50'}`}
                        >
                            <span className={`w-3 h-3 rounded-sm ${v} mr-1.5`} />{k}
                        </button>
                    ))}
                </div>
                <select
                    value={statusFilter}
                    onChange={e => setStatusFilter(e.target.value as any)}
                    className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-300"
                >
                    <option value="all">All Statuses</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="in_progress">In Progress</option>
                    <option value="overdue">Overdue</option>
                    <option value="completed">Completed</option>
                    <option value="deferred">Deferred</option>
                    <option value="cancelled">Cancelled</option>
                </select>
            </div>

            {/* ── Calendar View ── */}
            {viewMode === 'calendar' ? (
                <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
                    <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-widest mb-4">
                        {now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                    </h3>
                    <div className="grid grid-cols-7 gap-1">
                        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                            <div key={d} className="text-center text-[10px] text-slate-500 uppercase py-2 font-bold">{d}</div>
                        ))}
                        {Array.from({ length: firstDow }).map((_, i) => <div key={`e-${i}`} className="h-20" />)}
                        {Array.from({ length: daysInMonth }).map((_, i) => {
                            const day = i + 1;
                            const dayEvents = inspections.filter(ins => {
                                const id = new Date(ins.scheduled_date);
                                return id.getDate() === day && id.getMonth() === now.getMonth() && id.getFullYear() === now.getFullYear();
                            });
                            return (
                                <div key={day} className={`h-20 rounded-lg border ${day === now.getDate() ? 'border-primary-300 bg-primary-50/50' : 'border-slate-100'} p-1`}>
                                    <span className="text-[10px] text-slate-600 font-mono">{day}</span>
                                    <div className="flex flex-wrap gap-0.5 mt-0.5">
                                        {dayEvents.map(de => (
                                            <button
                                                key={de.id}
                                                onClick={() => navigate(`/comply/inspections/${de.id}`)}
                                                className={`w-3 h-3 rounded-full ${NDT_COLOR[de.inspection_type] || 'bg-gray-500'} hover:ring-2 hover:ring-primary-300 transition-all cursor-pointer`}
                                                title={`${de.inspection_type} — ${getAssetName(de.asset_id)} (${de.status})`}
                                            />
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ) : (
                /* ── List View ── */
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                    <table className="w-full text-sm text-left">
                        <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                            <tr>
                                <th className="px-5 py-3.5">Asset</th>
                                <th className="px-5 py-3.5">NDE</th>
                                <th className="px-5 py-3.5">Code</th>
                                <th className="px-5 py-3.5">Date</th>
                                <th className="px-5 py-3.5">Status</th>
                                <th className="px-5 py-3.5">Inspector</th>
                                <th className="px-5 py-3.5 text-right">Findings</th>
                                <th className="px-5 py-3.5 w-10"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {filtered.map(ins => {
                                const sc = STATUS_CFG[ins.status] || STATUS_CFG.scheduled;
                                return (
                                    <tr
                                        key={ins.id}
                                        onClick={() => navigate(`/comply/inspections/${ins.id}`)}
                                        className="hover:bg-primary-50/40 transition-colors cursor-pointer group"
                                    >
                                        <td className="px-5 py-3.5">
                                            <p className="text-slate-800 text-xs font-semibold">{ins.asset_name || getAssetName(ins.asset_id)}</p>
                                            <p className="text-[10px] text-slate-400 font-mono mt-0.5">{ins.asset_id}</p>
                                        </td>
                                        <td className="px-5 py-3.5">
                                            <span className={`px-2 py-0.5 text-[10px] font-bold text-white rounded ${NDT_COLOR[ins.inspection_type] || 'bg-gray-500'}`}>
                                                {ins.inspection_type}
                                            </span>
                                        </td>
                                        <td className="px-5 py-3.5">
                                            <span className="text-[10px] text-slate-500 font-medium">{ins.governing_code || '—'}</span>
                                        </td>
                                        <td className="px-5 py-3.5 font-mono text-xs text-slate-600">
                                            {new Date(ins.scheduled_date).toLocaleDateString()}
                                        </td>
                                        <td className="px-5 py-3.5">
                                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full border ${sc.cls}`}>
                                                {sc.icon} {sc.label}
                                            </span>
                                        </td>
                                        <td className="px-5 py-3.5 text-slate-500 text-xs">{ins.inspector}</td>
                                        <td className="px-5 py-3.5 text-right">
                                            <span className={`font-mono text-xs font-bold ${ins.findings_count > 0 ? 'text-orange-600' : 'text-slate-400'}`}>
                                                {ins.findings_count}
                                            </span>
                                        </td>
                                        <td className="px-5 py-3.5">
                                            <ChevronRight size={14} className="text-slate-300 group-hover:text-primary-500 transition-colors" />
                                        </td>
                                    </tr>
                                );
                            })}
                            {filtered.length === 0 && (
                                <tr>
                                    <td colSpan={8} className="px-5 py-12 text-center">
                                        <Eye size={28} className="mx-auto text-slate-300 mb-2" />
                                        <p className="text-sm text-slate-500 font-medium">No inspections match filters</p>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            {/* ── New Inspection Modal ── */}
            {showNew && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setShowNew(false)}>
                    <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg mx-4 shadow-2xl animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-primary-50 rounded-lg text-primary-600"><CalendarDays size={20} /></div>
                                <div>
                                    <h2 className="text-lg font-bold text-slate-800">Schedule Inspection</h2>
                                    <p className="text-xs text-slate-500 mt-0.5">Plan an NDT inspection event</p>
                                </div>
                            </div>
                            <button onClick={() => setShowNew(false)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"><X size={18} /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Target Asset</label>
                                <select value={form.asset_id} onChange={e => setForm(f => ({ ...f, asset_id: e.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500">
                                    <option value="">Select asset…</option>{assetOptions.map(a => <option key={a.id} value={a.id}>{a.tag} — {a.name}</option>)}
                                </select>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">NDE Method</label>
                                    <select value={form.inspection_type} onChange={e => setForm(f => ({ ...f, inspection_type: e.target.value as InspectionType }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500">
                                        {['UT', 'PAUT', 'MFL', 'VT', 'PT', 'RT', 'MT'].map(t => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Governing Code</label>
                                    <select value={form.governing_code} onChange={e => setForm(f => ({ ...f, governing_code: e.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500">
                                        <option value="">None</option>
                                        <option value="API 510">API 510 — Pressure Vessels</option>
                                        <option value="API 570">API 570 — Piping</option>
                                        <option value="API 653">API 653 — Tanks</option>
                                        <option value="ASME B31.3">ASME B31.3 — Process Piping</option>
                                    </select>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Scheduled Date</label>
                                    <input type="date" value={form.scheduled_date} onChange={e => setForm(f => ({ ...f, scheduled_date: e.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Inspector</label>
                                    <input type="text" value={form.inspector} onChange={e => setForm(f => ({ ...f, inspector: e.target.value }))} placeholder="e.g. D. Chen" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Description</label>
                                <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Inspection scope and objectives…" rows={2} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 resize-none" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Approval Mode</label>
                                <div className="flex gap-3">
                                    {(['simple', 'two_step'] as const).map(mode => (
                                        <label key={mode} className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-all ${form.approval_mode === mode ? 'border-primary-400 bg-primary-50 text-primary-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                                            <input type="radio" name="approval" value={mode} checked={form.approval_mode === mode} onChange={() => setForm(f => ({ ...f, approval_mode: mode }))} className="sr-only" />
                                            <span className={`w-3 h-3 rounded-full border-2 ${form.approval_mode === mode ? 'border-primary-500 bg-primary-500' : 'border-slate-300'}`} />
                                            <span className="text-xs font-semibold">{mode === 'simple' ? 'Simple' : '2-Step'}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div className="p-6 border-t border-slate-200 flex justify-end space-x-3">
                            <button onClick={() => setShowNew(false)} className="px-4 py-2.5 text-sm text-slate-500 hover:text-slate-700 transition-colors">Cancel</button>
                            <button onClick={handleSubmit} disabled={!form.asset_id || !form.scheduled_date || !form.inspector} className="px-6 py-2.5 bg-primary-600 text-white text-sm font-semibold rounded-lg hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm">
                                Schedule
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

function Kpi({ label, value, icon: Icon, color = 'text-accent-blue', bg = 'bg-blue-50' }: any) {
    return (
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-center shadow-sm hover:shadow-md transition-shadow">
            <div className={`p-3 rounded-lg ${bg} ${color} mr-4`}><Icon size={24} /></div>
            <div>
                <p className="text-slate-500 text-xs uppercase tracking-wider font-semibold mb-1">{label}</p>
                <h3 className="text-2xl font-bold text-slate-800 tracking-tight">{value}</h3>
            </div>
        </div>
    );
}
