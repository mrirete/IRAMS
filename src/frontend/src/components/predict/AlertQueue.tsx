/**
 * AlertQueue — an asset's prediction alerts as a triage queue (0391).
 *
 *   New ──► Acknowledged ──► In progress ──► Closed · outcome
 *
 * Every alert ends with a recorded outcome. The outcome is the precision
 * verdict (confirmed fault / known condition = real, no fault found = false
 * alarm, duplicate = not counted), so the precision number comes from real
 * results rather than optional clicks.
 *
 * An alert raised by a vibration capture asks for a follow-up capture once
 * its work is done, and the close pop-up sets the two side by side (RepairCheck).
 */
import React, { useMemo, useState } from 'react';
import { ShieldCheck, CheckCircle2, Wrench, Flag, Loader2, Eye, ClipboardCheck, Activity } from 'lucide-react';
import type { PredictionAlert, AlertOutcome, AlertStatus } from '../../types/intelligence';
import { Modal } from '../../eam/components/ui';
import { RepairCheck } from './RepairCheck';
import { CAPTURE_ALERT_PREFIX, alertPointOf } from '../../lib/predict/vibrationCaptures';

const fromCapture = (a: PredictionAlert) => a.alert_id.startsWith(CAPTURE_ALERT_PREFIX);

type Filter = 'open' | AlertStatus;

const STATUS_LABEL: Record<AlertStatus, string> = { new: 'New', acknowledged: 'Acknowledged', in_progress: 'In progress', closed: 'Closed' };
const STATUS_TONE: Record<AlertStatus, string> = {
    new: 'bg-red-50 text-red-700 border-red-200',
    acknowledged: 'bg-amber-50 text-amber-700 border-amber-200',
    in_progress: 'bg-blue-50 text-blue-700 border-blue-200',
    closed: 'bg-slate-100 text-slate-600 border-slate-200',
};

export const OUTCOMES: { value: AlertOutcome; label: string; meaning: string; tone: string }[] = [
    { value: 'confirmed_fault', label: 'Confirmed fault', meaning: 'The problem was real and was found.', tone: 'text-emerald-700' },
    { value: 'no_fault_found', label: 'No fault found', meaning: 'Checked — nothing wrong. Counts as a false alarm.', tone: 'text-orange-700' },
    { value: 'known_condition', label: 'Known condition', meaning: 'Real, but already known and accepted.', tone: 'text-slate-700' },
    { value: 'duplicate', label: 'Duplicate', meaning: 'Another alert covers this. Not counted.', tone: 'text-slate-500' },
];
const outcomeLabel = (o?: AlertOutcome | null) => OUTCOMES.find(x => x.value === o)?.label ?? '—';

interface Props {
    alerts: PredictionAlert[];
    canClose: boolean;
    onAcknowledge: (a: PredictionAlert) => Promise<{ ok: boolean; message?: string }>;
    onRaiseWork: (a: PredictionAlert) => void;
    /** Remaining-life alerts: ask for a condition reading before committing the work. */
    onRequestReading?: (a: PredictionAlert) => void;
    onClose: (a: PredictionAlert, outcome: AlertOutcome, notes: string) => Promise<{ ok: boolean; message?: string }>;
    /** Renders the diagnosis / metadata block of one alert (kept where it was). */
    renderDetail: (a: PredictionAlert) => React.ReactNode;
}

