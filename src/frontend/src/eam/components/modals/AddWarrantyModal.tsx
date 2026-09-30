/**
 * AddWarrantyModal — one warranty on one asset.
 *
 * Who backs it depends on the type: an OEM warranty is the manufacturer's
 * (pre-filled from the asset's manufacturer; the vendor a claim goes through
 * is optional), an extended warranty or service contract is with a vendor.
 * The dialog stays open until the save resolves and shows the failure inline,
 * so a rejected save never throws away what was typed. Resets on close.
 */
import React, { useEffect, useState } from 'react';
import { X, AlertCircle } from 'lucide-react';
import { FinOpsService, Warranty } from '../../services/FinOpsService';
import { todayDateOnly } from '../../../lib/dateOnly';

interface AddWarrantyModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** Resolves when saved; a throw keeps the dialog open with the message. */
    onSave: (data: Partial<Warranty>) => Promise<void> | void;
    /** The asset's manufacturer, used to pre-fill an OEM warranty. */
    defaultManufacturerId?: string | null;
    defaultManufacturerName?: string | null;
}

type Form = {
    warrantyType: Warranty['warrantyType'];
    manufacturerId: string;
    vendorId: string;
    warrantyNumber: string;
    startDate: string;
    endDate: string;
    maxHours: string;
    deductible: string;
    warrantyValue: string;
    reminderDays: string;
    coverageScope: string;
    exclusions: string;
};

const blank = (mfr?: string | null): Form => ({
    warrantyType: 'OEM',
    manufacturerId: mfr || '',
    vendorId: '',
    warrantyNumber: '',
    startDate: todayDateOnly(),
    endDate: '',
    maxHours: '',
    deductible: '',
    warrantyValue: '',
    reminderDays: '30',
    coverageScope: '',
    exclusions: '',
});

const inputCls = 'w-full px-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:border-blue-500 focus:ring-1 focus:ring-primary-500 outline-none';
const labelCls = 'block text-xs font-bold text-slate-500 uppercase mb-1';

