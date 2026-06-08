/**
 * NewWOModal — Create Work Order
 * ══════════════════════════════
 * Form with governance: taxonomy validation, auto-RPN, Criticality A enforcement.
 */

import React, { useState } from 'react';
import { X, Plus, AlertTriangle } from 'lucide-react';
import { useAssetLookup } from '../../hooks/useAssetLookup';
import type { WorkType, WorkPriority } from '../../types/work';

const WORK_TYPES: { value: WorkType; label: string }[] = [
    { value: 'PM', label: 'Preventive Maintenance' },
    { value: 'CM', label: 'Corrective Maintenance' },
    { value: 'EM', label: 'Emergency' },
    { value: 'PdM', label: 'Predictive Maintenance' },
    { value: 'PROJ', label: 'Project' },
];

const CRAFT_OPTIONS = ['Mechanic', 'Electrician', 'Millwright', 'Instrument Tech', 'Operator', 'Specialist', 'Technician'];

interface NewWOModalProps {
    onClose: () => void;
    onSubmit: (data: {
        type: WorkType; title: string; description: string; assetId: string;
        priority: WorkPriority; plannedStart: string | null; plannedFinish: string | null;
        leadCraft: string; estimatedHours: number;
    }) => { error?: string; wo?: any };
}

export const NewWOModal: React.FC<NewWOModalProps> = ({ onClose, onSubmit }) => {
    const [type, setType] = useState<WorkType>('PM');
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [assetId, setAssetId] = useState('');
    const [priority, setPriority] = useState<WorkPriority>('routine');
    const [plannedStart, setPlannedStart] = useState('');
    const [plannedFinish, setPlannedFinish] = useState('');
    const [leadCraft, setLeadCraft] = useState('Mechanic');
    const [estimatedHours, setEstimatedHours] = useState(8);
    const [error, setError] = useState('');

    // Use live asset data from Supabase via useAssetLookup (already filtered to equipment level)
    const { assetOptions: eligibleAssets, getAssetById } = useAssetLookup();

    const selectedAsset = getAssetById(assetId);
    const isCritA = selectedAsset?.criticality === 'A';

    const handleSubmit = () => {
        if (!title.trim() || !assetId) {
            setError('Title and Asset are required.');
            return;
        }
        const result = onSubmit({
            type, title, description, assetId, priority,
            plannedStart: plannedStart || null,
            plannedFinish: plannedFinish || null,
            leadCraft, estimatedHours,
        });
        if (result.error) {
            setError(result.error);
        } else {
            onClose();
        }
    };

    const fld = "w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:border-relantern-500 transition-colors";

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white border border-slate-200 rounded-2xl w-[560px] max-h-[85vh] overflow-y-auto shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
                    <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <Plus size={18} className="text-accent-cyan" /> New Work Order
                    </h2>
                    <button onClick={onClose} className="p-1.5 text-slate-500 hover:text-white hover:bg-slate-100 rounded-lg transition-colors">
                        <X size={18} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 space-y-4">
                    {error && (
                        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm flex items-center gap-2">
                            <AlertTriangle size={16} /> {error}
                        </div>
                    )}

                    {isCritA && (
                        <div className="p-3 bg-orange-500/10 border border-orange-500/30 rounded-lg text-orange-400 text-xs font-medium">
                            ⚠️ Criticality A asset selected — mandatory failure coding will be required at TECO.
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wider">Work Type</label>
                            <select value={type} onChange={e => setType(e.target.value as WorkType)} className={fld}>
                                {WORK_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wider">Priority</label>
                            <select value={priority} onChange={e => setPriority(e.target.value as WorkPriority)} className={fld}>
                                <option value="routine">Routine</option>
                                <option value="urgent">Urgent</option>
                                <option value="emergency">Emergency</option>
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wider">Title *</label>
                        <input value={title} onChange={e => setTitle(e.target.value)} className={fld} placeholder="Brief description of work" />
                    </div>

                    <div>
                        <label className="block text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wider">Description</label>
                        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className={fld} placeholder="Detailed scope of work..." />
                    </div>

                    <div>
                        <label className="block text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wider">Target Asset * (Equipment Level Only)</label>
                        <select value={assetId} onChange={e => setAssetId(e.target.value)} className={fld}>
                            <option value="">Select asset...</option>
                            {eligibleAssets.map(a => (
                                <option key={a.id} value={a.id}>
                                    [{a.criticality}] {a.tag} — {a.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wider">Planned Start</label>
                            <input type="date" value={plannedStart} onChange={e => setPlannedStart(e.target.value)} className={fld} />
                        </div>
                        <div>
                            <label className="block text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wider">Planned Finish</label>
                            <input type="date" value={plannedFinish} onChange={e => setPlannedFinish(e.target.value)} className={fld} />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wider">Lead Craft</label>
                            <select value={leadCraft} onChange={e => setLeadCraft(e.target.value)} className={fld}>
                                {CRAFT_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wider">Est. Hours</label>
                            <input type="number" min={1} value={estimatedHours} onChange={e => setEstimatedHours(Number(e.target.value))} className={fld} />
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200">
                    <button onClick={onClose} className="px-4 py-2 bg-slate-100 text-slate-600 rounded-lg text-sm hover:bg-slate-200 transition-colors">Cancel</button>
                    <button onClick={handleSubmit} className="px-5 py-2 bg-accent-cyan text-brand-900 font-bold rounded-lg text-sm hover:bg-cyan-400 transition-all shadow-[0_0_12px_rgba(6,182,212,0.15)]">
                        Create Work Order
                    </button>
                </div>
            </div>
        </div>
    );
};
