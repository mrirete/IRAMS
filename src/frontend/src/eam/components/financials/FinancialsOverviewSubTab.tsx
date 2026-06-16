import React from 'react';
import { DollarSign, Shield, Edit3 } from 'lucide-react';
import { AssetFinancial, DepreciationBook, Warranty } from '../../services/FinOpsService';

interface OverviewProps {
    financialRecord: AssetFinancial | null;
    primaryBook: DepreciationBook | undefined;
    warranties: Warranty[];
    editedDowntimeCost: number;
    isEditingDowntime: boolean;
    saving: boolean;
    setEditedDowntimeCost: (v: number) => void;
    setIsEditingDowntime: (v: boolean) => void;
    onSaveDowntimeCost: () => void;
}

export const FinancialsOverviewSubTab: React.FC<OverviewProps> = ({
    financialRecord, primaryBook, warranties,
    editedDowntimeCost, isEditingDowntime, saving,
    setEditedDowntimeCost, setIsEditingDowntime, onSaveDowntimeCost
}) => {
    const activeWarranties = warranties.filter(w => {
        if (w.status !== 'ACTIVE') return false;
        if (w.endDate && new Date(w.endDate) < new Date()) return false;
        return true;
    });
    const hasActiveWarranty = activeWarranties.length > 0;
    const latestEnd = activeWarranties.length > 0
        ? activeWarranties.reduce((latest, w) => {
            if (!w.endDate) return latest;
            return !latest || new Date(w.endDate) > new Date(latest) ? w.endDate : latest;
        }, '' as string)
        : null;
    const earliestStart = activeWarranties.length > 0
        ? activeWarranties.reduce((earliest, w) => {
            if (!w.startDate) return earliest;
            return !earliest || new Date(w.startDate) < new Date(earliest) ? w.startDate : earliest;
        }, '' as string)
        : null;

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            {/* Key Financial Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                {/* Acquisition Cost */}
                <div className="p-4 rounded-xl border shadow-sm bg-slate-50 border-slate-200">
                    <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                        Acquisition Cost
                    </div>
                    <div className="text-2xl font-bold text-slate-900">
                        ${(financialRecord?.acquisitionCost ?? 0).toLocaleString()}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                        {financialRecord?.acquisitionDate
                            ? `Acquired ${new Date(financialRecord.acquisitionDate).toLocaleDateString()}`
                            : 'Not capitalized'}
                    </div>
                </div>

                {/* Book Value */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 shadow-sm">
                    <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Book Value (Corp)</div>
                    <div className="text-2xl font-bold text-slate-900">${(primaryBook?.currentValue ?? 0).toLocaleString()}</div>
                    <div className="text-xs text-emerald-600 font-medium mt-1">
                        {financialRecord && primaryBook
                            ? `${(((primaryBook.currentValue ?? 0) / (financialRecord.acquisitionCost || 1)) * 100).toFixed(1)}% Remaining`
                            : 'N/A'}
                    </div>
                </div>

                {/* Useful Life */}
                <div className="p-4 rounded-xl border shadow-sm bg-slate-50 border-slate-200">
                    <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Useful Life</div>
                    <div className="text-2xl font-bold text-slate-900">
                        {financialRecord ? ((financialRecord.usefulLifeMonths ?? 0) / 12).toFixed(1) : '-'}{' '}
                        <span className="text-sm font-normal text-slate-500">Years</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                        {financialRecord
                            ? `Ends ${new Date(new Date(financialRecord.acquisitionDate).setFullYear(new Date(financialRecord.acquisitionDate).getFullYear() + ((financialRecord.usefulLifeMonths ?? 0) / 12))).getFullYear()}`
                            : 'N/A'}
                    </div>
                </div>

                {/* Warranty Status */}
                <div className="p-4 rounded-xl border shadow-sm bg-slate-50 border-slate-200">
                    <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Warranty</div>
                    <div className="flex flex-col gap-1">
                        <div className="text-sm font-bold text-slate-900 flex items-center gap-1">
                            <Shield size={14} className={hasActiveWarranty ? "text-emerald-500" : "text-slate-300"} />
                            {hasActiveWarranty ? 'Active' : (warranties.length > 0 ? 'Expired' : 'None')}
                        </div>
                        <div className="text-xs text-slate-500">
                            {hasActiveWarranty
                                ? `${earliestStart ? new Date(earliestStart).toLocaleDateString() : 'N/A'} - ${latestEnd ? new Date(latestEnd).toLocaleDateString() : 'N/A'}`
                                : warranties.length > 0 ? 'All warranties expired' : 'No warranties added'}
                        </div>
                        {hasActiveWarranty && (
                            <div className="text-[10px] text-emerald-600 font-medium">
                                {activeWarranties.length} active {activeWarranties.length === 1 ? 'policy' : 'policies'}
                            </div>
                        )}
                    </div>
                </div>

                {/* Downtime Cost — click-to-edit */}
                <div className={`p-4 rounded-xl border shadow-sm ${isEditingDowntime ? 'bg-blue-50 border-blue-200' : 'bg-slate-50 border-slate-200'}`}>
                    <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1 flex justify-between items-center">
                        <span>Downtime Cost</span>
                        {!isEditingDowntime && (
                            <button onClick={() => setIsEditingDowntime(true)} className="text-blue-400 hover:text-blue-600" title="Edit downtime cost">
                                <Edit3 size={12} />
                            </button>
                        )}
                    </div>
                    {isEditingDowntime ? (
                        <div>
                            <div className="flex items-baseline gap-1 mb-2">
                                <span className="text-sm text-slate-500">$</span>
                                <input
                                    type="number"
                                    value={editedDowntimeCost}
                                    onChange={(e) => setEditedDowntimeCost(parseFloat(e.target.value) || 0)}
                                    className="w-20 px-2 py-1.5 border border-blue-300 rounded-lg text-lg font-bold text-slate-900 bg-white"
                                    autoFocus
                                />
                                <span className="text-sm text-slate-500">/hr</span>
                            </div>
                            <div className="flex gap-1">
                                <button onClick={() => { setIsEditingDowntime(false); setEditedDowntimeCost(financialRecord?.downtimeCostPerHour || 0); }} className="px-1.5 py-0.5 text-[10px] text-slate-500 hover:text-slate-700 border border-slate-200 rounded">
                                    Cancel
                                </button>
                                <button onClick={onSaveDowntimeCost} disabled={saving} className="px-1.5 py-0.5 text-[10px] bg-blue-600 text-white rounded hover:bg-primary-500 disabled:opacity-50">
                                    {saving ? '...' : 'Save'}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="text-2xl font-bold text-slate-700">${editedDowntimeCost}/hr</div>
                    )}
                </div>
            </div>

            {/* Summary Info */}
            {!financialRecord && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3">
                    <DollarSign className="text-amber-500 shrink-0" size={20} />
                    <div>
                        <div className="font-bold text-amber-800 text-sm">Asset Not Capitalized</div>
                        <div className="text-xs text-amber-600">Navigate to the Depreciation tab to capitalize this asset and begin tracking its book value.</div>
                    </div>
                </div>
            )}

            {financialRecord && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                        <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Residual Value</div>
                        <div className="text-xl font-bold text-slate-700">${(financialRecord.residualValue ?? 0).toLocaleString()}</div>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                        <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Capitalization Date</div>
                        <div className="text-xl font-bold text-slate-700">
                            {financialRecord.capitalizationDate ? new Date(financialRecord.capitalizationDate).toLocaleDateString() : 'N/A'}
                        </div>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                        <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Replacement Value</div>
                        <div className="text-xl font-bold text-slate-700">${(financialRecord.replacementValue ?? 0).toLocaleString()}</div>
                    </div>
                </div>
            )}
        </div>
    );
};
