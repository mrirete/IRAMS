import React, { useState } from 'react';
import { FileCheck, AlertTriangle, CheckCircle, Clock, Plus, X, XCircle } from 'lucide-react';
import { useIntegrity } from '../hooks/useIntegrity';
import { useAssetLookup } from '../hooks/useAssetLookup';
import type { FFSAssessment, FFSPart, FFSLevel, FFSStatusType } from '../types/integrity';

export const FfsPage: React.FC = () => {
    const { ffsAssessments, summary, addFfsAssessment } = useIntegrity();
    const { assetOptions, getAssetName } = useAssetLookup();
    const [selected, setSelected] = useState<FFSAssessment | null>(null);
    const [showNew, setShowNew] = useState(false);
    const [form, setForm] = useState({ asset_id: '', api_579_part: 'Part 4 — General Metal Loss' as FFSPart, level: 'Level 1' as FFSLevel, status: 'monitoring' as FFSStatusType, rsf: '', remaining_life_years: '', assessor: '', recommended_action: '' });

    const handleSubmit = () => {
        if (!form.asset_id || !form.rsf || !form.assessor) return;
        const f: FFSAssessment = {
            id: `ffs-${Date.now()}`, asset_id: form.asset_id, api_579_part: form.api_579_part,
            level: form.level, status: form.status, rsf: parseFloat(form.rsf),
            remaining_life_years: form.remaining_life_years ? parseFloat(form.remaining_life_years) : 0,
            assessor: form.assessor, assessed_date: new Date().toISOString(),
            recommended_action: form.recommended_action || 'Continue monitoring per standard interval.',
        };
        addFfsAssessment(f);
        setForm({ asset_id: '', api_579_part: 'Part 4 — General Metal Loss', level: 'Level 1', status: 'monitoring', rsf: '', remaining_life_years: '', assessor: '', recommended_action: '' });
        setShowNew(false);
    };

    const statusBadge = (s: string) => {
        if (s === 'passed') return 'text-emerald-700 bg-emerald-50 border border-emerald-200';
        if (s === 'failed') return 'text-red-700 bg-red-50 border border-red-200';
        return 'text-amber-700 bg-amber-50 border border-amber-200';
    };

    return (
        <div className="space-y-6 pb-20">
            <div className="flex justify-between items-center">
                <div><h1 className="text-2xl font-bold text-slate-800 tracking-tight">Fitness for Service</h1><p className="text-slate-500 text-sm mt-1">API 579-1/ASME FFS-1 assessments — remaining strength and life evaluation</p></div>
                <button onClick={() => setShowNew(true)} className="btn-primary"><Plus size={16} className="mr-2" />New Assessment</button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Kpi label="Total Assessments" value={summary.ffs_total} icon={FileCheck} />
                <Kpi label="Passed" value={summary.ffs_passed} icon={CheckCircle} color="text-emerald-500" bg="bg-emerald-50" />
                <Kpi label="Failed" value={summary.ffs_failed} icon={AlertTriangle} color="text-red-500" bg="bg-red-50" />
                <Kpi label="Monitoring" value={ffsAssessments.filter(f => f.status === 'monitoring').length} icon={Clock} color="text-amber-500" bg="bg-amber-50" />
            </div>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <table className="w-full text-sm text-left">
                    <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                        <tr><th className="px-6 py-4">Asset</th><th className="px-6 py-4">API 579 Part</th><th className="px-6 py-4">Level</th><th className="px-6 py-4">Status</th><th className="px-6 py-4 text-right">RSF</th><th className="px-6 py-4 text-right">Remaining Life</th><th className="px-6 py-4 text-right">Assessor</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {ffsAssessments.map(f => (
                            <tr key={f.id} onClick={() => setSelected(f)} className="hover:bg-slate-50 cursor-pointer transition-colors">
                                <td className="px-6 py-4 text-slate-800 font-medium text-xs">{getAssetName(f.asset_id)}</td>
                                <td className="px-6 py-4 text-slate-600 text-xs">{f.api_579_part}</td>
                                <td className="px-6 py-4"><span className="px-2 py-1 text-[10px] bg-slate-100 text-slate-600 rounded font-medium">{f.level}</span></td>
                                <td className="px-6 py-4"><span className={`px-2 py-1 text-xs font-semibold rounded-full capitalize ${statusBadge(f.status)}`}>{f.status}</span></td>
                                <td className={`px-6 py-4 text-right font-mono font-bold ${f.rsf < 0.7 ? 'text-red-600' : f.rsf < 0.8 ? 'text-amber-600' : 'text-emerald-600'}`}>{f.rsf.toFixed(2)}</td>
                                <td className="px-6 py-4 text-right font-mono text-slate-700">{f.remaining_life_years !== null ? `${f.remaining_life_years.toFixed(1)} yrs` : '—'}</td>
                                <td className="px-6 py-4 text-right text-slate-500 text-xs">{f.assessor}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {selected && (
                <div className="fixed inset-y-0 right-0 w-[460px] bg-white border-l border-slate-200 shadow-2xl z-40 flex flex-col pt-16 mt-2">
                    <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200 bg-slate-50">
                        <div><h2 className="text-lg font-bold text-slate-800">{getAssetName(selected.asset_id)}</h2><p className="text-slate-500 text-sm">{selected.api_579_part}</p></div>
                        <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-slate-700"><XCircle size={24} /></button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-6 space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <Stat label="Level" value={selected.level} /><Stat label="Status" value={selected.status} />
                            <Stat label="RSF" value={selected.rsf.toFixed(2)} /><Stat label="Remaining Life" value={selected.remaining_life_years !== null ? `${selected.remaining_life_years.toFixed(1)} yrs` : '—'} />
                        </div>
                        <Stat label="Assessor" value={selected.assessor} />
                        <div className="bg-slate-50 p-4 rounded-lg border border-slate-200"><p className="text-[10px] text-slate-500 uppercase font-semibold mb-2">Recommended Action</p><p className="text-slate-700 text-sm leading-relaxed">{selected.recommended_action}</p></div>
                    </div>
                </div>
            )}

            {showNew && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowNew(false)}>
                    <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
                            <div className="flex items-center gap-3"><div className="p-2 bg-cyan-50 rounded-lg text-cyan-600"><FileCheck size={20} /></div><div><h2 className="text-lg font-bold text-slate-800">New FFS Assessment</h2><p className="text-xs text-slate-500 mt-0.5">API 579-1 / ASME FFS-1</p></div></div>
                            <button onClick={() => setShowNew(false)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"><X size={18} /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div><label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Target Asset</label>
                                <select value={form.asset_id} onChange={e => setForm(f => ({ ...f, asset_id: e.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500">
                                    <option value="">Select asset…</option>{assetOptions.map(a => <option key={a.id} value={a.id}>{a.tag} — {a.name}</option>)}
                                </select>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div><label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">API 579 Part</label>
                                    <select value={form.api_579_part} onChange={e => setForm(f => ({ ...f, api_579_part: e.target.value as FFSPart }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500">
                                        <option>Part 4 — General Metal Loss</option><option>Part 5 — Local Metal Loss</option><option>Part 6 — Pitting</option><option>Part 8 — HIC/SOHIC</option>
                                    </select>
                                </div>
                                <div><label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Assessment Level</label>
                                    <select value={form.level} onChange={e => setForm(f => ({ ...f, level: e.target.value as FFSLevel }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500">
                                        <option value="Level 1">Level 1</option><option value="Level 2">Level 2</option><option value="Level 3">Level 3</option>
                                    </select>
                                </div>
                            </div>
                            <div className="grid grid-cols-3 gap-4">
                                <div><label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Status</label>
                                    <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as FFSStatusType }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500">
                                        <option value="passed">Passed</option><option value="failed">Failed</option><option value="monitoring">Monitoring</option>
                                    </select>
                                </div>
                                <div><label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">RSF</label>
                                    <input type="number" step="0.01" min="0" max="1" value={form.rsf} onChange={e => setForm(f => ({ ...f, rsf: e.target.value }))} placeholder="0.82" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500" />
                                </div>
                                <div><label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Life (yrs)</label>
                                    <input type="number" step="0.5" value={form.remaining_life_years} onChange={e => setForm(f => ({ ...f, remaining_life_years: e.target.value }))} placeholder="8.5" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500" />
                                </div>
                            </div>
                            <div><label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Assessor</label>
                                <input type="text" value={form.assessor} onChange={e => setForm(f => ({ ...f, assessor: e.target.value }))} placeholder="S. Jenkins" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500" />
                            </div>
                            <div><label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Recommended Action</label>
                                <textarea value={form.recommended_action} onChange={e => setForm(f => ({ ...f, recommended_action: e.target.value }))} rows={2} placeholder="Continue monitoring. Next assessment in 4 years." className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 resize-none" />
                            </div>
                        </div>
                        <div className="p-6 border-t border-slate-200 flex justify-end space-x-3">
                            <button onClick={() => setShowNew(false)} className="px-4 py-2.5 text-sm text-slate-500 hover:text-slate-700 transition-colors">Cancel</button>
                            <button onClick={handleSubmit} disabled={!form.asset_id || !form.rsf || !form.assessor} className="px-6 py-2.5 bg-cyan-600 text-white text-sm font-semibold rounded-lg hover:bg-cyan-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Create Assessment</button>
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

function Stat({ label, value }: { label: string; value: any }) {
    return (<div className="bg-slate-50 p-3 rounded-lg border border-slate-200"><p className="text-[10px] text-slate-500 uppercase font-semibold mb-1">{label}</p><p className="text-slate-800 text-sm font-medium">{value}</p></div>);
}
