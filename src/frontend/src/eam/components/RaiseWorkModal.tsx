/**
 * RaiseWorkModal — raise a Maintenance Request, Work Order, or PM from Condition
 * Data, pre-filled with the asset + reading context. One modal, a kind selector
 * up top; each kind routes to the right service (createRequest / createWorkOrder
 * / createPM) and navigates to the new record.
 */
import React, { useState, useEffect } from 'react';
import { X, FileText, Wrench, Clock, Save, Loader2, AlertTriangle, Users } from 'lucide-react';
import { DatabaseService } from '../services/DatabaseService';
import { useToast } from '../contexts/ToastContext';
import { useNavigate } from 'react-router-dom';
import type { Asset, WorkCenter } from '../types';

export type RaiseKind = 'REQUEST' | 'WO' | 'PM';

interface Props {
    asset: Asset;
    kind: RaiseKind;
    actor: string;
    requesterId?: string;
    contextNote?: string;
    /** Where this was raised from, e.g. "Condition Data" or "Predict". */
    sourceLabel?: string;
    /** id is the dictionary UUID (service_requests.functional_failure_id is a UUID FK). */
    faultTypes: { id: string; code: string; description: string }[];
    onClose: () => void;
}

const PRIORITIES = [{ v: 'LOW', l: 'Low' }, { v: 'MEDIUM', l: 'Medium' }, { v: 'HIGH', l: 'High' }];
const TIME_UNITS = ['Days', 'Weeks', 'Months', 'Years'];
const METER_UNITS = ['Hours', 'Km', 'Cycles', 'Starts'];
const riskFor = (p: string) => (p === 'HIGH' ? 80 : p === 'MEDIUM' ? 50 : 20);
const unitToDays: Record<string, number> = { Days: 1, Weeks: 7, Months: 30, Years: 365 };

