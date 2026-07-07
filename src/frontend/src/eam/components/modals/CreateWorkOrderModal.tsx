
import React, { useState, useEffect } from 'react';
import { X, CheckCircle, Search, Calendar, AlertTriangle, Shield, ShieldAlert } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { DatabaseService } from '../../services/DatabaseService';
import { buildWorkOrder } from '../../lib/workOrder';
import { FinOpsService, WarrantyCheckResult, Warranty } from '../../services/FinOpsService';
import { Asset, WorkOrder, WorkOrderStatus, WorkOrderType } from '../../types';
import { SearchableDropdown } from '../ui/SearchableDropdown';
import { NotificationService } from '../../services/NotificationService';

interface CreateWorkOrderModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: () => void; // Parent should reload
    dictionaries?: any[];
}

export const CreateWorkOrderModal: React.FC<CreateWorkOrderModalProps> = ({ isOpen, onClose, onSave, dictionaries: propDictionaries }) => {
    const [assets, setAssets] = useState<Asset[]>([]);
    const [dictionaries, setDictionaries] = useState<any[]>(propDictionaries || []); // Store dictionaries
    const [loadingData, setLoadingData] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

    const [formData, setFormData] = useState({
        title: '',
        assetId: '',
        priority: '',
        type: '',
        costCenterId: ''
    });

    // Warranty detection state (G1)
    const [warrantyCheck, setWarrantyCheck] = useState<WarrantyCheckResult | null>(null);
    const [checkingWarranty, setCheckingWarranty] = useState(false);
    // G8: Multi-warranty selection
    const [selectedWarrantyId, setSelectedWarrantyId] = useState<string | null>(null);

    const { user, profile } = useAuth();

    const loadData = async () => {
        setLoadingData(true);
        try {
            const data = await DatabaseService.getInstance().getAssets();
            setAssets(data);

            // If prop dictionaries are empty, we could fetch them here, 
            // but we expect parent to pass them. 
            // However, we can verify or refresh if needed.
            // For now, trust props or parent.
        } catch (error) {
            console.error("Error loading assets for modal:", error);
        } finally {
            setLoadingData(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    // Update local state if props change
    useEffect(() => {
        if (propDictionaries) {
            setDictionaries(propDictionaries);
        }
    }, [propDictionaries]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const errors: Record<string, string> = {};
        if (!formData.assetId) errors.assetId = 'Asset is required';
        if (!formData.title.trim()) errors.title = 'Work description is required';
        if (!formData.type) errors.type = 'Work type is required';
        if (!formData.priority) errors.priority = 'Priority is required';
        if (Object.keys(errors).length > 0) {
            setValidationErrors(errors);
            return;
        }
        setValidationErrors({});

        const actorId = profile?.id || user?.id;
        if (!actorId) {
            alert("Error: No valid User Actor found (Database needs at least one User).");
            return;
        }

        setSubmitting(true);
        try {
            const selectedAsset = assets.find(a => a.id === formData.assetId);

            // wo_number is auto-generated
            const woNumber = `WO-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

            // Validate actorId is a real UUID before sending to DB
            const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            const validActorUuid = UUID_RE.test(actorId) ? actorId : null;

            const newWO = buildWorkOrder({
                woNumber,
                title: formData.title,
                description: formData.title, // Default description to title
                status: WorkOrderStatus.OPEN,
                type: formData.type,
                priorityCode: formData.priority,
                assetId: formData.assetId,
                assignedTo: null,
                costCenterId: formData.costCenterId || null,
                createdBy: validActorUuid,
                warrantyFlag: warrantyCheck?.underWarranty || false,
                warrantyId: warrantyCheck?.underWarranty ? (selectedWarrantyId || warrantyCheck.warranty?.id) : null,
            });

            await DatabaseService.getInstance().createWorkOrder(newWO, actorId || 'unknown');

            // Fire notification for WO creation (non-blocking)
            NotificationService.checkRules('workOrders', 'WO_CREATED', {
                ...newWO,
                woNumber: woNumber,
                title: formData.title,
            }, {
                currentUserId: actorId,
            }).catch(console.error);

            onSave();
            onClose();
        } catch (err: any) {
            alert('Error creating Work Order: ' + err.message);
        } finally {
            setSubmitting(false);
        }
    };

    if (!isOpen) return null;

    const assetOptions = assets.map(a => ({
        code: a.id,
        description: `${a.tag} - ${a.name}`
    }));

    const workTypes = dictionaries.filter(d => d.type === 'WORK_TYPE');
    const priorities = dictionaries.filter(d => d.type === 'PRIORITY');

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto overflow-x-hidden animate-in zoom-in-95 duration-200">
                <div className="p-5 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2">
                        <CheckCircle size={20} className="text-blue-600" /> Create New Work Order
                    </h3>
                    <button onClick={onClose}><X size={20} className="text-slate-400 hover:text-slate-600" /></button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Required Asset <span className="text-red-500">*</span></label>
                        {validationErrors.assetId && <p className="text-[11px] text-red-500 font-medium mb-1">{validationErrors.assetId}</p>}
                        <SearchableDropdown
                            options={assetOptions}
                            value={formData.assetId}
                            onChange={async (val) => {
                                // Auto-select cost center from asset if available
                                const asset = assets.find(a => a.id === val);
                                setFormData({
                                    ...formData,
                                    assetId: val,
                                    costCenterId: asset?.costCenter || formData.costCenterId
                                });
                                // Warranty auto-detection (G1)
                                if (val) {
                                    setCheckingWarranty(true);
                                    try {
                                        const result = await FinOpsService.checkWarrantyStatus(val);
                                        setWarrantyCheck(result);
                                        // G8: Auto-select primary warranty
                                        setSelectedWarrantyId(result.warranty?.id || null);
                                    } catch (err) {
                                        console.error('Warranty check failed:', err);
                                        setWarrantyCheck(null);
                                    } finally {
                                        setCheckingWarranty(false);
                                    }
                                } else {
                                    setWarrantyCheck(null);
                                    setSelectedWarrantyId(null);
                                }
                            }}
                            placeholder={loadingData ? "Loading Assets..." : "Select Asset..."}
                        />
                    </div>

                    {/* Warranty Detection Banner (G1) */}
                    {checkingWarranty && (
                        <div className="flex items-center gap-2 p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-500">
                            <div className="animate-spin h-3 w-3 border-2 border-slate-300 border-t-slate-600 rounded-full" />
                            Checking warranty coverage...
                        </div>
                    )}
                    {warrantyCheck?.underWarranty && !checkingWarranty && (
                        <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg">
                            <div className="flex items-start gap-2">
                                <Shield size={16} className="text-amber-600 mt-0.5 flex-shrink-0" />
                                <div>
                                    <div className="text-xs font-bold text-amber-800 flex items-center gap-1">
                                        ⚠️ ASSET UNDER WARRANTY
                                    </div>
                                    <div className="text-[11px] text-amber-700 mt-1">
                                        {warrantyCheck.message}
                                    </div>
                                    {warrantyCheck.daysRemaining !== undefined && (
                                        <div className="text-[10px] text-amber-600 mt-1">
                                            Coverage: <strong>{warrantyCheck.coverageType}</strong> • {warrantyCheck.daysRemaining} days remaining
                                            {warrantyCheck.hoursRemaining !== undefined && ` • ${warrantyCheck.hoursRemaining} hours remaining`}
                                        </div>
                                    )}
                                    <div className="text-[10px] text-amber-600 mt-1 italic">
                                        A warranty claim will be auto-drafted when this WO is technically completed.
                                    </div>

                                    {/* G8: Multi-warranty selector */}
                                    {warrantyCheck.allWarranties && warrantyCheck.allWarranties.length > 1 && (
                                        <div className="mt-2 pt-2 border-t border-amber-200">
                                            <label className="block text-[10px] font-bold text-amber-800 mb-1">
                                                {warrantyCheck.allWarranties.length} warranties found — select which to apply:
                                            </label>
                                            <select
                                                value={selectedWarrantyId || ''}
                                                onChange={e => setSelectedWarrantyId(e.target.value)}
                                                className="w-full px-2 py-1.5 text-[11px] border border-amber-300 rounded bg-white focus:ring-2 focus:ring-amber-400 focus:outline-none"
                                            >
                                                {warrantyCheck.allWarranties.map((w: Warranty) => {
                                                    const dLeft = w.endDate ? Math.ceil((new Date(w.endDate).getTime() - Date.now()) / (86400000)) : 0;
                                                    return (
                                                        <option key={w.id} value={w.id}>
                                                            {w.warrantyType} — {dLeft}d left{w.coverageScope ? ` — ${w.coverageScope}` : ''}{w.maxHours ? ` — ${w.maxHours - w.currentHours}h remaining` : ''}
                                                        </option>
                                                    );
                                                })}
                                            </select>
                                        </div>
                                    )}
                                </div>
                            </div>
                            {/* Gatekeeper for Criticality A (G13) */}
                            {(() => {
                                const selectedAsset = assets.find(a => a.id === formData.assetId);
                                if (selectedAsset?.criticality === 'A') {
                                    return (
                                        <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-[10px] text-red-700 flex items-start gap-1.5">
                                            <ShieldAlert size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
                                            <div>
                                                <strong>GATEKEEPER — Criticality A Asset:</strong> Consider contacting the vendor for
                                                warranty-covered repair before proceeding with in-house work. In-house repair on
                                                a warranted safety-critical asset should be accompanied by a warranty claim.
                                            </div>
                                        </div>
                                    );
                                }
                                return null;
                            })()}
                        </div>
                    )}

                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Work Description <span className="text-red-500">*</span></label>
                        {validationErrors.title && <p className="text-[11px] text-red-500 font-medium mb-1">{validationErrors.title}</p>}
                        <input
                            required
                            type="text"
                            className={`w-full p-2 border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none ${validationErrors.title ? 'border-red-400 bg-red-50' : 'border-slate-300'}`}
                            placeholder="e.g. Pump P-101 Vibration High"
                            value={formData.title}
                            onChange={e => setFormData({ ...formData, title: e.target.value })}
                        />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 modal-grid-responsive">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Work Type <span className="text-red-500">*</span></label>
                            {validationErrors.type && <p className="text-[11px] text-red-500 font-medium mb-1">{validationErrors.type}</p>}
                            <select
                                required
                                className={`w-full p-2 border rounded-lg text-sm bg-white ${validationErrors.type ? 'border-red-400 bg-red-50' : 'border-slate-300'}`}
                                value={formData.type}
                                onChange={e => setFormData({ ...formData, type: e.target.value })}
                            >
                                <option value="" disabled>Select Type...</option>
                                {workTypes.map(t => (
                                    <option key={t.id} value={t.code}>{t.description}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Priority <span className="text-red-500">*</span></label>
                            {validationErrors.priority && <p className="text-[11px] text-red-500 font-medium mb-1">{validationErrors.priority}</p>}
                            <select
                                required
                                className={`w-full p-2 border rounded-lg text-sm bg-white ${validationErrors.priority ? 'border-red-400 bg-red-50' : 'border-slate-300'}`}
                                value={formData.priority}
                                onChange={e => setFormData({ ...formData, priority: e.target.value })}
                            >
                                <option value="" disabled>Select Priority...</option>
                                {priorities.map(p => (
                                    <option key={p.id} value={p.code}>{p.code} - {p.description}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Cost Center (Optional)</label>
                        <select
                            className="w-full p-2 border border-slate-300 rounded-lg text-sm bg-white"
                            value={formData.costCenterId || ''}
                            onChange={e => setFormData({ ...formData, costCenterId: e.target.value })}
                        >
                            <option value="">Use Asset Default</option>
                            {dictionaries.filter(d => d.type === 'COST_CENTRE').map(cc => (
                                <option key={cc.id} value={cc.id}>{cc.code} - {cc.description}</option>
                            ))}
                        </select>
                        <p className="text-[10px] text-slate-400 mt-1">If blank, cost will be allocated to Asset's cost center.</p>
                    </div>

                    <div className="pt-4 flex justify-end gap-3 border-t border-slate-100 modal-actions-sticky">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-100 rounded-lg">Cancel</button>
                        <button
                            type="submit"
                            disabled={submitting}
                            className="px-6 py-2 bg-primary-600 text-white font-bold rounded-lg hover:bg-primary-500 shadow-md flex items-center gap-2 disabled:opacity-50"
                        >
                            {submitting ? 'Creating...' : 'Create Work Order'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
