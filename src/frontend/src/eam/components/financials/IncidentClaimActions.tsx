/**
 * IncidentClaimActions — the next step on an insurance incident's claim.
 *
 *   OPEN ──Submit claim──▶ SUBMITTED ──Record settlement──▶ SETTLED ──Close──▶ CLOSED
 *     └──Close (no claim)        └──Close (declined / withdrawn)
 *
 * One primary button for the next step, a quiet "Close" beside it, and a
 * small dialog (bottom sheet on a phone) for the figures the step needs. The
 * database trigger (0397) is the rule; the dialog shows its message inline.
 * A settlement is recorded, not posted to the cost ledger.
 */
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, AlertCircle } from 'lucide-react';
import { FinOpsService, InsuranceIncident } from '../../services/FinOpsService';
import { currencySym, money } from '../../../lib/fiscal';
import { todayDateOnly } from '../../../lib/dateOnly';

type Step = 'SUBMITTED' | 'SETTLED' | 'CLOSED';

interface Props {
    incident: Pick<InsuranceIncident, 'id' | 'incidentNumber' | 'claimStatus' | 'claimAmount' | 'estimatedDamage' | 'totalCost'>;
    canEdit: boolean;
    onChanged: () => void;
}

const inputCls = 'w-full px-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:border-blue-500 focus:ring-1 focus:ring-primary-500 outline-none';
const labelCls = 'block text-xs font-bold text-slate-500 uppercase mb-1';