export const RaiseWorkModal: React.FC<Props> = ({ asset, kind: initialKind, actor, requesterId, contextNote, sourceLabel = 'Condition Data', faultTypes, onClose }) => {
    const { showToast } = useToast();
    const navigate = useNavigate();
    const [kind, setKind] = useState<RaiseKind>(initialKind);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const ctx = contextNote ? `\n\n${contextNote}` : '';
    const [title, setTitle] = useState(`${initialKind === 'PM' ? 'PM' : 'Corrective'} — ${asset.tag}`);
    const [description, setDescription] = useState(`Raised from ${sourceLabel}.\nAsset: ${asset.tag} — ${asset.name}${ctx}`);
    const [priority, setPriority] = useState('MEDIUM');
    const [workType, setWorkType] = useState('CM');
    const [faultType, setFaultType] = useState(faultTypes[0]?.id || ''); // dictionary UUID
    // PM-specific
    const [scheduleType, setScheduleType] = useState<'TIME' | 'READING'>('TIME');
    const [interval, setInterval] = useState(1);
    const [freqUnit, setFreqUnit] = useState('Months');
    // Work group (responsible work center)
    const [workCenters, setWorkCenters] = useState<WorkCenter[]>([]);
    // Default the work group from the asset's responsible work centre (SAP-style).
    const [workCenterId, setWorkCenterId] = useState(asset.responsibleWorkCenterId || '');
    useEffect(() => { DatabaseService.getInstance().getWorkCenters(true).then(setWorkCenters).catch(() => setWorkCenters([])); }, []);

    const setKindAndDefaults = (k: RaiseKind) => {
        setKind(k);
        setTitle(`${k === 'PM' ? 'PM' : 'Corrective'} — ${asset.tag}`);
        if (k === 'PM') { setScheduleType('TIME'); setFreqUnit('Months'); }
    };

    const submit = async () => {
        setSaving(true); setErr(null);
        const db = DatabaseService.getInstance();
        const now = new Date().toISOString();
        try {
            if (kind === 'WO') {
                const wo = await db.createWorkOrder({
                    title, description, type: workType, status: 'OPEN',
                    asset_id: asset.id, priority_code: priority,
                    work_center_id: workCenterId || null,
                }, actor);
                showToast('Work order raised.', 'success');
                onClose();
                if ((wo as any)?.id) navigate(`/work-orders/${(wo as any).id}`);
            } else if (kind === 'REQUEST') {
                if (asset.criticality === 'A' && !faultType) throw new Error('Criticality A needs a fault type (ISO 14224).');
                const req = await db.createRequest({
                    id: crypto.randomUUID(),
                    request_number: `REQ-${Date.now().toString(36).toUpperCase()}`,
                    status: 'NEW' as any,
                    description,
                    asset_id: asset.id,
                    requester_id: requesterId || actor,
                    functional_failure_id: faultType,
                    work_center_id: workCenterId || null,
                    risk_score: riskFor(priority),
                    created_at: now, updated_at: now,
                } as any, actor);
                showToast('Maintenance request raised.', 'success');
                onClose();
                if ((req as any)?.id) navigate('/requests');
            } else {
                const days = scheduleType === 'TIME' ? (unitToDays[freqUnit] || 30) * interval : 0;
                await db.createPM({
                    id: crypto.randomUUID(),
                    code: `PM-${Date.now().toString(36).toUpperCase()}`,
                    title, description, status: 'ACTIVE',
                    asset_id: asset.id,
                    schedule_type: scheduleType,
                    frequency_interval: interval,
                    frequency_unit: freqUnit,
                    job_type: 'PM',
                    priority_code: priority,
                    lead_time_days: 7, est_duration: 0, est_downtime: 0,
                    active: true, created_by: requesterId || null,
                    work_center_id: workCenterId || null,
                    next_due_date: new Date(Date.now() + days * 86400000).toISOString(),
                } as any);
                showToast('PM strategy created.', 'success');
                onClose();
                navigate('/recurring-work');
            }
        } catch (e: any) {
            setErr(e?.message || 'Failed to raise.');
        } finally { setSaving(false); }
    };

    const KIND_TABS: { k: RaiseKind; label: string; icon: React.ReactNode; sub: string }[] = [
        { k: 'REQUEST', label: 'Request', icon: <FileText size={14} />, sub: 'For approval → WO' },
        { k: 'WO', label: 'Work Order', icon: <Wrench size={14} />, sub: 'Corrective, direct' },
        { k: 'PM', label: 'PM', icon: <Clock size={14} />, sub: 'Recurring strategy' },
    ];
    const inputCls = 'w-full p-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500/40 focus:border-primary-500 outline-none';

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-150" onClick={e => e.stopPropagation()}>
                <div className="px-5 py-3 flex items-center gap-2 bg-primary-600 text-white flex-shrink-0">
                    <Wrench size={18} />
                    <div className="min-w-0"><h3 className="font-bold text-sm leading-tight">Raise work</h3>
                        <p className="text-[11px] text-white/80 truncate">{asset.tag} · {asset.name}</p></div>
                    <button onClick={onClose} className="ml-auto text-white/80 hover:text-white"><X size={18} /></button>
                </div>

                <div className="p-5 space-y-4 overflow-y-auto">
                    {/* Kind selector */}
                    <div className="grid grid-cols-3 gap-2">
                        {KIND_TABS.map(t => (
                            <button key={t.k} onClick={() => setKindAndDefaults(t.k)}
                                className={`text-left p-2.5 rounded-xl border-2 transition ${kind === t.k ? 'border-primary-400 bg-primary-50' : 'border-slate-200 hover:border-slate-300'}`}>
                                <div className={`flex items-center gap-1.5 font-bold text-xs ${kind === t.k ? 'text-primary-700' : 'text-slate-700'}`}>{t.icon} {t.label}</div>
                                <div className="text-[10px] text-slate-500 mt-0.5">{t.sub}</div>
                            </button>
                        ))}
                    </div>

                    {kind !== 'REQUEST' && (
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Title</label>
                            <input value={title} onChange={e => setTitle(e.target.value)} className={inputCls} />
                        </div>
                    )}

                    {kind === 'REQUEST' && (
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Fault type {asset.criticality === 'A' && <span className="text-red-500">*</span>}</label>
                            <select value={faultType} onChange={e => setFaultType(e.target.value)} className={inputCls}>
                                <option value="">Select fault type…</option>
                                {faultTypes.map(f => <option key={f.id} value={f.id}>{f.description}</option>)}
                            </select>
                            {faultTypes.length === 0 && <p className="text-[11px] text-amber-600 mt-1">No fault types configured — add them under Admin → Dictionaries (FAULT_TYPE).</p>}
                        </div>
                    )}

                    {kind === 'PM' && (
                        <div className="grid grid-cols-3 gap-2">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Basis</label>
                                <select value={scheduleType} onChange={e => { const v = e.target.value as 'TIME' | 'READING'; setScheduleType(v); setFreqUnit(v === 'TIME' ? 'Months' : 'Hours'); }} className={inputCls}>
                                    <option value="TIME">Time</option>
                                    <option value="READING">Meter</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Every</label>
                                <input type="number" min={1} value={interval} onChange={e => setInterval(parseInt(e.target.value) || 1)} className={inputCls} />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Unit</label>
                                <select value={freqUnit} onChange={e => setFreqUnit(e.target.value)} className={inputCls}>
                                    {(scheduleType === 'TIME' ? TIME_UNITS : METER_UNITS).map(u => <option key={u} value={u}>{u}</option>)}
                                </select>
                            </div>
                        </div>
                    )}

                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5 flex items-center gap-1"><Users size={12} /> Work group</label>
                        <select value={workCenterId} onChange={e => setWorkCenterId(e.target.value)} className={inputCls}>
                            <option value="">Unassigned</option>
                            {workCenters.map(w => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
                        </select>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Priority</label>
                            <select value={priority} onChange={e => setPriority(e.target.value)} className={inputCls}>
                                {PRIORITIES.map(p => <option key={p.v} value={p.v}>{p.l}</option>)}
                            </select>
                        </div>
                        {kind === 'WO' && (
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Work type</label>
                                <select value={workType} onChange={e => setWorkType(e.target.value)} className={inputCls}>
                                    <option value="CM">CM — Corrective</option>
                                    <option value="PdM">PdM — Predictive</option>
                                    <option value="EM">EM — Emergency</option>
                                </select>
                            </div>
                        )}
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Description</label>
                        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={4} className={`${inputCls} font-mono text-xs leading-relaxed resize-none`} />
                    </div>

                    {err && <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600"><AlertTriangle size={14} /> {err}</div>}
                </div>

                <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-end gap-2 flex-shrink-0">
                    <button onClick={onClose} className="text-sm font-semibold text-slate-500 hover:bg-slate-50 px-3 py-2 rounded-lg">Cancel</button>
                    <button onClick={submit} disabled={saving || !title.trim() && kind !== 'REQUEST'}
                        className="inline-flex items-center gap-1.5 text-sm font-semibold text-white bg-primary-600 hover:bg-primary-500 disabled:opacity-50 px-4 py-2 rounded-lg">
                        {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                        {kind === 'REQUEST' ? 'Raise request' : kind === 'WO' ? 'Raise work order' : 'Create PM'}
                    </button>
                </div>
            </div>
        </div>
    );
};
