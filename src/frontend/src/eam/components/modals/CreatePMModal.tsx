import React, { useState, useEffect } from 'react';
import { X, Calendar, AlertTriangle, Clock, Hash } from 'lucide-react';
import { DatabaseService } from '../../services/DatabaseService';
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
        leadTimeDays: 7
    });

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

    const loadData = async () => {
        setLoading(true);
        try {
            const [assetData, userData, dictData] = await Promise.all([
                DatabaseService.getInstance().getAssets(),
                DatabaseService.getInstance().getUsers(),
                DatabaseService.getInstance().getDictionaries()
            ]);

            setAssets(assetData);
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
            const newPM = {
                id: crypto.randomUUID(),
                code: `PM-${Math.floor(10000 + Math.random() * 90000)}`,
                title: formData.title,
                description: formData.description,
                status: 'ACTIVE',
                asset_id: formData.assetId,
                schedule_type: formData.scheduleType,
                frequency_interval: formData.interval,
                frequency_unit: formData.frequencyUnit,
                lead_time_days: formData.leadTimeDays,
                job_type: formData.type,
                priority_code: formData.priority,
                est_duration: 0,
                est_downtime: 0,
                created_by: currentUser,
                active: true,
                next_due_date: new Date(Date.now() + (formData.interval * 30 * 24 * 60 * 60 * 1000)).toISOString() // Rough approx for demo
            };

            await DatabaseService.getInstance().createPM(newPM);
            showToast("Strategy created successfully", 'success');
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
