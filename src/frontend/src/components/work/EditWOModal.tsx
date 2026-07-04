/**
 * EditWOModal — Edit Work Order
 * ═════════════════════════════
 * Governance: status workflow gates, TECO failure coding, cost lock on closed.
 */

import React, { useState } from 'react';
import { X, Save, AlertTriangle, Lock, ArrowRight } from 'lucide-react';
import type { WorkOrder, WorkOrderStatus, WorkPriority, FailureCause } from '../../types/work';

const STATUS_LABELS: Record<WorkOrderStatus, string> = {
    draft: 'Draft', planning: 'Planning', scheduled: 'Scheduled',
    in_progress: 'In Progress', on_hold: 'On Hold', teco: 'Tech. Complete', closed: 'Closed',
};

const WO_STATUS_FLOW: Record<WorkOrderStatus, WorkOrderStatus[]> = {
    draft: ['planning'], planning: ['scheduled', 'draft'],
    scheduled: ['in_progress', 'on_hold', 'planning'], in_progress: ['teco', 'on_hold'],
    on_hold: ['in_progress', 'scheduled'], teco: ['closed'], closed: [],
};

const FAILURE_CAUSES: FailureCause[] = [
    'bearing_wear', 'seal_leak', 'vibration', 'overheating',
    'electrical_fault', 'lubrication', 'operator_error', 'other',
];

interface EditWOModalProps {
    wo: WorkOrder;
    onClose: () => void;
    onSave: (id: string, patch: Partial<WorkOrder>) => void;
}

