import React, { useState } from 'react';
import { FileText, CheckCircle, AlertTriangle, Clock, Plus, X } from 'lucide-react';
import { useSafety } from '../hooks/useSafety';
import type { RegulatoryRequirement, ComplianceStatus } from '../types/safety';

export const RegulatoryPage: React.FC = () => {
    const { regulations, summary, addRegulation } = useSafety();
    const [showNew, setShowNew] = useState(false);
    const [form, setForm] = useState({ regulation_name: '', authority: '', applicable_sites: '', compliance_status: 'under_review' as ComplianceStatus, next_submission: '', owner: '' });

    const handleSubmit = () => {
        if (!form.regulation_name || !form.authority || !form.owner) return;
        const r: RegulatoryRequirement = {
            id: `reg-${Date.now()}`, regulation_name: form.regulation_name, authority: form.authority.toUpperCase(),
            applicable_sites: form.applicable_sites.split(',').map(s => s.trim()).filter(Boolean),
            compliance_status: form.compliance_status,
            next_submission: form.next_submission ? new Date(form.next_submission).toISOString() : new Date(Date.now() + 365 * 86400000).toISOString(),
            owner: form.owner,
        };
        addRegulation(r);
        setForm({ regulation_name: '', authority: '', applicable_sites: '', compliance_status: 'under_review', next_submission: '', owner: '' });
        setShowNew(false);
    };

    const statusBadge = (s: string) => {
        if (s === 'compliant') return 'text-green-400 bg-green-400/10';
        if (s === 'partially_compliant') return 'text-yellow-400 bg-yellow-400/10';
        if (s === 'non_compliant') return 'text-red-400 bg-red-400/10';
        return 'text-blue-400 bg-blue-400/10';
    };

    return (
        <div className="space-y-6 pb-20">
            <div className="flex justify-between items-center">
                <div><h1 className="text-2xl font-bold text-slate-800 tracking-tight">Regulatory Master List</h1><p className="text-slate-500 text-sm mt-1">Compliance requirements by authority and jurisdiction</p></div>
                <button onClick={() => setShowNew(true)} className="btn-primary"><Plus size={16} className="mr-2" />Add Requirement</button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Kpi label="Total Requirements" value={summary.total_requirements} icon={FileText} />
                <Kpi label="Compliant" value={summary.compliant_count} icon={CheckCircle} color="text-green-400" bg="bg-green-500/10" />
                <Kpi label="Non-Compliant" value={summary.non_compliant_count} icon={AlertTriangle} color="text-red-400" bg="bg-red-500/10" />
                <Kpi label="Next Deadline" value={(() => { const next = regulations.filter(r => new Date(r.next_submission) > new Date()).sort((a, b) => new Date(a.next_submission).getTime() - new Date(b.next_submission).getTime())[0]; return next ? `${Math.ceil((new Date(next.next_submission).getTime() - Date.now()) / 86400000)}d` : '—'; })()} icon={Clock} color="text-yellow-400" bg="bg-yellow-500/10" />
            </div>

            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm text-left">
                    <thead className="text-xs text-slate-500 uppercase bg-brand-800/50 border-b border-slate-200">
                        <tr><th className="px-6 py-4">Regulation</th><th className="px-6 py-4">Authority</th><th className="px-6 py-4">Applicable Sites</th><th className="px-6 py-4">Status</th><th className="px-6 py-4">Next Submission</th><th className="px-6 py-4 text-right">Owner</th></tr>
                    </thead>
                    <tbody className="divide-y divide-brand-700/50">
                        {regulations.map(r => (
                            <tr key={r.id} className="hover:bg-slate-100/30 transition-colors">
                                <td className="px-6 py-4 text-slate-800 font-medium text-xs">{r.regulation_name}</td>
                                <td className="px-6 py-4"><span className="px-2 py-1 text-[10px] font-bold bg-slate-100 text-brand-300 rounded">{r.authority}</span></td>
                                <td className="px-6 py-4 text-slate-500 text-xs">{r.applicable_sites.join(', ')}</td>
                                <td className="px-6 py-4"><span className={`px-2 py-1 text-xs font-semibold rounded capitalize ${statusBadge(r.compliance_status)}`}>{r.compliance_status.replace(/_/g, ' ')}</span></td>
                                <td className="px-6 py-4 font-mono text-xs text-brand-300">{new Date(r.next_submission).toLocaleDateString()}</td>
                                <td className="px-6 py-4 text-right text-slate-500 text-xs">{r.owner}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {showNew && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowNew(false)}>
                    <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
                            <div className="flex items-center gap-3"><div className="p-2 bg-accent-cyan/10 rounded-lg text-accent-cyan"><FileText size={20} /></div><div><h2 className="text-lg font-bold text-slate-800">New Regulatory Requirement</h2><p className="text-xs text-slate-500 mt-0.5">Track a compliance obligation</p></div></div>
                            <button onClick={() => setShowNew(false)} className="p-1.5 text-slate-500 hover:text-brand-200 hover:bg-slate-100 rounded-lg transition-colors"><X size={18} /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div><label className="block text-xs font-bold text-brand-300 uppercase tracking-wider mb-2">Regulation Name</label>
                                <input type="text" value={form.regulation_name} onChange={e => setForm(f => ({ ...f, regulation_name: e.target.value }))} placeholder="e.g. API 510 — Pressure Vessel Inspection" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div><label className="block text-xs font-bold text-brand-300 uppercase tracking-wider mb-2">Authority</label>
                                    <input type="text" value={form.authority} onChange={e => setForm(f => ({ ...f, authority: e.target.value }))} placeholder="e.g. API, OSHA, EPA" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500" />
                                </div>
                                <div><label className="block text-xs font-bold text-brand-300 uppercase tracking-wider mb-2">Compliance Status</label>
                                    <select value={form.compliance_status} onChange={e => setForm(f => ({ ...f, compliance_status: e.target.value as ComplianceStatus }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500">
                                        <option value="under_review">Under Review</option><option value="compliant">Compliant</option><option value="partially_compliant">Partially Compliant</option><option value="non_compliant">Non-Compliant</option>
                                    </select>
                                </div>
                            </div>
                            <div><label className="block text-xs font-bold text-brand-300 uppercase tracking-wider mb-2">Applicable Sites</label>
                                <input type="text" value={form.applicable_sites} onChange={e => setForm(f => ({ ...f, applicable_sites: e.target.value }))} placeholder="Platform Alpha, Onshore Terminal" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div><label className="block text-xs font-bold text-brand-300 uppercase tracking-wider mb-2">Next Submission</label>
                                    <input type="date" value={form.next_submission} onChange={e => setForm(f => ({ ...f, next_submission: e.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500" />
                                </div>
                                <div><label className="block text-xs font-bold text-brand-300 uppercase tracking-wider mb-2">Owner</label>
                                    <input type="text" value={form.owner} onChange={e => setForm(f => ({ ...f, owner: e.target.value }))} placeholder="e.g. Safety Manager" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500" />
                                </div>
                            </div>
                        </div>
                        <div className="p-6 border-t border-slate-200 flex justify-end space-x-3">
                            <button onClick={() => setShowNew(false)} className="px-4 py-2.5 text-sm text-slate-500 hover:text-brand-200 transition-colors">Cancel</button>
                            <button onClick={handleSubmit} disabled={!form.regulation_name || !form.authority || !form.owner} className="px-6 py-2.5 bg-accent-cyan text-white text-sm font-semibold rounded-lg hover:bg-accent-cyan/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Add Requirement</button>
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
