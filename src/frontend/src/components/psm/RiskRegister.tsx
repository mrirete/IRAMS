/**
 * RiskRegister — ISO 31000:2018 Master Risk Log
 *
 * Pre/post assessment with 5×5 risk matrix heatmap,
 * category filtering, and full CRUD.
 */
import React, { useState, useEffect } from 'react';
import {
    Plus, Trash2, Edit3, Check, X, Filter, Search,
    AlertTriangle, Shield, BarChart3,
} from 'lucide-react';
import psmService, { getRiskLevel, RISK_COLORS as LEVEL_COLORS } from '../../eam/services/PSMService';
import type { RiskRegisterEntry, RiskCategory, RiskStatus } from '../../types/safety';

const CATEGORIES: RiskCategory[] = ['safety', 'environmental', 'financial', 'operational', 'reputational'];
const STATUSES: RiskStatus[] = ['open', 'mitigated', 'accepted', 'closed', 'escalated'];

const CATEGORY_COLORS: Record<RiskCategory, string> = {
    safety: 'bg-red-50 text-red-600 border-red-200',
    environmental: 'bg-green-50 text-green-600 border-green-200',
    financial: 'bg-blue-50 text-blue-600 border-blue-200',
    operational: 'bg-amber-50 text-amber-600 border-amber-200',
    reputational: 'bg-purple-50 text-purple-600 border-purple-200',
};

const STATUS_COLORS: Record<RiskStatus, string> = {
    open: 'bg-blue-100 text-blue-700',
    mitigated: 'bg-emerald-100 text-emerald-700',
    accepted: 'bg-amber-100 text-amber-700',
    closed: 'bg-slate-100 text-slate-500',
    escalated: 'bg-red-100 text-red-700',
};

// ═══════════════════════════════════════════════════════════════
//  5×5 Risk Heatmap
// ═══════════════════════════════════════════════════════════════

