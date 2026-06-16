import React, { useState } from 'react';
import { Ruler, AlertTriangle, Clock, CheckCircle, Plus, X } from 'lucide-react';
import { useIntegrity } from '../hooks/useIntegrity';
import type { ThicknessReading, UTMethod } from '../types/integrity';

export const ThicknessDataPage: React.FC = () => {
    const { cmls, readings, corrosionRates, summary, addReading } = useIntegrity();
    const [showNew, setShowNew] = useState(false);
    const [form, setForm] = useState({ cml_id: '', measured_thickness_mm: '', ut_method: 'ut_contact' as UTMethod, technician: '' });

    const handleSubmit = () => {
        if (!form.cml_id || !form.measured_thickness_mm || !form.technician) return;
        const r: ThicknessReading = { id: `r-${Date.now()}`, cml_id: form.cml_id, reading_date: new Date().toISOString(), measured_thickness_mm: parseFloat(form.measured_thickness_mm), ut_method: form.ut_method, technician: form.technician };
        addReading(r);
        setForm({ cml_id: '', measured_thickness_mm: '', ut_method: 'ut_contact', technician: '' });
        setShowNew(false);
    };

    const augmented = readings.map(r => {
        const cml = cmls.find(c => c.id === r.cml_id);
        const cr = corrosionRates.find(c => c.cml_id === r.cml_id);
        const delta = cml ? r.measured_thickness_mm - cml.tmin_mm : 0;
        const remainingLife = cr && cr.short_term_rate_mmpy > 0 ? delta / cr.short_term_rate_mmpy : null;
        return { ...r, cml, delta, remainingLife };
    }).sort((a, b) => a.delta - b.delta);

    return (
        <div className="space-y-6 pb-20">
            <div className="flex justify-between items-center">
                <div><h1 className="text-2xl font-bold text-slate-800 tracking-tight">Thickness Data</h1><p className="text-slate-500 text-sm mt-1">Ultrasonic thickness readings, T-min monitoring, and retirement forecasting</p></div>
                <button onClick={() => setShowNew(true)} className="btn-primary"><Plus size={16} className="mr-2" />New Reading</button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Kpi label="Total CMLs" value={summary.total_cmls} icon={Ruler} />
                <Kpi label="Readings (Recent)" value={readings.length} icon={CheckCircle} color="text-emerald-500" bg="bg-emerald-50" />
                <Kpi label="Below T-min" value={summary.cmls_below_tmin} icon={AlertTriangle} color="text-red-500" bg="bg-red-50" />
                <Kpi label="Avg Rate" value={`${summary.avg_corrosion_rate} mm/yr`} icon={Clock} />
            </div>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <table className="w-full text-sm text-left">
                    <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                        <tr>
                            <th className="px-5 py-4">CML</th><th className="px-5 py-4">Component</th><th className="px-5 py-4 text-right">Nominal</th><th className="px-5 py-4 text-right">Measured</th><th className="px-5 py-4 text-right">T-min</th><th className="px-5 py-4 text-right">Δ (Margin)</th><th className="px-5 py-4">UT Method</th><th className="px-5 py-4">Date</th><th className="px-5 py-4">Technician</th><th className="px-5 py-4 text-right">Est. Life</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {augmented.map(r => {
                            const deltaColor = r.delta < 0 ? 'text-red-600 font-bold' : r.delta < 2 ? 'text-amber-600' : 'text-emerald-600';
                            return (
                                <tr key={r.id} className={`hover:bg-slate-50 transition-colors ${r.delta < 0 ? 'bg-red-50/50' : ''}`}>
                                    <td className="px-5 py-4 font-mono text-slate-700 text-xs">{r.cml?.cml_number || r.cml_id}</td>
                                    <td className="px-5 py-4 text-slate-600 capitalize text-xs">{r.cml?.component_type.replace(/_/g, ' ') || '—'}</td>
                                    <td className="px-5 py-4 text-right font-mono text-slate-500">{r.cml?.nominal_thickness_mm.toFixed(1)}</td>
                                    <td className="px-5 py-4 text-right font-mono text-slate-800 font-medium">{r.measured_thickness_mm.toFixed(1)}</td>
                                    <td className="px-5 py-4 text-right font-mono text-slate-500">{r.cml?.tmin_mm.toFixed(1)}</td>
                                    <td className={`px-5 py-4 text-right font-mono ${deltaColor}`}>{r.delta >= 0 ? '+' : ''}{r.delta.toFixed(1)}</td>
                                    <td className="px-5 py-4"><span className="px-2 py-1 text-[10px] bg-slate-100 text-slate-600 rounded uppercase font-medium">{r.ut_method.replace(/_/g, ' ')}</span></td>
                                    <td className="px-5 py-4 font-mono text-xs text-slate-500">{new Date(r.reading_date).toLocaleDateString()}</td>
                                    <td className="px-5 py-4 text-slate-600 text-xs">{r.technician}</td>
                                    <td className="px-5 py-4 text-right font-mono text-slate-700">{r.remainingLife !== null ? `${r.remainingLife.toFixed(1)} yrs` : '—'}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {showNew && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowNew(false)}>
                    <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
                            <div className="flex items-center gap-3"><div className="p-2 bg-primary-50 rounded-lg text-primary-600"><Ruler size={20} /></div><div><h2 className="text-lg font-bold text-slate-800">New UT Reading</h2><p className="text-xs text-slate-500 mt-0.5">Record an ultrasonic thickness measurement</p></div></div>
                            <button onClick={() => setShowNew(false)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"><X size={18} /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div><label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">CML Location</label>
                                <select value={form.cml_id} onChange={e => setForm(f => ({ ...f, cml_id: e.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500">
                                    <option value="">Select CML…</option>
                                    {cmls.map(c => <option key={c.id} value={c.id}>{c.cml_number} — {c.component_type.replace(/_/g, ' ')} ({c.orientation})</option>)}
                                </select>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div><label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Measured Thickness (mm)</label>
                                    <input type="number" step="0.1" value={form.measured_thickness_mm} onChange={e => setForm(f => ({ ...f, measured_thickness_mm: e.target.value }))} placeholder="e.g. 10.4" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500" />
                                </div>
                                <div><label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">UT Method</label>
                                    <select value={form.ut_method} onChange={e => setForm(f => ({ ...f, ut_method: e.target.value as UTMethod }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500">
                                        <option value="ut_contact">UT Contact</option><option value="ut_compression">UT Compression</option><option value="paut">PAUT</option><option value="scan">Scan</option>
                                    </select>
                                </div>
                            </div>
                            <div><label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Technician</label>
                                <input type="text" value={form.technician} onChange={e => setForm(f => ({ ...f, technician: e.target.value }))} placeholder="e.g. D. Chen" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500" />
                            </div>
                        </div>
                        <div className="p-6 border-t border-slate-200 flex justify-end space-x-3">
                            <button onClick={() => setShowNew(false)} className="px-4 py-2.5 text-sm text-slate-500 hover:text-slate-700 transition-colors">Cancel</button>
                            <button onClick={handleSubmit} disabled={!form.cml_id || !form.measured_thickness_mm || !form.technician} className="px-6 py-2.5 bg-primary-600 text-white text-sm font-semibold rounded-lg hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Record Reading</button>
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
