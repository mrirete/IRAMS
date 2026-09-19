import React, { useState, useEffect } from 'react';
import { X, Calendar, AlertTriangle, Clock, Hash } from 'lucide-react';
import { DatabaseService } from '../../services/DatabaseService';
import { buildPMStrategy } from '../../lib/pmStrategy';
import { firstDueDate, isWithinCallHorizon, sensibleLeadTimeDays, cadenceDays } from '../../lib/pmCadence';
import { Asset, WorkOrderStatus } from '../../types';
import { SearchableDropdown } from '../ui/SearchableDropdown';
import { useToast } from '../../contexts/ToastContext';

interface CreatePMModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: () => void;
    dictionaries?: any[];
}

export const CreatePMModal: React.FC<CreatePMModalProps> = ({ isOpen, onClose, onSave, dictionaries: propDictionaries }) => {
    const { showToast } = useToast();
    const [assets, setAssets] = useState<Asset[]>([]);
    const [workCenters, setWorkCenters] = useState<any[]>([]);
    const [dictionaries, setDictionaries] = useState<any[]>(propDictionaries || []);
    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const [formData, setFormData] = useState({
        title: '',
        assetId: '',
        priority: '',
        type: '',
        description: '',
        scheduleType: 'TIME',
        interval: 1,
        frequencyUnit: 'Months',
        leadTimeDays: 7,
        workCenterId: '',
        // 0365: a new schedule is due today unless the planner says otherwise —
        // the cadence is the gap between occurrences, not a wait before the first.
        firstDue: firstDueDate(),
        // The first occurrence is NOT raised on the spot by default: the order copies
        // whatever is planned at that moment, and a brand-new schedule has no steps,
        // labour, parts or JSA yet. Opt in once the plan exists (completing it still
        // arms Autopilot — 0304 arming rule).
        generateNow: false,
        // Automatic (daily sweep) or Manual (Generator only) — defaults to the company's choice.
        autoGenerate: true,
    });
    const [companyAuto, setCompanyAuto] = useState<boolean>(true);

    const [currentUser, setCurrentUser] = useState<string>('');

    useEffect(() => {
        if (isOpen) {
            loadData();
        }
    }, [isOpen]);

    // Sync with parent dictionaries if they arrive after mount
    useEffect(() => {
        if (propDictionaries && propDictionaries.length > 0) {
            setDictionaries(propDictionaries);
        }
    }, [propDictionaries]);

    // Default the work group from the selected asset's responsible work centre (0179).
    useEffect(() => {
        const a = assets.find(x => x.id === formData.assetId);
        if (a?.responsibleWorkCenterId) setFormData(f => ({ ...f, workCenterId: a.responsibleWorkCenterId! }));
    }, [formData.assetId, assets]);

    const loadData = async () => {
        setLoading(true);
        try {
            const [assetData, userData, dictData, wcData] = await Promise.all([
                DatabaseService.getInstance().getAssets(),
                DatabaseService.getInstance().getUsers(),
                DatabaseService.getInstance().getDictionaries(),
                DatabaseService.getInstance().getWorkCenters(true)
            ]);

            setAssets(assetData);
            setWorkCenters(wcData);
            try {
                const co = (await DatabaseService.getInstance().getCompanies(false))[0];
                const auto = co ? co.pmAutoGenerate !== false : true;
                setCompanyAuto(auto);
                setFormData(f => ({ ...f, autoGenerate: auto }));
            } catch { /* default stays Automatic */ }
            if (dictData.length > 0) setDictionaries(dictData);
            if (userData.length > 0) setCurrentUser(userData[0].id);
        } catch (err) {
            console.error('CreatePMModal: Load Error', err);
            showToast('Failed to load form data: ' + (err as any).message, 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.title || !formData.assetId || !formData.priority || !formData.type) {
            showToast("Please fill all required fields (Title, Asset, Type, Priority).", 'warning');
            return;
        }

        setSubmitting(true);
        try {
            const isTime = formData.scheduleType === 'TIME';
            // 0365: unit-aware — "1 Days" once meant first-due in 30 days (interval × 30),
            // so a daily PM read as monthly and its first work order was a month away.
            const leadTimeDays = isTime
                ? sensibleLeadTimeDays(formData.leadTimeDays, formData.interval, formData.frequencyUnit)
                : formData.leadTimeDays;
            const firstDue = isTime ? (formData.firstDue || firstDueDate()) : undefined;
            const newPM = buildPMStrategy({
                title: formData.title,
                description: formData.description,
                assetId: formData.assetId,
                scheduleType: formData.scheduleType,
                frequencyInterval: formData.interval,
                frequencyUnit: formData.frequencyUnit,
                leadTimeDays,
                jobType: formData.type,
                priorityCode: formData.priority,
                workCenterId: formData.workCenterId || null,
                createdBy: currentUser || null,
                nextDueDate: firstDue,
                autoGenerate: formData.autoGenerate,
            });

            const db = DatabaseService.getInstance();
            await db.createPM(newPM);

            // Raise the first occurrence now when it is already inside its call
            // horizon. Without this the schedule sits unarmed until someone finds
            // the Generator — and the technician never sees the job.
            let generated = false;
            if (isTime && formData.generateNow && firstDue && isWithinCallHorizon(firstDue, leadTimeDays)) {
                try {
                    await db.generateWOFromPM(String(newPM.id));
                    generated = true;
                } catch (genErr) {
                    console.error('CreatePMModal: first work order not generated', genErr);
                    showToast('Strategy created, but its first work order could not be raised — use the Generator on Recurring Work.', 'warning');
                }
            }
            if (generated) showToast('Strategy created — first work order raised and on the technician\'s list.', 'success');
            else if (!(isTime && formData.generateNow)) showToast('Strategy created successfully', 'success');
            else if (firstDue && !isWithinCallHorizon(firstDue, leadTimeDays)) showToast(`Strategy created — first work order will be raised ${leadTimeDays > 0 ? `${leadTimeDays} days before ` : 'on '}${firstDue}.`, 'success');
            onSave();
            onClose();
        } catch (e: any) {
            console.error(e);
            showToast("Failed to create PM strategy.", 'error');
        } finally {
            setSubmitting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                    <div>
                        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                            <Clock className="text-blue-600" size={24} /> New Maintenance Strategy
                        </h2>
                        <p className="text-xs text-slate-500">Define a recurring preventive maintenance schedule</p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-red-500 hover:bg-red-50 p-2 rounded-full transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto">
                    <form id="pm-form" onSubmit={handleSubmit} className="space-y-6">
                        {/* 1. Schedule Definition */}
                        <div className="bg-blue-50/50 p-4 rounded-lg border border-blue-100 space-y-4">
                            <h3 className="font-bold text-sm text-blue-800 uppercase flex items-center gap-2">
                                <Calendar size={16} /> Schedule & Frequency
                            </h3>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div className="col-span-2 md:col-span-1">
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Type</label>
                                    <select
                                        className="w-full text-sm border-slate-300 rounded-md"
                                        value={formData.scheduleType}
                                        onChange={e => setFormData({ ...formData, scheduleType: e.target.value })}
                                    >
                                        <option value="TIME">Time Based</option>
                                        <option value="READING">Meter Based</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Every</label>
                                    <input
                                        type="number"
                                        min="1"
                                        className="w-full text-sm border-slate-300 rounded-md"
                                        value={formData.interval}
                                        onChange={e => setFormData({ ...formData, interval: parseInt(e.target.value) })}
                                    />
                                </div>
                                <div className="col-span-2 md:col-span-2">
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Unit</label>
                                    <select
                                        className="w-full text-sm border-slate-300 rounded-md"
                                        value={formData.frequencyUnit}
                                        onChange={e => setFormData({ ...formData, frequencyUnit: e.target.value })}
                                    >
                                        {formData.scheduleType === 'TIME' ? (
                                            // Time-period options for TIME-based schedules
                                            dictionaries?.filter(d => d.type === 'TIME_PERIOD' && d.active).length > 0
                                                ? dictionaries.filter(d => d.type === 'TIME_PERIOD' && d.active).map(d => (
                                                    <option key={d.code} value={d.code}>{d.description || d.code}</option>
                                                ))
                                                : [
                                                    <option key="Days" value="Days">Days</option>,
                                                    <option key="Weeks" value="Weeks">Weeks</option>,
                                                    <option key="Months" value="Months">Months</option>,
                                                    <option key="Years" value="Years">Years</option>,
                                                ]
                                        ) : (
                                            // Reading type options for READING-based schedules
                                            dictionaries?.filter(d => d.type === 'READING_TYPE' && d.active).length > 0
                                                ? dictionaries.filter(d => d.type === 'READING_TYPE' && d.active).map(d => (
                                                    <option key={d.code} value={d.code}>{d.description || d.code}</option>
                                                ))
                                                : [
                                                    <option key="Hours" value="Hours">Operating Hours</option>,
                                                    <option key="Km" value="Km">Kilometres</option>,
                                                    <option key="Cycles" value="Cycles">Cycles</option>,
                                                    <option key="Starts" value="Starts">Starts</option>,
                                                ]
                                        )}
                                    </select>
                                </div>
                            </div>
                            {formData.scheduleType === 'TIME' && (() => {
                                const lead = sensibleLeadTimeDays(formData.leadTimeDays, formData.interval, formData.frequencyUnit);
                                const leadDropped = formData.leadTimeDays > 0 && lead === 0 && cadenceDays(formData.interval, formData.frequencyUnit) > 0;
                                const dueNow = !!formData.firstDue && isWithinCallHorizon(formData.firstDue, lead);
                                return (
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
                                        <div className="col-span-2 md:col-span-1">
                                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">First due</label>
                                            <input
                                                type="date"
                                                className="w-full text-sm border-slate-300 rounded-md"
                                                value={formData.firstDue}
                                                onChange={e => setFormData({ ...formData, firstDue: e.target.value })}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Lead time (days)</label>
                                            <input
                                                type="number"
                                                min="0"
                                                className="w-full text-sm border-slate-300 rounded-md"
                                                value={formData.leadTimeDays}
                                                onChange={e => setFormData({ ...formData, leadTimeDays: parseInt(e.target.value) || 0 })}
                                            />
                                        </div>
                                        <div className="col-span-2 pb-2">
                                            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    className="rounded border-slate-300"
                                                    checked={formData.generateNow}
                                                    onChange={e => setFormData({ ...formData, generateNow: e.target.checked })}
                                                />
                                                Raise the first work order now
                                            </label>
                                            <p className="text-[10px] text-slate-500 mt-1 leading-snug">
                                                The first order copies whatever is planned now — plan steps, labour, parts and JSA first, then generate.
                                            </p>
                                        </div>
                                        <div className="col-span-2 md:col-span-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
                                            {([
                                                [true, 'Automatic (Autopilot)', companyAuto
                                                    ? 'After the first order is completed, the daily sweep raises each due occurrence by itself.'
                                                    : 'Company setting is Manual — this takes effect once Automatic is enabled in Admin › Your Company.'],
                                                [false, 'Manual (Generator)', 'Nothing is raised on its own; a planner creates each occurrence from Recurring Work › Generate.'],
                                            ] as const).map(([mode, label, help]) => (
                                                <label key={String(mode)} className={`flex items-start gap-2 p-2 rounded-lg border text-[11px] cursor-pointer ${formData.autoGenerate === mode ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
                                                    <input type="radio" name="pm-generation" className="mt-0.5" checked={formData.autoGenerate === mode} onChange={() => setFormData({ ...formData, autoGenerate: mode })} />
                                                    <span><span className="font-bold text-slate-700">{label}</span><br /><span className="text-slate-500">{help}</span></span>
                                                </label>
                                            ))}
                                        </div>
                                        <p className="col-span-2 md:col-span-4 text-[11px] text-slate-500 -mt-2">
                                            {leadDropped
                                                ? `Lead time is longer than the cadence, so it is treated as 0 — the order is raised on the due day.`
                                                : `Work orders are raised ${lead > 0 ? `${lead} day${lead === 1 ? '' : 's'} before` : 'on'} each due date.`}
                                            {' '}
                                            {formData.generateNow
                                                ? (dueNow
                                                    ? (formData.autoGenerate && companyAuto ? 'The first one is raised immediately; completing it arms Autopilot for the rest.' : 'The first one is raised immediately; later occurrences come from the Generator.')
                                                    : (formData.autoGenerate && companyAuto ? 'The first one is not yet inside its lead time — Autopilot raises it after the first completed order; use the Generator before then.' : 'The first one is not yet inside its lead time — raise it from the Generator when due.'))
                                                : 'Nothing is raised until you run the Generator once.'}
                                        </p>
                                    </div>
                                );
                            })()}
                        </div>

                        {/* 2. Job Template */}
                        <div className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Strategy Title <span className="text-red-500">*</span></label>
                                    <input
                                        type="text"
                                        required
                                        placeholder="e.g., Monthly Pump Inspection"
                                        className="w-full text-sm border-slate-300 rounded-md focus:ring-2 focus:ring-primary-500"
                                        value={formData.title}
                                        onChange={e => setFormData({ ...formData, title: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Asset <span className="text-red-500">*</span></label>
                                    <SearchableDropdown
                                        options={assets.map(a => ({ code: a.id, description: `${a.tag} - ${a.name}` }))}
                                        value={formData.assetId}
                                        onChange={(id) => setFormData({ ...formData, assetId: id })}
                                        placeholder="Search Asset..."
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 modal-grid-responsive">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Work Type <span className="text-red-500">*</span></label>
                                    <select
                                        required
                                        className="w-full text-sm border-slate-300 rounded-md"
                                        value={formData.type}
                                        onChange={e => setFormData({ ...formData, type: e.target.value })}
                                    >
                                        <option value="">Select Type...</option>
                                        {dictionaries?.filter(d => d.type === 'WORK_TYPE' && d.active).map(d => (
                                            <option key={d.code} value={d.code}>{d.description}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Priority <span className="text-red-500">*</span></label>
                                    <select
                                        required
                                        className="w-full text-sm border-slate-300 rounded-md"
                                        value={formData.priority}
                                        onChange={e => setFormData({ ...formData, priority: e.target.value })}
                                    >
                                        <option value="">Select Priority...</option>
                                        {dictionaries?.filter(d => d.type === 'PRIORITY' && d.active).map(d => (
                                            <option key={d.code} value={d.code}>{d.description}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Work Group</label>
                                <select
                                    className="w-full text-sm border-slate-300 rounded-md"
                                    value={formData.workCenterId}
                                    onChange={e => setFormData({ ...formData, workCenterId: e.target.value })}
                                >
                                    <option value="">Unassigned</option>
                                    {workCenters.map((w: any) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Standard Description</label>
                                <textarea
                                    className="w-full text-sm border-slate-300 rounded-md h-24 resize-none"
                                    placeholder="Detailed job instructions..."
                                    value={formData.description}
                                    onChange={e => setFormData({ ...formData, description: e.target.value })}
                                />
                            </div>
                        </div>
                    </form>
                </div>

                <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 modal-actions-sticky">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-200 rounded-lg">Cancel</button>
                    <button
                        form="pm-form"
                        type="submit"
                        disabled={submitting || loading}
                        className="px-6 py-2 text-sm font-bold text-white bg-primary-600 hover:bg-primary-500 rounded-lg disabled:opacity-50 shadow-lg shadow-blue-600/20"
                    >
                        {submitting ? 'Creating Strategy...' : 'Create Strategy'}
                    </button>
                </div>
            </div>
        </div>
    );
};
