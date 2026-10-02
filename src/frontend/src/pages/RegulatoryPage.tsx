import React, { useState } from 'react';
import { FileText, Plus, X } from 'lucide-react';
import { useSafety } from '../hooks/useSafety';
import { PreviewBanner } from '../components/common/PreviewBanner';
import { AssessPage, AssessHeader, StatStrip, ASSESS_PRIMARY_BTN, fmtDate } from '../components/audit/AssessLayout';
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

    // -700 on -50: the old -400 text on a white table did not meet contrast.
    const statusBadge = (s: string) => {
        if (s === 'compliant') return 'text-emerald-700 bg-emerald-50 border-emerald-200';
        if (s === 'partially_compliant') return 'text-amber-700 bg-amber-50 border-amber-200';
        if (s === 'non_compliant') return 'text-red-700 bg-red-50 border-red-200';
        return 'text-sky-700 bg-sky-50 border-sky-200';
    };

    const next = regulations
        .filter(r => new Date(r.next_submission) > new Date())
        .sort((a, b) => new Date(a.next_submission).getTime() - new Date(b.next_submission).getTime())[0];
    const nextDays = next ? Math.ceil((new Date(next.next_submission).getTime() - Date.now()) / 86400000) : null;

    return (
        <AssessPage>
            <AssessHeader
                title="Regulatory Master List"
                subtitle="Compliance requirements by authority and jurisdiction"
                actions={<button onClick={() => setShowNew(true)} className={ASSESS_PRIMARY_BTN}><Plus size={16} />Add requirement</button>}
            />

            <PreviewBanner message="Preview — regulatory requirements shown are illustrative and new entries are not saved yet." />

            <StatStrip stats={[
                { key: 'total', label: 'Requirements', value: summary.total_requirements },
                { key: 'ok', label: 'Compliant', value: summary.compliant_count, tone: 'green' },
                { key: 'nc', label: 'Non-compliant', value: summary.non_compliant_count, tone: 'red' },
                { key: 'next', label: 'Next deadline', value: nextDays != null ? `${nextDays}d` : '—', tone: 'amber', hint: next?.regulation_name },
            ]} />

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                <table className="w-full min-w-[46rem] text-sm text-left">
                    <thead className="text-[10px] font-bold tracking-wider text-slate-400 uppercase bg-slate-50 border-b border-slate-200">
                        <tr><th className="px-5 py-3">Regulation</th><th className="px-5 py-3">Authority</th><th className="px-5 py-3">Applicable sites</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Next submission</th><th className="px-5 py-3 text-right">Owner</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {regulations.map(r => (
                            <tr key={r.id} className="hover:bg-slate-50/70 transition-colors">
                                <td className="px-5 py-3.5 text-slate-800 font-medium">{r.regulation_name}</td>
                                <td className="px-5 py-3.5"><span className="px-2 py-1 text-[10px] font-bold bg-slate-100 text-slate-600 rounded">{r.authority}</span></td>
                                <td className="px-5 py-3.5 text-slate-500 text-xs">{r.applicable_sites.join(', ')}</td>
                                <td className="px-5 py-3.5"><span className={`px-2 py-0.5 text-[11px] font-semibold rounded-md border capitalize whitespace-nowrap ${statusBadge(r.compliance_status)}`}>{r.compliance_status.replace(/_/g, ' ')}</span></td>
                                <td className="px-5 py-3.5 text-xs text-slate-600 tabular-nums whitespace-nowrap">{fmtDate(r.next_submission)}</td>
                                <td className="px-5 py-3.5 text-right text-slate-500 text-xs">{r.owner}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                </div>
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
                            <button onClick={handleSubmit} disabled={!form.regulation_name || !form.authority || !form.owner} className={ASSESS_PRIMARY_BTN}>Add requirement</button>
                        </div>
                    </div>
                </div>
            )}
        </AssessPage>
    );
};