export const EditWOModal: React.FC<EditWOModalProps> = ({ wo, onClose, onSave }) => {
    const isClosed = wo.status === 'closed';
    const isTeco = wo.status === 'teco';

    const [title, setTitle] = useState(wo.title);
    const [description, setDescription] = useState(wo.description);
    const [priority, setPriority] = useState<WorkPriority>(wo.priority);
    const [status, setStatus] = useState<WorkOrderStatus>(wo.status);
    const [actualHours, setActualHours] = useState(wo.actual_hours);
    const [laborCost, setLaborCost] = useState(wo.costs.labor);
    const [materialCost, setMaterialCost] = useState(wo.costs.material);
    const [servicesCost, setServicesCost] = useState(wo.costs.services);

    // Failure coding (required for TECO)
    const [failureMode, setFailureMode] = useState(wo.failure_coding?.failure_mode || '');
    const [failureCause, setFailureCause] = useState<FailureCause>(wo.failure_coding?.failure_cause || 'other');
    const [remedy, setRemedy] = useState(wo.failure_coding?.remedy || '');
    const [downtimeHours, setDowntimeHours] = useState(wo.failure_coding?.downtime_hours || 0);

    const [error, setError] = useState('');

    const allowedNextStatuses = WO_STATUS_FLOW[wo.status];
    const isTransitioningToTeco = status === 'teco' && wo.status !== 'teco';

    const handleSave = () => {
        // Rule 2: Block TECO without failure coding
        if (isTransitioningToTeco && (!failureMode.trim() || !remedy.trim())) {
            setError('TECO requires Failure Mode, Failure Cause, and Remedy to be completed.');
            return;
        }

        const patch: Partial<WorkOrder> = {};

        if (title !== wo.title) patch.title = title;
        if (description !== wo.description) patch.description = description;
        if (priority !== wo.priority) patch.priority = priority;
        if (status !== wo.status) patch.status = status;
        if (actualHours !== wo.actual_hours) patch.actual_hours = actualHours;

        if (!isClosed) {
            patch.costs = { labor: laborCost, material: materialCost, services: servicesCost, total: laborCost + materialCost + servicesCost };
        }

        if (isTransitioningToTeco || failureMode) {
            patch.failure_coding = {
                failure_mode: failureMode,
                failure_cause: failureCause,
                remedy,
                downtime_hours: downtimeHours,
            };
        }

        onSave(wo.id, patch);
        onClose();
    };

    const fld = "w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:border-relantern-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

    // Visual status stepper
    const allStatuses: WorkOrderStatus[] = ['draft', 'planning', 'scheduled', 'in_progress', 'teco', 'closed'];
    const currentIdx = allStatuses.indexOf(wo.status);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white border border-slate-200 rounded-2xl w-[600px] max-h-[85vh] overflow-y-auto shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
                    <div>
                        <h2 className="text-lg font-bold text-slate-800">Edit {wo.wo_number}</h2>
                        <p className="text-xs text-slate-400">{wo.type} — {wo.asset_id}</p>
                    </div>
                    <button onClick={onClose} className="p-1.5 text-slate-500 hover:text-white hover:bg-slate-100 rounded-lg transition-colors">
                        <X size={18} />
                    </button>
                </div>

                {/* Status Stepper */}
                <div className="px-6 py-3 border-b border-slate-200 flex items-center gap-1">
                    {allStatuses.map((s, i) => (
                        <React.Fragment key={s}>
                            <div className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${i === currentIdx ? 'bg-accent-cyan/20 text-accent-cyan border border-accent-cyan/30'
                                : i < currentIdx ? 'bg-green-500/10 text-green-400'
                                    : 'bg-slate-50 text-brand-600'
                                }`}>
                                {STATUS_LABELS[s]}
                            </div>
                            {i < allStatuses.length - 1 && <ArrowRight size={10} className="text-brand-600" />}
                        </React.Fragment>
                    ))}
                </div>

                {/* Body */}
                <div className="p-6 space-y-4">
                    {error && (
                        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm flex items-center gap-2">
                            <AlertTriangle size={16} /> {error}
                        </div>
                    )}

                    {isClosed && (
                        <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-yellow-400 text-xs font-medium flex items-center gap-2">
                            <Lock size={14} /> This Work Order is closed. Cost fields and status are locked (ISO 55000 immutability).
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wider">Status</label>
                            <select value={status} onChange={e => setStatus(e.target.value as WorkOrderStatus)}
                                disabled={isClosed || allowedNextStatuses.length === 0} className={fld}>
                                <option value={wo.status}>{STATUS_LABELS[wo.status]} (current)</option>
                                {allowedNextStatuses.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wider">Priority</label>
                            <select value={priority} onChange={e => setPriority(e.target.value as WorkPriority)} disabled={isClosed} className={fld}>
                                <option value="routine">Routine</option>
                                <option value="urgent">Urgent</option>
                                <option value="emergency">Emergency</option>
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wider">Title</label>
                        <input value={title} onChange={e => setTitle(e.target.value)} disabled={isClosed} className={fld} />
                    </div>

                    <div>
                        <label className="block text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wider">Description</label>
                        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} disabled={isClosed} className={fld} />
                    </div>

                    <div className="grid grid-cols-4 gap-4">
                        <div>
                            <label className="block text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wider">Actual Hours</label>
                            <input type="number" min={0} value={actualHours} onChange={e => setActualHours(Number(e.target.value))} disabled={isClosed} className={fld} />
                        </div>
                        <div>
                            <label className="block text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wider">Labor ($)</label>
                            <input type="number" min={0} value={laborCost} onChange={e => setLaborCost(Number(e.target.value))} disabled={isClosed} className={fld} />
                        </div>
                        <div>
                            <label className="block text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wider">Material ($)</label>
                            <input type="number" min={0} value={materialCost} onChange={e => setMaterialCost(Number(e.target.value))} disabled={isClosed} className={fld} />
                        </div>
                        <div>
                            <label className="block text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wider">Services ($)</label>
                            <input type="number" min={0} value={servicesCost} onChange={e => setServicesCost(Number(e.target.value))} disabled={isClosed} className={fld} />
                        </div>
                    </div>

                    {/* Failure Coding Section — visible when approaching TECO */}
                    {(isTransitioningToTeco || isTeco || wo.failure_coding) && (
                        <div className="border border-slate-200 rounded-xl p-4 space-y-3">
                            <h4 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                                <AlertTriangle size={14} className="text-orange-400" />
                                Failure Coding {isTransitioningToTeco && <span className="text-[10px] text-red-400 font-mono">(MANDATORY)</span>}
                            </h4>
                            <div>
                                <label className="block text-xs text-slate-500 mb-1">Failure Mode *</label>
                                <input value={failureMode} onChange={e => setFailureMode(e.target.value)} className={fld} placeholder="e.g. Mechanical Seal Blowout" />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs text-slate-500 mb-1">Cause *</label>
                                    <select value={failureCause} onChange={e => setFailureCause(e.target.value as FailureCause)} className={fld}>
                                        {FAILURE_CAUSES.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs text-slate-500 mb-1">Downtime (hrs)</label>
                                    <input type="number" min={0} value={downtimeHours} onChange={e => setDowntimeHours(Number(e.target.value))} className={fld} />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs text-slate-500 mb-1">Remedy *</label>
                                <textarea value={remedy} onChange={e => setRemedy(e.target.value)} rows={2} className={fld} placeholder="Describe corrective action taken..." />
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200">
                    <button onClick={onClose} className="px-4 py-2 bg-slate-100 text-slate-600 rounded-lg text-sm hover:bg-slate-200 transition-colors">Cancel</button>
                    {!isClosed && (
                        <button onClick={handleSave} className="flex items-center gap-2 px-5 py-2 bg-accent-cyan text-brand-900 font-bold rounded-lg text-sm hover:bg-primary-400 transition-all shadow-[0_0_12px_rgba(6,182,212,0.15)]">
                            <Save size={14} /> Save Changes
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};
