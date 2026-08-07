import React, { useState, useEffect, useMemo } from 'react';
import { Search, X, Package, AlertTriangle, CheckCircle } from 'lucide-react';
import { StorageImage } from '../ui/StorageImage';
import { DatabaseService } from '../../services/DatabaseService';

interface InventoryPickerProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (item: any) => void;
}

export const InventoryPicker: React.FC<InventoryPickerProps> = ({ isOpen, onClose, onSelect }) => {
    const [items, setItems] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        if (isOpen && items.length === 0) {
            loadInventory();
        }
    }, [isOpen]);

    const loadInventory = async () => {
        setLoading(true);
        try {
            const data = await DatabaseService.getInstance().getInventory();
            setItems(data);
        } catch (error) {
            console.error("Failed to load inventory:", error);
        } finally {
            setLoading(false);
        }
    };

    const filteredItems = useMemo(() => {
        if (!searchTerm) return items;
        const lower = searchTerm.toLowerCase();
        return items.filter(i =>
            (i.code || '').toLowerCase().includes(lower) ||
            (i.description || '').toLowerCase().includes(lower)
        );
    }, [items, searchTerm]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-2xl rounded-2xl shadow-xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[80vh]">

                {/* Header */}
                <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                    <div>
                        <h3 className="font-bold text-slate-800 flex items-center gap-2">
                            <Package size={20} className="text-blue-600" />
                            Select Part / Material
                        </h3>
                        <p className="text-xs text-slate-500">Choose an item from the master inventory.</p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition">
                        <X size={24} />
                    </button>
                </div>

                {/* Search */}
                <div className="p-4 border-b border-slate-100 bg-white">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <input
                            type="text"
                            placeholder="Search by Part Number or Description..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-blue-500 outline-none"
                            autoFocus
                        />
                    </div>
                </div>

                {/* List */}
                <div className="flex-1 overflow-y-auto p-2 space-y-1 bg-slate-50">
                    {loading ? (
                        <div className="text-center py-8 text-slate-400">Loading Inventory...</div>
                    ) : filteredItems.length === 0 ? (
                        <div className="text-center py-8 text-slate-400">No items found matching "{searchTerm}"</div>
                    ) : (
                        filteredItems.map(item => (
                            <div
                                key={item.id}
                                onClick={() => onSelect(item)}
                                className="group flex items-center justify-between p-3 bg-white rounded-lg border border-slate-200 hover:border-blue-300 hover:shadow-md cursor-pointer transition"
                            >
                                <div className="flex items-center gap-3">
                                    <div className={`w-10 h-10 rounded bg-slate-100 flex items-center justify-center text-slate-500 font-bold text-xs border border-slate-200`}>
                                        {item.image ? <StorageImage value={item.image} alt="" className="w-full h-full object-cover rounded" fallback={<Package size={16} />} /> : <Package size={16} />}
                                    </div>
                                    <div>
                                        <div className="font-bold text-slate-800 text-sm group-hover:text-blue-600 transition">{item.description}</div>
                                        <div className="flex items-center gap-2 text-xs text-slate-500">
                                            <span className="font-mono bg-slate-100 px-1 rounded">{item.code}</span>
                                            <span>•</span>
                                            <span>{item.manufacturer}</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="text-right">
                                    <div className={`font-bold text-sm ${item.totalQtyOnHand > 0 ? 'text-green-600' : 'text-red-500'}`}>
                                        {item.totalQtyOnHand} {item.uom}
                                    </div>
                                    <div className="text-xs text-slate-400">On Hand</div>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Footer */}
                <div className="p-3 border-t border-slate-200 bg-slate-50 text-xs text-center text-slate-400">
                    Showing {filteredItems.length} items
                </div>
            </div>
        </div>
    );
};
