/**
 * SILAssessment — IEC 61508 / IEC 61511 SIL Lifecycle
 *
 * Target SIL determination + PFD verification for each SIF.
 */
import React, { useState, useEffect } from 'react';
import {
    Plus, Trash2, Edit3, Check, X, Shield, Activity,
} from 'lucide-react';
import psmService, { verifySIL } from '../../eam/services/PSMService';
import type { PSMStudy, SILAssessment as SILAssessmentType, SILDemandMode } from '../../types/safety';

const SIL_BANDS: { sil: number; pfd_min: number; pfd_max: number; rrr: string; color: string }[] = [
    { sil: 4, pfd_min: 1e-5, pfd_max: 1e-4, rrr: '10,000–100,000', color: 'bg-red-100 text-red-700 border-red-200' },
    { sil: 3, pfd_min: 1e-4, pfd_max: 1e-3, rrr: '1,000–10,000',   color: 'bg-orange-100 text-orange-700 border-orange-200' },
    { sil: 2, pfd_min: 1e-3, pfd_max: 1e-2, rrr: '100–1,000',      color: 'bg-amber-100 text-amber-700 border-amber-200' },
    { sil: 1, pfd_min: 1e-2, pfd_max: 1e-1, rrr: '10–100',         color: 'bg-blue-100 text-blue-700 border-blue-200' },
];

