/**
 * AuditScoredFindings.tsx — Step 6: Score Findings
 *
 * Risk-rated finding register with impact analysis.
 * Two modes: AI auto-generate (synthesizes Steps 2–5) and manual entry.
 * Each finding is classified by category, rating, 6M root cause,
 * and multi-dimensional impact (business, safety, environmental, production).
 *
 * Standards: ISO 55001 §10, ISO 55002 (maturity scoring)
 */

import React, { useState, useMemo } from 'react';
import { Target, Plus, ArrowRight, ArrowLeft, Trash2, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import type { ScoredFinding } from '../../eam/services/AuditTypes';
import { FINDING_RATINGS, FINDING_CATEGORIES, SIXM_CATEGORIES, IMPACT_LEVELS } from '../../eam/services/AuditTypes';

interface Props {
    initialData?: ScoredFinding[];
    onComplete: (data: ScoredFinding[]) => void;
    onBack: () => void;
}

function makeId() { return crypto.randomUUID?.() || Math.random().toString(36).substring(2); }

const EMPTY_FINDING: Omit<ScoredFinding, 'id'> = {
    finding: '', category: 'Governance & Strategy', rating: 'minor_gap',
    riskRank: 4, businessImpact: 'Medium', safetyImpact: 'Low',
    environmentalImpact: 'Low', productionImpact: 'Medium',
    isoReference: '', recommendedAction: '', owner: '', dueDate: '',
    sixmCategory: 'Method',
};

export const AuditScoredFindings: React.FC<Props> = ({ initialData, onComplete, onBack }) => {
    const [findings, setFindings] = useState<ScoredFinding[]>(initialData?.length ? initialData : []);
    const [expandedId, setExpandedId] = useState<string | null>(null);

    // Stats
    const stats = useMemo(() => {
        const counts: Record<string, number> = { compliant: 0, minor_gap: 0, major_gap: 0, critical_risk: 0 };
        findings.forEach(f => { if (counts[f.rating] !== undefined) counts[f.rating]++; });
        return counts;
    }, [findings]);

    const addFinding = () => {
        const newF: ScoredFinding = { id: makeId(), ...EMPTY_FINDING };
        setFindings(prev => [...prev, newF]);
        setExpandedId(newF.id);
    };

    const removeFinding = (id: string) => {
        setFindings(prev => prev.filter(f => f.id !== id));
        if (expandedId === id) setExpandedId(null);
    };

    const updateFinding = (id: string, patch: Partial<ScoredFinding>) => {
        setFindings(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f));
    };

    const getRatingConfig = (rating: string) => FINDING_RATINGS.find(r => r.value === rating) || FINDING_RATINGS[1];

    return (
        <div className="ers-page-narrow py-8 px-4 space-y-6">
            {/* Header */}
            <div className="text-center mb-2">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-red-500/20">
                    <Target size={24} className="text-white" />
                </div>
                <h2 className="text-2xl font-black text-slate-800">Step 6 — Score Findings</h2>
                <p className="text-sm text-slate-500 mt-1">Risk-rated finding register with impact analysis and corrective actions</p>
            </div>

            {/* Stats Bar */}
            <div className="flex items-center gap-4 bg-white border border-slate-200 rounded-xl px-5 py-3">
                {FINDING_RATINGS.map(r => (
                    <div key={r.value} className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: r.color }} />
                        <span className="text-xs font-bold text-slate-600">{stats[r.value] || 0}</span>
                        <span className="text-[10px] text-slate-400">{r.label}</span>
                    </div>
                ))}
                <div className="ml-auto text-xs text-slate-400">{findings.length} total findings</div>
            </div>

            {/* Findings List */}
            {findings.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-2xl px-8 py-12 text-center">
                    <Target size={32} className="text-slate-300 mx-auto mb-3" />
                    <p className="text-sm text-slate-500">No findings recorded yet.</p>
                    <p className="text-xs text-slate-400 mt-1">Add findings from your document review, site walkdown, interviews, and 6M assessment.</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {findings.map((f, idx) => {
                        const isExpanded = expandedId === f.id;
                        const rc = getRatingConfig(f.rating);
                        return (
                            <div key={f.id} className={`bg-white border rounded-xl overflow-hidden transition-all ${isExpanded ? 'border-red-300 shadow-md' : 'border-slate-200'}`}>
                                {/* Collapsed row */}
                                <button
                                    onClick={() => setExpandedId(isExpanded ? null : f.id)}
                                    className="w-full px-5 py-3 flex items-center justify-between hover:bg-slate-50 transition-colors"
                                >
                                    <div className="flex items-center gap-3 min-w-0 flex-1">
                                        <span className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-white" style={{ background: rc.color }}>
                                            {idx + 1}
                                        </span>
                                        <div className="text-left min-w-0 flex-1">
                                            <p className="text-sm font-medium text-slate-700 truncate">
                                                {f.finding || <span className="text-slate-400 italic">New finding...</span>}
                                            </p>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${rc.color}15`, color: rc.color }}>{rc.label}</span>
                                                <span className="text-[10px] text-slate-400">{f.category}</span>
                                                <span className="text-[10px] text-slate-400">· {f.sixmCategory}</span>
                                            </div>
                                        </div>
                                    </div>
                                    {isExpanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                                </button>

                                {/* Expanded detail */}
                                {isExpanded && (
                                    <div className="px-5 pb-5 border-t border-slate-100 pt-4 space-y-4">
                                        {/* Finding description */}
                                        <div>
                                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Finding Description</label>
                                            <textarea
                                                value={f.finding}
                                                onChange={e => updateFinding(f.id, { finding: e.target.value })}
                                                placeholder="Describe the finding, gap, or observation..."
                                                rows={2}
                                                className="input-field text-sm resize-none"
                                            />
                                        </div>

                                        {/* Classification row */}
                                        <div className="grid grid-cols-3 gap-3">
                                            <div>
                                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Category</label>
                                                <select value={f.category} onChange={e => updateFinding(f.id, { category: e.target.value })} className="input-field text-xs">
                                                    {FINDING_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Rating</label>
                                                <select value={f.rating} onChange={e => updateFinding(f.id, { rating: e.target.value })} className="input-field text-xs">
                                                    {FINDING_RATINGS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">6M Root Cause</label>
                                                <select value={f.sixmCategory} onChange={e => updateFinding(f.id, { sixmCategory: e.target.value })} className="input-field text-xs">
                                                    {SIXM_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                                </select>
                                            </div>
                                        </div>

                                        {/* Impact analysis */}
                                        <div>
                                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2">Impact Analysis</label>
                                            <div className="grid grid-cols-4 gap-2">
                                                {(['businessImpact', 'safetyImpact', 'environmentalImpact', 'productionImpact'] as const).map(key => (
                                                    <div key={key}>
                                                        <label className="block text-[9px] text-slate-400 mb-1">
                                                            {key.replace('Impact', '').replace(/([A-Z])/g, ' $1').trim()}
                                                        </label>
                                                        <select value={f[key]} onChange={e => updateFinding(f.id, { [key]: e.target.value })} className="input-field text-[11px]">
                                                            {IMPACT_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                                                        </select>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        {/* ISO Reference + Risk Rank */}
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">ISO Reference</label>
                                                <input value={f.isoReference} onChange={e => updateFinding(f.id, { isoReference: e.target.value })} placeholder="e.g., ISO 55001 §7.6, ISO 55013" className="input-field text-xs" />
                                            </div>
                                            <div>
                                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Risk Rank (1–25)</label>
                                                <input type="number" min={1} max={25} value={f.riskRank} onChange={e => updateFinding(f.id, { riskRank: parseInt(e.target.value) || 1 })} className="input-field text-xs" />
                                            </div>
                                        </div>

                                        {/* Corrective action */}
                                        <div>
                                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Recommended Action</label>
                                            <textarea
                                                value={f.recommendedAction}
                                                onChange={e => updateFinding(f.id, { recommendedAction: e.target.value })}
                                                placeholder="Specific corrective or improvement action..."
                                                rows={2}
                                                className="input-field text-sm resize-none"
                                            />
                                        </div>

                                        {/* Owner + Due Date */}
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Owner</label>
                                                <input value={f.owner} onChange={e => updateFinding(f.id, { owner: e.target.value })} placeholder="Responsible person / role" className="input-field text-xs" />
                                            </div>
                                            <div>
                                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Target Date</label>
                                                <input type="date" value={f.dueDate} onChange={e => updateFinding(f.id, { dueDate: e.target.value })} className="input-field text-xs" />
                                            </div>
                                        </div>

                                        <div className="flex justify-end">
                                            <button onClick={() => removeFinding(f.id)} className="text-xs text-red-400 hover:text-red-600 flex items-center gap-1 transition-colors">
                                                <Trash2 size={12} /> Remove Finding
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Add Finding */}
            <button
                onClick={addFinding}
                className="w-full py-3 border border-dashed border-red-300 rounded-xl text-red-600 font-bold text-sm hover:bg-red-50 transition-colors flex items-center justify-center gap-2"
            >
                <Plus size={16} /> Add Finding
            </button>

            {/* Navigation */}
            <div className="flex justify-between pt-2">
                <button onClick={onBack} className="px-5 py-3 border border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-slate-50 flex items-center gap-2">
                    <ArrowLeft size={16} /> Back
                </button>
                <button
                    onClick={() => onComplete(findings)}
                    className="px-6 py-3 bg-gradient-to-r from-red-500 to-rose-600 text-white font-bold rounded-xl shadow-md hover:shadow-lg transition-all flex items-center gap-2"
                >
                    Generate Report <ArrowRight size={16} />
                </button>
            </div>
        </div>
    );
};
