import React, { useState, useEffect } from 'react';
import { X, Clock } from 'lucide-react';
import { DatabaseService } from '../../services/DatabaseService';
import { buildPMStrategy } from '../../lib/pmStrategy';
import { firstDueDate, sensibleLeadTimeDays } from '../../lib/pmCadence';
import { useToast } from '../../contexts/ToastContext';

interface CreatePMModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** Called with the new strategy's id so the page can open it straight away. */
    onSave: (newId?: string) => void;
    dictionaries?: any[];
}

/**
 * New strategy — three things: what it is called, what it does, how often.
 *
 * Everything else (assets, work type, priority, lead time, Autopilot mode,
 * work group) lives on the strategy's own tabs and starts from a sensible
 * default. The old form asked eleven questions before the record existed and
 * still required one asset, which is wrong for a schedule that can cover many;
 * assets are linked on the Assets tab, where each link persists on its own.
 *
 * Defaults are read from the dictionaries rather than hard-coded: a tenant may
 * not carry a code called P4 or PM.
 */
const preferCode = (rows: any[], type: string, prefer: string[], match: RegExp, fallback: string): string => {
    const active = (rows || []).filter(d => d.type === type && d.active !== false);
    if (active.length === 0) return fallback;
    for (const p of prefer) { const hit = active.find(d => String(d.code).toUpperCase() === p); if (hit) return hit.code; }
    const byText = active.find(d => match.test(String(d.description || '')));
    if (byText) return byText.code;
    return active[Math.floor((active.length - 1) / 2)].code;
};