function SILBandTable() {
    return (
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <h3 className="text-xs font-semibold text-slate-600 mb-3 flex items-center gap-1.5"><Activity size={14} /> IEC 61508 SIL Bands (Low Demand)</h3>
            <div className="overflow-x-auto">
                <table className="w-full text-xs">
                    <thead>
                        <tr className="bg-slate-50 border-b border-slate-100">
                            <th className="p-2 text-left text-[10px] text-slate-500 font-semibold uppercase">SIL</th>
                            <th className="p-2 text-left text-[10px] text-slate-500 font-semibold uppercase">PFD Range</th>
                            <th className="p-2 text-left text-[10px] text-slate-500 font-semibold uppercase">Risk Reduction</th>
                        </tr>
                    </thead>
                    <tbody>
                        {SIL_BANDS.map(b => (
                            <tr key={b.sil} className="border-b border-slate-50">
                                <td className="p-2"><span className={`px-2 py-0.5 rounded border font-bold text-[10px] ${b.color}`}>SIL {b.sil}</span></td>
                                <td className="p-2 font-mono text-slate-600">{b.pfd_min.toExponential(0)} – {b.pfd_max.toExponential(0)}</td>
                                <td className="p-2 text-slate-500">{b.rrr}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════
//  SIF Card
// ═══════════════════════════════════════════════════════════════

function SIFCard({ sif, onUpdate, onDelete }: {
    sif: SILAssessmentType;
    onUpdate: (id: string, updates: Partial<SILAssessmentType>) => void;
    onDelete: (id: string) => void;
}) {
    const [editing, setEditing] = useState(false);
    const [form, setForm] = useState(sif);

    const isVerified = sif.target_sil != null && sif.achieved_pfd != null && verifySIL(sif.achieved_pfd, sif.target_sil);

    if (editing) {
        return (
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3">
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="text-[10px] font-semibold text-slate-500 uppercase mb-1 block">SIF Tag</label>
                        <input value={form.sif_tag} onChange={e => setForm(f => ({ ...f, sif_tag: e.target.value }))}
                            className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 font-mono" placeholder="e.g. SIF-101" />
                    </div>
                    <div>
                        <label className="text-[10px] font-semibold text-slate-500 uppercase mb-1 block">Demand Mode</label>
                        <select value={form.demand_mode} onChange={e => setForm(f => ({ ...f, demand_mode: e.target.value as SILDemandMode }))}
                            className="w-full text-xs border border-slate-200 rounded px-2 py-1.5">
                            <option value="low">Low Demand</option>
                            <option value="high">High Demand</option>
                            <option value="continuous">Continuous</option>
                        </select>
                    </div>
                </div>
                <div>
                    <label className="text-[10px] font-semibold text-slate-500 uppercase mb-1 block">Description</label>
                    <textarea value={form.sif_description || ''} onChange={e => setForm(f => ({ ...f, sif_description: e.target.value }))}
                        className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 min-h-[40px]" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                        <label className="text-[10px] font-semibold text-slate-500 uppercase mb-1 block">Target SIL</label>
                        <select value={form.target_sil ?? ''} onChange={e => setForm(f => ({ ...f, target_sil: e.target.value ? Number(e.target.value) : null }))}
                            className="w-full text-xs border border-slate-200 rounded px-2 py-1.5">
                            <option value="">—</option>
                            {[1,2,3,4].map(n => <option key={n} value={n}>SIL {n}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="text-[10px] font-semibold text-slate-500 uppercase mb-1 block">Architecture</label>
                        <select value={form.architecture || ''} onChange={e => setForm(f => ({ ...f, architecture: e.target.value }))}
                            className="w-full text-xs border border-slate-200 rounded px-2 py-1.5">
                            <option value="">Select...</option>
                            <option value="1oo1">1oo1</option>
                            <option value="1oo2">1oo2</option>
                            <option value="2oo2">2oo2</option>
                            <option value="2oo3">2oo3</option>
                            <option value="1oo1D">1oo1D</option>
                            <option value="1oo2D">1oo2D</option>
                        </select>
                    </div>
                    <div>
                        <label className="text-[10px] font-semibold text-slate-500 uppercase mb-1 block">Achieved PFD</label>
                        <input type="number" step="0.000001" value={form.achieved_pfd ?? ''} onChange={e => setForm(f => ({ ...f, achieved_pfd: parseFloat(e.target.value) || null }))}
                            className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 font-mono" />
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="text-[10px] font-semibold text-slate-500 uppercase mb-1 block">Proof Test Interval (months)</label>
                        <input type="number" value={form.proof_test_interval_months ?? ''} onChange={e => setForm(f => ({ ...f, proof_test_interval_months: parseInt(e.target.value) || null }))}
                            className="w-full text-xs border border-slate-200 rounded px-2 py-1.5" />
                    </div>
                    <div>
                        <label className="text-[10px] font-semibold text-slate-500 uppercase mb-1 block">Common Cause Beta (β)</label>
                        <input type="number" step="0.01" value={form.common_cause_beta ?? ''} onChange={e => setForm(f => ({ ...f, common_cause_beta: parseFloat(e.target.value) || null }))}
                            className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 font-mono" />
                    </div>
                </div>
                <div className="flex justify-end gap-2">
                    <button onClick={() => setEditing(false)} className="text-xs px-3 py-1.5 border border-slate-200 rounded-lg text-slate-600">Cancel</button>
                    <button onClick={() => { onUpdate(sif.id, form); setEditing(false); }}
                        className="text-xs px-3 py-1.5 bg-primary-500 text-white rounded-lg hover:bg-primary-600">Save</button>
                </div>
            </div>
        );
    }

    const silColor = sif.target_sil != null ? (SIL_BANDS.find(b => b.sil === sif.target_sil)?.color || '') : '';

    return (
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm group hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-mono font-bold text-blue-600">{sif.sif_tag}</span>
                    {sif.target_sil != null && (
                        <span className={`text-[10px] px-2 py-0.5 rounded border font-bold ${silColor}`}>SIL {sif.target_sil}</span>
                    )}
                    {sif.achieved_pfd != null && (
                        <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                            isVerified ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                        }`}>
                            {isVerified ? '✓ Verified' : '✗ Not Met'}
                        </span>
                    )}
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => { setForm(sif); setEditing(true); }}
                        className="p-1 hover:bg-slate-100 rounded"><Edit3 size={14} className="text-slate-400" /></button>
                    <button onClick={() => onDelete(sif.id)}
                        className="p-1 hover:bg-red-50 rounded"><Trash2 size={14} className="text-slate-400 hover:text-red-500" /></button>
                </div>
            </div>
            {sif.sif_description && <p className="text-xs text-slate-500 mb-2">{sif.sif_description}</p>}
            <div className="flex items-center gap-4 text-[10px] text-slate-400">
                <span>Mode: {sif.demand_mode}</span>
                {sif.architecture && <span>Arch: {sif.architecture}</span>}
                {sif.achieved_pfd != null && <span>PFD: <span className="font-mono">{sif.achieved_pfd.toExponential(2)}</span></span>}
                {sif.proof_test_interval_months && <span>PTI: {sif.proof_test_interval_months}mo</span>}
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════
//  Main SIL Assessment Panel
// ═══════════════════════════════════════════════════════════════

interface SILAssessmentProps {
    study: PSMStudy;
    onRefresh?: () => void;
}

const SILAssessmentPanel: React.FC<SILAssessmentProps> = ({ study, onRefresh }) => {
    const [assessments, setAssessments] = useState<SILAssessmentType[]>([]);

    useEffect(() => {
        psmService.getSILAssessments(study.id).then(setAssessments);
    }, [study.id]);

    const handleAdd = async () => {
        const sil = await psmService.createSILAssessment({
            study_id: study.id,
            sif_tag: `SIF-${String(assessments.length + 1).padStart(3, '0')}`,
            demand_mode: 'low',
            sort_order: assessments.length,
        });
        if (sil) setAssessments(prev => [...prev, sil]);
    };

    const handleUpdate = async (id: string, updates: Partial<SILAssessmentType>) => {
        const updated = await psmService.updateSILAssessment(id, updates);
        if (updated) setAssessments(prev => prev.map(s => s.id === id ? updated : s));
    };

    const handleDelete = async (id: string) => {
        const ok = await psmService.deleteSILAssessment(id);
        if (ok) setAssessments(prev => prev.filter(s => s.id !== id));
    };

    return (
        <div className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-lg font-bold text-slate-800">{study.title}</h2>
                        <p className="text-xs text-slate-400 mt-0.5">IEC 61508 / IEC 61511 — SIL Assessment & Verification</p>
                    </div>
                    <button onClick={handleAdd}
                        className="flex items-center gap-1 text-xs font-medium text-white bg-gradient-to-r from-primary-500 to-primary-500 px-3 py-1.5 rounded-lg hover:shadow-md transition-all">
                        <Plus size={12} /> Add SIF
                    </button>
                </div>
            </div>

            <SILBandTable />

            {assessments.map(sif => (
                <SIFCard key={sif.id} sif={sif} onUpdate={handleUpdate} onDelete={handleDelete} />
            ))}

            {assessments.length === 0 && (
                <div className="bg-white border border-dashed border-slate-300 rounded-xl p-12 text-center">
                    <Shield size={32} className="text-slate-300 mx-auto mb-3" />
                    <p className="text-sm text-slate-500">No SIF records. Click "Add SIF" to begin.</p>
                </div>
            )}
        </div>
    );
};

export default SILAssessmentPanel;
