/**
 * AddInsuranceModal — one policy on one asset. Stays open until the save
 * resolves and shows the failure inline (insurer and policy number are NOT
 * NULL in the table; a blank used to reach the database and fail after the
 * dialog had already closed and dropped the input). Resets on close.
 */
import React, { useEffect, useState } from 'react';
import { X, AlertCircle } from 'lucide-react';
import { AssetInsurance } from '../../services/FinOpsService';
import { todayDateOnly } from '../../../lib/dateOnly';

interface AddInsuranceModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** Resolves when saved; a throw keeps the dialog open with the message. */
    onSave: (data: Partial<AssetInsurance>) => Promise<void> | void;
    /** Pre-fill for insured value (the asset's replacement value when known). */
    defaultInsuredValue?: number;
}

type Form = {
    provider: string;
    policyNumber: string;
    coverageType: NonNullable<AssetInsurance['coverageType']>;
    startDate: string;
    endDate: string;
    premium: string;
    deductible: string;
    insuredValue: string;
    renewalReminderDays: string;
};

const blank = (insured?: number): Form => ({
    provider: '', policyNumber: '', coverageType: 'ALL_RISK',
    startDate: todayDateOnly(), endDate: '',
    premium: '', deductible: '', insuredValue: insured && insured > 0 ? String(insured) : '',
    renewalReminderDays: '30',
});

const inputCls = 'w-full px-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:border-blue-500 focus:ring-1 focus:ring-primary-500 outline-none';
const labelCls = 'block text-xs font-bold text-slate-500 uppercase mb-1';

export const AddInsuranceModal: React.FC<AddInsuranceModalProps> = ({ isOpen, onClose, onSave, defaultInsuredValue }) => {
    const [form, setForm] = useState<Form>(() => blank(defaultInsuredValue));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => { if (isOpen) { setForm(blank(defaultInsuredValue)); setError(null); } }, [isOpen, defaultInsuredValue]);

    if (!isOpen) return null;

    const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm(f => ({ ...f, [k]: v }));
    const num = (s: string) => (s.trim() === '' ? 0 : Number(s));

    const validate = (): string | null => {
        if (!form.provider.trim()) return 'Insurer is required.';
        if (!form.policyNumber.trim()) return 'Policy number is required.';
        if (!form.startDate) return 'Coverage start date is required.';
        if (!form.endDate) return 'Coverage end date is required.';
        if (form.endDate < form.startDate) return 'Coverage ends before it starts.';
        for (const [k, label] of [['premium', 'Premium'], ['deductible', 'Deductible'], ['insuredValue', 'Insured value'], ['renewalReminderDays', 'Reminder days']] as const) {
            const v = num(form[k]);
            if (!Number.isFinite(v) || v < 0) return `${label} must be a number of zero or more.`;
        }
        return null;
    };

    const submit = async () => {
        const problem = validate();
        if (problem) { setError(problem); return; }
        setSaving(true); setError(null);
        try {
            await onSave({
                provider: form.provider.trim(),
                policyNumber: form.policyNumber.trim(),
                coverageType: form.coverageType,
                startDate: form.startDate,
                endDate: form.endDate,
                premiumAmount: num(form.premium),
                deductible: num(form.deductible),
                insuredValue: num(form.insuredValue),
                renewalReminderDays: num(form.renewalReminderDays) || 30,
                status: 'ACTIVE',
            });
            onClose();
        } catch (e: any) {
            setError(e?.message || 'The policy could not be saved.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm sm:p-4 animate-in fade-in duration-200" onClick={saving ? undefined : onClose}>
            <div
                className="bg-white w-full sm:max-w-md max-h-[92vh] sm:max-h-[88vh] rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col border border-slate-200 pb-[env(safe-area-inset-bottom)]"
                onClick={e => e.stopPropagation()}
            >
                <div className="px-5 py-3 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                    <h3 className="font-bold text-slate-800">Add insurance policy</h3>
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
                            <label className={labelCls}>Insurer</label>
                            <input value={form.provider} onChange={e => set('provider', e.target.value)} placeholder="e.g. Allianz" className={inputCls} />
                        </div>
                        <div>
                            <label className={labelCls}>Policy number</label>
                            <input value={form.policyNumber} onChange={e => set('policyNumber', e.target.value)} placeholder="e.g. POL-123456" className={inputCls} />
                        </div>
                        <div className="sm:col-span-2">
                            <label className={labelCls}>Coverage type</label>
                            <select value={form.coverageType} onChange={e => set('coverageType', e.target.value as Form['coverageType'])} className={inputCls}>
                                <option value="ALL_RISK">All risk</option>
                                <option value="FIRE">Fire only</option>
                                <option value="THEFT">Theft only</option>
                                <option value="LIABILITY">Liability</option>
                            </select>
                        </div>
                        <div>
                            <label className={labelCls}>Coverage start</label>
                            <input type="date" value={form.startDate} onChange={e => set('startDate', e.target.value)} className={inputCls} />
                        </div>
                        <div>
                            <label className={labelCls}>Coverage end</label>
                            <input type="date" value={form.endDate} min={form.startDate || undefined} onChange={e => set('endDate', e.target.value)} className={inputCls} />
                        </div>
                        <div>
                            <label className={labelCls}>Annual premium ($)</label>
                            <input type="number" min={0} step="0.01" value={form.premium} onChange={e => set('premium', e.target.value)} className={inputCls} placeholder="0" />
                        </div>
                        <div>
                            <label className={labelCls}>Deductible ($)</label>
                            <input type="number" min={0} step="0.01" value={form.deductible} onChange={e => set('deductible', e.target.value)} className={inputCls} placeholder="0" />
                        </div>
                        <div>
                            <label className={labelCls}>Insured value ($)</label>
                            <input type="number" min={0} step="0.01" value={form.insuredValue} onChange={e => set('insuredValue', e.target.value)} className={inputCls} placeholder="0" />
                        </div>
                        <div>
                            <label className={labelCls}>Renewal reminder (days before)</label>
                            <input type="number" min={0} step={1} value={form.renewalReminderDays} onChange={e => set('renewalReminderDays', e.target.value)} className={inputCls} />
                        </div>
                    </div>
                </div>
                <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex justify-end gap-2">
                    <button onClick={onClose} disabled={saving} className="px-4 py-2 text-slate-600 hover:text-slate-800 font-medium text-sm disabled:opacity-50">Cancel</button>
                    <button onClick={submit} disabled={saving} className="px-4 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-500 text-sm disabled:opacity-50 min-w-[7rem]">
                        {saving ? 'Saving…' : 'Save policy'}
                    </button>
                </div>
            </div>
        </div>
    );
};