export const AddWarrantyModal: React.FC<AddWarrantyModalProps> = ({ isOpen, onClose, onSave, defaultManufacturerId, defaultManufacturerName }) => {
    const [form, setForm] = useState<Form>(() => blank(defaultManufacturerId));
    const [vendors, setVendors] = useState<{ id: string; name: string }[]>([]);
    const [manufacturers, setManufacturers] = useState<{ id: string; name: string }[]>([]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        setForm(blank(defaultManufacturerId));
        setError(null);
        FinOpsService.getVendorsForPicker().then(setVendors);
        FinOpsService.getManufacturersForPicker().then(list => {
            // The asset's manufacturer may be inactive or missing from the master; keep it selectable.
            if (defaultManufacturerId && !list.some(m => m.id === defaultManufacturerId)) {
                setManufacturers([{ id: defaultManufacturerId, name: defaultManufacturerName || 'Asset manufacturer' }, ...list]);
            } else setManufacturers(list);
        });
    }, [isOpen, defaultManufacturerId, defaultManufacturerName]);

    if (!isOpen) return null;

    const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm(f => ({ ...f, [k]: v }));
    const isOEM = form.warrantyType === 'OEM';
    const num = (s: string) => (s.trim() === '' ? undefined : Number(s));

    const validate = (): string | null => {
        if (!form.startDate) return 'Start date is required.';
        if (form.endDate && form.endDate < form.startDate) return 'End date is before the start date.';
        if (!form.endDate && !num(form.maxHours)) return 'Give an end date, an hour limit, or both — otherwise the warranty never expires.';
        if (isOEM && !form.manufacturerId) return 'An OEM warranty needs the manufacturer that backs it.';
        if (!isOEM && !form.vendorId) return `${form.warrantyType === 'EXTENDED' ? 'An extended warranty' : 'A service contract'} needs the vendor it is with.`;
        for (const [k, label] of [['maxHours', 'Hour limit'], ['deductible', 'Deductible'], ['warrantyValue', 'Warranty value'], ['reminderDays', 'Reminder days']] as const) {
            const v = num(form[k]);
            if (v !== undefined && (!Number.isFinite(v) || v < 0)) return `${label} must be a number of zero or more.`;
        }
        return null;
    };

    const submit = async () => {
        const problem = validate();
        if (problem) { setError(problem); return; }
        setSaving(true); setError(null);
        try {
            await onSave({
                warrantyType: form.warrantyType,
                manufacturerId: form.manufacturerId || null,
                vendorId: form.vendorId || null,
                warrantyNumber: form.warrantyNumber.trim() || undefined,
                startDate: form.startDate,
                endDate: form.endDate || null,
                maxHours: num(form.maxHours) ?? null,
                deductible: num(form.deductible) ?? 0,
                warrantyValue: num(form.warrantyValue) ?? null,
                reminderDays: num(form.reminderDays) ?? 30,
                coverageScope: form.coverageScope.trim() || undefined,
                exclusions: form.exclusions.trim() || null,
                status: 'ACTIVE',
                currentHours: 0,
            });
            onClose();
        } catch (e: any) {
            setError(e?.message || 'The warranty could not be saved.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm sm:p-4 animate-in fade-in duration-200" onClick={saving ? undefined : onClose}>
            <div
                className="bg-white w-full sm:max-w-lg max-h-[92vh] sm:max-h-[88vh] rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col border border-slate-200 pb-[env(safe-area-inset-bottom)]"
                onClick={e => e.stopPropagation()}
            >
                <div className="px-5 py-3 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                    <h3 className="font-bold text-slate-800">Add warranty</h3>
                    <button onClick={onClose} disabled={saving} className="p-2 -mr-2 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100" title="Close">
                        <X size={18} />
                    </button>
                </div>

                <div className="p-5 space-y-4 overflow-y-auto">
                    {error && (
                        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                            <AlertCircle size={16} className="mt-0.5 shrink-0" /> <span>{error}</span>
                        </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className={labelCls}>Warranty type</label>
                            <select value={form.warrantyType} onChange={e => set('warrantyType', e.target.value as Warranty['warrantyType'])} className={inputCls}>
                                <option value="OEM">OEM standard</option>
                                <option value="EXTENDED">Extended warranty</option>
                                <option value="SERVICE_CONTRACT">Service contract</option>
                            </select>
                        </div>
                        <div>
                            <label className={labelCls}>Warranty / contract no.</label>
                            <input value={form.warrantyNumber} onChange={e => set('warrantyNumber', e.target.value)} className={inputCls} placeholder="as printed on the certificate" />
                        </div>

                        {isOEM ? (
                            <>
                                <div>
                                    <label className={labelCls}>Manufacturer (warrantor)</label>
                                    <select value={form.manufacturerId} onChange={e => set('manufacturerId', e.target.value)} className={inputCls}>
                                        <option value="">Select manufacturer…</option>
                                        {manufacturers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                                    </select>
                                    {defaultManufacturerId && form.manufacturerId === defaultManufacturerId && (
                                        <p className="text-[10px] text-slate-400 mt-1">From the asset's nameplate.</p>
                                    )}
                                </div>
                                <div>
                                    <label className={labelCls}>Claims through (optional)</label>
                                    <select value={form.vendorId} onChange={e => set('vendorId', e.target.value)} className={inputCls}>
                                        <option value="">Direct with the manufacturer</option>
                                        {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                                    </select>
                                    <p className="text-[10px] text-slate-400 mt-1">The distributor or contractor who handles claims, if not the OEM.</p>
                                </div>
                            </>
                        ) : (
                            <div className="sm:col-span-2">
                                <label className={labelCls}>Vendor / provider</label>
                                <select value={form.vendorId} onChange={e => set('vendorId', e.target.value)} className={inputCls}>
                                    <option value="">Select vendor…</option>
                                    {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                                </select>
                            </div>
                        )}

                        <div>
                            <label className={labelCls}>Start date</label>
                            <input type="date" value={form.startDate} onChange={e => set('startDate', e.target.value)} className={inputCls} />
                        </div>
                        <div>
                            <label className={labelCls}>End date</label>
                            <input type="date" value={form.endDate} min={form.startDate || undefined} onChange={e => set('endDate', e.target.value)} className={inputCls} />
                        </div>
                        <div>
                            <label className={labelCls}>Hour limit</label>
                            <input type="number" min={0} step={1} value={form.maxHours} onChange={e => set('maxHours', e.target.value)} className={inputCls} placeholder="e.g. 8000 — blank = none" />
                        </div>
                        <div>
                            <label className={labelCls}>Remind me (days before end)</label>
                            <input type="number" min={0} step={1} value={form.reminderDays} onChange={e => set('reminderDays', e.target.value)} className={inputCls} />
                        </div>
                        <div>
                            <label className={labelCls}>Deductible ($)</label>
                            <input type="number" min={0} step="0.01" value={form.deductible} onChange={e => set('deductible', e.target.value)} className={inputCls} placeholder="0" />
                        </div>
                        <div>
                            <label className={labelCls}>Warranty value ($)</label>
                            <input type="number" min={0} step="0.01" value={form.warrantyValue} onChange={e => set('warrantyValue', e.target.value)} className={inputCls} placeholder="optional cap" />
                        </div>
                        <div className="sm:col-span-2">
                            <label className={labelCls}>Coverage</label>
                            <textarea value={form.coverageScope} onChange={e => set('coverageScope', e.target.value)} className={`${inputCls} h-16 resize-y`} placeholder="e.g. Parts and labour on rotating assembly and control system" />
                        </div>
                        <div className="sm:col-span-2">
                            <label className={labelCls}>Exclusions</label>
                            <textarea value={form.exclusions} onChange={e => set('exclusions', e.target.value)} className={`${inputCls} h-14 resize-y`} placeholder="e.g. Consumables; damage from operation outside the nameplate envelope" />
                        </div>
                    </div>
                </div>

                <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex justify-end gap-2">
                    <button onClick={onClose} disabled={saving} className="px-4 py-2 text-slate-600 hover:text-slate-800 font-medium text-sm disabled:opacity-50">Cancel</button>
                    <button onClick={submit} disabled={saving} className="px-4 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-500 text-sm disabled:opacity-50 min-w-[8rem]">
                        {saving ? 'Saving…' : 'Save warranty'}
                    </button>
                </div>
            </div>
        </div>
    );
};
