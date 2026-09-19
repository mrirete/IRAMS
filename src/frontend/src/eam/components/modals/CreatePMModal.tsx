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

    const field = 'w-full text-sm bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500';
    const label = 'block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5';
    const seg = (on: boolean) => `px-3 py-1 text-xs font-semibold rounded-md transition-colors ${on ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`;
    const group = 'flex items-stretch border border-slate-300 rounded-lg bg-white focus-within:ring-2 focus-within:ring-primary-500/20 focus-within:border-primary-500 overflow-hidden';
    const prefix = 'px-3 flex items-center text-sm text-slate-500 bg-slate-50 border-r border-slate-200 select-none whitespace-nowrap';

    return (
        <>
        {/* z-[60]: the phone bottom nav is fixed at z-50 and painted after this overlay, so at z-50 it sat on top of Cancel / Create. */}
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-200">
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
                            <p className="text-[11px] text-slate-400 mt-1">Every work order it raises carries this title.</p>
                        </div>

                        <div>
                            <label className={label} htmlFor="pm-description">Description</label>
                            <textarea
                                id="pm-description"
                                rows={2}
                                className={`${field} resize-none`}
                                placeholder="Optional"
                                value={formData.description}
                                onChange={e => setFormData({ ...formData, description: e.target.value })}
                            />
                            <p className="text-[11px] text-slate-400 mt-1">Copied into each work order. Steps go on the Tasks tab.</p>
                        </div>

                        <div>
                            <div className="flex items-center justify-between mb-1.5">
                                <span className={label.replace(' mb-1.5', '')}>Repeats</span>
                                <div className="inline-flex bg-slate-100 rounded-lg p-0.5" role="radiogroup" aria-label="Schedule type">
                                    {([['TIME', 'By calendar'], ['READING', 'By meter']] as const).map(([v, t]) => (
                                        <button
                                            key={v}
                                            type="button"
                                            role="radio"
                                            aria-checked={formData.scheduleType === v}
                                            className={seg(formData.scheduleType === v)}
                                            onClick={() => setFormData({
                                                ...formData,
                                                scheduleType: v,
                                                frequencyUnit: v === 'TIME' ? (timeUnits[0]?.code || 'Months') : (meterUnits[0]?.code || 'Hours'),
                                            })}
                                        >{t}</button>
                                    ))}
                                </div>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div className={group}>
                                    <span className={prefix}>Every</span>
                                    <input
                                        type="number"
                                        min="1"
                                        step="1"
                                        aria-label="Every"
                                        className="w-16 text-sm text-right px-2 py-2 border-0 focus:ring-0 focus:outline-none tabular-nums"
                                        value={formData.interval}
                                        onChange={e => setFormData({ ...formData, interval: parseInt(e.target.value) || 1 })}
                                    />
                                    <select
                                        aria-label="Unit"
                                        className="flex-1 min-w-0 text-sm border-0 border-l border-slate-200 focus:ring-0 focus:outline-none pl-3 pr-8 py-2 bg-white"
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
                                    <div className={group}>
                                        <label className={prefix} htmlFor="pm-first-due">First due</label>
                                        <input
                                            id="pm-first-due"
                                            type="date"
                                            className="flex-1 min-w-0 text-sm px-3 py-2 border-0 focus:ring-0 focus:outline-none"
                                            value={formData.firstDue}
                                            onChange={e => setFormData({ ...formData, firstDue: e.target.value })}
                                        />
                                    </div>
                                ) : (
                                    <p className="text-[11px] text-slate-400 self-center">The meter reading that triggers it is set on the Details tab.</p>
                                )}
                            </div>
                        </div>

                        <p className="text-[11px] text-slate-400 border-t border-slate-100 pt-3">
                            Assets, work type, priority and Autopilot are set on the strategy's tabs next. Nothing is raised until an asset is linked.
                        </p>
                    </form>
                </div>

                <div className="px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
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
        </>
    );
};
