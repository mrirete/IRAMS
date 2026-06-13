/**
 * PHAWorksheet — OSHA 1910.119(e) Process Hazard Analysis
 *
 * Supports "What-If" and "Checklist" methodologies.
 * Each row captures: question, hazard, consequence, safeguards,
 * severity/likelihood, risk ranking, and recommendations.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
    Plus, Trash2, Edit3, Check, X,
    HelpCircle, ClipboardList, Save,
    FileText, Users, Calendar,
} from 'lucide-react';
import psmService from '../../eam/services/PSMService';
import type { PSMStudy, PHAItem, PHAItemType } from '../../types/safety';

function calcRiskRanking(s: number | null, l: number | null): string {
    if (!s || !l) return '';
    const score = s * l;
    if (score >= 15) return 'H';
    if (score >= 6) return 'M';
    return 'L';
}

const RISK_COLORS: Record<string, string> = {
    'H': 'bg-red-100 text-red-700 border-red-200',
    'M': 'bg-amber-100 text-amber-700 border-amber-200',
    'L': 'bg-emerald-100 text-emerald-700 border-emerald-200',
};

const STATUS_COLORS: Record<string, string> = {
    open: 'bg-blue-100 text-blue-700',
    in_progress: 'bg-amber-100 text-amber-700',
    completed: 'bg-emerald-100 text-emerald-700',
    verified: 'bg-blue-100 text-blue-700',
    cancelled: 'bg-slate-100 text-slate-500',
};

// ═══════════════════════════════════════════════════════════════
//  PHA Item Row (inline editing)
// ═══════════════════════════════════════════════════════════════

function PHARow({ item, onUpdate, onDelete }: {
    item: PHAItem;
    onUpdate: (id: string, updates: Partial<PHAItem>) => void;
    onDelete: (id: string) => void;
}) {
    const [editing, setEditing] = useState(false);
    const [form, setForm] = useState(item);

    const handleSave = () => {
        const ranking = calcRiskRanking(form.severity, form.likelihood);
        onUpdate(item.id, { ...form, risk_ranking: ranking });
        setEditing(false);
    };

    if (editing) {
        return (
            <tr className="bg-teal-50/30">
                <td className="p-2">
                    <select value={form.item_type} onChange={e => setForm(f => ({ ...f, item_type: e.target.value as PHAItemType }))}
                        className="w-full text-xs border border-slate-200 rounded px-2 py-1">
                        <option value="what_if">What-If</option>
                        <option value="checklist">Checklist</option>
                    </select>
                </td>
                <td className="p-2">
                    <textarea value={form.question} onChange={e => setForm(f => ({ ...f, question: e.target.value }))}
                        className="w-full text-xs border border-slate-200 rounded px-2 py-1 min-h-[40px]"
                        placeholder={form.item_type === 'what_if' ? 'What if...?' : 'Is/Does...?'} />
                </td>
                <td className="p-2">
                    <textarea value={form.hazard || ''} onChange={e => setForm(f => ({ ...f, hazard: e.target.value }))}
                        className="w-full text-xs border border-slate-200 rounded px-2 py-1 min-h-[40px]" placeholder="Hazard identified..." />
                </td>
                <td className="p-2">
                    <textarea value={form.consequence || ''} onChange={e => setForm(f => ({ ...f, consequence: e.target.value }))}
                        className="w-full text-xs border border-slate-200 rounded px-2 py-1 min-h-[40px]" placeholder="Potential consequence..." />
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
                    <textarea value={form.recommendation || ''} onChange={e => setForm(f => ({ ...f, recommendation: e.target.value }))}
                        className="w-full text-xs border border-slate-200 rounded px-2 py-1 min-h-[40px]" placeholder="Recommendation..." />
                </td>
                <td className="p-2">
                    <select value={form.action_status} onChange={e => setForm(f => ({ ...f, action_status: e.target.value as any }))}
                        className="w-full text-xs border border-slate-200 rounded px-1 py-1">
                        <option value="open">Open</option>
                        <option value="in_progress">In Progress</option>
                        <option value="completed">Completed</option>
                        <option value="verified">Verified</option>
                        <option value="cancelled">Cancelled</option>
                    </select>
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

    const ranking = item.risk_ranking || calcRiskRanking(item.severity, item.likelihood);

    return (
        <tr className="group hover:bg-slate-50/50 border-b border-slate-50">
            <td className="p-2">
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                    item.item_type === 'what_if' ? 'bg-blue-50 text-blue-600' : 'bg-blue-50 text-blue-600'
                }`}>
                    {item.item_type === 'what_if' ? 'What-If' : 'Checklist'}
                </span>
            </td>
            <td className="p-2 text-xs text-slate-700 font-medium max-w-[160px]">{item.question}</td>
            <td className="p-2 text-xs text-slate-500 max-w-[120px] truncate" title={item.hazard || ''}>{item.hazard}</td>
            <td className="p-2 text-xs text-slate-500 max-w-[120px] truncate" title={item.consequence || ''}>{item.consequence}</td>
            <td className="p-2 text-xs text-slate-500 max-w-[100px] truncate" title={item.safeguards || ''}>{item.safeguards}</td>
            <td className="p-2 text-xs text-center font-mono">{item.severity ?? '—'}</td>
            <td className="p-2 text-xs text-center font-mono">{item.likelihood ?? '—'}</td>
            <td className="p-2 text-xs text-slate-500 max-w-[120px] truncate" title={item.recommendation || ''}>{item.recommendation}</td>
            <td className="p-2">
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${STATUS_COLORS[item.action_status] || ''}`}>
                    {item.action_status}
                </span>
            </td>
            <td className="p-2">
                <div className="flex items-center gap-1">
                    {ranking && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-bold ${RISK_COLORS[ranking] || ''}`}>
                            {ranking}
                        </span>
                    )}
                    <button onClick={() => { setForm(item); setEditing(true); }}
                        className="p-1 hover:bg-slate-100 rounded text-slate-400 opacity-0 group-hover:opacity-100"><Edit3 size={12} /></button>
                    <button onClick={() => onDelete(item.id)}
                        className="p-1 hover:bg-red-50 rounded text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100"><Trash2 size={12} /></button>
                </div>
            </td>
        </tr>
    );
}

// ═══════════════════════════════════════════════════════════════
//  Main PHA Worksheet
// ═══════════════════════════════════════════════════════════════

interface PHAWorksheetProps {
    study: PSMStudy;
    onRefresh?: () => void;
}

const PHAWorksheet: React.FC<PHAWorksheetProps> = ({ study, onRefresh }) => {
    const [items, setItems] = useState<PHAItem[]>([]);
    const [methodology, setMethodology] = useState<PHAItemType>('what_if');
    const [editingTitle, setEditingTitle] = useState(false);
    const [title, setTitle] = useState(study.title);

    useEffect(() => {
        setTitle(study.title);
        psmService.getPHAItems(study.id).then(setItems);
    }, [study.id, study.title]);

    const handleAdd = async () => {
        const item = await psmService.createPHAItem({
            study_id: study.id,
            item_type: methodology,
            question: methodology === 'what_if' ? 'What if...?' : 'Is/Does...?',
            action_status: 'open',
            sort_order: items.length,
        });
        if (item) setItems(prev => [...prev, item]);
    };

    const handleUpdate = async (id: string, updates: Partial<PHAItem>) => {
        const updated = await psmService.updatePHAItem(id, updates);
        if (updated) setItems(prev => prev.map(i => i.id === id ? updated : i));
    };

    const handleDelete = async (id: string) => {
        const ok = await psmService.deletePHAItem(id);
        if (ok) setItems(prev => prev.filter(i => i.id !== id));
    };

    const handleSaveTitle = async () => {
        await psmService.updateStudy(study.id, { title });
        setEditingTitle(false);
        onRefresh?.();
    };

    const whatIfCount = items.filter(i => i.item_type === 'what_if').length;
    const checklistCount = items.filter(i => i.item_type === 'checklist').length;
    const openActions = items.filter(i => i.action_status === 'open').length;

    return (
        <div className="space-y-4">
            {/* Study Header */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                    {editingTitle ? (
                        <div className="flex items-center gap-2 flex-1">
                            <input value={title} onChange={e => setTitle(e.target.value)}
                                className="text-lg font-bold border border-slate-200 rounded-lg px-3 py-1 flex-1" />
                            <button onClick={handleSaveTitle} className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100"><Check size={16} /></button>
                            <button onClick={() => setEditingTitle(false)} className="p-1.5 bg-red-50 text-red-500 rounded-lg hover:bg-red-100"><X size={16} /></button>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2">
                            <h2 className="text-lg font-bold text-slate-800">{study.title}</h2>
                            <button onClick={() => setEditingTitle(true)} className="p-1 hover:bg-slate-100 rounded text-slate-400"><Edit3 size={14} /></button>
                        </div>
                    )}
                    <span className={`text-[10px] px-2 py-1 rounded-full font-semibold ${
                        study.status === 'approved' ? 'bg-emerald-50 text-emerald-600' :
                        study.status === 'in_progress' ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-500'
                    }`}>{study.status.replace('_', ' ').toUpperCase()}</span>
                </div>

                <div className="flex items-center gap-4 text-xs text-slate-400">
                    <span className="flex items-center gap-1"><FileText size={12} /> OSHA 1910.119(e)</span>
                    <span className="flex items-center gap-1"><HelpCircle size={12} /> {whatIfCount} What-If</span>
                    <span className="flex items-center gap-1"><ClipboardList size={12} /> {checklistCount} Checklist</span>
                    <span className={`flex items-center gap-1 ${openActions > 0 ? 'text-amber-500 font-medium' : ''}`}>
                        Open actions: {openActions}
                    </span>
                </div>
            </div>

            {/* Methodology toggle + Add */}
            <div className="flex items-center justify-between">
                <div className="flex bg-slate-100 p-0.5 rounded-lg">
                    <button onClick={() => setMethodology('what_if')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                            methodology === 'what_if' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-500'
                        }`}>
                        <HelpCircle size={12} /> What-If
                    </button>
                    <button onClick={() => setMethodology('checklist')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                            methodology === 'checklist' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-500'
                        }`}>
                        <ClipboardList size={12} /> Checklist
                    </button>
                </div>

                <button onClick={handleAdd}
                    className="flex items-center gap-1 text-xs font-medium text-white bg-gradient-to-r from-teal-500 to-cyan-500 px-3 py-1.5 rounded-lg hover:shadow-md hover:shadow-teal-500/20 transition-all">
                    <Plus size={12} /> Add Item
                </button>
            </div>

            {/* PHA Table */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-slate-50/80 border-b border-slate-100">
                                <th className="p-2 text-[10px] text-slate-500 font-semibold uppercase tracking-wider w-20">Type</th>
                                <th className="p-2 text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Question</th>
                                <th className="p-2 text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Hazard</th>
                                <th className="p-2 text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Consequence</th>
                                <th className="p-2 text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Safeguards</th>
                                <th className="p-2 text-[10px] text-slate-500 font-semibold uppercase tracking-wider text-center w-12">S</th>
                                <th className="p-2 text-[10px] text-slate-500 font-semibold uppercase tracking-wider text-center w-12">L</th>
                                <th className="p-2 text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Recommendation</th>
                                <th className="p-2 text-[10px] text-slate-500 font-semibold uppercase tracking-wider w-20">Status</th>
                                <th className="p-2 text-[10px] text-slate-500 font-semibold uppercase tracking-wider w-20">Risk</th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.map(item => (
                                <PHARow key={item.id} item={item} onUpdate={handleUpdate} onDelete={handleDelete} />
                            ))}
                            {items.length === 0 && (
                                <tr>
                                    <td colSpan={10} className="p-8 text-center text-slate-400 text-xs">
                                        No items yet. Add a {methodology === 'what_if' ? '"What-If"' : '"Checklist"'} item to begin.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default PHAWorksheet;
