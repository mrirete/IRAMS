/**
 * AuditSiteVerification.tsx — Step 3: Site Verification (Field Walkdown)
 *
 * 16 default field checks grouped by 8 areas.
 * Each item rated: OK / Minor Gap / Major Gap / Critical
 * with photo reference and notes. Custom observations can be added.
 *
 * Standards: ISO 55013, ISO 55001 §8, API 510/570/653, API 580/581,
 *            API RP 754, IEC 61511, OSHA 1910.147
 */

import React, { useState, useMemo } from 'react';
import { HardHat, Plus, ArrowRight, ArrowLeft, Check, AlertTriangle, XOctagon, ShieldAlert } from 'lucide-react';
import type { SiteVerificationItem, VerificationStatus } from '../../eam/services/AuditTypes';
import { DEFAULT_SITE_CHECKS } from '../../eam/services/AuditTypes';

interface Props {
    initialData?: SiteVerificationItem[];
    onComplete: (data: SiteVerificationItem[]) => void;
    onBack: () => void;
}

const STATUS_CFG: { value: VerificationStatus; label: string; icon: React.ReactNode; color: string; bg: string }[] = [
    { value: 'ok',        label: 'OK',        icon: <Check size={14} />,          color: '#22c55e', bg: 'bg-green-50 border-green-200 text-green-700' },
    { value: 'minor_gap', label: 'Minor',     icon: <AlertTriangle size={14} />,  color: '#f59e0b', bg: 'bg-amber-50 border-amber-200 text-amber-700' },
    { value: 'major_gap', label: 'Major',     icon: <XOctagon size={14} />,       color: '#f97316', bg: 'bg-orange-50 border-orange-200 text-orange-700' },
    { value: 'critical',  label: 'Critical',  icon: <ShieldAlert size={14} />,    color: '#ef4444', bg: 'bg-red-50 border-red-200 text-red-700' },
];

function makeId() { return crypto.randomUUID?.() || Math.random().toString(36).substring(2); }

function initItems(existing?: SiteVerificationItem[]): SiteVerificationItem[] {
    if (existing && existing.length) return existing;
    return DEFAULT_SITE_CHECKS.map(d => ({
        id: makeId(),
        area: d.area,
        checkItem: d.checkItem,
        isoRef: d.isoRef,
        status: 'ok' as VerificationStatus,
        photoRef: '',
        notes: '',
    }));
}

export const AuditSiteVerification: React.FC<Props> = ({ initialData, onComplete, onBack }) => {
    const [items, setItems] = useState<SiteVerificationItem[]>(() => initItems(initialData));
    const [addCheck, setAddCheck] = useState('');
    const [addArea, setAddArea] = useState('Physical Condition');
    const [expandedId, setExpandedId] = useState<string | null>(null);

    // Group by area
    const areas = useMemo(() => {
        const map = new Map<string, SiteVerificationItem[]>();
        items.forEach(item => {
            const list = map.get(item.area) || [];
            list.push(item);
            map.set(item.area, list);
        });
        return Array.from(map.entries());
    }, [items]);

    // Stats
    const stats = useMemo(() => {
        const counts = { ok: 0, minor_gap: 0, major_gap: 0, critical: 0 };
        items.forEach(i => counts[i.status]++);
        return counts;
    }, [items]);

    const updateItem = (id: string, patch: Partial<SiteVerificationItem>) => {
        setItems(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i));
    };

    const handleAdd = () => {
        if (!addCheck.trim()) return;
        setItems(prev => [...prev, {
            id: makeId(),
            area: addArea,
            checkItem: addCheck.trim(),
            isoRef: 'Custom observation',
            status: 'ok',
            photoRef: '',
            notes: '',
        }]);
        setAddCheck('');
    };

    return (
        <div className="ers-page-narrow py-8 px-4 space-y-6">
            {/* Header */}
            <div className="text-center mb-2">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-amber-500/20">
                    <HardHat size={24} className="text-white" />
                </div>
                <h2 className="text-2xl font-black text-slate-800">Step 3 — Site Verification</h2>
                <p className="text-sm text-slate-500 mt-1">Field walkdown observations — rate each check area</p>
            </div>

            {/* Stats Bar */}
            <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-5 py-3">
                {STATUS_CFG.map(s => (
                    <div key={s.value} className="flex items-center gap-1.5">
                        <span style={{ color: s.color }}>{s.icon}</span>
                        <span className="text-xs font-bold text-slate-600">{stats[s.value]}</span>
                        <span className="text-[10px] text-slate-400">{s.label}</span>
                    </div>
                ))}
                <div className="ml-auto text-xs text-slate-400">{items.length} checks</div>
            </div>

            {/* Area Groups */}
            {areas.map(([area, areaItems]) => (
                <div key={area} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                    <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                        <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wider">{area}</h3>
                        <span className="text-[10px] text-slate-400">{areaItems.length} checks</span>
                    </div>
                    <div className="divide-y divide-slate-100">
                        {areaItems.map(item => (
                            <div key={item.id} className="px-5 py-3">
                                <div className="flex items-start gap-3">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-slate-700">{item.checkItem}</p>
                                        <p className="text-[10px] text-slate-400 mt-0.5">{item.isoRef}</p>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        {STATUS_CFG.map(s => (
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
                                    <button
                                        onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                                        className="text-[10px] text-slate-400 hover:text-slate-600 transition-colors whitespace-nowrap"
                                    >
                                        {expandedId === item.id ? 'Hide' : 'Details'}
                                    </button>
                                </div>
                                {expandedId === item.id && (
                                    <div className="mt-2 grid grid-cols-2 gap-2">
                                        <div>
                                            <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Photo Reference</label>
                                            <input
                                                value={item.photoRef}
                                                onChange={e => updateItem(item.id, { photoRef: e.target.value })}
                                                placeholder="Photo ID / filename..."
                                                className="input-field text-xs"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Notes</label>
                                            <input
                                                value={item.notes}
                                                onChange={e => updateItem(item.id, { notes: e.target.value })}
                                                placeholder="Observation notes..."
                                                className="input-field text-xs"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            ))}

            {/* Add Custom Observation */}
            <div className="bg-white border border-dashed border-slate-300 rounded-xl px-5 py-4">
                <p className="text-xs font-bold text-slate-500 uppercase mb-2">Add Custom Observation</p>
                <div className="flex items-center gap-2">
                    <input
                        value={addCheck}
                        onChange={e => setAddCheck(e.target.value)}
                        placeholder="Observation description..."
                        className="input-field flex-1 text-sm"
                        onKeyDown={e => e.key === 'Enter' && handleAdd()}
                    />
                    <select value={addArea} onChange={e => setAddArea(e.target.value)} className="input-field text-sm w-48">
                        {['Asset Register', 'Physical Condition', 'Inspection Status', 'Maintenance Execution', 'Safety-Critical', 'Permit-to-Work', 'Field Compliance', 'Housekeeping'].map(a => (
                            <option key={a} value={a}>{a}</option>
                        ))}
                    </select>
                    <button onClick={handleAdd} className="p-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors">
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
                    className="px-6 py-3 bg-gradient-to-r from-amber-500 to-orange-600 text-white font-bold rounded-xl shadow-md hover:shadow-lg transition-all flex items-center gap-2"
                >
                    Proceed to Interviews <ArrowRight size={16} />
                </button>
            </div>
        </div>
    );
};
