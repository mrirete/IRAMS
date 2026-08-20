/**
 * AuditDocReview.tsx — Step 2: Pre-Audit Document Review
 *
 * Standardized checklist of 21 documents grouped by category.
 * Assessor marks each document as Received / Partial / Missing / N/A
 * with optional notes. Custom documents can be added.
 *
 * Standards: ISO 55001 §5-8, ISO 55010, ISO 55011, ISO 55012, ISO 55013,
 *            API 580/581, API RP 754, API RP 75
 */

import React, { useState, useMemo } from 'react';
import { FileSearch, Plus, ArrowRight, ArrowLeft, CheckCircle2, AlertCircle, XCircle, MinusCircle } from 'lucide-react';
import type { DocumentReviewItem, DocStatus } from '../../eam/services/AuditTypes';
import { DEFAULT_DOCUMENTS } from '../../eam/services/AuditTypes';

interface Props {
    initialData?: DocumentReviewItem[];
    onComplete: (data: DocumentReviewItem[]) => void;
    onBack: () => void;
}

const STATUS_OPTIONS: { value: DocStatus; label: string; icon: React.ReactNode; color: string; bg: string }[] = [
    { value: 'received', label: 'Received', icon: <CheckCircle2 size={14} />, color: '#22c55e', bg: 'bg-green-50 border-green-200 text-green-700' },
    { value: 'partial',  label: 'Partial',  icon: <AlertCircle size={14} />,  color: '#f59e0b', bg: 'bg-amber-50 border-amber-200 text-amber-700' },
    { value: 'missing',  label: 'Missing',  icon: <XCircle size={14} />,      color: '#ef4444', bg: 'bg-red-50 border-red-200 text-red-700' },
    { value: 'na',       label: 'N/A',      icon: <MinusCircle size={14} />,  color: '#94a3b8', bg: 'bg-slate-50 border-slate-200 text-slate-500' },
];

function makeId() { return crypto.randomUUID?.() || Math.random().toString(36).substring(2); }

function initItems(existing?: DocumentReviewItem[]): DocumentReviewItem[] {
    if (existing && existing.length) return existing;
    return DEFAULT_DOCUMENTS.map(d => ({
        id: makeId(),
        document: d.document,
        category: d.category,
        isoRef: d.isoRef,
        status: 'missing' as DocStatus,
        notes: '',
    }));
}

