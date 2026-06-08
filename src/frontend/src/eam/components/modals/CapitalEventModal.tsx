import React, { useState } from 'react';
import { X, AlertCircle, TrendingUp, DollarSign, Clock, Wrench, ArrowUp, Zap } from 'lucide-react';
import { FinOpsService, CapitalEventType, RecapitalizationInput, RecapitalizationResult, AssetFinancial } from '../../services/FinOpsService';
import { predictionService } from '../../services/PredictionService';

interface CapitalEventModalProps {
    isOpen: boolean;
    onClose: () => void;
    assetId: string;
    assetTag: string;
    financialRecord: AssetFinancial;
    onSuccess: (result: RecapitalizationResult) => void;
}

const EVENT_TYPES: { value: CapitalEventType; label: string; icon: React.ReactNode; description: string }[] = [
    { value: 'MAJOR_OVERHAUL', label: 'Major Overhaul', icon: <Wrench size={16} />, description: 'Complete refurbishment extending economic life (e.g. turbine hot gas path overhaul)' },
    { value: 'COMPONENT_REPLACEMENT', label: 'Component Replacement', icon: <Zap size={16} />, description: 'Replacing a major sub-component (e.g. new impeller, gearbox rebuild)' },
    { value: 'UPGRADE', label: 'Upgrade / Modification', icon: <ArrowUp size={16} />, description: 'Performance or capacity upgrade (e.g. control system upgrade, capacity de-bottleneck)' },
    { value: 'LIFE_EXTENSION', label: 'Life Extension Program', icon: <Clock size={16} />, description: 'Formal life extension program per OEM recommendations (e.g. run beyond design hours)' },
];

