/**
 * AuditDocReadiness.tsx — Step 2: Document Readiness (Simplified)
 *
 * Lightweight document availability check for client self-service assessments.
 * No file uploads — just Yes / Partial / No / N/A per document.
 * Quick-fill toolbar for fast completion.
 *
 * Full document review (with notes, custom docs) remains in AuditDocReview.tsx for Templates.
 */

import React, { useState, useMemo } from 'react';
import { FileSearch, ArrowRight, ArrowLeft, Check, AlertTriangle, X, Minus, Zap } from 'lucide-react';
import type { DocStatus } from '../../eam/services/AuditTypes';
import { DEFAULT_DOCUMENTS } from '../../eam/services/AuditTypes';

interface DocReadinessItem {
    id: string;
    document: string;
    category: string;
    status: DocStatus;
}

interface Props {
    initialData?: DocReadinessItem[];
    onComplete: (data: DocReadinessItem[]) => void;
    onBack: () => void;
}

const STATUS_PILLS: { value: DocStatus; label: string; icon: React.ReactNode; active: string; }[] = [
    { value: 'received', label: 'Yes',     icon: <Check size={12} />,          active: 'bg-green-100 border-green-300 text-green-700' },
    { value: 'partial',  label: 'Partial', icon: <AlertTriangle size={12} />,  active: 'bg-amber-100 border-amber-300 text-amber-700' },
    { value: 'missing',  label: 'No',      icon: <X size={12} />,             active: 'bg-red-100 border-red-300 text-red-700' },
    { value: 'na',       label: 'N/A',     icon: <Minus size={12} />,         active: 'bg-slate-100 border-slate-300 text-slate-500' },
];

function makeId() { return crypto.randomUUID?.() || Math.random().toString(36).substring(2); }

function initItems(existing?: DocReadinessItem[]): DocReadinessItem[] {
    if (existing?.length) return existing;
    return DEFAULT_DOCUMENTS.map(d => ({
        id: makeId(),
        document: d.document,
        category: d.category,
        status: 'na' as DocStatus,
    }));
}

export const AuditDocReadiness: React.FC<Props> = ({ initialData, onComplete, onBack }) => {
    const [items, setItems] = useState<DocReadinessItem[]>(() => initItems(initialData));

    const categories = useMemo(() => {
        const map = new Map<string, DocReadinessItem[]>();
        items.forEach(item => {
            const list = map.get(item.category) || [];
            list.push(item);
            map.set(item.category, list);
        });
        return Array.from(map.entries());
    }, [items]);

    const stats = useMemo(() => {
        const c = { received: 0, partial: 0, missing: 0, na: 0 };
        items.forEach(i => c[i.status]++);
        return c;
    }, [items]);

    const answered = items.filter(i => i.status !== 'na').length;

    const updateItem = (id: string, status: DocStatus) =>
        setItems(prev => prev.map(i => i.id === id ? { ...i, status } : i));

    const markAllAs = (status: DocStatus) =>
        setItems(prev => prev.map(i => ({ ...i, status })));

    const markRemainingNA = () =>
        setItems(prev => prev.map(i => i.status === 'na' ? i : i));

    return (
        <div className="max-w-3xl mx-auto py-8 px-4 space-y-5">
            {/* Header */}
            <div className="text-center mb-2">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-500/20">
                    <FileSearch size={24} className="text-white" />
                </div>
                <h2 className="text-2xl font-black text-slate-800">Step 2 — Document Readiness</h2>
                <p className="text-sm text-slate-500 mt-1">Quick check — does your organization have these documents available?</p>
                <p className="text-xs text-slate-400 mt-0.5">No uploads required. Just indicate availability status.</p>
            </div>

            {/* Stats + Quick Fill */}
            <div className="bg-white border border-slate-200 rounded-xl px-5 py-3 flex items-center gap-4 flex-wrap">
                {STATUS_PILLS.map(s => (
                    <div key={s.value} className="flex items-center gap-1.5">
                        <span className={`w-5 h-5 rounded flex items-center justify-center ${s.active}`}>{s.icon}</span>
                        <span className="text-xs font-bold text-slate-600">{stats[s.value]}</span>
                        <span className="text-[10px] text-slate-400">{s.label}</span>
                    </div>
                ))}
                <div className="ml-auto flex items-center gap-2">
                    <span className="text-[10px] text-slate-400">{answered}/{items.length} answered</span>
                    <div className="h-4 border-l border-slate-200" />
                    <button onClick={() => markAllAs('received')} className="text-[10px] font-bold text-green-600 hover:text-green-700 flex items-center gap-1">
                        <Zap size={10} /> All Yes
                    </button>
                    <button onClick={() => markAllAs('na')} className="text-[10px] font-bold text-slate-500 hover:text-slate-600 flex items-center gap-1">
                        <Minus size={10} /> All N/A
                    </button>
                </div>
            </div>

            {/* Document Categories */}
            {categories.map(([cat, catItems]) => (
                <div key={cat} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-100">
                        <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wider">{cat}</h3>
                    </div>
                    <div className="divide-y divide-slate-100">
                        {catItems.map(item => (
                            <div key={item.id} className="px-5 py-2.5 flex items-center gap-3">
                                <p className="flex-1 text-sm text-slate-700 min-w-0">{item.document}</p>
                                <div className="flex items-center gap-1 shrink-0">
                                    {STATUS_PILLS.map(s => (
                                        <button
                                            key={s.value}
                                            onClick={() => updateItem(item.id, s.value)}
                                            className={`px-2.5 py-1 text-[10px] font-bold rounded-md border transition-all flex items-center gap-1 ${
                                                item.status === s.value ? s.active : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'
                                            }`}
                                        >
                                            {s.icon} {s.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ))}

            {/* Navigation */}
            <div className="flex justify-between pt-2">
                <button onClick={onBack} className="px-5 py-3 border border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-slate-50 flex items-center gap-2">
                    <ArrowLeft size={16} /> Back
                </button>
                <button
                    onClick={() => onComplete(items)}
                    className="px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white font-bold rounded-xl shadow-md hover:shadow-lg transition-all flex items-center gap-2"
                >
                    Proceed to 6M Assessment <ArrowRight size={16} />
                </button>
            </div>
        </div>
    );
};