export const AuditDocReview: React.FC<Props> = ({ initialData, onComplete, onBack }) => {
    const [items, setItems] = useState<DocumentReviewItem[]>(() => initItems(initialData));
    const [addDoc, setAddDoc] = useState('');
    const [addCat, setAddCat] = useState('Governance');
    const [expandedId, setExpandedId] = useState<string | null>(null);

    // Group by category
    const categories = useMemo(() => {
        const map = new Map<string, DocumentReviewItem[]>();
        items.forEach(item => {
            const list = map.get(item.category) || [];
            list.push(item);
            map.set(item.category, list);
        });
        return Array.from(map.entries());
    }, [items]);

    // Stats
    const stats = useMemo(() => {
        const counts = { received: 0, partial: 0, missing: 0, na: 0 };
        items.forEach(i => counts[i.status]++);
        return counts;
    }, [items]);

    const updateItem = (id: string, patch: Partial<DocumentReviewItem>) => {
        setItems(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i));
    };

    const handleAdd = () => {
        if (!addDoc.trim()) return;
        setItems(prev => [...prev, {
            id: makeId(),
            document: addDoc.trim(),
            category: addCat,
            isoRef: 'Custom',
            status: 'missing',
            notes: '',
        }]);
        setAddDoc('');
    };

    const handleRemoveCustom = (id: string) => {
        setItems(prev => prev.filter(i => i.id !== id || i.isoRef !== 'Custom'));
    };

    return (
        <div className="ers-page-narrow py-8 px-4 space-y-6">
            {/* Header */}
            <div className="text-center mb-2">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-500/20">
                    <FileSearch size={24} className="text-white" />
                </div>
                <h2 className="text-2xl font-black text-slate-800">Step 2 — Document Review</h2>
                <p className="text-sm text-slate-500 mt-1">Pre-audit document request list — mark status for each item</p>
            </div>

            {/* Stats Bar */}
            <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-5 py-3">
                {STATUS_OPTIONS.map(s => (
                    <div key={s.value} className="flex items-center gap-1.5">
                        <span style={{ color: s.color }}>{s.icon}</span>
                        <span className="text-xs font-bold text-slate-600">{stats[s.value]}</span>
                        <span className="text-[10px] text-slate-400">{s.label}</span>
                    </div>
                ))}
                <div className="ml-auto text-xs text-slate-400">{items.length} documents</div>
            </div>

            {/* Category Groups */}
            {categories.map(([category, categoryItems]) => (
                <div key={category} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                    <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                        <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wider">{category}</h3>
                        <span className="text-[10px] text-slate-400">{categoryItems.length} items</span>
                    </div>
                    <div className="divide-y divide-slate-100">
                        {categoryItems.map(item => (
                            <div key={item.id} className="px-5 py-3">
                                <div className="flex items-start gap-3">
                                    {/* Document Name + ISO Ref */}
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-slate-700 truncate">{item.document}</p>
                                        <p className="text-[10px] text-slate-400 mt-0.5">{item.isoRef}</p>
                                    </div>
                                    {/* Status Buttons */}
                                    <div className="flex items-center gap-1">
                                        {STATUS_OPTIONS.map(s => (
                                            <button
                                                key={s.value}
                                                onClick={() => updateItem(item.id, { status: s.value })}
                                                className={`px-2 py-1 text-[10px] font-bold rounded-md border transition-all ${
                                                    item.status === s.value ? s.bg : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'
                                                }`}
                                            >
                                                {s.label}
                                            </button>
                                        ))}
                                    </div>
                                    {/* Expand for notes */}
                                    <button
                                        onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                                        className="text-[10px] text-slate-400 hover:text-slate-600 transition-colors whitespace-nowrap"
                                    >
                                        {expandedId === item.id ? 'Hide' : 'Notes'}
                                    </button>
                                </div>
                                {/* Notes (expanded) */}
                                {expandedId === item.id && (
                                    <div className="mt-2">
                                        <textarea
                                            value={item.notes}
                                            onChange={e => updateItem(item.id, { notes: e.target.value })}
                                            placeholder="Add notes about this document..."
                                            rows={2}
                                            className="input-field resize-none text-xs"
                                        />
                                        {item.isoRef === 'Custom' && (
                                            <button onClick={() => handleRemoveCustom(item.id)} className="text-[10px] text-red-400 hover:text-red-600 mt-1">
                                                Remove custom document
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            ))}

            {/* Add Custom Document */}
            <div className="bg-white border border-dashed border-slate-300 rounded-xl px-5 py-4">
                <p className="text-xs font-bold text-slate-500 uppercase mb-2">Add Custom Document</p>
                <div className="flex items-center gap-2">
                    <input
                        value={addDoc}
                        onChange={e => setAddDoc(e.target.value)}
                        placeholder="Document name..."
                        className="input-field flex-1 text-sm"
                        onKeyDown={e => e.key === 'Enter' && handleAdd()}
                    />
                    <select value={addCat} onChange={e => setAddCat(e.target.value)} className="input-field text-sm w-40">
                        {['Governance', 'Asset Integrity', 'Process Safety', 'Maintenance', 'Data & Competence', 'Financial', 'Regulatory'].map(c => (
                            <option key={c} value={c}>{c}</option>
                        ))}
                    </select>
                    <button onClick={handleAdd} className="p-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors">
                        <Plus size={16} />
                    </button>
                </div>
            </div>

            {/* Navigation */}
            <div className="flex justify-between pt-2">
                <button onClick={onBack} className="px-5 py-3 border border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-slate-50 flex items-center gap-2">
                    <ArrowLeft size={16} /> Back
                </button>
                <button
                    onClick={() => onComplete(items)}
                    className="px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white font-bold rounded-xl shadow-md hover:shadow-lg transition-all flex items-center gap-2"
                >
                    Proceed to Site Verification <ArrowRight size={16} />
                </button>
            </div>
        </div>
    );
};
