import React, { useState } from 'react';
import { Brain, AlertTriangle, Plus, X } from 'lucide-react';
import { useIntegrity } from '../hooks/useIntegrity';
import type { DamageMechanism, DamageMechStatusType } from '../types/integrity';

export const DamageMechanismsPage: React.FC = () => {
    const { damageMechanisms, summary, addDamageMechanism } = useIntegrity();
    const [showNew, setShowNew] = useState(false);
    const [form, setForm] = useState({ api_571_code: '', mechanism_name: '', description: '', status: 'susceptible' as DamageMechStatusType, affected_asset_ids: '' });

    const handleSubmit = () => {
        if (!form.mechanism_name || !form.api_571_code) return;
        const dm: DamageMechanism = {
            id: `dm-${Date.now()}`, api_571_code: form.api_571_code, mechanism_name: form.mechanism_name,
            description: form.description, status: form.status, source: 'engineer_confirmed',
            affected_asset_ids: form.affected_asset_ids.split(',').map(s => s.trim()).filter(Boolean),
        };
        addDamageMechanism(dm);
        setForm({ api_571_code: '', mechanism_name: '', description: '', status: 'susceptible', affected_asset_ids: '' });
        setShowNew(false);
    };

    const statusBadge = (s: string) => {
        if (s === 'active') return 'text-red-700 bg-red-50 border border-red-200';
        if (s === 'susceptible') return 'text-amber-700 bg-amber-50 border border-amber-200';
        if (s === 'latent') return 'text-blue-700 bg-blue-50 border border-blue-200';
        return 'text-slate-600 bg-slate-100 border border-slate-200';
    };

    const sourceBadge = (s: string) => {
        if (s === 'ai_suggested') return 'text-blue-700 bg-blue-50 border border-blue-200';
        if (s === 'engineer_confirmed') return 'text-emerald-700 bg-emerald-50 border border-emerald-200';
        return 'text-slate-600 bg-slate-100 border border-slate-200';
    };

    return (
        <div className="space-y-6 pb-20">
            <div className="flex justify-between items-center">
                <div><h1 className="text-2xl font-bold text-slate-800 tracking-tight">Damage Mechanisms</h1><p className="text-slate-500 text-sm mt-1">API 571 damage mechanism registry and AI-assisted identification</p></div>
                <button onClick={() => setShowNew(true)} className="btn-primary"><Plus size={16} className="mr-2" />Add Mechanism</button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Kpi label="Active Mechanisms" value={summary.active_damage_mechs} icon={AlertTriangle} color="text-red-500" bg="bg-red-50" />
                <Kpi label="Total Registered" value={damageMechanisms.length} icon={AlertTriangle} />
                <Kpi label="AI Pending Review" value={summary.ai_suggested_pending} icon={Brain} color="text-blue-500" bg="bg-blue-50" />
                <Kpi label="Confirmed" value={damageMechanisms.filter(dm => dm.source === 'engineer_confirmed').length} icon={AlertTriangle} color="text-emerald-500" bg="bg-emerald-50" />
            </div>

            {summary.ai_suggested_pending > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start">
                    <Brain className="text-blue-500 mr-3 flex-shrink-0 mt-0.5" size={20} />
                    <div>
                        <p className="text-blue-800 text-sm font-medium">AI has identified {summary.ai_suggested_pending} potential damage mechanism(s).</p>
                        <p className="text-blue-600 text-xs mt-1">All AI results are <strong>Tier 2 advisory</strong>. Engineer confirmation required before inclusion in official MI program.</p>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {damageMechanisms.map(dm => (
                    <div key={dm.id} className="bg-white border border-slate-200 rounded-xl p-5 hover:shadow-md transition-shadow">
                        <div className="flex justify-between items-start mb-3">
                            <div><h3 className="text-slate-800 font-semibold text-sm">{dm.mechanism_name}</h3><p className="text-slate-400 text-[10px] font-mono mt-0.5">{dm.api_571_code}</p></div>
                            <div className="flex space-x-2">
                                <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full capitalize ${statusBadge(dm.status)}`}>{dm.status}</span>
                                <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full capitalize ${sourceBadge(dm.source)}`}>{dm.source.replace(/_/g, ' ')}</span>
                            </div>
                        </div>
                        <p className="text-slate-600 text-xs leading-relaxed mb-3">{dm.description}</p>
                        <div className="flex flex-wrap gap-1">
                            {dm.affected_asset_ids.map(a => <span key={a} className="px-1.5 py-0.5 text-[10px] bg-slate-100 text-slate-600 rounded font-mono font-medium">{a.toUpperCase()}</span>)}
                        </div>
                    </div>
                ))}
            </div>

            {showNew && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowNew(false)}>
                    <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
                            <div className="flex items-center gap-3"><div className="p-2 bg-primary-50 rounded-lg text-primary-600"><AlertTriangle size={20} /></div><div><h2 className="text-lg font-bold text-slate-800">New Damage Mechanism</h2><p className="text-xs text-slate-500 mt-0.5">API 571 reference classification</p></div></div>
                            <button onClick={() => setShowNew(false)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"><X size={18} /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div className="grid grid-cols-3 gap-4">
                                <div><label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">API 571 Code</label>
                                    <input type="text" value={form.api_571_code} onChange={e => setForm(f => ({ ...f, api_571_code: e.target.value }))} placeholder="e.g. 4.3.3" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500" />
                                </div>
                                <div className="col-span-2"><label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Mechanism Name</label>
                                    <input type="text" value={form.mechanism_name} onChange={e => setForm(f => ({ ...f, mechanism_name: e.target.value }))} placeholder="e.g. CUI (Corrosion Under Insulation)" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500" />
                                </div>
                            </div>
                            <div><label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Description</label>
                                <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} placeholder="Describe the damage mechanism, typical conditions, and risk…" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 resize-none" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div><label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Status</label>
                                    <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as DamageMechStatusType }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500">
                                        <option value="active">Active</option><option value="susceptible">Susceptible</option><option value="latent">Latent</option><option value="not_applicable">Not Applicable</option>
                                    </select>
                                </div>
                                <div><label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Affected Assets</label>
                                    <input type="text" value={form.affected_asset_ids} onChange={e => setForm(f => ({ ...f, affected_asset_ids: e.target.value }))} placeholder="ast-v205, ast-hx405" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500" />
                                </div>
                            </div>
                        </div>
                        <div className="p-6 border-t border-slate-200 flex justify-end space-x-3">
                            <button onClick={() => setShowNew(false)} className="px-4 py-2.5 text-sm text-slate-500 hover:text-slate-700 transition-colors">Cancel</button>
                            <button onClick={handleSubmit} disabled={!form.api_571_code || !form.mechanism_name} className="px-6 py-2.5 bg-primary-600 text-white text-sm font-semibold rounded-lg hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Add Mechanism</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

function Kpi({ label, value, icon: Icon, color = 'text-accent-blue', bg = 'bg-blue-50' }: any) {
    return (<div className="bg-white border border-slate-200 rounded-xl p-5 flex items-center shadow-sm hover:shadow-md transition-shadow"><div className={`p-3 rounded-lg ${bg} ${color} mr-4`}><Icon size={24} /></div><div><p className="text-slate-500 text-xs uppercase tracking-wider font-semibold mb-1">{label}</p><h3 className="text-2xl font-bold text-slate-800 tracking-tight">{value}</h3></div></div>);
}
