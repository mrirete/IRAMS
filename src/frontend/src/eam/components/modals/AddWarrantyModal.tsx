import React, { useState } from 'react';
import { X } from 'lucide-react';
import { FinOpsService, Warranty } from '../../services/FinOpsService';

interface AddWarrantyModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: Partial<Warranty>) => void;
}

export const AddWarrantyModal: React.FC<AddWarrantyModalProps> = ({ isOpen, onClose, onSave }) => {
    const [type, setType] = useState<Warranty['warrantyType']>('OEM');
    const [vendor, setVendor] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [scope, setScope] = useState('');
    const [maxHours, setMaxHours] = useState<number>(0);
    const [vendors, setVendors] = useState<{ id: string; name: string }[]>([]);

    React.useEffect(() => {
        if (isOpen) {
            FinOpsService.getVendorsForPicker().then(setVendors);
        }
    }, [isOpen]);

    const handleSubmit = () => {
        onSave({
            warrantyType: type,
            vendorId: vendor || undefined, // Send undefined if empty string
            startDate,
            endDate,
            coverageScope: scope,
            maxHours: maxHours > 0 ? maxHours : undefined,
            status: 'ACTIVE',
            currentHours: 0
        });
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden border border-slate-200">
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                    <h3 className="font-bold text-slate-800">Add Warranty</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                        <X size={20} />
                    </button>
                </div>
                <div className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Warranty Type</label>
                        <select
                            value={type}
                            onChange={e => setType(e.target.value as any)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-md bg-white"
                        >
                            <option value="OEM">OEM Standard</option>
                            <option value="EXTENDED">Extended Warranty</option>
                            <option value="SERVICE_CONTRACT">Service Contract</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Vendor / Provider</label>
                        <select
                            value={vendor}
                            onChange={e => setVendor(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-md bg-white"
                        >
                            <option value="">Select a vendor...</option>
                            {vendors.map(v => (
                                <option key={v.id} value={v.id}>{v.name}</option>
                            ))}
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
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Max Usage (Hours)</label>
                        <input
                            type="number"
                            value={maxHours}
                            onChange={e => setMaxHours(parseFloat(e.target.value))}
                            placeholder="Optional limit"
                            className="w-full px-3 py-2 border border-slate-300 rounded-md"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Coverage Scope</label>
                        <textarea
                            value={scope}
                            onChange={e => setScope(e.target.value)}
                            placeholder="e.g. Parts and Labor for engine components..."
                            className="w-full px-3 py-2 border border-slate-300 rounded-md h-20"
                        />
                    </div>
                </div>
                <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2">
                    <button onClick={onClose} className="px-4 py-2 text-slate-600 hover:text-slate-800 font-medium text-sm">Cancel</button>
                    <button onClick={handleSubmit} className="px-4 py-2 bg-relantern-500 text-white rounded-lg font-medium hover:bg-relantern-600 text-sm">Save Warranty</button>
                </div>
            </div>
        </div>
    );
};