export const CreatePMModal: React.FC<CreatePMModalProps> = ({ isOpen, onClose, onSave, dictionaries: propDictionaries }) => {
    const { showToast } = useToast();
    const [dictionaries, setDictionaries] = useState<any[]>(propDictionaries || []);
    const [submitting, setSubmitting] = useState(false);
    const [companyAuto, setCompanyAuto] = useState<boolean>(true);
    const [currentUser, setCurrentUser] = useState<string>('');

    const blank = () => ({
        title: '',
        description: '',
        scheduleType: 'TIME',
        interval: 1,
        frequencyUnit: 'Months',
        // 0365: a new schedule is due today unless the planner says otherwise —
        // the cadence is the gap between occurrences, not a wait before the first.
        firstDue: firstDueDate(),
    });
    const [formData, setFormData] = useState(blank);

    useEffect(() => {
        if (!isOpen) return;
        setFormData(blank());
        (async () => {
            try {
                const db = DatabaseService.getInstance();
                const [dictData, userData] = await Promise.all([db.getDictionaries(), db.getUsers()]);
                if (dictData.length > 0) setDictionaries(dictData);
                if (userData.length > 0) setCurrentUser(userData[0].id);
                try {
                    const co = (await db.getCompanies(false))[0];
                    setCompanyAuto(co ? co.pmAutoGenerate !== false : true);
                } catch { /* default stays Automatic */ }
            } catch (err) {
                console.error('CreatePMModal: Load Error', err);
            }
        })();
    }, [isOpen]);

    useEffect(() => {
        if (propDictionaries && propDictionaries.length > 0) setDictionaries(propDictionaries);
    }, [propDictionaries]);

    const isTime = formData.scheduleType === 'TIME';
    const timeUnits = dictionaries.filter(d => d.type === 'TIME_PERIOD' && d.active !== false);
    const meterUnits = dictionaries.filter(d => d.type === 'READING_TYPE' && d.active !== false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const title = formData.title.trim();
        if (!title) { showToast('Give the strategy a title — it becomes the title of every work order it raises.', 'warning'); return; }
        const interval = Number(formData.interval);
        if (!(interval >= 1)) { showToast('"Repeats every" needs a whole number of 1 or more.', 'warning'); return; }

        setSubmitting(true);
        try {
            const leadTimeDays = isTime ? sensibleLeadTimeDays(7, interval, formData.frequencyUnit) : 7;
            const newPM = buildPMStrategy({
                title,
                description: formData.description.trim(),
                assetId: null,
                scheduleType: formData.scheduleType,
                frequencyInterval: interval,
                frequencyUnit: formData.frequencyUnit,
                leadTimeDays,
                jobType: preferCode(dictionaries, 'JOB_TYPE', ['PM'], /preventive|planned/i, 'PM'),
                priorityCode: preferCode(dictionaries, 'PRIORITY', ['P4', 'MEDIUM', 'NORMAL'], /normal|planned|medium/i, 'P4'),
                workCenterId: null,
                createdBy: currentUser || null,
                nextDueDate: isTime ? (formData.firstDue || firstDueDate()) : undefined,
                autoGenerate: companyAuto,
                assignedAssets: [],
            });
            await DatabaseService.getInstance().createPM(newPM);
            showToast('Strategy created — link its assets, then plan the steps.', 'success');
            onSave(String(newPM.id));
            onClose();
        } catch (err: any) {
            console.error(err);
            showToast(`Could not create the strategy: ${err?.message || err}`, 'error');
        } finally {
            setSubmitting(false);
        }
    };

    if (!isOpen) return null;

    const field = 'w-full text-sm border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500';
    const label = 'block text-xs font-bold text-slate-500 uppercase mb-1';

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[92vh]">
                <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center">
                    <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <Clock className="text-blue-600" size={20} /> New strategy
                    </h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-red-500 hover:bg-red-50 p-2 rounded-full transition-colors" aria-label="Close">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-5 overflow-y-auto ers-dense ers-dense-labels">
                    <form id="pm-form" onSubmit={handleSubmit} className="space-y-5">
                        <div>
                            <label className={label} htmlFor="pm-title">Title <span className="text-red-500">*</span></label>
                            <input
                                id="pm-title"
                                autoFocus
                                className={field}
                                placeholder="e.g. Monthly seal inspection"
                                value={formData.title}
                                onChange={e => setFormData({ ...formData, title: e.target.value })}
                            />
                            <p className="text-[11px] text-slate-400 mt-1">Becomes the title of every work order this strategy raises.</p>
                        </div>

                        <div>
                            <label className={label} htmlFor="pm-description">Description</label>
                            <textarea
                                id="pm-description"
                                rows={2}
                                className={`${field} resize-none`}
                                placeholder="Optional — copied into each work order's description"
                                value={formData.description}
                                onChange={e => setFormData({ ...formData, description: e.target.value })}
                            />
                            <p className="text-[11px] text-slate-400 mt-1">Steps and instructions go on the Tasks tab once the strategy exists.</p>
                        </div>

                        <div>
                            <label className={label}>Repeats</label>
                            <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_minmax(0,1fr)] gap-2">
                                <select
                                    className={field}
                                    aria-label="Schedule type"
                                    value={formData.scheduleType}
                                    onChange={e => setFormData({
                                        ...formData,
                                        scheduleType: e.target.value,
                                        frequencyUnit: e.target.value === 'TIME' ? (timeUnits[0]?.code || 'Months') : (meterUnits[0]?.code || 'Hours'),
                                    })}
                                >
                                    <option value="TIME">By calendar</option>
                                    <option value="READING">By meter</option>
                                </select>
                                <input
                                    type="number"
                                    min="1"
                                    step="1"
                                    aria-label="Every"
                                    className={`${field} text-right`}
                                    value={formData.interval}
                                    onChange={e => setFormData({ ...formData, interval: parseInt(e.target.value) || 1 })}
                                />
                                <select
                                    className={field}
                                    aria-label="Unit"
                                    value={formData.frequencyUnit}
                                    onChange={e => setFormData({ ...formData, frequencyUnit: e.target.value })}
                                >
                                    {isTime
                                        ? (timeUnits.length > 0
                                            ? timeUnits.map(d => <option key={d.code} value={d.code}>{d.description || d.code}</option>)
                                            : ['Days', 'Weeks', 'Months', 'Years'].map(u => <option key={u} value={u}>{u}</option>))
                                        : (meterUnits.length > 0
                                            ? meterUnits.map(d => <option key={d.code} value={d.code}>{d.description || d.code}</option>)
                                            : [['Hours', 'Operating hours'], ['Km', 'Kilometres'], ['Cycles', 'Cycles'], ['Starts', 'Starts']].map(([v, t]) => <option key={v} value={v}>{t}</option>))}
                                </select>
                            </div>
                            {isTime ? (
                                <div className="mt-2 flex items-center gap-2">
                                    <label className="text-xs text-slate-500 whitespace-nowrap" htmlFor="pm-first-due">First due</label>
                                    <input
                                        id="pm-first-due"
                                        type="date"
                                        className={`${field} max-w-[11rem]`}
                                        value={formData.firstDue}
                                        onChange={e => setFormData({ ...formData, firstDue: e.target.value })}
                                    />
                                </div>
                            ) : (
                                <p className="text-[11px] text-slate-400 mt-1">The meter reading that triggers it is set on the Details tab.</p>
                            )}
                        </div>

                        <p className="text-[11px] text-slate-400 border-t border-slate-100 pt-3">
                            Assets, work type, priority and Autopilot are set on the strategy's tabs after you create it. Nothing is raised until an asset is linked.
                        </p>
                    </form>
                </div>

                <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 modal-actions-sticky">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-200 rounded-lg">Cancel</button>
                    <button
                        form="pm-form"
                        type="submit"
                        disabled={submitting}
                        className="px-5 py-2 text-sm font-bold text-white bg-primary-600 hover:bg-primary-500 rounded-lg disabled:opacity-50 shadow-lg shadow-blue-600/20"
                    >
                        {submitting ? 'Creating…' : 'Create'}
                    </button>
                </div>
            </div>
        </div>
    );
};