export const CapitalEventModal: React.FC<CapitalEventModalProps> = ({
    isOpen, onClose, assetId, assetTag, financialRecord, onSuccess
}) => {
    const [eventType, setEventType] = useState<CapitalEventType>('MAJOR_OVERHAUL');
    const [capitalAmount, setCapitalAmount] = useState<number>(0);
    const [lifeExtensionMonths, setLifeExtensionMonths] = useState<number>(0);
    const [newSalvageValue, setNewSalvageValue] = useState<number | undefined>(undefined);
    const [effectiveDate, setEffectiveDate] = useState<string>(new Date().toISOString().split('T')[0]);
    const [workOrderNumber, setWorkOrderNumber] = useState<string>('');
    const [description, setDescription] = useState<string>('');
    const [healthBoostPct, setHealthBoostPct] = useState<number>(10);
    const [saving, setSaving] = useState(false);
    const [result, setResult] = useState<RecapitalizationResult | null>(null);
    const [rulResult, setRulResult] = useState<{ success: boolean; message: string } | null>(null);

    const currentLifeYears = (financialRecord.usefulLifeMonths / 12).toFixed(1);
    const newLifeYears = ((financialRecord.usefulLifeMonths + lifeExtensionMonths) / 12).toFixed(1);
    const newCarrying = financialRecord.acquisitionCost + capitalAmount;

    const handleSubmit = async () => {
        if (capitalAmount <= 0) return;
        setSaving(true);
        setResult(null);
        setRulResult(null);

        try {
            // 1. Record capital event in FinOps
            const input: RecapitalizationInput = {
                assetId,
                eventType,
                capitalAmount,
                lifeExtensionMonths: lifeExtensionMonths > 0 ? lifeExtensionMonths : undefined,
                newSalvageValue,
                effectiveDate,
                workOrderNumber: workOrderNumber || undefined,
                description,
            };

            const finResult = await FinOpsService.recapitalizeAsset(input);
            setResult(finResult);

            // 2. If life was extended, sync to Predict module (RUL reset)
            if (finResult.success && lifeExtensionMonths > 0) {
                const lifeExtensionDays = Math.round(lifeExtensionMonths * 30.44); // avg days/month
                const rul = await predictionService.resetRULForCapitalEvent(
                    assetId,
                    lifeExtensionDays,
                    eventType.replace(/_/g, ' '),
                    healthBoostPct > 0 ? healthBoostPct : undefined
                );
                setRulResult(rul);
            }

            if (finResult.success) {
                onSuccess(finResult);
            }
        } catch (err: any) {
            setResult({ success: false, message: err.message || 'Unknown error', booksRecalculated: 0 });
        } finally {
            setSaving(false);
        }
    };

    if (!isOpen) return null;

    const selectedType = EVENT_TYPES.find(et => et.value === eventType)!;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-xl overflow-hidden border border-slate-200 max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-gradient-to-r from-amber-50 to-white">
                    <div>
                        <h3 className="font-bold text-slate-800 flex items-center gap-2">
                            <DollarSign size={18} className="text-amber-600" />
                            Record Capital Event
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">IAS 16 Subsequent Expenditure — {assetTag}</p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 space-y-5">
                    {/* Current Financial Summary */}
                    <div className="bg-slate-50 rounded-lg p-3 grid grid-cols-3 gap-3 text-center">
                        <div>
                            <div className="text-[10px] text-slate-500 uppercase font-semibold">Carrying Amount</div>
                            <div className="text-sm font-bold text-slate-800">${financialRecord.acquisitionCost.toLocaleString()}</div>
                        </div>
                        <div>
                            <div className="text-[10px] text-slate-500 uppercase font-semibold">Useful Life</div>
                            <div className="text-sm font-bold text-slate-800">{currentLifeYears} yrs</div>
                        </div>
                        <div>
                            <div className="text-[10px] text-slate-500 uppercase font-semibold">Salvage Value</div>
                            <div className="text-sm font-bold text-slate-800">${financialRecord.residualValue.toLocaleString()}</div>
                        </div>
                    </div>

                    {/* Event Type */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">Event Type</label>
                        <div className="grid grid-cols-2 gap-2">
                            {EVENT_TYPES.map(et => (
                                <button
                                    key={et.value}
                                    onClick={() => setEventType(et.value)}
                                    className={`flex items-center gap-2 p-2.5 rounded-lg border text-left transition-all ${
                                        eventType === et.value
                                            ? 'border-amber-400 bg-amber-50 ring-1 ring-amber-300'
                                            : 'border-slate-200 hover:bg-slate-50'
                                    }`}
                                >
                                    <span className={eventType === et.value ? 'text-amber-600' : 'text-slate-400'}>{et.icon}</span>
                                    <span className={`text-xs font-semibold ${eventType === et.value ? 'text-amber-800' : 'text-slate-600'}`}>{et.label}</span>
                                </button>
                            ))}
                        </div>
                        <p className="text-xs text-slate-400 mt-1.5 italic">{selectedType.description}</p>
                    </div>

                    {/* Capital Amount & Life Extension */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Capital Amount ($) *</label>
                            <input
                                type="number"
                                value={capitalAmount || ''}
                                onChange={e => setCapitalAmount(parseFloat(e.target.value) || 0)}
                                placeholder="e.g. 250000"
                                className="w-full px-3 py-2 border border-slate-300 rounded-md"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Life Extension (months)</label>
                            <input
                                type="number"
                                value={lifeExtensionMonths || ''}
                                onChange={e => setLifeExtensionMonths(parseInt(e.target.value) || 0)}
                                placeholder="e.g. 36"
                                className="w-full px-3 py-2 border border-slate-300 rounded-md"
                            />
                        </div>
                    </div>

                    {/* Effective Date & WO Reference */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Effective Date *</label>
                            <input
                                type="date"
                                value={effectiveDate}
                                onChange={e => setEffectiveDate(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 rounded-md"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Work Order #</label>
                            <input
                                type="text"
                                value={workOrderNumber}
                                onChange={e => setWorkOrderNumber(e.target.value)}
                                placeholder="e.g. WO-2026-042"
                                className="w-full px-3 py-2 border border-slate-300 rounded-md"
                            />
                        </div>
                    </div>

                    {/* Health Boost & New Salvage */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Health Boost (%)</label>
                            <input
                                type="number"
                                value={healthBoostPct || ''}
                                onChange={e => setHealthBoostPct(parseInt(e.target.value) || 0)}
                                placeholder="e.g. 15"
                                className="w-full px-3 py-2 border border-slate-300 rounded-md"
                            />
                            <p className="text-[10px] text-slate-400 mt-0.5">Predict module: boosts Digital Twin health index</p>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">New Salvage Value ($)</label>
                            <input
                                type="number"
                                value={newSalvageValue !== undefined ? newSalvageValue : ''}
                                onChange={e => setNewSalvageValue(e.target.value ? parseFloat(e.target.value) : undefined)}
                                placeholder={`Keep ${financialRecord.residualValue.toLocaleString()}`}
                                className="w-full px-3 py-2 border border-slate-300 rounded-md"
                            />
                        </div>
                    </div>

                    {/* Description */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Description *</label>
                        <textarea
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            placeholder="Describe the capital work performed and justification for capitalization..."
                            className="w-full px-3 py-2 border border-slate-300 rounded-md h-20 resize-none"
                        />
                    </div>

                    {/* Impact Preview */}
                    {capitalAmount > 0 && (
                        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-3 border border-blue-200">
                            <div className="text-[10px] text-blue-600 uppercase font-bold mb-2 flex items-center gap-1">
                                <TrendingUp size={12} /> Impact Preview
                            </div>
                            <div className="grid grid-cols-3 gap-3 text-center">
                                <div>
                                    <div className="text-xs text-slate-500">Carrying Amount</div>
                                    <div className="text-sm font-bold text-blue-800">${financialRecord.acquisitionCost.toLocaleString()} → ${newCarrying.toLocaleString()}</div>
                                </div>
                                <div>
                                    <div className="text-xs text-slate-500">Useful Life</div>
                                    <div className="text-sm font-bold text-blue-800">{currentLifeYears} → {newLifeYears} yrs</div>
                                </div>
                                <div>
                                    <div className="text-xs text-slate-500">RUL Extension</div>
                                    <div className="text-sm font-bold text-emerald-700">+{Math.round(lifeExtensionMonths * 30.44)} days</div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Result messages */}
                    {result && (
                        <div className={`rounded-lg p-3 text-sm ${result.success ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
                            <div className="flex items-start gap-2">
                                {result.success ? <TrendingUp size={16} className="shrink-0 mt-0.5" /> : <AlertCircle size={16} className="shrink-0 mt-0.5" />}
                                <div>
                                    <div className="font-semibold">{result.success ? 'Capital Event Recorded ✓' : 'Failed'}</div>
                                    <div className="text-xs mt-0.5">{result.message}</div>
                                </div>
                            </div>
                        </div>
                    )}

                    {rulResult && (
                        <div className={`rounded-lg p-3 text-sm ${rulResult.success ? 'bg-blue-50 text-blue-800 border border-blue-200' : 'bg-yellow-50 text-yellow-800 border border-yellow-200'}`}>
                            <div className="flex items-start gap-2">
                                <Clock size={16} className="shrink-0 mt-0.5" />
                                <div>
                                    <div className="font-semibold">Predict Module Sync {rulResult.success ? '✓' : '⚠'}</div>
                                    <div className="text-xs mt-0.5">{rulResult.message}</div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-between items-center">
                    <p className="text-[10px] text-slate-400">Depreciation books will be automatically recalculated</p>
                    <div className="flex gap-2">
                        <button onClick={onClose} className="px-4 py-2 text-slate-600 hover:text-slate-800 font-medium text-sm">
                            {result?.success ? 'Close' : 'Cancel'}
                        </button>
                        {!result?.success && (
                            <button
                                onClick={handleSubmit}
                                disabled={saving || capitalAmount <= 0 || !description}
                                className="px-4 py-2 bg-amber-500 text-white rounded-lg font-medium hover:bg-amber-600 text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                            >
                                {saving ? (
                                    <><span className="animate-spin">⟳</span> Processing...</>
                                ) : (
                                    <>Record Capital Event</>
                                )}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
