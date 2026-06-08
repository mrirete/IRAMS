import React, { useState } from 'react';
import { Lock, Shield, CheckCircle, Clock, FileText, XCircle, Plus, X } from 'lucide-react';
import { useSafety } from '../hooks/useSafety';
import { useAssetLookup } from '../hooks/useAssetLookup';
import type { LOTOPermit, IsolationType } from '../types/safety';

export const LotoPage: React.FC = () => {
    const { lotoPermits, summary, addLotoPermit } = useSafety();
    const { assetOptions, getAssetName } = useAssetLookup();
    const [selected, setSelected] = useState<LOTOPermit | null>(null);
    const [showNew, setShowNew] = useState(false);
    const [form, setForm] = useState({ asset_id: '', isolation_type: 'electrical' as IsolationType, work_description: '', authorized_by: '' });

    const handleSubmit = () => {
        if (!form.asset_id || !form.work_description || !form.authorized_by) return;
        const assetName = getAssetName(form.asset_id);
        const seq = lotoPermits.length + 1;
        const permit: LOTOPermit = {
            id: `loto-${Date.now()}`, permit_number: `LOTO-2026-${String(40 + seq).padStart(3, '0')}`,
            asset_id: form.asset_id, asset_name: assetName || form.asset_id,
            isolation_type: form.isolation_type, status: 'draft', blind_list: [], padlocks: [],
            authorized_by: form.authorized_by, issued_date: new Date().toISOString(),
            cleared_date: null, work_description: form.work_description,
        };
        addLotoPermit(permit);
        setForm({ asset_id: '', isolation_type: 'electrical', work_description: '', authorized_by: '' });
        setShowNew(false);
    };

    const statusBadge = (s: string) => {
        if (s === 'active') return 'text-green-400 bg-green-400/10';
        if (s === 'issued') return 'text-blue-400 bg-blue-400/10';
        if (s === 'draft') return 'text-slate-500 bg-slate-100';
        return 'text-slate-400 bg-brand-800';
    };

    return (
        <div className="space-y-6 pb-20">
            <div className="flex justify-between items-center">
                <div><h1 className="text-2xl font-bold text-slate-800 tracking-tight">Lockout / Tagout</h1><p className="text-slate-500 text-sm mt-1">OSHA 1910.147 — Energy isolation permits and safe-to-work authorizations</p></div>
                <button onClick={() => setShowNew(true)} className="btn-primary"><Plus size={16} className="mr-2" />New LOTO Permit</button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Kpi label="Active Permits" value={summary.active_loto_permits} icon={Lock} color="text-green-400" bg="bg-green-500/10" />
                <Kpi label="Pending Clearance" value={summary.pending_clearance} icon={Clock} color="text-yellow-400" bg="bg-yellow-500/10" />
                <Kpi label="Draft" value={lotoPermits.filter(l => l.status === 'draft').length} icon={FileText} />
                <Kpi label="Cleared (Recent)" value={lotoPermits.filter(l => l.status === 'cleared').length} icon={CheckCircle} />
            </div>

            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm text-left">
                    <thead className="text-xs text-slate-500 uppercase bg-brand-800/50 border-b border-slate-200">
                        <tr><th className="px-6 py-4">Permit #</th><th className="px-6 py-4">Equipment</th><th className="px-6 py-4">Isolation Type</th><th className="px-6 py-4">Status</th><th className="px-6 py-4">Blinds</th><th className="px-6 py-4">Padlocks</th><th className="px-6 py-4 text-right">Authorized By</th></tr>
                    </thead>
                    <tbody className="divide-y divide-brand-700/50">
                        {lotoPermits.map(l => (
                            <tr key={l.id} onClick={() => setSelected(l)} className="hover:bg-slate-100/30 cursor-pointer transition-colors">
                                <td className="px-6 py-4 font-mono text-slate-800 font-medium">{l.permit_number}</td>
                                <td className="px-6 py-4 text-brand-200">{l.asset_name}</td>
                                <td className="px-6 py-4"><span className="px-2 py-1 text-xs bg-slate-100 text-brand-300 rounded capitalize">{l.isolation_type}</span></td>
                                <td className="px-6 py-4"><span className={`px-2 py-1 text-xs font-semibold rounded capitalize ${statusBadge(l.status)}`}>{l.status}</span></td>
                                <td className="px-6 py-4 font-mono text-brand-300">{l.blind_list.length}</td>
                                <td className="px-6 py-4 font-mono text-brand-300">{l.padlocks.length}</td>
                                <td className="px-6 py-4 text-right text-slate-500">{l.authorized_by || '—'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {selected && (
                <div className="fixed inset-y-0 right-0 w-[520px] bg-slate-50 border-l border-slate-200 shadow-2xl z-40 flex flex-col pt-16 mt-2">
                    <div className="flex justify-between items-center px-6 py-5 border-b border-brand-800 bg-brand-950">
                        <div><h2 className="text-lg font-bold text-white">{selected.permit_number}</h2><p className="text-slate-500 text-sm">{selected.asset_name}</p></div>
                        <button onClick={() => setSelected(null)} className="text-slate-500 hover:text-white"><XCircle size={24} /></button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-6 space-y-6">
                        <div className="bg-brand-800 p-4 rounded-lg border border-slate-200"><p className="text-[10px] text-slate-400 uppercase font-semibold mb-1">Work Description</p><p className="text-brand-200 text-sm">{selected.work_description}</p></div>
                        <section>
                            <h3 className="text-xs font-semibold text-brand-300 uppercase tracking-widest mb-3 flex items-center"><Shield size={14} className="mr-2 text-accent-cyan" />Blind List</h3>
                            <div className="space-y-2">{selected.blind_list.length ? selected.blind_list.map((b, i) => <div key={i} className="bg-brand-800 p-3 rounded border border-slate-200 text-brand-200 text-sm font-mono">{b}</div>) : <p className="text-slate-400 text-sm italic">No blinds specified</p>}</div>
                        </section>
                        <section>
                            <h3 className="text-xs font-semibold text-brand-300 uppercase tracking-widest mb-3 flex items-center"><Lock size={14} className="mr-2 text-accent-cyan" />Padlock Registry</h3>
                            <div className="space-y-2">{selected.padlocks.length ? selected.padlocks.map(p => (
                                <div key={p.padlock_id} className="bg-brand-800 p-3 rounded border border-slate-200 flex justify-between items-center">
                                    <div><p className="text-slate-800 font-mono text-sm">{p.padlock_id}</p><p className="text-slate-400 text-xs">{p.assigned_to}</p></div>
                                    <div className="text-right text-xs font-mono">{p.unlocked_date ? <span className="text-slate-500">Returned {new Date(p.unlocked_date).toLocaleDateString()}</span> : <span className="text-yellow-400 font-semibold">🔒 Active</span>}</div>
                                </div>
                            )) : <p className="text-slate-400 text-sm italic">No padlocks assigned</p>}</div>
                        </section>
                        {selected.status === 'active' && (
                            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
                                <p className="text-yellow-300 text-sm font-semibold mb-2">⚠ Gatekeeper Authorization Required</p>
                                <p className="text-yellow-400/70 text-xs mb-3">Clearing this LOTO permit requires verification that all energy sources are de-isolated and safe-to-work conditions are restored.</p>
                                <button className="px-4 py-2 bg-yellow-500/20 text-yellow-300 border border-yellow-500/30 rounded-lg text-sm font-semibold hover:bg-yellow-500/30 transition-colors">Authorize Safe-to-Work Clearance</button>
                                <p className="text-yellow-500/50 text-[10px] mt-2 uppercase tracking-wider">Human-In-The-Loop: Digital sign-off required</p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {showNew && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowNew(false)}>
                    <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
                            <div className="flex items-center gap-3"><div className="p-2 bg-accent-cyan/10 rounded-lg text-accent-cyan"><Lock size={20} /></div><div><h2 className="text-lg font-bold text-slate-800">New LOTO Permit</h2><p className="text-xs text-slate-500 mt-0.5">OSHA 1910.147 energy isolation</p></div></div>
                            <button onClick={() => setShowNew(false)} className="p-1.5 text-slate-500 hover:text-brand-200 hover:bg-slate-100 rounded-lg transition-colors"><X size={18} /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div><label className="block text-xs font-bold text-brand-300 uppercase tracking-wider mb-2">Equipment</label>
                                <select value={form.asset_id} onChange={e => setForm(f => ({ ...f, asset_id: e.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500">
                                    <option value="">Select equipment…</option>{assetOptions.map(a => <option key={a.id} value={a.id}>{a.tag} — {a.name}</option>)}
                                </select>
                            </div>
                            <div><label className="block text-xs font-bold text-brand-300 uppercase tracking-wider mb-2">Isolation Type</label>
                                <select value={form.isolation_type} onChange={e => setForm(f => ({ ...f, isolation_type: e.target.value as IsolationType }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500">
                                    <option value="electrical">Electrical</option><option value="mechanical">Mechanical</option><option value="process">Process</option><option value="pneumatic">Pneumatic</option><option value="hydraulic">Hydraulic</option>
                                </select>
                            </div>
                            <div><label className="block text-xs font-bold text-brand-300 uppercase tracking-wider mb-2">Work Description</label>
                                <textarea value={form.work_description} onChange={e => setForm(f => ({ ...f, work_description: e.target.value }))} rows={3} placeholder="Describe the work requiring isolation…" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500 resize-none" />
                            </div>
                            <div><label className="block text-xs font-bold text-brand-300 uppercase tracking-wider mb-2">Authorized By</label>
                                <input type="text" value={form.authorized_by} onChange={e => setForm(f => ({ ...f, authorized_by: e.target.value }))} placeholder="e.g. S. Jenkins" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500" />
                            </div>
                        </div>
                        <div className="p-6 border-t border-slate-200 flex justify-end space-x-3">
                            <button onClick={() => setShowNew(false)} className="px-4 py-2.5 text-sm text-slate-500 hover:text-brand-200 transition-colors">Cancel</button>
                            <button onClick={handleSubmit} disabled={!form.asset_id || !form.work_description || !form.authorized_by} className="px-6 py-2.5 bg-accent-cyan text-white text-sm font-semibold rounded-lg hover:bg-accent-cyan/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Create Draft Permit</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

function Kpi({ label, value, icon: Icon, color = 'text-accent-blue', bg = 'bg-accent-blue/10' }: any) {
    return (<div className="bg-white border border-slate-200 rounded-lg p-5 flex items-center shadow-sm"><div className={`p-3 rounded-md ${bg} ${color} mr-4`}><Icon size={24} /></div><div><p className="text-slate-400 text-xs uppercase tracking-wider font-semibold mb-1">{label}</p><h3 className="text-2xl font-bold text-brand-50 tracking-tight">{value}</h3></div></div>);
}