export const AlertQueue: React.FC<Props> = ({ alerts, canClose, onAcknowledge, onRaiseWork, onRequestReading, onClose, renderDetail }) => {
    const [filter, setFilter] = useState<Filter>('open');
    const [busy, setBusy] = useState<string | null>(null);
    const [msg, setMsg] = useState<Record<string, string>>({});
    const [closing, setClosing] = useState<PredictionAlert | null>(null);

    const statusOf = (a: PredictionAlert): AlertStatus => a.status ?? 'new';
    const counts = useMemo(() => {
        const c: Record<Filter, number> = { open: 0, new: 0, acknowledged: 0, in_progress: 0, closed: 0 };
        for (const a of alerts) { const s = statusOf(a); c[s]++; if (s !== 'closed') c.open++; }
        return c;
    }, [alerts]);
    const shown = alerts.filter(a => (filter === 'open' ? statusOf(a) !== 'closed' : statusOf(a) === filter));

    const ack = async (a: PredictionAlert) => {
        setBusy(a.alert_id);
        const r = await onAcknowledge(a);
        setBusy(null);
        setMsg(m => ({ ...m, [a.alert_id]: r.ok ? '' : (r.message || 'Not acknowledged.') }));
    };

    const chips: Filter[] = ['open', 'new', 'acknowledged', 'in_progress', 'closed'];
    return (
        <div>
            <div className="flex flex-wrap gap-1.5 mb-4" role="tablist" aria-label="Alert status">
                {chips.map(f => (
                    <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
                        className={`px-2.5 py-1 rounded-full border text-[11px] font-semibold transition-colors ${filter === f ? 'bg-primary-50 border-primary-300 text-primary-700' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                        {f === 'open' ? 'Open' : STATUS_LABEL[f]} <span className="tabular-nums opacity-70">{counts[f]}</span>
                    </button>
                ))}
            </div>

            {shown.length === 0 ? (
                <div className="text-center py-6">
                    <ShieldCheck size={28} className="mx-auto text-accent-safe/50 mb-2" />
                    <p className="text-sm text-slate-400">{filter === 'open' ? 'No open alerts for this asset.' : `No ${STATUS_LABEL[filter as AlertStatus].toLowerCase()} alerts.`}</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {shown.map(a => {
                        const s = statusOf(a);
                        const high = a.severity === 'high' || (a.severity as string) === 'critical' || a.severity === 'emergency';
                        return (
                            <div key={a.alert_id} className="relative pl-4 border-l-2 border-slate-200 pb-3 last:pb-0">
                                <div className={`absolute -left-1.5 top-1.5 w-2.5 h-2.5 rounded-full ${high ? 'bg-red-500' : a.severity === 'medium' ? 'bg-yellow-500' : 'bg-slate-400'}`} />
                                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${STATUS_TONE[s]}`}>{STATUS_LABEL[s]}</span>
                                    <span className="text-xs text-slate-400">{new Date(a.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                                </div>
                                <p className={`text-sm font-semibold ${high ? 'text-red-600' : a.severity === 'medium' ? 'text-amber-600' : 'text-slate-700'}`}>{a.title}</p>
                                {a.description && <p className="text-xs text-slate-500 mt-1 mb-2 leading-relaxed">{a.description}</p>}

                                {renderDetail(a)}

                                {/* Where the work stands */}
                                {s === 'in_progress' && (
                                    <p className={`text-[11px] mb-2 flex items-center gap-1.5 ${a.work_done_at ? 'text-emerald-700 font-semibold' : 'text-blue-700'}`}>
                                        {a.work_done_at
                                            ? <><ClipboardCheck size={12} /> Work done — {fromCapture(a) ? `take a capture on ${alertPointOf(a.title)} to confirm, then record the outcome.` : 'record the outcome.'}</>
                                            : <><Wrench size={12} /> {a.work_order_id ? 'Work order open.' : 'Work request raised.'}</>}
                                    </p>
                                )}
                                {s === 'closed' && (
                                    <p className="text-[11px] text-slate-500 mb-2">
                                        <b className="text-slate-700">{outcomeLabel(a.outcome)}</b>
                                        {a.closed_at ? ` · ${new Date(a.closed_at).toLocaleDateString()}` : ''}
                                        {a.outcome_notes ? ` · ${a.outcome_notes}` : ''}
                                    </p>
                                )}

                                {s !== 'closed' && (
                                    <div className="flex flex-wrap gap-1.5 mt-1">
                                        {s === 'new' && (
                                            <button onClick={() => ack(a)} disabled={busy === a.alert_id}
                                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 disabled:opacity-50">
                                                {busy === a.alert_id ? <Loader2 size={11} className="animate-spin" /> : <Eye size={11} />} Acknowledge
                                            </button>
                                        )}
                                        {a.alert_type === 'rul_warning' && onRequestReading && s !== 'in_progress' && (
                                            <button onClick={() => onRequestReading(a)}
                                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100">
                                                <Activity size={11} /> Request a reading
                                            </button>
                                        )}
                                        {s !== 'in_progress' && (
                                            <button onClick={() => onRaiseWork(a)}
                                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100">
                                                <Wrench size={11} /> Raise work request
                                            </button>
                                        )}
                                        {canClose ? (
                                            <button onClick={() => setClosing(a)}
                                                className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md border ${a.work_done_at ? 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-500' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}>
                                                <Flag size={11} /> Close with outcome
                                            </button>
                                        ) : (
                                            <span className="text-[10px] text-slate-400 self-center">A reliability engineer or supervisor closes alerts.</span>
                                        )}
                                    </div>
                                )}
                                {msg[a.alert_id] && <p className="text-[11px] text-red-600 mt-1">{msg[a.alert_id]}</p>}
                            </div>
                        );
                    })}
                </div>
            )}

            {closing && (
                <CloseAlertModal
                    alert={closing}
                    onCancel={() => setClosing(null)}
                    onConfirm={async (o, notes) => {
                        const r = await onClose(closing, o, notes);
                        if (r.ok) setClosing(null);
                        return r;
                    }}
                />
            )}
        </div>
    );
};

