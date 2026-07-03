/**
 * CreatePMFromWeibullModal — Bridge Reliability → Work Management
 *
 * Pre-populates a RecurringWorkRecord from Weibull analysis data:
 * - PM interval derived from β/η (% of characteristic life)
 * - Asset locked to the analysed equipment
 * - Description includes analysis provenance (β, η, R², data basis)
 *
 * HITL: User can review, adjust, and confirm before saving.
 */
import React, { useState, useMemo, useEffect } from 'react';
import {
    X, Wrench, CheckCircle, AlertTriangle, TrendingUp,
    Calendar, Clock, Shield, Info, Loader2,
} from 'lucide-react';
import { DatabaseService } from '../../eam/services/DatabaseService';

// ─── Props ──────────────────────────────────────────────────
export interface WeibullPMData {
    asset: { id: string; tag: string; name: string };
    beta: number;
    eta: number;          // hours
    r2: number;
    b10: number;          // hours
    pmInterval: number;   // hours (recommended)
    dataPoints: number;   // number of failure intervals used
    // Population (asset-class) mode — when set, the PM applies to the whole class,
    // and the fit was pooled across every asset in it. `asset` is the representative.
    className?: string;
    classAssets?: { id: string; tag: string; name: string }[];
}

interface CreatePMFromWeibullModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: (pmId?: string, pmTitle?: string) => void;
    data: WeibullPMData;
}

// ─── Helpers ────────────────────────────────────────────────
function hoursToReadable(hours: number): string {
    if (hours < 24) return `${hours} hours`;
    const days = Math.round(hours / 24);
    if (days < 14) return `${days} days (~${hours} hrs)`;
    const weeks = Math.round(days / 7);
    if (weeks < 8) return `${weeks} weeks (~${days} days)`;
    const months = Math.round(days / 30);
    return `${months} months (~${days} days)`;
}

function getStrategyLabel(beta: number): { label: string; color: string; icon: React.ReactNode } {
    if (beta <= 1) return { label: 'Not Recommended', color: 'text-red-600', icon: <AlertTriangle size={14} /> };
    if (beta <= 1.5) return { label: 'Condition-Based (CBM)', color: 'text-amber-600', icon: <Shield size={14} /> };
    if (beta <= 3) return { label: 'Time-Directed (PM)', color: 'text-emerald-600', icon: <Wrench size={14} /> };
    return { label: 'Aggressive Replacement', color: 'text-red-600', icon: <TrendingUp size={14} /> };
}