export const IncidentClaimActions: React.FC<Props> = ({ incident, canEdit, onChanged }) => {
    const [step, setStep] = useState<Step | null>(null);
    const [amount, setAmount] = useState('');
    const [reference, setReference] = useState('');
    const [date, setDate] = useState(todayDateOnly());
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!canEdit || incident.claimStatus === 'CLOSED') return null;

    const open = (s: Step) => {
        setStep(s); setError(null); setReference(''); setDate(todayDateOnly());
        // Pre-fill what we know: the damage estimate for a claim, the claimed amount for a settlement.
        const guess = s === 'SUBMITTED' ? (incident.totalCost || incident.estimatedDamage || 0) : s === 'SETTLED' ? (incident.claimAmount || 0) : 0;
        setAmount(guess > 0 ? String(guess) : '');
    };

    const submit = async () => {
        if (!step) return;
        setSaving(true); setError(null);
        try {
            const n = amount.trim() === '' ? undefined : Number(amount);
            if (step === 'SUBMITTED') await FinOpsService.advanceIncidentClaim(incident.id, 'SUBMITTED', { claimAmount: n, claimReference: reference, submittedDate: date });
            else if (step === 'SETTLED') await FinOpsService.advanceIncidentClaim(incident.id, 'SETTLED', { settlementAmount: n, settlementDate: date });
            else await FinOpsService.advanceIncidentClaim(incident.id, 'CLOSED');
            setStep(null);
            onChanged();
        } catch (e: any) {
            setError(e?.message || 'The step could not be saved.');
        } finally {
            setSaving(false);
        }
    };

    const primary: { step: Step; label: string } | null =
        incident.claimStatus === 'OPEN' ? { step: 'SUBMITTED', label: 'Submit claim' }
        : incident.claimStatus === 'SUBMITTED' ? { step: 'SETTLED', label: 'Record settlement' }
        : incident.claimStatus === 'SETTLED' ? { step: 'CLOSED', label: 'Close' }
        : null;
    const closeLabel = incident.claimStatus === 'OPEN' ? 'Close — no claim' : incident.claimStatus === 'SUBMITTED' ? 'Close — declined' : null;

    const title = step === 'SUBMITTED' ? 'Submit insurance claim' : step === 'SETTLED' ? 'Record settlement' : 'Close incident';

    return (
        <>
            <div className="flex flex-wrap items-center gap-1.5">
                {primary && (
                    <button type="button" onClick={() => open(primary.step)} className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-primary-600 text-white hover:bg-primary-500">
                        {primary.label}
                    </button>
                )}
                {closeLabel && (
                    <button type="button" onClick={() => open('CLOSED')} className="px-2 py-1 text-[11px] font-medium rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100">
                        {closeLabel}
                    </button>
                )}
            </div>

            {step && createPortal(
                <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm sm:p-4" onClick={saving ? undefined : () => setStep(null)}>
                    <div className="bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden pb-[env(safe-area-inset-bottom)]" onClick={e => e.stopPropagation()}>
                        <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                            <div>
                                <h3 className="font-bold text-slate-800 text-sm">{title}</h3>
                                <p className="text-[11px] text-slate-500 font-mono">{incident.incidentNumber}</p>
                            </div>
                            <button type="button" onClick={() => setStep(null)} disabled={saving} className="p-2 -mr-2 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100" title="Close"><X size={18} /></button>
                        </div>
                        <div className="p-5 space-y-3">
                            {error && <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700"><AlertCircle size={14} className="mt-0.5 shrink-0" /><span>{error}</span></div>}
                            {step === 'SUBMITTED' && (
                                <>
                                    <div><label className={labelCls}>Amount claimed ({currencySym()})</label><input type="number" min={0} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} className={inputCls} autoFocus /></div>
                                    <div><label className={labelCls}>Insurer's claim reference</label><input value={reference} onChange={e => setReference(e.target.value)} className={inputCls} placeholder="optional — as the insurer issues it" /></div>
                                    <div><label className={labelCls}>Submitted on</label><input type="date" value={date} max={todayDateOnly()} onChange={e => setDate(e.target.value)} className={inputCls} /></div>
                                </>
                            )}
                            {step === 'SETTLED' && (
                                <>
                                    <div>
                                        <label className={labelCls}>Amount the insurer paid ({currencySym()})</label>
                                        <input type="number" min={0} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} className={inputCls} autoFocus />
                                        {incident.claimAmount ? <p className="text-[10px] text-slate-400 mt-1">Claimed {money(incident.claimAmount, { decimals: 2 })}. Enter 0 if the insurer paid nothing.</p> : null}
                                    </div>
                                    <div><label className={labelCls}>Settled on</label><input type="date" value={date} max={todayDateOnly()} onChange={e => setDate(e.target.value)} className={inputCls} /></div>
                                    <p className="text-[11px] text-slate-500">Recorded against the incident. It is not posted to the maintenance cost ledger — an insurance payout is income, not a lower repair cost.</p>
                                </>
                            )}
                            {step === 'CLOSED' && (
                                <p className="text-sm text-slate-600">
                                    {incident.claimStatus === 'OPEN' ? 'Close this incident without making a claim? It cannot be reopened.'
                                        : incident.claimStatus === 'SUBMITTED' ? 'Close this claim as declined or withdrawn? It cannot be reopened.'
                                        : 'Close this settled claim? Its figures are final.'}
                                </p>
                            )}
                        </div>
                        <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex justify-end gap-2">
                            <button type="button" onClick={() => setStep(null)} disabled={saving} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 disabled:opacity-50">Cancel</button>
                            <button type="button" onClick={submit} disabled={saving} className={`px-4 py-2 text-sm font-medium rounded-lg text-white disabled:opacity-50 ${step === 'CLOSED' ? 'bg-slate-700 hover:bg-slate-800' : 'bg-primary-600 hover:bg-primary-500'}`}>
                                {saving ? 'Saving…' : step === 'SUBMITTED' ? 'Submit claim' : step === 'SETTLED' ? 'Record settlement' : 'Close'}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body,
            )}
        </>
    );
};

/** A one-line claim summary for an incident row. */
export function incidentClaimSummary(i: Pick<InsuranceIncident, 'claimStatus' | 'claimAmount' | 'claimReference' | 'settlementAmount' | 'settlementDate'>): string | null {
    if (i.claimStatus === 'SETTLED' || (i.claimStatus === 'CLOSED' && i.settlementAmount != null)) {
        return `Settled ${money(i.settlementAmount ?? 0)}${i.claimAmount ? ` of ${money(i.claimAmount)} claimed` : ''}${i.settlementDate ? ` · ${i.settlementDate}` : ''}`;
    }
    if (i.claimStatus === 'SUBMITTED' || (i.claimStatus === 'CLOSED' && i.claimAmount)) {
        return `Claimed ${money(i.claimAmount ?? 0)}${i.claimReference ? ` · ref ${i.claimReference}` : ''}${i.claimStatus === 'CLOSED' ? ' · declined / withdrawn' : ''}`;
    }
    return null;
}