const CloseAlertModal: React.FC<{
    alert: PredictionAlert;
    onCancel: () => void;
    onConfirm: (o: AlertOutcome, notes: string) => Promise<{ ok: boolean; message?: string }>;
}> = ({ alert, onCancel, onConfirm }) => {
    const [outcome, setOutcome] = useState<AlertOutcome | null>(null);
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const needsNote = outcome === 'no_fault_found' || outcome === 'known_condition';

    const submit = async () => {
        if (!outcome || (needsNote && !notes.trim())) return;
        setSaving(true);
        setError(null);
        const r = await onConfirm(outcome, notes);
        setSaving(false);
        if (!r.ok) setError(r.message || 'Not closed.');
    };

    return (
        <Modal
            open
            onClose={onCancel}
            size="md"
            title={<span className="flex items-center gap-2"><Flag size={16} className="text-slate-500" /> Close alert</span>}
            footer={
                <>
                    <button onClick={onCancel} className="px-4 py-2 bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-lg text-sm font-medium">Cancel</button>
                    <button onClick={submit} disabled={!outcome || (needsNote && !notes.trim()) || saving}
                        className="px-5 py-2 bg-primary-600 hover:bg-primary-500 disabled:opacity-40 text-white rounded-lg text-sm font-bold">
                        {saving ? 'Closing…' : 'Close alert'}
                    </button>
                </>
            }
        >
            <div className="space-y-4">
                <p className="text-sm font-semibold text-slate-800">{alert.title}</p>
                {fromCapture(alert) && <RepairCheck alert={alert} />}
                <fieldset>
                    <legend className="text-xs font-semibold text-slate-600 mb-2">What did you find?</legend>
                    <div className="space-y-2">
                        {OUTCOMES.map(o => (
                            <label key={o.value} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${outcome === o.value ? 'border-primary-400 bg-primary-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                                <input type="radio" name="alert-outcome" value={o.value} checked={outcome === o.value} onChange={() => setOutcome(o.value)} className="mt-0.5" />
                                <span>
                                    <span className={`block text-sm font-semibold ${o.tone}`}>{o.label}</span>
                                    <span className="block text-[12px] text-slate-500">{o.meaning}</span>
                                </span>
                            </label>
                        ))}
                    </div>
                </fieldset>
                <div>
                    <label htmlFor="alert-outcome-notes" className="text-xs font-semibold text-slate-600">
                        Notes {needsNote ? <span className="text-red-600">(required)</span> : <span className="text-slate-400 font-normal">(optional)</span>}
                    </label>
                    <textarea id="alert-outcome-notes" value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                        placeholder={outcome === 'no_fault_found' ? 'What was checked, and what did it show?' : outcome === 'known_condition' ? 'Which known condition, and why it is accepted?' : 'What was found or done?'}
                        className="w-full mt-1 p-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-primary-500 resize-none" />
                </div>
                {outcome && (
                    <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
                        <CheckCircle2 size={12} className="text-slate-400" />
                        {outcome === 'duplicate' ? 'Not counted in alert precision.' : outcome === 'no_fault_found' ? 'Counts as a false alarm in alert precision.' : 'Counts as a real alert in alert precision.'}
                    </p>
                )}
                {error && <p className="text-xs text-red-600">{error}</p>}
            </div>
        </Modal>
    );
};

export default AlertQueue;