// ═══════════════════════════════════════════════════════════════
//  COMPONENT
// ═══════════════════════════════════════════════════════════════
export const CreatePMFromWeibullModal: React.FC<CreatePMFromWeibullModalProps> = ({
    isOpen, onClose, onSuccess, data,
}) => {
    const strategy = useMemo(() => getStrategyLabel(data.beta), [data.beta]);

    // ── Form state ────────────────────────────────────────
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [intervalHours, setIntervalHours] = useState(0);
    const [frequencyType, setFrequencyType] = useState<'HOURS' | 'DAYS' | 'WEEKS' | 'MONTHS'>('HOURS');
    const [intervalValue, setIntervalValue] = useState(0);
    const [priorityCode, setPriorityCode] = useState('P3');
    const [nextDueDate, setNextDueDate] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);

    // ── Initialize form from data ─────────────────────────
    useEffect(() => {
        if (!isOpen) { setSuccess(false); return; }

        const pct = data.beta > 3 ? 70 : data.beta > 2 ? 75 : 80;
        const pmHrs = data.pmInterval || Math.round(data.eta * (pct / 100));

        const isClass = !!(data.classAssets && data.classAssets.length);
        setTitle(isClass
            ? `PM — ${data.className} class (${data.classAssets!.length} assets) — Weibull-based (β=${data.beta})`
            : `PM — ${data.asset.tag} — Weibull-based replacement (β=${data.beta})`);
        setDescription(
            `Time-directed Preventive Maintenance based on Weibull life data analysis.\n\n` +
            `Analysis Parameters:\n` +
            `• Shape β = ${data.beta} (${data.beta > 1.5 ? 'wear-out pattern — PM is effective' : data.beta > 1 ? 'early wear — PM has limited value' : 'infant mortality — PM not recommended'})\n` +
            `• Scale η = ${data.eta.toLocaleString()} hrs (characteristic life at 63.2% failure probability)\n` +
            `• Goodness of fit R² = ${data.r2}\n` +
            `• B10 life = ${data.b10.toLocaleString()} hrs (10% failure probability)\n` +
            `• Data basis: ${data.dataPoints} failure intervals from corrective WO history\n\n` +
            `Recommended PM interval: ${pmHrs.toLocaleString()} hrs (${pct}% of η)\n` +
            `This replaces/overhauls the component before ${100 - pct}% cumulative failure probability is reached.`
        );
        setIntervalHours(pmHrs);
        setIntervalValue(pmHrs);
        setFrequencyType('HOURS');

        // Default next due date: today + interval in days
        const days = Math.round(pmHrs / 24);
        const due = new Date(Date.now() + days * 86400000);
        setNextDueDate(due.toISOString().split('T')[0]);
        setPriorityCode('P3');
    }, [isOpen, data]);

    // ── Frequency conversion ──────────────────────────────
    useEffect(() => {
        // When user changes frequency type, recalculate the interval value
        switch (frequencyType) {
            case 'HOURS': setIntervalValue(intervalHours); break;
            case 'DAYS': setIntervalValue(Math.round(intervalHours / 24)); break;
            case 'WEEKS': setIntervalValue(Math.round(intervalHours / 168)); break;
            case 'MONTHS': setIntervalValue(Math.round(intervalHours / 720)); break;
        }
    }, [frequencyType, intervalHours]);

    // ── Submit ────────────────────────────────────────────
    const handleSubmit = async () => {
        if (!title.trim()) return;
        setSubmitting(true);
        try {
            const cls = data.classAssets && data.classAssets.length ? data.classAssets : null;
            // Map the modal's frequency unit to the recurring_work convention.
            const FREQ_UNIT: Record<string, string> = { HOURS: 'Hours', DAYS: 'Days', WEEKS: 'Weeks', MONTHS: 'Months' };
            const createdPM = await DatabaseService.getInstance().createPM({
                id: crypto.randomUUID(),
                code: `PM-${Math.floor(10000 + Math.random() * 90000)}`,
                title,
                description,
                status: 'ACTIVE',
                // Class PM: representative asset + assigned_assets across the whole class.
                asset_id: cls ? cls[0].id : data.asset.id,
                assigned_assets: cls ? cls.map(a => ({ assetId: a.id, lastCompletedDate: '', lastReadingValue: 0 })) : undefined,
                // Canonical NOT-NULL recurring_work columns (so the PM inserts AND the
                // generator can schedule it — the old frequency_type/interval/job_type_code
                // were non-columns and omitted the required fields).
                schedule_type: 'TIME',
                frequency_interval: intervalValue,
                frequency_unit: FREQ_UNIT[frequencyType] || 'Months',
                lead_time_days: 7,
                job_type: 'PM',
                priority_code: priorityCode,
                est_duration: 0,
                est_downtime: 0,
                active: true,
                next_due_date: nextDueDate,
            });
            setSuccess(true);
            setTimeout(() => {
                onSuccess?.(createdPM?.id, title);
                onClose();
            }, 2000);
        } catch (err: any) {
            alert('Error creating PM: ' + err.message);
        } finally {
            setSubmitting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto mx-4 animate-in zoom-in-95 duration-200">
                {/* ── Header ──────────────────────────────────── */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-primary-50 to-primary-50">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center">
                            <Wrench size={20} className="text-primary-600" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-slate-800">Create PM Program</h3>
                            <p className="text-xs text-slate-500">From Weibull analysis → Work Management</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
                        <X size={18} className="text-slate-400" />
                    </button>
                </div>

                {/* ── Success State ──────────────────────────── */}
                {success ? (
                    <div className="p-12 text-center">
                        <div className="w-16 h-16 mx-auto rounded-full bg-emerald-100 flex items-center justify-center mb-4 animate-in zoom-in duration-300">
                            <CheckCircle size={32} className="text-emerald-600" />
                        </div>
                        <h4 className="text-lg font-bold text-slate-800">PM Program Created</h4>
                        <p className="text-sm text-slate-500 mt-2">
                            Navigate to <strong>Work → PM Programs</strong> to view and manage.
                        </p>
                    </div>
                ) : (
                    <>
                        {/* ── Analysis Provenance Banner ────────────── */}
                        <div className="mx-6 mt-5 p-4 bg-gradient-to-r from-blue-50 via-blue-50 to-blue-50 border border-blue-200/60 rounded-xl">
                            <div className="flex items-center gap-2 mb-2">
                                <Info size={14} className="text-blue-500" />
                                <span className="text-xs font-bold text-blue-700 uppercase tracking-wider">Analysis Basis</span>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                <div className="text-center p-2 bg-white/70 rounded-lg border border-blue-100">
                                    <p className="text-[10px] text-slate-400 font-bold uppercase">Asset</p>
                                    <p className="text-xs font-bold text-slate-800 font-mono">{data.asset.tag}</p>
                                </div>
                                <div className="text-center p-2 bg-white/70 rounded-lg border border-blue-100">
                                    <p className="text-[10px] text-slate-400 font-bold uppercase">Shape β</p>
                                    <p className="text-sm font-bold text-blue-700">{data.beta}</p>
                                </div>
                                <div className="text-center p-2 bg-white/70 rounded-lg border border-blue-100">
                                    <p className="text-[10px] text-slate-400 font-bold uppercase">Scale η</p>
                                    <p className="text-sm font-bold text-blue-700">{data.eta.toLocaleString()} hrs</p>
                                </div>
                                <div className="text-center p-2 bg-white/70 rounded-lg border border-blue-100">
                                    <p className="text-[10px] text-slate-400 font-bold uppercase">R²</p>
                                    <p className={`text-sm font-bold ${data.r2 >= 0.9 ? 'text-emerald-700' : 'text-amber-600'}`}>{data.r2}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 mt-3">
                                <span className={`text-xs font-bold ${strategy.color} flex items-center gap-1`}>
                                    {strategy.icon} Strategy: {strategy.label}
                                </span>
                                <span className="text-[10px] text-slate-400 ml-auto">{data.dataPoints} failure intervals</span>
                            </div>
                        </div>

                        {/* ── PM Interval Recommendation ──────────── */}
                        <div className="mx-6 mt-4 p-4 bg-primary-50 border border-primary-200 rounded-xl">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-primary-100 text-primary-600">
                                    <Clock size={18} />
                                </div>
                                <div>
                                    <p className="text-sm font-bold text-primary-800">
                                        Recommended: every {intervalHours.toLocaleString()} hours
                                    </p>
                                    <p className="text-xs text-primary-600 mt-0.5">
                                        ≈ {hoursToReadable(intervalHours)} · {Math.round(intervalHours / data.eta * 100)}% of η
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* ── Editable Form ────────────────────────── */}
                        <div className="px-6 py-5 space-y-4">
                            {/* Class scope banner — one PM applied across the whole class */}
                            {data.classAssets && data.classAssets.length > 0 && (
                                <div className="flex items-start gap-2 p-3 rounded-xl bg-indigo-50 border border-indigo-200 text-xs text-indigo-800">
                                    <Wrench size={14} className="mt-0.5 shrink-0 text-indigo-500" />
                                    <span>
                                        <strong>Population PM.</strong> Fitted on pooled failures across the{' '}
                                        <strong>{data.className}</strong> class and applied to all{' '}
                                        <strong>{data.classAssets.length} assets</strong> in it (one program, multi-asset route).
                                    </span>
                                </div>
                            )}
                            {/* Title */}
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                                    PM Title <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text" value={title}
                                    onChange={e => setTitle(e.target.value)}
                                    className="w-full p-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                                />
                            </div>

                            {/* Frequency */}
                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Interval</label>
                                    <input
                                        type="number" value={intervalValue}
                                        onChange={e => {
                                            const v = parseInt(e.target.value) || 0;
                                            setIntervalValue(v);
                                            // Back-calculate hours
                                            switch (frequencyType) {
                                                case 'HOURS': setIntervalHours(v); break;
                                                case 'DAYS': setIntervalHours(v * 24); break;
                                                case 'WEEKS': setIntervalHours(v * 168); break;
                                                case 'MONTHS': setIntervalHours(v * 720); break;
                                            }
                                        }}
                                        className="w-full p-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Unit</label>
                                    <select
                                        value={frequencyType}
                                        onChange={e => setFrequencyType(e.target.value as any)}
                                        className="w-full p-2.5 border border-slate-300 rounded-lg text-sm bg-white"
                                    >
                                        <option value="HOURS">Hours</option>
                                        <option value="DAYS">Days</option>
                                        <option value="WEEKS">Weeks</option>
                                        <option value="MONTHS">Months</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Priority</label>
                                    <select
                                        value={priorityCode}
                                        onChange={e => setPriorityCode(e.target.value)}
                                        className="w-full p-2.5 border border-slate-300 rounded-lg text-sm bg-white"
                                    >
                                        <option value="P1">P1 — Emergency</option>
                                        <option value="P2">P2 — Urgent</option>
                                        <option value="P3">P3 — Planned</option>
                                        <option value="P4">P4 — Deferred</option>
                                    </select>
                                </div>
                            </div>

                            {/* Next Due Date */}
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                                    <Calendar size={12} className="inline mr-1" /> Next Due Date
                                </label>
                                <input
                                    type="date" value={nextDueDate}
                                    onChange={e => setNextDueDate(e.target.value)}
                                    className="w-full p-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                                />
                            </div>

                            {/* Description (read-only but scrollable) */}
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Description (auto-generated)</label>
                                <textarea
                                    value={description}
                                    onChange={e => setDescription(e.target.value)}
                                    className="w-full p-3 border border-slate-300 rounded-lg text-xs text-slate-600 font-mono h-32 resize-none bg-slate-50 focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                                />
                            </div>
                        </div>

                        {/* ── Footer ──────────────────────────────── */}
                        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
                            <p className="text-[10px] text-slate-400">
                                HITL: Review and confirm before creating. Saved to <code className="bg-slate-200 px-1 rounded">recurring_work</code> table.
                            </p>
                            <div className="flex gap-2">
                                <button
                                    onClick={onClose}
                                    className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSubmit}
                                    disabled={submitting || !title.trim()}
                                    className="px-5 py-2 text-sm font-semibold text-white bg-gradient-to-r from-primary-500 to-primary-500 rounded-lg shadow-md hover:shadow-lg transition-all disabled:opacity-50 flex items-center gap-2"
                                >
                                    {submitting ? (
                                        <><Loader2 size={14} className="animate-spin" /> Creating...</>
                                    ) : (
                                        <><Wrench size={14} /> Create PM Program</>
                                    )}
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default CreatePMFromWeibullModal;
