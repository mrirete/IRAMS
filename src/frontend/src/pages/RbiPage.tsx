import React, { useState } from 'react';
import { Shield, AlertTriangle, CheckCircle, Clock, Plus, X } from 'lucide-react';
import { useIntegrity } from '../hooks/useIntegrity';
import { useAssetLookup } from '../hooks/useAssetLookup';
import { VisionCorrosionPanel } from '../components/integrity/VisionCorrosionPanel';
import type { RBIAssessment, GoverningCode, InspectionEvent } from '../types/integrity';

export const RbiPage: React.FC = () => {
    const { rbiAssessments, summary, addRbiAssessment, addInspection } = useIntegrity();
    const { assetOptions, getAssetName } = useAssetLookup();
    const [selected, setSelected] = useState<RBIAssessment | null>(null);
    const [showNew, setShowNew] = useState(false);
    const [form, setForm] = useState({ asset_id: '', governing_code: 'API 510' as GoverningCode, pof_score: '3', cof_score: 'C', assessor: '' });

    const handleSubmit = () => {
        if (!form.asset_id || !form.assessor) return;
        const pof = parseInt(form.pof_score);
        const cofMap: Record<string, number> = { A: 5, B: 4, C: 3, D: 2, E: 1 };
        const riskScore = pof * (cofMap[form.cof_score] || 3);
        const rank = riskScore >= 20 ? 'Very High' : riskScore >= 15 ? 'High' : riskScore >= 10 ? 'Medium-High' : riskScore >= 5 ? 'Medium' : 'Low';
        const a: RBIAssessment = {
            id: `rbi-${Date.now()}`, asset_id: form.asset_id, governing_code: form.governing_code,
            pof_score: pof, cof_score: form.cof_score, risk_rank: rank as any,
            next_inspection_interval_months: pof >= 4 ? 12 : pof >= 3 ? 24 : 48,
            next_inspection_due: new Date(Date.now() + (pof >= 4 ? 365 : pof >= 3 ? 730 : 1460) * 86400000).toISOString(),
            assessor: form.assessor, assessed_date: new Date().toISOString(),
        };
        addRbiAssessment(a);
        // Close the loop: the RBI interval drives the inspection schedule.
        const insp: InspectionEvent = {
            id: `insp-${Date.now()}`,
            asset_id: a.asset_id,
            asset_name: getAssetName(a.asset_id),
            inspection_type: 'UT',
            governing_code: a.governing_code as GoverningCode,
            scheduled_date: a.next_inspection_due!,
            status: 'scheduled',
            approval_mode: 'simple',
            findings_count: 0,
            inspector: a.assessor!,
            description: `RBI-driven inspection — ${a.risk_rank} risk (PoF ${a.pof_score}, CoF ${a.cof_score}), ${a.next_inspection_interval_months}-month interval.`,
            team: [],
            findings: [],
            notes: [],
            checklist_responses: {},
        };
        addInspection(insp);
        setForm({ asset_id: '', governing_code: 'API 510', pof_score: '3', cof_score: 'C', assessor: '' });
        setShowNew(false);
    };

    const cofLabels = ['E', 'D', 'C', 'B', 'A'];
    const pofLabels = [5, 4, 3, 2, 1];
    const riskColor = (pof: number, cof: number) => {
        const s = pof * cof;
        if (s >= 20) return 'bg-red-500/80 hover:bg-red-500';
        if (s >= 15) return 'bg-orange-500/60 hover:bg-orange-500';
        if (s >= 10) return 'bg-yellow-500/40 hover:bg-yellow-500/60';
        if (s >= 5) return 'bg-primary-500/20 hover:bg-primary-500/30';
        return 'bg-green-500/10 hover:bg-green-500/20';
    };
    const matrixCounts = (pof: number, cofIdx: number) => rbiAssessments.filter(a => a.pof_score === pof && a.cof_score === cofLabels[cofIdx]).length;

    const riskBadge = (r: string) => {
        if (r === 'Very High') return 'text-red-700 bg-red-50 border border-red-200';
        if (r === 'High') return 'text-orange-700 bg-orange-50 border border-orange-200';
        if (r === 'Medium-High') return 'text-amber-700 bg-amber-50 border border-amber-200';
        if (r === 'Medium') return 'text-primary-700 bg-primary-50 border border-primary-200';
        return 'text-emerald-700 bg-emerald-50 border border-emerald-200';
    };

    return (
        <div className="space-y-6 pb-20">
            <div className="flex justify-between items-center">
                <div><h1 className="text-2xl font-bold text-slate-800 tracking-tight">Risk-Based Inspection</h1><p className="text-slate-500 text-sm mt-1">API 580/581 quantitative RBI assessments and risk matrix</p></div>
                <button onClick={() => setShowNew(true)} className="btn-primary"><Plus size={16} className="mr-2" />New Assessment</button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Kpi label="Total Assessments" value={rbiAssessments.length} icon={Shield} />
                <Kpi label="High / Very High" value={summary.rbi_high_risk_count} icon={AlertTriangle} color="text-red-500" bg="bg-red-50" />
                <Kpi label="Overdue Inspections" value={summary.inspections_overdue} icon={Clock} color="text-amber-500" bg="bg-amber-50" />
                <Kpi label="Completed YTD" value={summary.inspections_completed_ytd} icon={CheckCircle} color="text-emerald-500" bg="bg-emerald-50" />
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-widest mb-4">Risk Matrix (PoF vs CoF)</h3>
                <div className="grid grid-cols-6 gap-1 max-w-2xl">
                    <div></div>{cofLabels.map(c => <div key={c} className="text-center text-xs text-slate-600 font-bold py-2">{c}</div>)}
                    {pofLabels.map((pof) => (
                        <React.Fragment key={pof}>
                            <div className="flex items-center justify-center text-xs text-slate-600 font-bold">{pof}</div>
                            {cofLabels.map((_, ci) => {
                                const count = matrixCounts(pof, ci);
                                return <div key={ci} className={`h-12 rounded flex items-center justify-center text-sm font-bold text-white/90 ${riskColor(pof, ci + 1)} transition-colors cursor-default`}>{count > 0 ? count : ''}</div>;
                            })}
                        </React.Fragment>
                    ))}
                </div>
                <div className="flex items-center mt-3 space-x-4 text-[10px] text-slate-400"><span>← CoF (Consequence)</span><span className="flex-1"></span><span>↑ PoF (Probability)</span></div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <table className="w-full text-sm text-left">
                    <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                        <tr><th className="px-6 py-4">Asset</th><th className="px-6 py-4">Code</th><th className="px-6 py-4">PoF</th><th className="px-6 py-4">CoF</th><th className="px-6 py-4">Risk Rank</th><th className="px-6 py-4">Next Due</th><th className="px-6 py-4 text-right">Assessor</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {rbiAssessments.map(a => (
                            <tr key={a.id} onClick={() => setSelected(a)} className="hover:bg-slate-50 cursor-pointer transition-colors">
                                <td className="px-6 py-4 text-slate-800 font-medium text-xs">{getAssetName(a.asset_id)}</td>
                                <td className="px-6 py-4"><span className="px-2 py-1 text-[10px] bg-slate-100 text-slate-600 rounded font-medium">{a.governing_code}</span></td>
                                <td className="px-6 py-4 font-mono text-slate-700">{a.pof_score}</td>
                                <td className="px-6 py-4 font-mono text-slate-700">{a.cof_score}</td>
                                <td className="px-6 py-4"><span className={`px-2 py-1 text-xs font-semibold rounded-full ${riskBadge(a.risk_rank)}`}>{a.risk_rank}</span></td>
                                <td className="px-6 py-4 font-mono text-xs text-slate-600">{new Date(a.next_inspection_due).toLocaleDateString()}</td>
                                <td className="px-6 py-4 text-right text-slate-500 text-xs">{a.assessor}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {selected && (
                <div className="fixed inset-y-0 right-0 w-[420px] bg-white border-l border-slate-200 shadow-2xl z-40 flex flex-col pt-16 mt-2">
                    <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200 bg-slate-50">
                        <div><h2 className="text-lg font-bold text-slate-800">{getAssetName(selected.asset_id)}</h2><p className="text-slate-500 text-sm">{selected.governing_code}</p></div>
                        <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-slate-700"><X size={24} /></button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-6 space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <Stat label="PoF Score" value={selected.pof_score} />
                            <Stat label="CoF Score" value={selected.cof_score} />
                            <Stat label="Risk Rank" value={selected.risk_rank} />
                            <Stat label="Interval" value={`${selected.next_inspection_interval_months}mo`} />
                        </div>
                        <Stat label="Next Inspection Due" value={new Date(selected.next_inspection_due).toLocaleDateString()} />
                        <Stat label="Assessed By" value={selected.assessor} />
                        <Stat label="Assessment Date" value={new Date(selected.assessed_date).toLocaleDateString()} />

                        {/* Vision Corrosion Findings — Cross-Module Integration */}
                        <VisionCorrosionPanel
                            assetId={selected.asset_id}
                            assetName={getAssetName(selected.asset_id)}
                        />
                    </div>
                </div>
            )}

            {showNew && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowNew(false)}>
                    <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
                            <div className="flex items-center gap-3"><div className="p-2 bg-primary-50 rounded-lg text-primary-600"><Shield size={20} /></div><div><h2 className="text-lg font-bold text-slate-800">New RBI Assessment</h2><p className="text-xs text-slate-500 mt-0.5">API 580/581 risk quantification</p></div></div>
                            <button onClick={() => setShowNew(false)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"><X size={18} /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div><label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Target Asset</label>
                                <select value={form.asset_id} onChange={e => setForm(f => ({ ...f, asset_id: e.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500">
                                    <option value="">Select asset…</option>{assetOptions.map(a => <option key={a.id} value={a.id}>{a.tag} — {a.name}</option>)}
                                </select>
                            </div>
                            <div><label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Governing Code</label>
                                <select value={form.governing_code} onChange={e => setForm(f => ({ ...f, governing_code: e.target.value as GoverningCode }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500">
                                    <option value="API 510">API 510</option><option value="API 653">API 653</option><option value="ASME B31.3">ASME B31.3</option><option value="API 570">API 570</option>
                                </select>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div><label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">PoF Score (1–5)</label>
                                    <select value={form.pof_score} onChange={e => setForm(f => ({ ...f, pof_score: e.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500">
                                        {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
                                    </select>
                                </div>
                                <div><label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">CoF Score (A–E)</label>
                                    <select value={form.cof_score} onChange={e => setForm(f => ({ ...f, cof_score: e.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500">
                                        {['A', 'B', 'C', 'D', 'E'].map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div><label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Assessor</label>
                                <input type="text" value={form.assessor} onChange={e => setForm(f => ({ ...f, assessor: e.target.value }))} placeholder="e.g. S. Jenkins" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500" />
                            </div>
                        </div>
                        <div className="p-6 border-t border-slate-200 flex justify-end space-x-3">
                            <button onClick={() => setShowNew(false)} className="px-4 py-2.5 text-sm text-slate-500 hover:text-slate-700 transition-colors">Cancel</button>
                            <button onClick={handleSubmit} disabled={!form.asset_id || !form.assessor} className="px-6 py-2.5 bg-primary-600 text-white text-sm font-semibold rounded-lg hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Create Assessment</button>
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
