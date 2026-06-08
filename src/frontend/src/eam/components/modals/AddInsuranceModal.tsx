import React, { useState } from 'react';
import { X } from 'lucide-react';
import { AssetInsurance } from '../../services/FinOpsService';

interface AddInsuranceModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: Partial<AssetInsurance>) => void;
}

export const AddInsuranceModal: React.FC<AddInsuranceModalProps> = ({ isOpen, onClose, onSave }) => {
    const [provider, setProvider] = useState('');
    const [policyNum, setPolicyNum] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [premium, setPremium] = useState<number>(0);
    const [insuredValue, setInsuredValue] = useState<number>(0);
    const [deductible, setDeductible] = useState<number>(0);
    const [coverageType, setCoverageType] = useState<AssetInsurance['coverageType']>('ALL_RISK');

    const handleSubmit = () => {
        onSave({
            provider,
            policyNumber: policyNum,
            startDate,
            endDate,
            premiumAmount: premium,
            insuredValue,
            deductible,
            coverageType,
            status: 'ACTIVE'
        });
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden border border-slate-200">
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                    <h3 className="font-bold text-slate-800">Add Insurance Policy</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                        <X size={20} />
                    </button>
                </div>
                <div className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Provider</label>
                        <input
                            type="text"
                            value={provider}
                            onChange={e => setProvider(e.target.value)}
                            placeholder="e.g. Allianz"
                            className="w-full px-3 py-2 border border-slate-300 rounded-md"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Policy Number</label>
                        <input
                            type="text"
                            value={policyNum}
                            onChange={e => setPolicyNum(e.target.value)}
                            placeholder="e.g. POL-123456"
                            className="w-full px-3 py-2 border border-slate-300 rounded-md"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Coverage Type</label>
                        <select
                            value={coverageType}
                            onChange={e => setCoverageType(e.target.value as any)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-md bg-white"
                        >
                            <option value="ALL_RISK">All Risk</option>
                            <option value="FIRE">Fire Only</option>
                            <option value="THEFT">Theft Only</option>
                            <option value="LIABILITY">Liability</option>
                        </select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Start Date</label>
                            <input
                                type="date"
                                value={startDate}
                                onChange={e => setStartDate(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 rounded-md"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">End Date</label>
                            <input
                                type="date"
                                value={endDate}
                                onChange={e => setEndDate(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 rounded-md"
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Premium ($)</label>
                            <input
                                type="number"
                                value={premium}
                                onChange={e => setPremium(parseFloat(e.target.value))}
                                className="w-full px-3 py-2 border border-slate-300 rounded-md"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Deductible ($)</label>
                            <input
                                type="number"
                                value={deductible}
                                onChange={e => setDeductible(parseFloat(e.target.value))}
                                className="w-full px-3 py-2 border border-slate-300 rounded-md"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Insured Value ($)</label>
                        <input
                            type="number"
                            value={insuredValue}
                            onChange={e => setInsuredValue(parseFloat(e.target.value))}
                            className="w-full px-3 py-2 border border-slate-300 rounded-md"
                        />
                    </div>
                </div>
                <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2">
                    <button onClick={onClose} className="px-4 py-2 text-slate-600 hover:text-slate-800 font-medium text-sm">Cancel</button>
                    <button onClick={handleSubmit} className="px-4 py-2 bg-relantern-500 text-white rounded-lg font-medium hover:bg-relantern-600 text-sm">Save Policy</button>
                </div>
            </div>
        </div>
    );
};