function RiskHeatmap({ data, title }: { data: number[][]; title: string }) {
    const cellColor = (s: number, l: number) => {
        const score = (s + 1) * (l + 1);
        if (score >= 15) return 'bg-red-500 text-white';
        if (score >= 10) return 'bg-orange-400 text-white';
        if (score >= 6)  return 'bg-amber-300 text-slate-800';
        if (score >= 3)  return 'bg-yellow-200 text-slate-700';
        return 'bg-emerald-100 text-slate-600';
    };

    return (
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <h3 className="text-xs font-semibold text-slate-600 mb-3">{title}</h3>
            <div className="overflow-x-auto">
                <table className="text-[10px]">
                    <thead>
                        <tr>
                            <th className="p-1 w-16"></th>
                            {[1,2,3,4,5].map(l => (
                                <th key={l} className="p-1 text-center text-slate-400 font-normal w-10">L{l}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {[4,3,2,1,0].map(s => (
                            <tr key={s}>
                                <td className="p-1 text-slate-400 text-right pr-2">S{s + 1}</td>
                                {[0,1,2,3,4].map(l => (
                                    <td key={l} className="p-0.5">
                                        <div className={`w-10 h-8 rounded flex items-center justify-center font-bold ${cellColor(s, l)}`}>
                                            {data[s][l] > 0 ? data[s][l] : ''}
                                        </div>
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
                <div className="flex items-center justify-between mt-1 text-[9px] text-slate-400">
                    <span>← Low Likelihood</span>
                    <span>High Likelihood →</span>
                </div>
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════
//  Add/Edit Modal
// ═══════════════════════════════════════════════════════════════

function RiskModal({ entry, onSave, onCancel }: {
    entry: Partial<RiskRegisterEntry>;
    onSave: (data: Partial<RiskRegisterEntry>) => void;
    onCancel: () => void;
}) {
    const [form, setForm] = useState(entry);

    return (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6 space-y-4">
                <h2 className="text-lg font-bold text-slate-800">{entry.id ? 'Edit Risk' : 'New Risk Entry'}</h2>

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="text-[10px] font-semibold text-slate-500 uppercase mb-1 block">Risk ID</label>
                        <input value={form.risk_id_code || ''} onChange={e => setForm(f => ({ ...f, risk_id_code: e.target.value }))}
                            className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2" placeholder="e.g. RR-2026-001" />
                    </div>
                    <div>
                        <label className="text-[10px] font-semibold text-slate-500 uppercase mb-1 block">Category</label>
                        <select value={form.category || 'safety'} onChange={e => setForm(f => ({ ...f, category: e.target.value as RiskCategory }))}
                            className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2">
                            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                </div>

                <div>
                    <label className="text-[10px] font-semibold text-slate-500 uppercase mb-1 block">Description</label>
                    <textarea value={form.description || ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                        className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 min-h-[60px]" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="text-[10px] font-semibold text-slate-500 uppercase mb-1 block">Cause</label>
                        <textarea value={form.cause || ''} onChange={e => setForm(f => ({ ...f, cause: e.target.value }))}
                            className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 min-h-[40px]" />
                    </div>
                    <div>
                        <label className="text-[10px] font-semibold text-slate-500 uppercase mb-1 block">Consequence</label>
                        <textarea value={form.consequence || ''} onChange={e => setForm(f => ({ ...f, consequence: e.target.value }))}
                            className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 min-h-[40px]" />
                    </div>
                </div>

                {/* Pre-mitigation */}
                <div className="bg-red-50/30 rounded-lg p-3 border border-red-100">
                    <span className="text-[10px] font-bold text-red-600 uppercase">Pre-Mitigation</span>
                    <div className="grid grid-cols-2 gap-3 mt-2">
                        <div>
                            <label className="text-[10px] text-slate-500 mb-1 block">Severity (1–5)</label>
                            <select value={form.pre_severity ?? ''} onChange={e => setForm(f => ({ ...f, pre_severity: e.target.value ? Number(e.target.value) : null }))}
                                className="w-full text-xs border rounded px-2 py-1.5">
                                <option value="">—</option>
                                {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-[10px] text-slate-500 mb-1 block">Likelihood (1–5)</label>
                            <select value={form.pre_likelihood ?? ''} onChange={e => setForm(f => ({ ...f, pre_likelihood: e.target.value ? Number(e.target.value) : null }))}
                                className="w-full text-xs border rounded px-2 py-1.5">
                                <option value="">—</option>
                                {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
                            </select>
                        </div>
                    </div>
                </div>

                <div>
                    <label className="text-[10px] font-semibold text-slate-500 uppercase mb-1 block">Controls / Mitigations</label>
                    <textarea value={form.controls || ''} onChange={e => setForm(f => ({ ...f, controls: e.target.value }))}
                        className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 min-h-[40px]" />
                </div>

                {/* Post-mitigation */}
                <div className="bg-emerald-50/30 rounded-lg p-3 border border-emerald-100">
                    <span className="text-[10px] font-bold text-emerald-600 uppercase">Post-Mitigation</span>
                    <div className="grid grid-cols-2 gap-3 mt-2">
                        <div>
                            <label className="text-[10px] text-slate-500 mb-1 block">Severity (1–5)</label>
                            <select value={form.post_severity ?? ''} onChange={e => setForm(f => ({ ...f, post_severity: e.target.value ? Number(e.target.value) : null }))}
                                className="w-full text-xs border rounded px-2 py-1.5">
                                <option value="">—</option>
                                {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-[10px] text-slate-500 mb-1 block">Likelihood (1–5)</label>
                            <select value={form.post_likelihood ?? ''} onChange={e => setForm(f => ({ ...f, post_likelihood: e.target.value ? Number(e.target.value) : null }))}
                                className="w-full text-xs border rounded px-2 py-1.5">
                                <option value="">—</option>
                                {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
                            </select>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="text-[10px] font-semibold text-slate-500 uppercase mb-1 block">Risk Owner</label>
                        <input value={form.risk_owner || ''} onChange={e => setForm(f => ({ ...f, risk_owner: e.target.value }))}
                            className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2" />
                    </div>
                    <div>
                        <label className="text-[10px] font-semibold text-slate-500 uppercase mb-1 block">Status</label>
                        <select value={form.status || 'open'} onChange={e => setForm(f => ({ ...f, status: e.target.value as RiskStatus }))}
                            className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2">
                            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                    <button onClick={onCancel} className="text-xs px-4 py-2 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Cancel</button>
                    <button onClick={() => onSave(form)} className="text-xs px-4 py-2 bg-teal-500 text-white rounded-lg hover:bg-teal-600">Save</button>
                </div>
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════
//  Main Risk Register
// ═══════════════════════════════════════════════════════════════

const RiskRegister: React.FC = () => {
    const [entries, setEntries] = useState<RiskRegisterEntry[]>([]);
    const [heatmap, setHeatmap] = useState<{ pre: number[][]; post: number[][] }>({
        pre: Array.from({ length: 5 }, () => Array(5).fill(0)),
        post: Array.from({ length: 5 }, () => Array(5).fill(0)),
    });
    const [filterCat, setFilterCat] = useState<RiskCategory | ''>('');
    const [filterStatus, setFilterStatus] = useState<RiskStatus | ''>('');
    const [search, setSearch] = useState('');
    const [editingEntry, setEditingEntry] = useState<Partial<RiskRegisterEntry> | null>(null);

    const fetchData = async () => {
        const filters: any = {};
        if (filterCat) filters.category = filterCat;
        if (filterStatus) filters.status = filterStatus;
        const data = await psmService.getRiskRegisterEntries(filters);
        setEntries(data);
        const hm = await psmService.getRiskHeatmap();
        setHeatmap(hm);
    };

    useEffect(() => { fetchData(); }, [filterCat, filterStatus]);

    const handleSave = async (data: Partial<RiskRegisterEntry>) => {
        if (data.id) {
            await psmService.updateRiskEntry(data.id, data);
        } else {
            await psmService.createRiskEntry(data);
        }
        setEditingEntry(null);
        fetchData();
    };

    const handleDelete = async (id: string) => {
        await psmService.deleteRiskEntry(id);
        fetchData();
    };

    const filtered = entries.filter(e =>
        e.description?.toLowerCase().includes(search.toLowerCase()) ||
        e.risk_id_code?.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                    <div>
                        <h2 className="text-lg font-bold text-slate-800">Risk Register</h2>
                        <p className="text-xs text-slate-400 mt-0.5">ISO 31000:2018 — Master Risk Log</p>
                    </div>
                    <button onClick={() => setEditingEntry({ status: 'open', category: 'safety' })}
                        className="flex items-center gap-1 text-xs font-medium text-white bg-gradient-to-r from-teal-500 to-cyan-500 px-3 py-1.5 rounded-lg hover:shadow-md transition-all">
                        <Plus size={12} /> New Risk
                    </button>
                </div>
                {/* Filters */}
                <div className="flex items-center gap-3">
                    <div className="relative flex-1">
                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300" />
                        <input value={search} onChange={e => setSearch(e.target.value)}
                            className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg" placeholder="Search risks..." />
                    </div>
                    <select value={filterCat} onChange={e => setFilterCat(e.target.value as RiskCategory | '')}
                        className="text-xs border border-slate-200 rounded-lg px-2 py-1.5">
                        <option value="">All Categories</option>
                        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as RiskStatus | '')}
                        className="text-xs border border-slate-200 rounded-lg px-2 py-1.5">
                        <option value="">All Statuses</option>
                        {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                </div>
            </div>

            {/* Heatmaps */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <RiskHeatmap data={heatmap.pre} title="Pre-Mitigation Risk Matrix" />
                <RiskHeatmap data={heatmap.post} title="Post-Mitigation Risk Matrix" />
            </div>

            {/* Risk table */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-slate-50 border-b border-slate-100">
                                <th className="p-3 text-[10px] text-slate-500 font-semibold uppercase">Risk ID</th>
                                <th className="p-3 text-[10px] text-slate-500 font-semibold uppercase">Category</th>
                                <th className="p-3 text-[10px] text-slate-500 font-semibold uppercase">Description</th>
                                <th className="p-3 text-[10px] text-slate-500 font-semibold uppercase text-center">Pre Risk</th>
                                <th className="p-3 text-[10px] text-slate-500 font-semibold uppercase text-center">Post Risk</th>
                                <th className="p-3 text-[10px] text-slate-500 font-semibold uppercase">Owner</th>
                                <th className="p-3 text-[10px] text-slate-500 font-semibold uppercase">Status</th>
                                <th className="p-3 text-[10px] text-slate-500 font-semibold uppercase w-20"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map(entry => {
                                const preLevel = entry.pre_risk_score ? getRiskLevel(entry.pre_risk_score) : null;
                                const postLevel = entry.post_risk_score ? getRiskLevel(entry.post_risk_score) : null;
                                return (
                                    <tr key={entry.id} className="border-b border-slate-50 group hover:bg-slate-50/50">
                                        <td className="p-3 text-xs font-mono text-blue-600">{entry.risk_id_code}</td>
                                        <td className="p-3">
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${CATEGORY_COLORS[entry.category]}`}>
                                                {entry.category}
                                            </span>
                                        </td>
                                        <td className="p-3 text-xs text-slate-700 max-w-[200px] truncate" title={entry.description}>{entry.description}</td>
                                        <td className="p-3 text-center">
                                            {entry.pre_risk_score != null && (
                                                <span className="text-xs font-bold px-2 py-0.5 rounded" style={{
                                                    backgroundColor: preLevel ? LEVEL_COLORS[preLevel] + '20' : undefined,
                                                    color: preLevel ? LEVEL_COLORS[preLevel] : undefined,
                                                }}>
                                                    {entry.pre_risk_score}
                                                </span>
                                            )}
                                        </td>
                                        <td className="p-3 text-center">
                                            {entry.post_risk_score != null && (
                                                <span className="text-xs font-bold px-2 py-0.5 rounded" style={{
                                                    backgroundColor: postLevel ? LEVEL_COLORS[postLevel] + '20' : undefined,
                                                    color: postLevel ? LEVEL_COLORS[postLevel] : undefined,
                                                }}>
                                                    {entry.post_risk_score}
                                                </span>
                                            )}
                                        </td>
                                        <td className="p-3 text-xs text-slate-500">{entry.risk_owner}</td>
                                        <td className="p-3">
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${STATUS_COLORS[entry.status]}`}>
                                                {entry.status}
                                            </span>
                                        </td>
                                        <td className="p-3">
                                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button onClick={() => setEditingEntry(entry)}
                                                    className="p-1 hover:bg-slate-100 rounded"><Edit3 size={12} className="text-slate-400" /></button>
                                                <button onClick={() => handleDelete(entry.id)}
                                                    className="p-1 hover:bg-red-50 rounded"><Trash2 size={12} className="text-slate-400 hover:text-red-500" /></button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                            {filtered.length === 0 && (
                                <tr><td colSpan={8} className="p-8 text-center text-slate-400 text-xs">No risk entries found</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Modal */}
            {editingEntry && (
                <RiskModal entry={editingEntry} onSave={handleSave} onCancel={() => setEditingEntry(null)} />
            )}
        </div>
    );
};

export default RiskRegister;
