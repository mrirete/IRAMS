/**
 * EventTree — IEC 62502:2010 Event Tree Analysis
 *
 * Initiating event → branching headers (safety functions) →
 * outcome branches with calculated frequencies.
 */
import React, { useState, useEffect } from 'react';
import {
    Plus, Trash2, Edit3, Check, X, GitBranch,
} from 'lucide-react';
import psmService, { generateEventTreeBranches } from '../../eam/services/PSMService';
import type { PSMStudy, EventTreeBranch, EventTreeHeader, EventTreeOutcome } from '../../types/safety';
import EventTreeVisual from './diagrams/EventTreeVisual';

interface EventTreeProps {
    study: PSMStudy;
    onRefresh?: () => void;
}

const EventTree: React.FC<EventTreeProps> = ({ study, onRefresh }) => {
    const [trees, setTrees] = useState<EventTreeBranch[]>([]);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState<{
        initiating_event: string;
        ie_frequency: string;
        headers: { name: string; success_prob: string }[];
    }>({ initiating_event: '', ie_frequency: '', headers: [] });

    useEffect(() => {
        psmService.getEventTrees(study.id).then(setTrees);
    }, [study.id]);

    const handleAdd = async () => {
        const tree = await psmService.createEventTree({
            study_id: study.id,
            initiating_event: 'New Initiating Event',
            ie_frequency: 0.01,
            headers: [],
            branches: [],
        });
        if (tree) {
            setTrees(prev => [...prev, tree]);
            startEdit(tree);
        }
    };

    const startEdit = (tree: EventTreeBranch) => {
        setEditingId(tree.id);
        setForm({
            initiating_event: tree.initiating_event,
            ie_frequency: String(tree.ie_frequency || ''),
            headers: (tree.headers || []).map(h => ({ name: h.name, success_prob: String(h.success_prob) })),
        });
    };

    const handleSave = async () => {
        if (!editingId) return;
        const freq = parseFloat(form.ie_frequency) || 0;
        const headers: EventTreeHeader[] = form.headers.map(h => ({
            name: h.name,
            success_prob: parseFloat(h.success_prob) || 0.9,
        }));
        const branches = freq > 0 && headers.length > 0 ? generateEventTreeBranches(freq, headers) : [];

        const updated = await psmService.updateEventTree(editingId, {
            initiating_event: form.initiating_event,
            ie_frequency: freq,
            headers,
            branches,
        });
        if (updated) setTrees(prev => prev.map(t => t.id === editingId ? updated : t));
        setEditingId(null);
    };

    const handleDelete = async (id: string) => {
        const ok = await psmService.deleteEventTree(id);
        if (ok) setTrees(prev => prev.filter(t => t.id !== id));
    };

    const addHeader = () => {
        setForm(f => ({ ...f, headers: [...f.headers, { name: `Function ${f.headers.length + 1}`, success_prob: '0.9' }] }));
    };

    const removeHeader = (idx: number) => {
        setForm(f => ({ ...f, headers: f.headers.filter((_, i) => i !== idx) }));
    };

    const updateHeader = (idx: number, field: 'name' | 'success_prob', value: string) => {
        setForm(f => ({
            ...f,
            headers: f.headers.map((h, i) => i === idx ? { ...h, [field]: value } : h),
        }));
    };

    return (
        <div className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-lg font-bold text-slate-800">{study.title}</h2>
                        <p className="text-xs text-slate-400 mt-0.5">IEC 62502:2010 — Event Tree Analysis</p>
                    </div>
                    <button onClick={handleAdd}
                        className="flex items-center gap-1 text-xs font-medium text-white bg-gradient-to-r from-primary-500 to-primary-500 px-3 py-1.5 rounded-lg hover:shadow-md transition-all">
                        <Plus size={12} /> New Event Tree
                    </button>
                </div>
            </div>

            {trees.map(tree => (
                <div key={tree.id} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                    {editingId === tree.id ? (
                        // Edit mode
                        <div className="p-4 space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-semibold text-slate-500 uppercase mb-1 block">Initiating Event</label>
                                    <input value={form.initiating_event} onChange={e => setForm(f => ({ ...f, initiating_event: e.target.value }))}
                                        className="w-full text-xs border border-slate-200 rounded px-2 py-1.5" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-semibold text-slate-500 uppercase mb-1 block">IE Frequency (/yr)</label>
                                    <input value={form.ie_frequency} onChange={e => setForm(f => ({ ...f, ie_frequency: e.target.value }))}
                                        className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 font-mono" />
                                </div>
                            </div>

                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-[10px] font-semibold text-slate-500 uppercase">Safety Function Headers</span>
                                    <button onClick={addHeader} className="text-[10px] text-primary-600 flex items-center gap-0.5"><Plus size={10} /> Add</button>
                                </div>
                                {form.headers.map((h, idx) => (
                                    <div key={idx} className="flex items-center gap-2 mb-1">
                                        <span className="text-[10px] text-slate-400 w-6">{idx + 1}.</span>
                                        <input value={h.name} onChange={e => updateHeader(idx, 'name', e.target.value)}
                                            className="flex-1 text-xs border border-slate-200 rounded px-2 py-1" placeholder="Function name" />
                                        <div className="flex items-center gap-1">
                                            <span className="text-[10px] text-slate-400">P(success):</span>
                                            <input value={h.success_prob} onChange={e => updateHeader(idx, 'success_prob', e.target.value)}
                                                className="w-16 text-xs border border-slate-200 rounded px-1 py-1 font-mono text-center" />
                                        </div>
                                        <button onClick={() => removeHeader(idx)} className="p-0.5 hover:bg-red-50 rounded"><Trash2 size={12} className="text-slate-400" /></button>
                                    </div>
                                ))}
                            </div>

                            <div className="flex justify-end gap-2">
                                <button onClick={() => setEditingId(null)} className="text-xs px-3 py-1.5 border border-slate-200 rounded-lg">Cancel</button>
                                <button onClick={handleSave} className="text-xs px-3 py-1.5 bg-primary-500 text-white rounded-lg hover:bg-primary-600">Calculate & Save</button>
                            </div>
                        </div>
                    ) : (
                        // Display mode
                        <>
                            <div className="flex items-center justify-between p-3 border-b border-slate-100">
                                <div className="flex items-center gap-2">
                                    <GitBranch size={14} className="text-blue-500" />
                                    <span className="text-sm font-medium text-slate-700">{tree.initiating_event}</span>
                                    <span className="text-[10px] font-mono text-slate-400">
                                        {tree.ie_frequency != null ? `${tree.ie_frequency}/yr` : '—'}
                                    </span>
                                </div>
                                <div className="flex gap-1">
                                    <button onClick={() => startEdit(tree)} className="p-1 hover:bg-slate-100 rounded"><Edit3 size={14} className="text-slate-400" /></button>
                                    <button onClick={() => handleDelete(tree.id)} className="p-1 hover:bg-red-50 rounded"><Trash2 size={14} className="text-slate-400" /></button>
                                </div>
                            </div>

                            {/* Results table */}
                            {tree.branches && tree.branches.length > 0 && (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-xs">
                                        <thead>
                                            <tr className="bg-slate-50 border-b border-slate-100">
                                                {(tree.headers || []).map((h, i) => (
                                                    <th key={i} className="p-2 text-[10px] text-slate-500 font-semibold uppercase text-center">
                                                        {h.name}<br /><span className="text-[9px] font-normal">P={h.success_prob}</span>
                                                    </th>
                                                ))}
                                                <th className="p-2 text-[10px] text-slate-500 font-semibold uppercase">Outcome</th>
                                                <th className="p-2 text-[10px] text-slate-500 font-semibold uppercase text-right">Frequency</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {(tree.branches as EventTreeOutcome[]).map((b, idx) => (
                                                <tr key={idx} className="border-b border-slate-50 hover:bg-slate-50/50">
                                                    {b.path.map((success, i) => (
                                                        <td key={i} className="p-2 text-center">
                                                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                                                success ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                                                            }`}>
                                                                {success ? 'YES' : 'NO'}
                                                            </span>
                                                        </td>
                                                    ))}
                                                    <td className="p-2 text-slate-600">{b.outcome}</td>
                                                    <td className="p-2 text-right font-mono text-slate-600">{b.frequency.toExponential(2)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            {/* Event Tree SVG Diagram */}
                            {tree.branches && tree.branches.length > 0 && tree.headers && tree.headers.length > 0 && (
                                <div className="p-3">
                                    <EventTreeVisual tree={tree} />
                                </div>
                            )}
                        </>
                    )}
                </div>
            ))}

            {trees.length === 0 && (
                <div className="bg-white border border-dashed border-slate-300 rounded-xl p-12 text-center">
                    <GitBranch size={32} className="text-slate-300 mx-auto mb-3" />
                    <p className="text-sm text-slate-500">No event trees. Click "New Event Tree" to begin.</p>
                </div>
            )}
        </div>
    );
};

export default EventTree;
