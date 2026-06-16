/**
 * HAZOPWorksheet — IEC 61882:2016 HAZOP Study Worksheet
 *
 * Structure: Node → Deviations (Guide Word × Parameter)
 * Each deviation row captures: cause, consequence, safeguards,
 * severity/likelihood, risk ranking, and recommendations.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
    Plus, Trash2, Edit3, Check, X, ChevronDown, ChevronRight,
    Save, AlertTriangle, Layers, FileText, Users, Calendar,
} from 'lucide-react';
import psmService from '../../eam/services/PSMService';
import type { PSMStudy, HAZOPNode, HAZOPDeviation } from '../../types/safety';

// ── IEC 61882 Guide Words ──────────────────────────────────
const GUIDE_WORDS = ['NO', 'MORE', 'LESS', 'REVERSE', 'PART OF', 'AS WELL AS', 'OTHER THAN', 'EARLY', 'LATE', 'BEFORE', 'AFTER'];
const PARAMETERS = ['Flow', 'Pressure', 'Temperature', 'Level', 'Composition', 'Phase', 'Speed', 'Viscosity', 'Reaction', 'Time', 'Sequence', 'Signal'];

const RISK_COLORS: Record<string, string> = {
    'H': 'bg-red-100 text-red-700 border-red-200',
    'M': 'bg-amber-100 text-amber-700 border-amber-200',
    'L': 'bg-emerald-100 text-emerald-700 border-emerald-200',
};

function calcRiskRanking(s: number | null, l: number | null): string {
    if (!s || !l) return '';
    const score = s * l;
    if (score >= 15) return 'H';
    if (score >= 6) return 'M';
    return 'L';
}

// ═══════════════════════════════════════════════════════════════
//  Deviation Row
// ═══════════════════════════════════════════════════════════════

function DeviationRow({ dev, onUpdate, onDelete }: {
    dev: HAZOPDeviation;
    onUpdate: (id: string, updates: Partial<HAZOPDeviation>) => void;
    onDelete: (id: string) => void;
}) {
    const [editing, setEditing] = useState(false);
    const [form, setForm] = useState(dev);

    const handleSave = () => {
        const ranking = calcRiskRanking(form.severity, form.likelihood);
        onUpdate(dev.id, { ...form, risk_ranking: ranking });
        setEditing(false);
    };

    if (editing) {
        return (
            <tr className="bg-primary-50/30">
                <td className="p-2">
                    <select value={form.guide_word} onChange={e => setForm(f => ({ ...f, guide_word: e.target.value }))}
                        className="w-full text-xs border border-slate-200 rounded px-2 py-1 focus:ring-2 focus:ring-primary-400/30">
                        {GUIDE_WORDS.map(gw => <option key={gw} value={gw}>{gw}</option>)}
                    </select>
                </td>
                <td className="p-2">
                    <select value={form.parameter} onChange={e => setForm(f => ({ ...f, parameter: e.target.value }))}
                        className="w-full text-xs border border-slate-200 rounded px-2 py-1 focus:ring-2 focus:ring-primary-400/30">
                        {PARAMETERS.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                </td>
                <td className="p-2">
                    <input value={form.deviation} onChange={e => setForm(f => ({ ...f, deviation: e.target.value }))}
                        className="w-full text-xs border border-slate-200 rounded px-2 py-1" placeholder="e.g. No Flow" />
                </td>
                <td className="p-2">
                    <textarea value={form.causes || ''} onChange={e => setForm(f => ({ ...f, causes: e.target.value }))}
                        className="w-full text-xs border border-slate-200 rounded px-2 py-1 min-h-[40px]" placeholder="Causes..." />
                </td>
                <td className="p-2">
                    <textarea value={form.consequences || ''} onChange={e => setForm(f => ({ ...f, consequences: e.target.value }))}
                        className="w-full text-xs border border-slate-200 rounded px-2 py-1 min-h-[40px]" placeholder="Consequences..." />
                </td>
                <td className="p-2">
                    <textarea value={form.safeguards || ''} onChange={e => setForm(f => ({ ...f, safeguards: e.target.value }))}
                        className="w-full text-xs border border-slate-200 rounded px-2 py-1 min-h-[40px]" placeholder="Existing safeguards..." />
                </td>
                <td className="p-2 text-center">
                    <select value={form.severity ?? ''} onChange={e => setForm(f => ({ ...f, severity: e.target.value ? Number(e.target.value) : null }))}
                        className="w-14 text-xs border border-slate-200 rounded px-1 py-1 text-center">
                        <option value="">—</option>
                        {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                </td>
                <td className="p-2 text-center">
                    <select value={form.likelihood ?? ''} onChange={e => setForm(f => ({ ...f, likelihood: e.target.value ? Number(e.target.value) : null }))}
                        className="w-14 text-xs border border-slate-200 rounded px-1 py-1 text-center">
                        <option value="">—</option>
                        {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                </td>
                <td className="p-2">
                    <textarea value={form.recommendations || ''} onChange={e => setForm(f => ({ ...f, recommendations: e.target.value }))}
                        className="w-full text-xs border border-slate-200 rounded px-2 py-1 min-h-[40px]" placeholder="Recommendations..." />
                </td>
                <td className="p-2">
                    <div className="flex gap-1">
                        <button onClick={handleSave} className="p-1 hover:bg-emerald-100 rounded text-emerald-600"><Check size={14} /></button>
                        <button onClick={() => setEditing(false)} className="p-1 hover:bg-red-100 rounded text-red-500"><X size={14} /></button>
                    </div>
                </td>
            </tr>
        );
    }

    const ranking = dev.risk_ranking || calcRiskRanking(dev.severity, dev.likelihood);

    return (
        <tr className="group hover:bg-slate-50/50 border-b border-slate-50">
            <td className="p-2 text-xs font-medium text-blue-600">{dev.guide_word}</td>
            <td className="p-2 text-xs text-slate-600">{dev.parameter}</td>
            <td className="p-2 text-xs text-slate-700 font-medium">{dev.deviation}</td>
            <td className="p-2 text-xs text-slate-500 max-w-[120px] truncate" title={dev.causes || ''}>{dev.causes}</td>
            <td className="p-2 text-xs text-slate-500 max-w-[120px] truncate" title={dev.consequences || ''}>{dev.consequences}</td>
            <td className="p-2 text-xs text-slate-500 max-w-[100px] truncate" title={dev.safeguards || ''}>{dev.safeguards}</td>
            <td className="p-2 text-xs text-center font-mono">{dev.severity ?? '—'}</td>
            <td className="p-2 text-xs text-center font-mono">{dev.likelihood ?? '—'}</td>
            <td className="p-2 text-xs text-slate-500 max-w-[120px] truncate" title={dev.recommendations || ''}>{dev.recommendations}</td>
            <td className="p-2">
                <div className="flex items-center gap-1">
                    {ranking && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-bold ${RISK_COLORS[ranking] || ''}`}>
                            {ranking}
                        </span>
                    )}
                    <button onClick={() => { setForm(dev); setEditing(true); }}
                        className="p-1 hover:bg-slate-100 rounded text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Edit3 size={12} />
                    </button>
                    <button onClick={() => onDelete(dev.id)}
                        className="p-1 hover:bg-red-50 rounded text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Trash2 size={12} />
                    </button>
                </div>
            </td>
        </tr>
    );
}

// ═══════════════════════════════════════════════════════════════
//  Node Section (collapsible)
// ═══════════════════════════════════════════════════════════════

function NodeSection({ node, onUpdateNode, onDeleteNode, onRefresh }: {
    node: HAZOPNode;
    onUpdateNode: (id: string, updates: Partial<HAZOPNode>) => void;
    onDeleteNode: (id: string) => void;
    onRefresh: () => void;
}) {
    const [expanded, setExpanded] = useState(true);
    const [deviations, setDeviations] = useState<HAZOPDeviation[]>([]);
    const [editingNode, setEditingNode] = useState(false);
    const [nodeName, setNodeName] = useState(node.node_name);
    const [designIntent, setDesignIntent] = useState(node.design_intent || '');
    const [drawingRef, setDrawingRef] = useState(node.drawing_ref || '');

    useEffect(() => {
        psmService.getDeviations(node.id).then(setDeviations);
    }, [node.id]);

    const handleAddDeviation = async () => {
        const dev = await psmService.createDeviation({
            node_id: node.id,
            guide_word: 'NO',
            parameter: 'Flow',
            deviation: 'No Flow',
            action_status: 'open',
            sort_order: deviations.length,
        });
        if (dev) setDeviations(prev => [...prev, dev]);
    };

    const handleUpdateDeviation = async (id: string, updates: Partial<HAZOPDeviation>) => {
        const updated = await psmService.updateDeviation(id, updates);
        if (updated) setDeviations(prev => prev.map(d => d.id === id ? updated : d));
    };

    const handleDeleteDeviation = async (id: string) => {
        const ok = await psmService.deleteDeviation(id);
        if (ok) setDeviations(prev => prev.filter(d => d.id !== id));
    };

    const handleSaveNode = async () => {
        onUpdateNode(node.id, { node_name: nodeName, design_intent: designIntent, drawing_ref: drawingRef });
        setEditingNode(false);
    };

    return (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            {/* Node header */}
            <div className="flex items-center gap-3 p-3 bg-slate-50/50 border-b border-slate-100 cursor-pointer"
                 onClick={() => setExpanded(!expanded)}>
                {expanded ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}

                {editingNode ? (
                    <div className="flex-1 flex items-center gap-2" onClick={e => e.stopPropagation()}>
                        <input value={nodeName} onChange={e => setNodeName(e.target.value)}
                            className="text-sm font-semibold border border-slate-200 rounded px-2 py-1 flex-1" />
                        <input value={designIntent} onChange={e => setDesignIntent(e.target.value)}
                            className="text-xs border border-slate-200 rounded px-2 py-1 flex-1" placeholder="Design intent..." />
                        <input value={drawingRef} onChange={e => setDrawingRef(e.target.value)}
                            className="text-xs border border-slate-200 rounded px-2 py-1 w-32" placeholder="P&ID ref..." />
                        <button onClick={handleSaveNode} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"><Check size={14} /></button>
                        <button onClick={() => setEditingNode(false)} className="p-1 text-red-500 hover:bg-red-50 rounded"><X size={14} /></button>
                    </div>
                ) : (
                    <div className="flex-1 flex items-center gap-3">
                        <span className="text-sm font-semibold text-slate-700">{node.node_name}</span>
                        {node.design_intent && <span className="text-xs text-slate-400 italic">— {node.design_intent}</span>}
                        {node.drawing_ref && <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded font-mono">{node.drawing_ref}</span>}
                        <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">{deviations.length} deviations</span>
                    </div>
                )}

                <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                    <button onClick={() => setEditingNode(true)} className="p-1 hover:bg-slate-100 rounded text-slate-400"><Edit3 size={14} /></button>
                    <button onClick={() => onDeleteNode(node.id)} className="p-1 hover:bg-red-50 rounded text-slate-400 hover:text-red-500"><Trash2 size={14} /></button>
                </div>
            </div>

            {/* Deviations table */}
            {expanded && (
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-slate-50/80 border-b border-slate-100">
                                <th className="p-2 text-[10px] text-slate-500 font-semibold uppercase tracking-wider w-20">Guide Word</th>
                                <th className="p-2 text-[10px] text-slate-500 font-semibold uppercase tracking-wider w-24">Parameter</th>
                                <th className="p-2 text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Deviation</th>
                                <th className="p-2 text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Causes</th>
                                <th className="p-2 text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Consequences</th>
                                <th className="p-2 text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Safeguards</th>
                                <th className="p-2 text-[10px] text-slate-500 font-semibold uppercase tracking-wider text-center w-12">S</th>
                                <th className="p-2 text-[10px] text-slate-500 font-semibold uppercase tracking-wider text-center w-12">L</th>
                                <th className="p-2 text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Recommendations</th>
                                <th className="p-2 text-[10px] text-slate-500 font-semibold uppercase tracking-wider w-20">Risk</th>
                            </tr>
                        </thead>
                        <tbody>
                            {deviations.map(dev => (
                                <DeviationRow key={dev.id} dev={dev} onUpdate={handleUpdateDeviation} onDelete={handleDeleteDeviation} />
                            ))}
                        </tbody>
                    </table>

                    <div className="p-3 border-t border-slate-50">
                        <button onClick={handleAddDeviation}
                            className="flex items-center gap-1.5 text-xs text-primary-600 hover:text-primary-700 font-medium hover:bg-primary-50 px-3 py-1.5 rounded-lg transition-colors">
                            <Plus size={12} /> Add Deviation
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════
//  Main HAZOP Worksheet
// ═══════════════════════════════════════════════════════════════

interface HAZOPWorksheetProps {
    study: PSMStudy;
    onRefresh?: () => void;
}

const HAZOPWorksheet: React.FC<HAZOPWorksheetProps> = ({ study, onRefresh }) => {
    const [nodes, setNodes] = useState<HAZOPNode[]>([]);
    const [editingStudy, setEditingStudy] = useState(false);
    const [title, setTitle] = useState(study.title);

    useEffect(() => {
        setTitle(study.title);
        psmService.getHazopNodes(study.id).then(setNodes);
    }, [study.id, study.title]);

    const handleAddNode = async () => {
        const node = await psmService.createHazopNode({
            study_id: study.id,
            node_name: `Node ${nodes.length + 1}`,
            sort_order: nodes.length,
        });
        if (node) setNodes(prev => [...prev, node]);
    };

    const handleUpdateNode = async (id: string, updates: Partial<HAZOPNode>) => {
        const updated = await psmService.updateHazopNode(id, updates);
        if (updated) setNodes(prev => prev.map(n => n.id === id ? updated : n));
    };

    const handleDeleteNode = async (id: string) => {
        const ok = await psmService.deleteHazopNode(id);
        if (ok) setNodes(prev => prev.filter(n => n.id !== id));
    };

    const handleSaveTitle = async () => {
        await psmService.updateStudy(study.id, { title });
        setEditingStudy(false);
        onRefresh?.();
    };

    return (
        <div className="space-y-4">
            {/* Study Header */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                    {editingStudy ? (
                        <div className="flex items-center gap-2 flex-1">
                            <input value={title} onChange={e => setTitle(e.target.value)}
                                className="text-lg font-bold border border-slate-200 rounded-lg px-3 py-1 flex-1" />
                            <button onClick={handleSaveTitle} className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100"><Check size={16} /></button>
                            <button onClick={() => setEditingStudy(false)} className="p-1.5 bg-red-50 text-red-500 rounded-lg hover:bg-red-100"><X size={16} /></button>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2">
                            <h2 className="text-lg font-bold text-slate-800">{study.title}</h2>
                            <button onClick={() => setEditingStudy(true)} className="p-1 hover:bg-slate-100 rounded text-slate-400"><Edit3 size={14} /></button>
                        </div>
                    )}
                    <span className={`text-[10px] px-2 py-1 rounded-full font-semibold ${
                        study.status === 'approved' ? 'bg-emerald-50 text-emerald-600' :
                        study.status === 'in_progress' ? 'bg-blue-50 text-blue-600' :
                        'bg-slate-100 text-slate-500'
                    }`}>{study.status.replace('_', ' ').toUpperCase()}</span>
                </div>

                <div className="flex items-center gap-4 text-xs text-slate-400">
                    <span className="flex items-center gap-1"><FileText size={12} /> IEC 61882:2016</span>
                    {study.asset_tag && <span className="flex items-center gap-1"><Layers size={12} /> {study.asset_tag} — {study.asset_name}</span>}
                    {study.facilitator && <span className="flex items-center gap-1"><Users size={12} /> {study.facilitator}</span>}
                    {study.study_date && <span className="flex items-center gap-1"><Calendar size={12} /> {new Date(study.study_date).toLocaleDateString()}</span>}
                    <span className="flex items-center gap-1"><AlertTriangle size={12} /> {nodes.length} nodes</span>
                </div>
            </div>

            {/* Nodes */}
            {nodes.map(node => (
                <NodeSection
                    key={node.id}
                    node={node}
                    onUpdateNode={handleUpdateNode}
                    onDeleteNode={handleDeleteNode}
                    onRefresh={() => onRefresh?.()}
                />
            ))}

            {/* Add Node */}
            <button onClick={handleAddNode}
                className="w-full flex items-center justify-center gap-2 p-4 border-2 border-dashed border-slate-300 rounded-xl text-sm font-medium text-slate-500 hover:border-primary-400 hover:text-primary-600 hover:bg-primary-50/30 transition-all">
                <Plus size={16} /> Add Process Node
            </button>
        </div>
    );
};

export default HAZOPWorksheet;
