import React, { useState } from 'react';
import { Activity, AlertTriangle, CheckCircle, Plus, X, AlertOctagon } from 'lucide-react';
import { useIntegrity } from '../hooks/useIntegrity';
import { useAssetLookup } from '../hooks/useAssetLookup';
import type { IOWParameter, IOWType } from '../types/integrity';

export const IowDashboardPage: React.FC = () => {
    const { iowParameters, summary, addIowParameter } = useIntegrity();
    const { assetOptions, getAssetName } = useAssetLookup();
    const [showNew, setShowNew] = useState(false);
    const [form, setForm] = useState({ asset_id: '', parameter_name: '', iow_type: 'standard' as IOWType, unit: '', low_limit: '', high_limit: '', current_value: '' });

    const handleSubmit = () => {
        if (!form.asset_id || !form.parameter_name || !form.unit || !form.current_value) return;
        const val = parseFloat(form.current_value);
        const lo = form.low_limit ? parseFloat(form.low_limit) : null;
        const hi = form.high_limit ? parseFloat(form.high_limit) : null;
        const breach = (lo !== null && val < lo) || (hi !== null && val > hi);
        const alert = (hi !== null && val > hi * 0.9 && !breach) || (lo !== null && val < lo * 1.1 && !breach);
        const p: IOWParameter = {
            id: `iow-${Date.now()}`, asset_id: form.asset_id, parameter_name: form.parameter_name,
            iow_type: form.iow_type, unit: form.unit, low_limit: lo, high_limit: hi,
            current_value: val, breach_status: breach ? 'breach' : alert ? 'alert' : 'normal',
            last_breach_date: breach ? new Date().toISOString() : null,
        };
        addIowParameter(p);
        setForm({ asset_id: '', parameter_name: '', iow_type: 'standard', unit: '', low_limit: '', high_limit: '', current_value: '' });
        setShowNew(false);
    };

    const breachBanner = iowParameters.filter(p => p.breach_status === 'breach');

    return (
        <div className="space-y-6 pb-20">
            <div className="flex justify-between items-center">
                <div><h1 className="text-2xl font-bold text-slate-800 tracking-tight">Integrity Operating Windows</h1><p className="text-slate-500 text-sm mt-1">Real-time IOW monitoring — critical, standard, and informational parameters</p></div>
                <button onClick={() => setShowNew(true)} className="btn-primary"><Plus size={16} className="mr-2" />Add Parameter</button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Kpi label="Parameters Monitored" value={summary.iow_total} icon={Activity} />
                <Kpi label="Active Breaches" value={summary.iow_breach_count} icon={AlertTriangle} color="text-red-500" bg="bg-red-50" />
                <Kpi label="Alerts" value={iowParameters.filter(p => p.breach_status === 'alert').length} icon={AlertTriangle} color="text-amber-500" bg="bg-amber-50" />
                <Kpi label="Normal" value={iowParameters.filter(p => p.breach_status === 'normal').length} icon={CheckCircle} color="text-emerald-500" bg="bg-emerald-50" />
            </div>

            {breachBanner.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-5">
                    <div className="flex items-start"><AlertOctagon className="text-red-500 mr-3 flex-shrink-0 mt-0.5" size={20} />
                        <div>
                            <p className="text-red-700 text-sm font-bold mb-1">⚠ {breachBanner.length} IOW Breach(es) Active</p>
                            {breachBanner.map(b => <p key={b.id} className="text-red-600 text-xs">{b.parameter_name} — {b.current_value} {b.unit} (limit: {b.high_limit ?? b.low_limit} {b.unit}) on {getAssetName(b.asset_id)}</p>)}
                            <button className="mt-3 px-4 py-2 bg-red-100 text-red-700 border border-red-200 rounded-lg text-sm font-semibold hover:bg-red-200 transition-colors">Generate Emergency WO</button>
                            <p className="text-red-400 text-[10px] mt-2 uppercase tracking-wider">Human-In-The-Loop: Action requires authorized operator approval</p>
                        </div>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {iowParameters.map(p => {
                    const lo = p.low_limit ?? 0;
                    const hi = p.high_limit ?? 100;
                    const range = hi - lo || 1;
                    const pct = Math.max(0, Math.min(100, ((p.current_value - lo) / range) * 100));
                    const gaugeColor = p.breach_status === 'breach' ? 'bg-red-500' : p.breach_status === 'alert' ? 'bg-amber-500' : 'bg-emerald-500';
                    const borderColor = p.breach_status === 'breach' ? 'border-red-200' : p.breach_status === 'alert' ? 'border-amber-200' : 'border-slate-200';
                    const typeBadge = p.iow_type === 'critical' ? 'text-red-600 bg-red-50 border border-red-200' : p.iow_type === 'standard' ? 'text-amber-600 bg-amber-50 border border-amber-200' : 'text-slate-600 bg-slate-100 border border-slate-200';

                    return (
                        <div key={p.id} className={`bg-white border ${borderColor} rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow`}>
                            <div className="flex justify-between items-start mb-3">
                                <div><p className="text-slate-800 font-semibold text-sm">{p.parameter_name}</p><p className="text-slate-400 text-[10px] font-mono">{getAssetName(p.asset_id)}</p></div>
                                <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full uppercase ${typeBadge}`}>{p.iow_type}</span>
                            </div>
                            <div className="flex items-center mb-2">
                                <span className={`text-3xl font-bold font-mono ${p.breach_status === 'breach' ? 'text-red-600' : p.breach_status === 'alert' ? 'text-amber-600' : 'text-slate-800'}`}>{p.current_value}</span>
                                <span className="text-slate-400 text-sm ml-1">{p.unit}</span>
                            </div>
                            <div className="w-full bg-slate-100 rounded-full h-2.5 mb-2 relative">
                                <div className={`h-2.5 rounded-full transition-all ${gaugeColor}`} style={{ width: `${pct}%` }}></div>
                            </div>
                            <div className="flex justify-between text-[10px] text-slate-500">
                                <span>Lo: {p.low_limit !== null ? `${p.low_limit} ${p.unit}` : '—'}</span>
                                <span>Hi: {p.high_limit !== null ? `${p.high_limit} ${p.unit}` : '—'}</span>
                            </div>
                        </div>
                    );
                })}
            </div>

            {showNew && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowNew(false)}>
                    <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
                            <div className="flex items-center gap-3"><div className="p-2 bg-cyan-50 rounded-lg text-cyan-600"><Activity size={20} /></div><div><h2 className="text-lg font-bold text-slate-800">New IOW Parameter</h2><p className="text-xs text-slate-500 mt-0.5">Define an Integrity Operating Window</p></div></div>
                            <button onClick={() => setShowNew(false)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"><X size={18} /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div><label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Target Asset</label>
                                <select value={form.asset_id} onChange={e => setForm(f => ({ ...f, asset_id: e.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500">
                                    <option value="">Select asset…</option>{assetOptions.map(a => <option key={a.id} value={a.id}>{a.tag} — {a.name}</option>)}
                                </select>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div><label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Parameter Name</label>
                                    <input type="text" value={form.parameter_name} onChange={e => setForm(f => ({ ...f, parameter_name: e.target.value }))} placeholder="e.g. Operating Pressure" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500" />
                                </div>
                                <div><label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Unit</label>
                                    <input type="text" value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} placeholder="e.g. barg, °C, mm/s" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500" />
                                </div>
                            </div>
                            <div className="grid grid-cols-3 gap-4">
                                <div><label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">IOW Type</label>
                                    <select value={form.iow_type} onChange={e => setForm(f => ({ ...f, iow_type: e.target.value as IOWType }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500">
                                        <option value="critical">Critical</option><option value="standard">Standard</option><option value="informational">Informational</option>
                                    </select>
                                </div>
                                <div><label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Low Limit</label>
                                    <input type="number" step="0.1" value={form.low_limit} onChange={e => setForm(f => ({ ...f, low_limit: e.target.value }))} placeholder="—" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500" />
                                </div>
                                <div><label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">High Limit</label>
                                    <input type="number" step="0.1" value={form.high_limit} onChange={e => setForm(f => ({ ...f, high_limit: e.target.value }))} placeholder="—" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500" />
                                </div>
                            </div>
                            <div><label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Current Value</label>
                                <input type="number" step="0.1" value={form.current_value} onChange={e => setForm(f => ({ ...f, current_value: e.target.value }))} placeholder="Enter current reading" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500" />
                            </div>
                        </div>
                        <div className="p-6 border-t border-slate-200 flex justify-end space-x-3">
                            <button onClick={() => setShowNew(false)} className="px-4 py-2.5 text-sm text-slate-500 hover:text-slate-700 transition-colors">Cancel</button>
                            <button onClick={handleSubmit} disabled={!form.asset_id || !form.parameter_name || !form.unit || !form.current_value} className="px-6 py-2.5 bg-cyan-600 text-white text-sm font-semibold rounded-lg hover:bg-cyan-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Add Parameter</button>
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
