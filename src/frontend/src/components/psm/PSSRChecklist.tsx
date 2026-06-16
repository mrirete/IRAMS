/**
 * PSSRChecklist — OSHA 1910.119(i) Pre-Startup Safety Review
 *
 * Category-based checklist with pass/fail/NA status,
 * completion tracking, and sign-off capability.
 */
import React, { useState, useEffect } from 'react';
import {
    Plus, Trash2, Edit3, Check, X,
    CheckCircle2, XCircle, MinusCircle, Circle,
    Shield, BarChart3, ClipboardList,
} from 'lucide-react';
import psmService from '../../eam/services/PSMService';
import type { PSMStudy, PSSRCheckItem, PSSRItemStatus } from '../../types/safety';

const STATUS_ICONS: Record<PSSRItemStatus, { icon: React.FC<any>; color: string; bg: string }> = {
    pass:        { icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-50' },
    fail:        { icon: XCircle,      color: 'text-red-500',     bg: 'bg-red-50' },
    na:          { icon: MinusCircle,  color: 'text-slate-400',   bg: 'bg-slate-50' },
    not_checked: { icon: Circle,       color: 'text-slate-300',   bg: 'bg-white' },
};

interface PSSRChecklistProps {
    study: PSMStudy;
    onRefresh?: () => void;
}

const PSSRChecklist: React.FC<PSSRChecklistProps> = ({ study, onRefresh }) => {
    const [items, setItems] = useState<PSSRCheckItem[]>([]);
    const [completionPct, setCompletionPct] = useState(0);

    const fetchItems = async () => {
        const data = await psmService.getPSSRItems(study.id);
        setItems(data);
        const pct = await psmService.getPSSRCompletionPct(study.id);
        setCompletionPct(pct);
    };

    useEffect(() => { fetchItems(); }, [study.id]);

    const handleInit = async () => {
        const created = await psmService.initPSSRChecklist(study.id);
        if (created.length > 0) fetchItems();
    };

    const handleStatusChange = async (id: string, status: PSSRItemStatus) => {
        await psmService.updatePSSRItem(id, { status, checked_date: status !== 'not_checked' ? new Date().toISOString() : null });
        fetchItems();
    };

    const handleDeleteItem = async (id: string) => {
        await psmService.deletePSSRItem(id);
        fetchItems();
    };

    // Group items by category
    const categories = items.reduce<Record<string, PSSRCheckItem[]>>((acc, item) => {
        (acc[item.category] = acc[item.category] || []).push(item);
        return acc;
    }, {});

    const totalItems = items.length;
    const passCount = items.filter(i => i.status === 'pass').length;
    const failCount = items.filter(i => i.status === 'fail').length;

    if (items.length === 0) {
        return (
            <div className="space-y-4">
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                    <h2 className="text-lg font-bold text-slate-800">{study.title}</h2>
                    <p className="text-xs text-slate-400 mt-0.5">OSHA 1910.119(i) — Pre-Startup Safety Review</p>
                </div>
                <div className="bg-white border border-dashed border-slate-300 rounded-xl p-12 text-center">
                    <ClipboardList size={32} className="text-slate-300 mx-auto mb-3" />
                    <p className="text-sm text-slate-500 mb-3">No checklist items yet.</p>
                    <button onClick={handleInit}
                        className="text-xs font-medium text-white bg-gradient-to-r from-primary-500 to-primary-500 px-4 py-2 rounded-lg hover:shadow-md transition-all">
                        Initialize Standard PSSR Checklist (25 items)
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Header + progress */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                    <div>
                        <h2 className="text-lg font-bold text-slate-800">{study.title}</h2>
                        <p className="text-xs text-slate-400 mt-0.5">OSHA 1910.119(i) — Pre-Startup Safety Review</p>
                    </div>
                    <span className={`text-2xl font-bold font-mono ${
                        completionPct === 100 ? 'text-emerald-500' : completionPct >= 75 ? 'text-amber-500' : 'text-slate-600'
                    }`}>{completionPct}%</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2">
                    <div className={`h-2 rounded-full transition-all ${
                        completionPct === 100 ? 'bg-emerald-500' : completionPct >= 75 ? 'bg-amber-500' : 'bg-blue-500'
                    }`} style={{ width: `${completionPct}%` }} />
                </div>
                <div className="flex gap-4 mt-2 text-[10px] text-slate-400">
                    <span>Total: {totalItems}</span>
                    <span className="text-emerald-500">Pass: {passCount}</span>
                    <span className="text-red-500">Fail: {failCount}</span>
                    <span>Remaining: {totalItems - passCount - failCount - items.filter(i => i.status === 'na').length}</span>
                </div>
            </div>

            {/* Categories */}
            {Object.entries(categories).map(([category, catItems]) => {
                const catPass = catItems.filter(i => i.status === 'pass').length;
                const catApplicable = catItems.filter(i => i.status !== 'na').length;
                const catPct = catApplicable > 0 ? Math.round((catPass / catApplicable) * 100) : 100;

                return (
                    <div key={category} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                        <div className="flex items-center justify-between p-3 bg-slate-50/50 border-b border-slate-100">
                            <div className="flex items-center gap-2">
                                <Shield size={14} className="text-slate-400" />
                                <span className="text-sm font-semibold text-slate-700">{category}</span>
                            </div>
                            <span className={`text-xs font-mono font-bold ${catPct === 100 ? 'text-emerald-500' : 'text-slate-500'}`}>
                                {catPct}% ({catPass}/{catApplicable})
                            </span>
                        </div>
                        <div className="divide-y divide-slate-50">
                            {catItems.map(item => {
                                const statusInfo = STATUS_ICONS[item.status];
                                const StatusIcon = statusInfo.icon;
                                return (
                                    <div key={item.id} className={`flex items-center gap-3 p-3 ${statusInfo.bg} hover:bg-opacity-80 transition-colors`}>
                                        <StatusIcon size={18} className={statusInfo.color} />
                                        <span className={`flex-1 text-xs ${item.status === 'pass' ? 'text-slate-500 line-through' : 'text-slate-700'}`}>
                                            {item.checklist_item}
                                        </span>
                                        <div className="flex gap-1">
                                            {(['pass', 'fail', 'na', 'not_checked'] as PSSRItemStatus[]).map(s => {
                                                const info = STATUS_ICONS[s];
                                                const Icon = info.icon;
                                                return (
                                                    <button key={s} onClick={() => handleStatusChange(item.id, s)}
                                                        className={`p-1 rounded transition-colors ${item.status === s ? info.color + ' bg-white shadow-sm' : 'text-slate-300 hover:text-slate-500'}`}
                                                        title={s.replace('_', ' ')}>
                                                        <Icon size={14} />
                                                    </button>
                                                );
                                            })}
                                            <button onClick={() => handleDeleteItem(item.id)}
                                                className="p-1 hover:bg-red-50 rounded text-slate-300 hover:text-red-500 ml-1">
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

export default PSSRChecklist;
