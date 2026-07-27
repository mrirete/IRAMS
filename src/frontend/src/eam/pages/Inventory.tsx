
import React, { useState, useEffect } from 'react';
import {
    Search, Plus, Filter, Save, Package, Truck, Layers,
    FileText, ShoppingCart, History, Box, Barcode,
    Building2, Warehouse, MoreHorizontal, Settings, Info, X, ChevronRight,
    Edit2, Trash2, CheckCircle, CheckSquare, BarChart2, DollarSign, Activity, MapPin,
    Briefcase, RefreshCcw, Camera, AlertTriangle, Image as ImageIcon,
    Tag, ClipboardCheck, ShieldCheck, RefreshCw, Calculator, Upload
} from 'lucide-react';
import { ImageCapture } from '../components/ui/ImageCapture';
import { ConfirmationModal, ConfirmationType } from '../components/modals/ConfirmationModal';
import {
    MOCK_INVENTORY, MOCK_ASSETS,
    MOCK_DICTIONARIES, MOCK_STORES
} from '../constants';
import { InventoryItem, InventoryLocation, Store, BinLocation, InventorySupplier, Contact, Vendor } from '../types';
import { DatabaseService } from '../services/DatabaseService';
import { emptyResult, tally, errMessage } from '../services/importTypes';
import { NotificationService } from '../services/NotificationService';
import { AskRelanternButton } from '../components/AskRelanternButton';
import { useAuth } from '../contexts/AuthContext';
import { UnifiedDetailHeader } from '../components/ui/UnifiedDetailHeader';
import { UnifiedTabBar } from '../components/ui/UnifiedTabBar';
import { Badge, Button, type Tone } from '../components/ui';
import { InventoryItemRecord } from '../schema';
import BulkImportModal from '../components/modals/BulkImportModal';
import type { ImportType } from '../services/assetTemplates';
import { useToast } from '../contexts/ToastContext';
import { availableQty, fetchReservedByItem } from '../lib/atp';

interface InventoryProps {
    onAnalyze: (context: string) => void;
}


type TabId = 'details' | 'properties' | 'stores' | 'suppliers' | 'bom' | 'jobs' | 'purchasing' | 'history' | 'financials' | 'fields';




// --- Stock Adjustment Modal Component ---
function StockAdjustmentModal({ isOpen, onClose, item, onSuccess }: {
    isOpen: boolean;
    onClose: () => void;
    item: InventoryItem;
    onSuccess: () => void;
}) {
    const [selectedLocationId, setSelectedLocationId] = useState(item.stockLocations[0]?.id || '');
    const [adjType, setAdjType] = useState<'STOCKTAKE' | 'ADJUSTMENT'>('STOCKTAKE');
    const [quantity, setQuantity] = useState<string>(''); // string input for ease
    const [reason, setReason] = useState('');
    const [loading, setLoading] = useState(false);
    const { showToast } = useToast();

    const handleProcess = async () => {
        if (!selectedLocationId || !quantity) return;

        const qtyNum = parseFloat(quantity);
        if (isNaN(qtyNum)) return;

        setLoading(true);
        try {
            // Determine final quantity or delta
            const finalQty = qtyNum;
            // The service expects the NEW TOTAL for Stocktake, but usually logic is complex.
            // My Service Logic:
            // if STOCKTAKE -> newLocationQty IS the total.
            // if ADJUSTMENT -> newLocationQty IS the change?
            // Wait, my service logic (Step 3328):
            // if (transactionType === 'STOCKTAKE') { delta = newLocationQty - oldQty; locations[locIndex].qtyOnHand = newLocationQty; }
            // else { delta = newLocationQty - oldQty; locations[locIndex].qtyOnHand = newLocationQty; }
            // Ah, I implemented it so that `newLocationQty` MUST BE THE TARGET QUANTITY regardless of type.
            // So I need to calculate it here if it's an adjustment.

            const loc = item.stockLocations.find(l => l.id === selectedLocationId);
            const currentQty = loc?.qtyOnHand || 0;

            let targetQty = qtyNum;
            if (adjType === 'ADJUSTMENT') {
                targetQty = currentQty + qtyNum; // Assuming + for add, - for subtract
            }

            await DatabaseService.getInstance().adjustInventoryStock(
                item.id,
                selectedLocationId,
                targetQty,
                adjType,
                reason,
                'USER' // Todo: get real user
            );

            onSuccess();
        } catch (e) {
            console.error(e);
            showToast('Failed to process stock adjustment.', 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-md rounded-2xl shadow-xl overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                    <h3 className="font-bold text-slate-800">Stock Adjustment</h3>
                    <button onClick={onClose}><X size={20} className="text-slate-400 hover:text-slate-600" /></button>
                </div>
                <div className="p-6 space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Store Location</label>
                        <select
                            className="w-full p-2 border border-slate-300 rounded-lg"
                            value={selectedLocationId}
                            onChange={(e) => setSelectedLocationId(e.target.value)}
                        >
                            {item.stockLocations.length === 0 && <option value="">No Store Locations</option>}
                            {item.stockLocations.map(loc => (
                                <option key={loc.id} value={loc.id}>{loc.storeName} (Current: {loc.qtyOnHand})</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Adjustment Type</label>
                        <div className="flex gap-2">
                            <label className={`flex-1 border p-3 rounded-lg flex items-center gap-2 cursor-pointer transition ${adjType === 'STOCKTAKE' ? 'bg-blue-50 border-blue-200 ring-1 ring-blue-500' : 'hover:bg-slate-50'}`}>
                                <input
                                    type="radio"
                                    name="adjType"
                                    checked={adjType === 'STOCKTAKE'}
                                    onChange={() => setAdjType('STOCKTAKE')}
                                />
                                <span className={`text-sm font-medium ${adjType === 'STOCKTAKE' ? 'text-blue-700' : 'text-slate-600'}`}>Stocktake (Set Total)</span>
                            </label>
                            <label className={`flex-1 border p-3 rounded-lg flex items-center gap-2 cursor-pointer transition ${adjType === 'ADJUSTMENT' ? 'bg-blue-50 border-blue-200 ring-1 ring-blue-500' : 'hover:bg-slate-50'}`}>
                                <input
                                    type="radio"
                                    name="adjType"
                                    checked={adjType === 'ADJUSTMENT'}
                                    onChange={() => setAdjType('ADJUSTMENT')}
                                />
                                <span className={`text-sm font-medium ${adjType === 'ADJUSTMENT' ? 'text-blue-700' : 'text-slate-600'}`}>Adjustment (+/-)</span>
                            </label>
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                            {adjType === 'STOCKTAKE' ? 'New Total Quantity' : 'Adjustment Amount'}
                        </label>
                        <input
                            type="number"
                            className="w-full p-2 border border-slate-300 rounded-lg text-lg font-bold"
                            placeholder="0.00"
                            value={quantity}
                            onChange={e => setQuantity(e.target.value)}
                        />
                        <p className="text-xs text-slate-400 mt-1">
                            {adjType === 'ADJUSTMENT' ? 'Use positive for receipt, negative for issue.' : 'Enter the exact counted quantity.'}
                        </p>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Reason / Reference</label>
                        <input
                            type="text"
                            className="w-full p-2 border border-slate-300 rounded-lg text-sm"
                            placeholder="e.g. Annual Count or WO-123"
                            value={reason}
                            onChange={e => setReason(e.target.value)}
                        />
                    </div>
                </div>
                <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
                    <button onClick={onClose} className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-100 rounded-lg">Cancel</button>
                    <button
                        onClick={handleProcess}
                        disabled={loading || !selectedLocationId || !quantity}
                        className={`px-4 py-2 text-white font-bold rounded-lg flex items-center gap-2 ${loading || !selectedLocationId || !quantity ? 'bg-slate-300 cursor-not-allowed' : 'bg-primary-600 hover:bg-primary-500'}`}
                    >
                        {loading ? 'Processing...' : 'Process'} <CheckCircle size={16} />
                    </button>
                </div>
            </div>
        </div>
    );
};

// --- Store Manager Modal Component ---
function StoreManagerModal({ isOpen, onClose, stores, onUpdateStores }: {
    isOpen: boolean;
    onClose: () => void;
    stores: Store[];
    onUpdateStores: (stores: Store[]) => void;
}) {
    const [selectedStoreId, setSelectedStoreId] = useState<string | null>(stores[0]?.id || null);
    const { showToast } = useToast();

    // UI State for creating new vs editing
    const [isCreating, setIsCreating] = useState(false);

    // Form State (shared for create/edit)
    const [formData, setFormData] = useState<Partial<Store>>({});

    // Bin Management State
    const [newBinCode, setNewBinCode] = useState('');
    const [newBinDesc, setNewBinDesc] = useState('');
    const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; binId: string | null }>({
        isOpen: false,
        binId: null
    });

    const selectedStore = stores.find(s => s.id === selectedStoreId);

    // Initialize form when selection changes
    React.useEffect(() => {
        if (isCreating) {
            setFormData({ code: '', name: '', location: '', description: '', bins: [] });
        } else if (selectedStore) {
            setFormData({ ...selectedStore });
        }
    }, [selectedStoreId, isCreating, selectedStore]);

    const handleSaveStore = async () => {
        if (!formData.name || !formData.code) {
            showToast('Store Code and Name are required.', 'warning');
            return;
        }

        try {
            const dbRef = DatabaseService.getInstance();
            if (isCreating) {
                const newStore: Store = {
                    id: `store-${Date.now()}`, // Temp ID, will be replaced by DB
                    code: formData.code!,
                    name: formData.name!,
                    location: formData.location || '',
                    description: formData.description || '',
                    bins: formData.bins || []
                };
                // Optimistic update
                const saved = await dbRef.addStore(newStore);
                onUpdateStores([...stores, saved]); // Update list with real DB record

                setIsCreating(false);
                setSelectedStoreId(saved.id);
            } else if (selectedStore) {
                const updatedStore: Store = {
                    ...selectedStore,
                    ...formData as Store
                };

                await dbRef.updateStore(updatedStore);

                const updatedList = stores.map(s => s.id === selectedStore.id ? updatedStore : s);
                onUpdateStores(updatedList);
                showToast('Store details refreshed.', 'success');
            }
        } catch (e: any) {
            console.error("Store save failed", e);
            showToast('Failed to save store: ' + e.message, 'error');
        }
    };

    const handleStartCreate = () => {
        setIsCreating(true);
        setSelectedStoreId(null);
    };

    const handleAddBin = () => {
        if (!selectedStoreId || !newBinCode.trim()) return;

        const newBin: BinLocation = {
            id: `bin-${Date.now()}`,
            code: newBinCode,
            description: newBinDesc
        };

        const updatedStores = stores.map(s => {
            if (s.id === selectedStoreId) {
                return { ...s, bins: [...s.bins, newBin] };
            }
            return s;
        });

        onUpdateStores(updatedStores);
        setNewBinCode('');
        setNewBinDesc('');
    };

    const handleDeleteBinClick = (binId: string) => {
        setDeleteModal({ isOpen: true, binId });
    };

    const handleConfirmDeleteBin = () => {
        if (!selectedStoreId || !deleteModal.binId) return;
        const updatedStores = stores.map(s => {
            if (s.id === selectedStoreId) {
                return { ...s, bins: s.bins.filter(b => b.id !== deleteModal.binId) };
            }
            return s;
        });
        onUpdateStores(updatedStores);
        setDeleteModal({ isOpen: false, binId: null });
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-5xl h-[85vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200 modal-responsive">
                <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2">
                        <Warehouse size={18} className="text-blue-600" /> Warehouse & Location Management
                    </h3>
                    <button onClick={onClose}><X size={20} className="text-slate-400 hover:text-slate-600" /></button>
                </div>

                <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
                    {/* Left: Store List */}
                    <div className="w-full md:w-1/3 border-b md:border-b-0 md:border-r border-slate-200 flex flex-col bg-slate-50 max-h-48 md:max-h-full">
                        <div className="p-4 border-b border-slate-200">
                            <button
                                onClick={handleStartCreate}
                                className={`w-full py-2 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition ${isCreating ? 'bg-primary-600 text-white shadow-md' : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'}`}
                            >
                                <Plus size={16} /> Add New Store
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-2 space-y-2">
                            {stores.map(store => (
                                <div
                                    key={store.id}
                                    onClick={() => { setSelectedStoreId(store.id); setIsCreating(false); }}
                                    className={`p-3 cursor-pointer rounded-lg border transition ${selectedStoreId === store.id && !isCreating ? 'bg-white border-blue-500 ring-1 ring-blue-500 shadow-sm' : 'bg-white border-slate-200 hover:border-blue-300'}`}
                                >
                                    <div className="flex justify-between items-start mb-1">
                                        <span className="font-bold text-sm text-slate-800">{store.name}</span>
                                        <span className="text-[10px] font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-500">{store.code}</span>
                                    </div>
                                    <div className="text-xs text-slate-500 truncate">{store.location || 'No location set'}</div>
                                    <div className="mt-2 text-[10px] font-medium text-blue-600 bg-blue-50 inline-block px-2 py-0.5 rounded">
                                        {store.bins.length} Bin Locations
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Right: Details & Bins */}
                    <div className="flex-1 flex flex-col bg-white overflow-y-auto">
                        {(selectedStore || isCreating) ? (
                            <>
                                {/* Store Header / Form */}
                                <div className="p-6 border-b border-slate-200 bg-white">
                                    <div className="flex justify-between items-center mb-4">
                                        <h2 className="text-lg font-bold text-slate-900">
                                            {isCreating ? 'Create New Store' : 'Store Configuration'}
                                        </h2>
                                        <button
                                            onClick={handleSaveStore}
                                            className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-bold hover:bg-primary-500 flex items-center gap-2"
                                        >
                                            <Save size={16} /> {isCreating ? 'Create Store' : 'Save Changes'}
                                        </button>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Store Code <span className="text-red-500">*</span></label>
                                            <input
                                                type="text"
                                                className="w-full p-2 border border-slate-300 rounded text-sm font-mono"
                                                value={formData.code || ''}
                                                onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                                                placeholder="e.g. STR-MAIN"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Store Name <span className="text-red-500">*</span></label>
                                            <input
                                                type="text"
                                                className="w-full p-2 border border-slate-300 rounded text-sm"
                                                value={formData.name || ''}
                                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                                placeholder="e.g. Main Warehouse"
                                            />
                                        </div>
                                        <div className="col-span-2">
                                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Physical Location</label>
                                            <input
                                                type="text"
                                                className="w-full p-2 border border-slate-300 rounded text-sm"
                                                value={formData.location || ''}
                                                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                                                placeholder="e.g. Building 4, North Campus"
                                            />
                                        </div>
                                        <div className="col-span-2">
                                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Description</label>
                                            <textarea
                                                className="w-full p-2 border border-slate-300 rounded text-sm h-16 resize-none"
                                                value={formData.description || ''}
                                                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                                placeholder="Details about this storage area..."
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Bins Section (Only if not creating new) */}
                                {!isCreating && selectedStore && (
                                    <div className="bg-slate-50/50 mt-8 border-t border-slate-200">
                                        <div className="p-4 border-b border-slate-200 bg-white shadow-sm z-10">
                                            <div className="flex justify-between items-center mb-6">
                                                <div>
                                                    <h4 className="font-bold text-slate-800">Bin Locations</h4>
                                                    <p className="text-xs text-slate-500">Manage racks, shelves, and bins within this store.</p>
                                                </div>
                                                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                                                    {selectedStore.bins.length} Locations
                                                </div>
                                            </div>

                                            <div className="flex gap-3 items-end bg-slate-50 p-3 rounded-lg border border-slate-200">
                                                <div className="w-32">
                                                    <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Bin Code</label>
                                                    <input
                                                        type="text"
                                                        className="w-full text-sm border border-slate-300 rounded-md px-2 py-1.5 focus:ring-2 focus:ring-primary-500 outline-none font-mono"
                                                        placeholder="e.g. A-01"
                                                        value={newBinCode}
                                                        onChange={e => setNewBinCode(e.target.value)}
                                                        onKeyDown={e => e.key === 'Enter' && handleAddBin()}
                                                    />
                                                </div>
                                                <div className="flex-1">
                                                    <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Description / Zone</label>
                                                    <input
                                                        type="text"
                                                        className="w-full text-sm border border-slate-300 rounded-md px-2 py-1.5 focus:ring-2 focus:ring-primary-500 outline-none"
                                                        placeholder="e.g. Rack A - Top Shelf"
                                                        value={newBinDesc}
                                                        onChange={e => setNewBinDesc(e.target.value)}
                                                        onKeyDown={e => e.key === 'Enter' && handleAddBin()}
                                                    />
                                                </div>
                                                <button
                                                    onClick={handleAddBin}
                                                    className="bg-green-600 text-white px-4 py-1.5 rounded-md text-sm font-bold hover:bg-green-700 transition flex items-center gap-2 h-[34px] shadow-sm"
                                                >
                                                    <Plus size={16} /> Add
                                                </button>
                                            </div>
                                        </div>

                                        <div className="p-4">
                                            <table className="min-w-full divide-y divide-slate-200 border border-slate-200 rounded-lg overflow-hidden bg-white shadow-sm">
                                                <thead className="bg-slate-100">
                                                    <tr className="text-left text-xs font-bold text-slate-500 uppercase">
                                                        <th className="px-4 py-3">Bin Code</th>
                                                        <th className="px-4 py-3">Description / Zone</th>
                                                        <th className="px-4 py-3 text-right">Action</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100">
                                                    {selectedStore.bins.map(bin => (
                                                        <tr key={bin.id} className="group hover:bg-slate-50">
                                                            <td className="px-4 py-2 text-sm font-mono text-blue-600 font-bold">{bin.code}</td>
                                                            <td className="px-4 py-2 text-sm text-slate-600">{bin.description}</td>
                                                            <td className="px-4 py-2 text-right">
                                                                <button
                                                                    onClick={() => handleDeleteBinClick(bin.id)}
                                                                    className="text-slate-300 hover:text-red-500 p-1 rounded hover:bg-red-50 transition"
                                                                >
                                                                    <Trash2 size={14} />
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                    {selectedStore.bins.length === 0 && (
                                                        <tr><td colSpan={3} className="py-8 text-center text-slate-400 italic">No bins defined for this store.</td></tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}
                                {isCreating && (
                                    <div className="flex-1 flex items-center justify-center bg-slate-50 text-slate-400 p-8 text-center">
                                        <div>
                                            <Info size={48} className="mx-auto mb-2 opacity-20" />
                                            <p>Configure the store details above and click "Create Store".<br />You can add bin locations after the store is created.</p>
                                        </div>
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="flex-1 flex items-center justify-center text-slate-400">
                                <Warehouse size={64} className="mb-4 opacity-20" />
                                <p>Select a store to manage or create a new one.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
            <ConfirmationModal
                isOpen={deleteModal.isOpen}
                onClose={() => setDeleteModal({ isOpen: false, binId: null })}
                onConfirm={handleConfirmDeleteBin}
                title="Delete Bin Location?"
                message="Are you sure you want to remove this bin? Items currently in this bin will need to be reassigned."
                type="danger"
                confirmText="Delete Bin"
            />
        </div>
    );
};


// --- Add Inventory Modal Component ---

function AddInventoryModal({ isOpen, onClose, onSave, availableStores, dictionaries }: {
    isOpen: boolean;
    onClose: () => void;
    onSave: (item: InventoryItem) => void;
    availableStores: Store[];
    dictionaries: any[];
}) {
    const { profile } = useAuth();
    const { showToast } = useToast();
    const [formData, setFormData] = useState<Partial<InventoryItem>>({
        code: '',
        description: '',
        type: 'SPARE',
        uom: 'EA',
        itemCost: 0,
        totalQtyOnHand: 0,
        isCritical: false,

        isActive: true,
        costCenterId: '',
        stockLocations: []
    });

    // Logic for creating initial stock location using Stores/Bins
    const [selectedStoreId, setSelectedStoreId] = useState<string>(availableStores[0]?.id || '');
    const [selectedBinCode, setSelectedBinCode] = useState<string>('');

    // Get bins for selected store
    const currentBins = availableStores.find(s => s.id === selectedStoreId)?.bins || [];

    const handleSubmit = () => {
        if (!formData.code || !formData.description) {
            showToast('Item Code and Description are required.', 'warning');
            return;
        }

        const selectedStoreName = availableStores.find(s => s.id === selectedStoreId)?.name || 'Main Store';

        const newItem: InventoryItem = {
            id: `inv-new-${Date.now()}`,
            code: formData.code!,
            description: formData.description!,
            type: formData.type || 'SPARE',
            uom: formData.uom || 'EA',
            isActive: formData.isActive ?? true,
            isCritical: formData.isCritical ?? false,
            itemCost: Number(formData.itemCost) || 0,
            totalQtyOnHand: Number(formData.totalQtyOnHand) || 0,
            totalQtyOnOrder: 0,
            suppliers: [],
            stockLocations: [{
                id: selectedStoreId, // Use actual Store ID
                storeName: selectedStoreName,
                binLocation: selectedBinCode || 'UNASSIGNED',
                qtyOnHand: Number(formData.totalQtyOnHand) || 0,
                minQty: 0,
                maxQty: 0,
                reorderQty: 0,
                qtyOnOrder: 0
            }],
            minLevel: 0,
            maxLevel: 100,
            costCenterId: formData.costCenterId,
            createdById: profile?.username || profile?.fullName || 'Unknown User',
            createdAt: new Date().toISOString().split('T')[0],
            transactions: [],
            ...formData
        } as InventoryItem;

        onSave(newItem);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 modal-responsive">
                <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2">
                        <Plus size={18} className="text-blue-600" /> Add New Inventory Item
                    </h3>
                    <button onClick={onClose}><X size={20} className="text-slate-400 hover:text-slate-600" /></button>
                </div>

                <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Item Code <span className="text-red-500">*</span></label>
                        <input
                            type="text"
                            className="w-full p-2 border border-slate-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-primary-500 outline-none uppercase"
                            placeholder="e.g. BRG-6309-2RS"
                            value={formData.code}
                            onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Description <span className="text-red-500">*</span></label>
                        <input
                            type="text"
                            className="w-full p-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                            placeholder="e.g. Deep Groove Ball Bearing"
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Type</label>
                            <select
                                className="w-full p-2 border border-slate-300 rounded-lg text-sm bg-white"
                                value={formData.type}
                                onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                            >
                                {dictionaries.filter(d => d.type === 'INVENTORY_TYPE').map(d => (
                                    <option key={d.id} value={d.code}>{d.description}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Cost Center</label>
                        <select
                            className="w-full p-2 border border-slate-300 rounded-lg text-sm bg-white"
                            value={formData.costCenterId || ''}
                            onChange={(e) => setFormData({ ...formData, costCenterId: e.target.value })}
                        >
                            <option value="">(None)</option>
                            {dictionaries.filter(d => d.type === 'COST_CENTRE').map(cc => (
                                <option key={cc.id} value={cc.id}>{cc.description}</option>
                            ))}
                        </select>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Unit of Measure</label>
                            <select
                                className="w-full p-2 border border-slate-300 rounded-lg text-sm bg-white"
                                value={formData.uom}
                                onChange={(e) => setFormData({ ...formData, uom: e.target.value })}
                            >
                                {dictionaries.filter(d => d.type === 'UOM').map(d => (
                                    <option key={d.id} value={d.code}>{d.description}</option>
                                ))}
                            </select>
                        </div>
                    </div>



                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Standard Cost ($)</label>
                            <input
                                type="number"
                                className="w-full p-2 border border-slate-300 rounded-lg text-sm"
                                placeholder="0.00"
                                value={formData.itemCost}
                                onChange={(e) => setFormData({ ...formData, itemCost: parseFloat(e.target.value) })}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Cost Center</label>
                            <select
                                className="w-full p-2 border border-slate-300 rounded-lg text-sm bg-white"
                                value={formData.costCenterId || ''}
                                onChange={(e) => setFormData({ ...formData, costCenterId: e.target.value })}
                            >
                                <option value="">(None)</option>
                                {dictionaries.filter(d => d.type === 'COST_CENTRE').map(d => (
                                    <option key={d.id} value={d.id}>{d.description} ({d.code})</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Initial Qty</label>
                            <input
                                type="number"
                                className="w-full p-2 border border-slate-300 rounded-lg text-sm"
                                placeholder="0"
                                value={formData.totalQtyOnHand}
                                onChange={(e) => setFormData({ ...formData, totalQtyOnHand: parseFloat(e.target.value) })}
                            />
                        </div>
                    </div>

                    {/* STORE & BIN SELECTION */}
                    <div className="p-4 bg-blue-50/50 border border-blue-100 rounded-xl space-y-3">
                        <div className="flex items-center gap-2 text-blue-800 font-bold text-sm border-b border-blue-100 pb-2">
                            <MapPin size={16} /> Initial Stock Placement
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Store / Warehouse</label>
                                <select
                                    className="w-full p-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-primary-500 outline-none"
                                    value={selectedStoreId}
                                    onChange={(e) => {
                                        setSelectedStoreId(e.target.value);
                                        setSelectedBinCode(''); // Reset bin when store changes
                                    }}
                                >
                                    {availableStores.map(s => (
                                        <option key={s.id} value={s.id}>{s.code} - {s.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Bin Location</label>
                                <select
                                    className="w-full p-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-primary-500 outline-none"
                                    value={selectedBinCode}
                                    onChange={(e) => setSelectedBinCode(e.target.value)}
                                    disabled={currentBins.length === 0}
                                >
                                    <option value="">-- Select Bin --</option>
                                    {currentBins.map(b => (
                                        <option key={b.id} value={b.code}>{b.code} - {b.description}</option>
                                    ))}
                                </select>
                                {currentBins.length === 0 && (
                                    <div className="flex items-center gap-1 text-[10px] text-amber-600 mt-1 font-medium bg-amber-50 px-2 py-1 rounded">
                                        <AlertTriangle size={10} /> No bins in this store. Item will be 'Unassigned'.
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-4 pt-2">
                        <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={formData.isCritical}
                                onChange={(e) => setFormData({ ...formData, isCritical: e.target.checked })}
                                className="rounded text-blue-600 focus:ring-primary-500"
                            />
                            Critical Spare
                        </label>
                    </div>
                </div>

                <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-3">
                    <button onClick={onClose} className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-100 rounded-lg">Cancel</button>
                    <button
                        onClick={handleSubmit}
                        className="px-6 py-2 bg-primary-600 text-white font-bold rounded-lg hover:bg-primary-500 shadow-md flex items-center gap-2"
                    >
                        <CheckCircle size={16} /> Create Item
                    </button>
                </div>
            </div>
        </div >
    );
};

// --- Sub Components ---

function DetailsTab({ item, dictionaries, contacts, vendors, onUpdate }: { item: InventoryItem, dictionaries: any[], contacts: Contact[], vendors: Vendor[], onUpdate: (item: InventoryItem) => void }) {
    const handleChange = (field: keyof InventoryItem, value: any) => {
        onUpdate({ ...item, [field]: value });
    };

    const inputClasses = "w-full text-sm border border-slate-200 rounded-lg p-2.5 bg-white hover:border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 outline-none transition-all duration-200";

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in duration-300">
            {/* Left Card: Identification & Classification */}
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-5">
                <h3 className="font-bold text-slate-800 border-b border-slate-100 pb-2 flex items-center gap-2">
                    <Package size={16} className="text-blue-600" /> Identification & Classification
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Inventory Code</label>
                        <input
                            type="text"
                            value={item.code}
                            onChange={e => handleChange('code', e.target.value)}
                            className={`${inputClasses} bg-slate-50/50 font-mono font-medium`}
                            disabled
                        />
                    </div>

                    <div className="col-span-1 sm:col-span-2">
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Item Status & Criticality</label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <label className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${
                                item.isActive
                                    ? 'bg-blue-50/60 border-blue-200 text-blue-900 shadow-2xs'
                                    : 'bg-slate-50 border-slate-200 text-slate-500'
                            }`}>
                                <div className="flex flex-col">
                                     <span className="text-sm font-semibold">Active Status</span>
                                     <span className="text-[10px] text-slate-400">Available for work orders</span>
                                </div>
                                <input
                                    type="checkbox"
                                    checked={item.isActive}
                                    onChange={e => handleChange('isActive', e.target.checked)}
                                    className="w-4.5 h-4.5 rounded text-blue-600 focus:ring-blue-500 border-slate-300 cursor-pointer"
                                />
                            </label>
                            <label className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${
                                item.isCritical
                                    ? 'bg-red-50/60 border-red-200 text-red-900 shadow-2xs'
                                    : 'bg-slate-50 border-slate-200 text-slate-500'
                            }`}>
                                <div className="flex flex-col">
                                     <span className="text-sm font-semibold text-red-700">Critical Spare Part</span>
                                     <span className="text-[10px] text-slate-400">Triggers alert on low stock</span>
                                </div>
                                <input
                                    type="checkbox"
                                    checked={item.isCritical}
                                    onChange={e => handleChange('isCritical', e.target.checked)}
                                    className="w-4.5 h-4.5 rounded text-red-600 focus:ring-red-500 border-slate-300 cursor-pointer"
                                />
                            </label>
                        </div>
                    </div>

                    <div className="col-span-1 sm:col-span-2">
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Description</label>
                        <textarea
                            value={item.description}
                            onChange={e => handleChange('description', e.target.value)}
                            className={`${inputClasses} h-20 resize-none`}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Inventory Type</label>
                        <select
                            value={item.type}
                            onChange={e => handleChange('type', e.target.value)}
                            className={inputClasses}
                        >
                            {dictionaries.filter(d => d.type === 'INVENTORY_TYPE').map(d => (
                                <option key={d.id} value={d.code}>{d.description}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Unit of Measure</label>
                        <select
                            value={item.uom}
                            onChange={e => handleChange('uom', e.target.value)}
                            className={inputClasses}
                        >
                            {dictionaries.filter(d => d.type === 'UOM').map(d => (
                                <option key={d.id} value={d.code}>{d.description}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Manufacturer</label>
                        <select
                            value={item.manufacturer || ''}
                            onChange={e => handleChange('manufacturer', e.target.value)}
                            className={inputClasses}
                        >
                            <option value="">Select Manufacturer...</option>
                            {(() => {
                                const fromContacts = contacts
                                    .filter(c => c.types.includes('MANUFACTURER') || c.types.includes('VENDOR') || c.flags?.isVendor)
                                    .map(c => c.name);
                                const fromVendors = (vendors || [])
                                    .filter(v => v.active && (v.type === 'MANUFACTURER' || v.type === 'SUPPLIER'))
                                    .map(v => v.name);
                                const uniqueNames = [...new Set([...fromContacts, ...fromVendors])].sort();
                                return uniqueNames.map(name => (
                                    <option key={name} value={name}>{name}</option>
                                ));
                            })()}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Barcode</label>
                        <div className="relative">
                            <input
                                type="text"
                                value={item.barcode || ''}
                                onChange={e => handleChange('barcode', e.target.value)}
                                className={`${inputClasses} pl-9`}
                            />
                            <Barcode size={16} className="absolute left-3 top-3.5 text-slate-400" />
                        </div>
                    </div>
                </div>
            </div>

            {/* Right Card: Financials & Purchasing */}
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-5">
                <h3 className="font-bold text-slate-800 border-b border-slate-100 pb-2 flex items-center gap-2">
                    <DollarSign size={16} className="text-green-600" /> Financials & Purchasing
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Item Cost (Avg)</label>
                        <div className="relative">
                            <span className="absolute left-3 top-3 text-slate-400 text-sm">$</span>
                            <input
                                type="number"
                                value={item.itemCost}
                                onChange={e => handleChange('itemCost', Number(e.target.value))}
                                className={`${inputClasses} pl-7`}
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Markup %</label>
                        <div className="relative">
                            <input
                                type="number"
                                value={item.markupPercentage || 0}
                                onChange={e => handleChange('markupPercentage', Number(e.target.value))}
                                className={`${inputClasses} pr-7`}
                            />
                            <span className="absolute right-3 top-3 text-slate-400 text-sm">%</span>
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Cost Centre (Inbound)</label>
                        <select
                            value={item.costCenterInbound || ''}
                            onChange={e => handleChange('costCenterInbound', e.target.value)}
                            className={inputClasses}
                        >
                            <option value="">(Select Account)</option>
                            {dictionaries.filter(d => d.type === 'COST_CENTRE').map(d => (
                                <option key={d.id} value={d.id}>{d.description} ({d.code})</option>
                            ))}
                        </select>
                        <p className="text-[10px] text-slate-400 mt-1.5">Asset Account (Balance Sheet)</p>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Cost Centre (Outbound)</label>
                        <select
                            value={item.costCenterOutbound || ''}
                            onChange={e => handleChange('costCenterOutbound', e.target.value)}
                            className={inputClasses}
                        >
                            <option value="">(Select Account)</option>
                            {dictionaries.filter(d => d.type === 'COST_CENTRE').map(d => (
                                <option key={d.id} value={d.id}>{d.description} ({d.code})</option>
                            ))}
                        </select>
                        <p className="text-[10px] text-slate-400 mt-1.5">Default Expense Account (Usage)</p>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Tax Code</label>
                        <input
                            type="text"
                            value={item.taxCode || ''}
                            onChange={e => handleChange('taxCode', e.target.value)}
                            className={inputClasses}
                        />
                    </div>
                    <PreferredSupplierPicker
                        value={item.preferredSupplierId || ''}
                        onChange={(val) => handleChange('preferredSupplierId', val)}
                    />
                </div>
                <div className="mt-4 p-3 bg-blue-50/60 border border-blue-100 rounded-xl text-xs text-blue-800 flex justify-between items-center shadow-2xs">
                    <span><strong>Inventory Totals:</strong> {item.totalQtyOnHand} On Hand | {item.totalQtyOnOrder} On Order</span>
                </div>
            </div>
        </div>
    );
}

// --- Preferred Supplier Picker (Live from vendors table) ---
function PreferredSupplierPicker({ value, onChange }: { value: string; onChange: (val: string) => void }) {
    const [vendors, setVendors] = useState<any[]>([]);
    useEffect(() => {
        DatabaseService.getInstance().getVendors()
            .then(v => setVendors(v.filter((x: any) => x.active !== false)))
            .catch(() => setVendors([]));
    }, []);
    return (
        <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Preferred Supplier</label>
            <select
                value={value}
                onChange={e => onChange(e.target.value)}
                className="w-full text-sm border border-slate-300 rounded-lg bg-white p-2"
            >
                <option value="">(None Selected)</option>
                {vendors.map(v => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                ))}
            </select>
        </div>
    );
}

// --- Enhanced Stores Tab (Add/Edit Support) ---

function StoresTab({ item, stores, onUpdate, canCreate = true, canEdit = true, canDelete = true }: { item: InventoryItem; stores: Store[]; onUpdate: (item: InventoryItem) => void; canCreate?: boolean; canEdit?: boolean; canDelete?: boolean }) {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingLocId, setEditingLocId] = useState<string | null>(null);
    const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; locId: string | null }>({
        isOpen: false,
        locId: null
    });

    const handleSaveLocation = (loc: InventoryLocation) => {
        let newLocations;
        if (editingLocId) {
            newLocations = item.stockLocations.map(l => l.id === editingLocId ? loc : l);
        } else {
            newLocations = [...item.stockLocations, loc];
        }
        onUpdate({ ...item, stockLocations: newLocations });
        setIsModalOpen(false);
        setEditingLocId(null);
    };

    const handleDeleteLocationClick = (locId: string) => {
        setDeleteModal({ isOpen: true, locId });
    };

    const handleConfirmDeleteLocation = () => {
        if (deleteModal.locId) {
            onUpdate({ ...item, stockLocations: item.stockLocations.filter(l => l.id !== deleteModal.locId) });
        }
        setDeleteModal({ isOpen: false, locId: null });
    };

    const openEdit = (loc: InventoryLocation) => {
        setEditingLocId(loc.id);
        setIsModalOpen(true);
    };

    const openAdd = () => {
        setEditingLocId(null);
        setIsModalOpen(true);
    }

    return (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden animate-in fade-in duration-300">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                <h3 className="font-bold text-slate-700">Stock Locations</h3>
                <button
                    onClick={openAdd}
                    disabled={!canCreate}
                    className={`text-xs bg-primary-600 text-white px-3 py-1.5 rounded flex items-center gap-1 ${!canCreate ? 'opacity-50 cursor-not-allowed' : 'hover:bg-primary-500'}`}
                    title={!canCreate ? 'Insufficient permissions' : 'Add Location'}
                >
                    <Plus size={14} /> Add Location
                </button>
            </div>
            <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                    <tr>
                        <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Store Name</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Bin Location</th>
                        <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase">Min</th>
                        <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase">Max</th>
                        <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase">Reorder Qty</th>
                        <th className="px-4 py-3 text-right text-xs font-bold text-slate-900 uppercase bg-slate-100">Qty On Hand</th>
                        <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase">On Order</th>
                        <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase">Actions</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                    {item.stockLocations.map(loc => (
                        <tr key={loc.id} className="hover:bg-slate-50 group">
                            <td className="px-4 py-3 text-sm font-medium text-slate-900">{loc.storeName}</td>
                            <td className="px-4 py-3 text-sm font-mono text-blue-600 bg-blue-50/50">{loc.binLocation}</td>
                            <td className="px-4 py-3 text-sm text-right text-slate-500">{loc.minQty}</td>
                            <td className="px-4 py-3 text-sm text-right text-slate-500">{loc.maxQty}</td>
                            <td className="px-4 py-3 text-sm text-right text-slate-500">{loc.reorderQty}</td>
                            <td className="px-4 py-3 text-sm text-right font-bold text-slate-900 bg-slate-50">
                                {loc.qtyOnHand}
                            </td>
                            <td className="px-4 py-3 text-sm text-right text-blue-600 font-medium">{loc.qtyOnOrder}</td>
                            <td className="px-4 py-3 text-right">
                                <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={() => openEdit(loc)} disabled={!canEdit} className={`text-slate-400 ${!canEdit ? 'opacity-50 cursor-not-allowed' : 'hover:text-blue-600'}`} title={!canEdit ? 'Insufficient permissions' : 'Edit'}><Edit2 size={16} /></button>
                                    <button onClick={() => handleDeleteLocationClick(loc.id)} disabled={!canDelete} className={`text-slate-400 ${!canDelete ? 'opacity-50 cursor-not-allowed' : 'hover:text-red-600'}`} title={!canDelete ? 'Insufficient permissions' : 'Delete'}><Trash2 size={16} /></button>
                                </div>
                            </td>
                        </tr>
                    ))}
                    {item.stockLocations.length === 0 && (
                        <tr><td colSpan={8} className="p-8 text-center text-slate-400 italic">No locations assigned.</td></tr>
                    )}
                </tbody>
            </table>
            <ConfirmationModal
                isOpen={deleteModal.isOpen}
                onClose={() => setDeleteModal({ isOpen: false, locId: null })}
                onConfirm={handleConfirmDeleteLocation}
                title="Remove Stock Location?"
                message="Are you sure you want to remove this store location? This will delete stock history for this specific location."
                type="danger"
                confirmText="Remove Location"
            />
            {/* Location Add/Edit Modal */}
            {isModalOpen && (
                <LocationModal
                    isOpen={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                    stores={stores}
                    existingLocation={item.stockLocations.find(l => l.id === editingLocId)}
                    onSave={handleSaveLocation}
                />
            )}
        </div>
    );
};

function LocationModal({ isOpen, onClose, stores, existingLocation, onSave }: {
    isOpen: boolean;
    onClose: () => void;
    stores: Store[];
    existingLocation?: InventoryLocation;
    onSave: (loc: InventoryLocation) => void;
}) {
    const [selectedStoreId, setSelectedStoreId] = useState(
        stores.find(s => s.name === existingLocation?.storeName)?.id || stores[0]?.id || ''
    );

    // Fix: Update state when props change (re-opening modal for different item)
    useEffect(() => {
        if (isOpen) {
            setSelectedStoreId(existingLocation ? existingLocation.id : (stores[0]?.id || ''));
            setFormData(existingLocation || {
                minQty: 0, maxQty: 0, reorderQty: 0, binLocation: '', qtyOnHand: 0
            });
        }
    }, [isOpen, existingLocation, stores]);

    // Find store object to get bins
    const selectedStore = stores.find(s => s.id === selectedStoreId);

    const [formData, setFormData] = useState<Partial<InventoryLocation>>(existingLocation || {
        minQty: 0, maxQty: 0, reorderQty: 0, binLocation: '', qtyOnHand: 0
    });

    const handleSubmit = () => {
        if (!selectedStore) return;
        const newLoc: InventoryLocation = {
            id: selectedStore.id, // Use actual Store/Location ID
            storeName: selectedStore.name,
            binLocation: formData.binLocation || 'UNASSIGNED',
            qtyOnHand: formData.qtyOnHand || 0,
            minQty: Number(formData.minQty) || 0,
            maxQty: Number(formData.maxQty) || 0,
            reorderQty: Number(formData.reorderQty) || 0,
            qtyOnOrder: existingLocation?.qtyOnOrder || 0
        };
        onSave(newLoc);
    };

    if (!isOpen) return null;

    return (
        <div className="absolute inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-lg rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                    <h3 className="font-bold text-slate-800">{existingLocation ? 'Edit Location' : 'Add Stock Location'}</h3>
                    <button onClick={onClose}><X size={20} className="text-slate-400 hover:text-slate-600" /></button>
                </div>
                <div className="p-6 space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Store / Warehouse</label>
                        <select
                            className="w-full p-2 border border-slate-300 rounded-lg text-sm bg-white"
                            value={selectedStoreId}
                            onChange={(e) => {
                                setSelectedStoreId(e.target.value);
                                setFormData({ ...formData, binLocation: '' });
                            }}
                            disabled={!!existingLocation} // Lock store on edit to prevent confusion, usually better to delete/add new
                        >
                            {stores.map(s => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Bin Location</label>
                        <div className="flex flex-col gap-1">
                            <input
                                list="store-bins"
                                type="text"
                                className="w-full p-2 border border-slate-300 rounded-lg text-sm bg-white"
                                placeholder="Select or Enter Bin Code"
                                value={formData.binLocation}
                                onChange={(e) => setFormData({ ...formData, binLocation: e.target.value })}
                            />
                            <datalist id="store-bins">
                                {selectedStore?.bins.map(b => (
                                    <option key={b.id} value={b.code}>{b.description}</option>
                                ))}
                            </datalist>
                            {selectedStore?.bins.length === 0 && <p className="text-[10px] text-slate-400">No pre-defined bins in this store.</p>}
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Min</label>
                            <input
                                type="number"
                                className="w-full p-2 border border-slate-300 rounded-lg text-sm"
                                value={formData.minQty}
                                onChange={(e) => setFormData({ ...formData, minQty: Number(e.target.value) })}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Max</label>
                            <input
                                type="number"
                                className="w-full p-2 border border-slate-300 rounded-lg text-sm"
                                value={formData.maxQty}
                                onChange={(e) => setFormData({ ...formData, maxQty: Number(e.target.value) })}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Reorder</label>
                            <input
                                type="number"
                                className="w-full p-2 border border-slate-300 rounded-lg text-sm"
                                value={formData.reorderQty}
                                onChange={(e) => setFormData({ ...formData, reorderQty: Number(e.target.value) })}
                            />
                        </div>
                    </div>

                    {!existingLocation && (
                        <div className="pt-2 border-t border-slate-100">
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Initial Stock (Stocktake)</label>
                            <input
                                type="number"
                                className="w-full p-2 border border-slate-300 rounded-lg text-sm font-bold"
                                value={formData.qtyOnHand}
                                onChange={(e) => setFormData({ ...formData, qtyOnHand: Number(e.target.value) })}
                            />
                        </div>
                    )}
                </div>
                <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
                    <button onClick={onClose} className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-100 rounded-lg">Cancel</button>
                    <button onClick={handleSubmit} className="px-4 py-2 bg-primary-600 text-white font-bold rounded-lg hover:bg-primary-500">Save Location</button>
                </div>
            </div>
        </div>
    );
};

function AddSupplierModal({ isOpen, onClose, onSave }: {
    isOpen: boolean;
    onClose: () => void;
    onSave: (supplier: InventorySupplier) => void;
}) {
    const [contacts, setContacts] = useState<any[]>([]);
    const [selectedContactId, setSelectedContactId] = useState('');
    const [formData, setFormData] = useState({
        supplierPartNo: '',
        supplierCost: 0,
        leadTimeDays: 0,
        isPreferred: false
    });

    useEffect(() => {
        if (isOpen) {
            // Fetch vendors from the vendors table (created in Vendors module)
            const loadVendors = async () => {
                try {
                    const vendors = await DatabaseService.getInstance().getVendors();
                    const activeVendors = vendors.filter((v: any) => v.active !== false);
                    setContacts(activeVendors.map((v: any) => ({ id: v.id, name: v.name })));
                } catch (e) {
                    console.error("Failed to load vendors for supplier modal", e);
                    setContacts([]);
                }
            };
            loadVendors();
        }
    }, [isOpen]);

    const handleSubmit = () => {
        if (!selectedContactId) return;
        const newSupplier: InventorySupplier = {
            id: crypto.randomUUID(),
            contactId: selectedContactId,
            supplierPartNo: formData.supplierPartNo,
            supplierCost: Number(formData.supplierCost),
            leadTimeDays: Number(formData.leadTimeDays),
            isPreferred: formData.isPreferred
        };
        onSave(newSupplier);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-md rounded-xl shadow-xl overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                    <h3 className="font-bold text-slate-800">Add Supplier Link</h3>
                    <button onClick={onClose}><X size={20} className="text-slate-400 hover:text-slate-600" /></button>
                </div>
                <div className="p-6 space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Select Vendor</label>
                        <select
                            className="w-full p-2 border border-slate-300 rounded-lg text-sm"
                            value={selectedContactId}
                            onChange={e => setSelectedContactId(e.target.value)}
                        >
                            <option value="">-- Select Vendor --</option>
                            {contacts.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </select>
                        {contacts.length === 0 && <p className="text-xs text-slate-400 mt-1">No vendors found. Create vendors in the Vendors module first.</p>}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Supplier Part #</label>
                            <input
                                className="w-full p-2 border border-slate-300 rounded-lg text-sm"
                                value={formData.supplierPartNo}
                                onChange={e => setFormData({ ...formData, supplierPartNo: e.target.value })}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Cost</label>
                            <input
                                type="number"
                                className="w-full p-2 border border-slate-300 rounded-lg text-sm"
                                value={formData.supplierCost}
                                onChange={e => setFormData({ ...formData, supplierCost: Number(e.target.value) })}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Lead Time (Days)</label>
                            <input
                                type="number"
                                className="w-full p-2 border border-slate-300 rounded-lg text-sm"
                                value={formData.leadTimeDays}
                                onChange={e => setFormData({ ...formData, leadTimeDays: Number(e.target.value) })}
                            />
                        </div>
                        <div className="flex items-center pt-6">
                            <label className="flex items-center gap-2 text-sm font-medium text-slate-700 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={formData.isPreferred}
                                    onChange={e => setFormData({ ...formData, isPreferred: e.target.checked })}
                                    className="rounded text-blue-600 focus:ring-primary-500"
                                />
                                Preferred Vendor
                            </label>
                        </div>
                    </div>

                    <button
                        onClick={handleSubmit}
                        disabled={!selectedContactId}
                        className="w-full py-2 bg-primary-600 text-white font-bold rounded-lg hover:bg-primary-500 disabled:opacity-50 mt-4"
                    >
                        Add Supplier
                    </button>
                </div>
            </div>
        </div>
    );
};

function SuppliersTab({ item, onUpdate, canCreate = true }: { item: InventoryItem; onUpdate?: (item: InventoryItem) => void; canCreate?: boolean }) {
    const [showAddModal, setShowAddModal] = useState(false);
    const [contacts, setContacts] = useState<any[]>([]);

    useEffect(() => {
        const loadVendors = async () => {
            try {
                const vendors = await DatabaseService.getInstance().getVendors();
                setContacts(vendors.map((v: any) => ({ id: v.id, name: v.name })));
            } catch {
                setContacts([]);
            }
        };
        loadVendors();
    }, []);

    const handleAddSupplier = (newSupplier: InventorySupplier) => {
        const updatedItem = {
            ...item,
            suppliers: [...(item.suppliers || []), newSupplier]
        };
        onUpdate?.(updatedItem);
    };

    return (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                <h3 className="font-bold text-slate-700">Approved Vendors</h3>
                <button
                    onClick={() => setShowAddModal(true)}
                    disabled={!canCreate}
                    className={`text-xs bg-primary-600 text-white px-3 py-1.5 rounded ${!canCreate ? 'opacity-50 cursor-not-allowed' : 'hover:bg-primary-500'}`}
                    title={!canCreate ? 'Insufficient permissions' : 'Add Supplier'}
                >
                    + Add Supplier
                </button>
            </div>
            <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-white">
                    <tr>
                        <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Supplier Name</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Supplier Part #</th>
                        <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase">Lead Time (Days)</th>
                        <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase">Cost</th>
                        <th className="px-4 py-3 text-center text-xs font-bold text-slate-500 uppercase">Preferred</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                    {item.suppliers.map(sup => {
                        const vendor = contacts.find(c => c.id === sup.contactId);
                        return (
                            <tr key={sup.id} className="hover:bg-slate-50">
                                <td className="px-4 py-3 text-sm font-medium text-slate-900">{vendor?.name || 'Unknown Vendor'}</td>
                                <td className="px-4 py-3 text-sm text-slate-600 font-mono">{sup.supplierPartNo}</td>
                                <td className="px-4 py-3 text-sm text-right text-slate-600">{sup.leadTimeDays}</td>
                                <td className="px-4 py-3 text-sm text-right text-slate-600">${sup.supplierCost.toFixed(2)}</td>
                                <td className="px-4 py-3 text-center">
                                    {sup.isPreferred && <CheckCircle size={16} className="text-green-600 inline" />}
                                </td>
                            </tr>
                        );
                    })}
                    {item.suppliers.length === 0 && (
                        <tr><td colSpan={5} className="p-6 text-center text-slate-400 italic">No suppliers linked.</td></tr>
                    )}
                </tbody>
            </table>
            {showAddModal && (
                <AddSupplierModal
                    isOpen={showAddModal}
                    onClose={() => setShowAddModal(false)}
                    onSave={handleAddSupplier}
                />
            )}
        </div >
    );
};

function BOMTab({ item }: { item: InventoryItem }) {
    const [assets, setAssets] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const { showToast } = useToast();
    const { dataScope } = useAuth(); // F-012: scope the asset picker to the user's site(s)
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; assetId: string | null }>({
        isOpen: false,
        assetId: null
    });

    const loadAssets = async () => {
        setLoading(true);
        try {
            const allAssets = await DatabaseService.getInstance().getAssets();
            setAssets(allAssets);
        } catch (e) {
            console.error("Failed to load assets for BOM check", e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadAssets();
    }, [item.id]);

    // Reverse lookup: Find Assets that have this item in their BOM
    const linkedAssets = assets.filter(a => a.bomItems?.some((b: any) => b.inventoryCode === item.code));

    const handleLinkToAsset = async (assetId: string, quantity: number) => {
        const targetAsset = assets.find(a => a.id === assetId);
        if (!targetAsset) return;

        // Check if already exists
        const existingEntry = targetAsset.bomItems?.find((b: any) => b.inventoryCode === item.code);

        let updatedBOM;
        if (existingEntry) {
            // Update quantity
            updatedBOM = targetAsset.bomItems.map((b: any) =>
                b.inventoryCode === item.code ? { ...b, quantity: b.quantity + quantity } : b
            );
        } else {
            // Add new
            const newEntry = {
                id: crypto.randomUUID(),
                inventoryCode: item.code,
                description: item.description,
                quantity: quantity,
                uom: item.uom,
                critical: item.isCritical
            };
            updatedBOM = [...(targetAsset.bomItems || []), newEntry];
        }

        const updatedAsset = { ...targetAsset, bomItems: updatedBOM };

        try {
            await DatabaseService.getInstance().updateAsset(updatedAsset);
            loadAssets(); // Refresh
            setIsAddModalOpen(false);
        } catch (e) {
            showToast('Failed to link to asset.', 'error');
        }
    };

    const handleUnlinkAssetClick = (assetId: string) => {
        setDeleteModal({ isOpen: true, assetId });
    };

    const handleConfirmUnlink = async () => {
        if (!deleteModal.assetId) return;

        const targetAsset = assets.find(a => a.id === deleteModal.assetId);
        if (!targetAsset) {
            setDeleteModal({ isOpen: false, assetId: null });
            return;
        }

        // Filter out this item from BOM
        const updatedBOM = targetAsset.bomItems.filter((b: any) => b.inventoryCode !== item.code);
        const updatedAsset = { ...targetAsset, bomItems: updatedBOM };

        try {
            await DatabaseService.getInstance().updateAsset(updatedAsset);
            loadAssets();
        } catch (e: any) {
            showToast('Failed to unlink asset: ' + e.message, 'error');
        } finally {
            setDeleteModal({ isOpen: false, assetId: null });
        }
    };

    return (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                <div>
                    <h3 className="font-bold text-slate-700">Where Used (Bill of Materials)</h3>
                    <p className="text-xs text-slate-500">Assets that require this part.</p>
                </div>
                <button
                    onClick={() => setIsAddModalOpen(true)}
                    className="bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2 shadow-sm"
                >
                    <Plus size={14} /> Add to Asset
                </button>
            </div>

            {loading ? (
                <div className="p-8 text-center text-slate-400">Loading relationships...</div>
            ) : (
                <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-white">
                        <tr>
                            <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Asset Tag</th>
                            <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Asset Name</th>
                            <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Common Name (On Asset)</th>
                            <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase">Qty Req</th>
                            <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                        {linkedAssets.map(asset => {
                            const bomEntry = asset.bomItems?.find((b: any) => b.inventoryCode === item.code);
                            return (
                                <tr key={asset.id} className="hover:bg-slate-50">
                                    <td className="px-4 py-3 text-sm font-bold text-blue-600">{asset.tag}</td>
                                    <td className="px-4 py-3 text-sm text-slate-600">{asset.name}</td>
                                    <td className="px-4 py-3 text-sm text-slate-900 italic">{bomEntry?.description}</td>
                                    <td className="px-4 py-3 text-sm text-right font-medium">{bomEntry?.quantity}</td>
                                    <td className="px-4 py-3 text-sm text-right">
                                        <button
                                            onClick={() => handleUnlinkAssetClick(asset.id)}
                                            className="text-slate-400 hover:text-red-600 p-1 rounded hover:bg-red-50 transition"
                                            title="Remove from BOM"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                        {linkedAssets.length === 0 && (
                            <tr><td colSpan={5} className="p-6 text-center text-slate-400 italic">This part is not listed on any Asset BOMs.</td></tr>
                        )}
                    </tbody>
                </table>
            )}

            {isAddModalOpen && (
                <AddToAssetBOMModal
                    isOpen={isAddModalOpen}
                    onClose={() => setIsAddModalOpen(false)}
                    onSave={handleLinkToAsset}
                    assets={DatabaseService.filterAssetsBySiteScope(assets, dataScope?.siteIds)} // F-012: site-scoped selection (all sites for global scope)
                    itemCode={item.code}
                />
            )}
            <ConfirmationModal
                isOpen={deleteModal.isOpen}
                onClose={() => setDeleteModal({ isOpen: false, assetId: null })}
                onConfirm={handleConfirmUnlink}
                title="Remove from Asset BOM?"
                message="Are you sure you want to remove this part from the asset's Bill of Materials?"
                type="danger"
                confirmText="Remove Part"
            />
        </div>
    );
};

function AddToAssetBOMModal({ isOpen, onClose, onSave, assets, itemCode }: {
    isOpen: boolean;
    onClose: () => void;
    onSave: (assetId: string, qty: number) => void;
    assets: any[];
    itemCode: string;
}) {
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedAssetId, setSelectedAssetId] = useState('');
    const [quantity, setQuantity] = useState(1);

    const filteredAssets = assets.filter(a =>
        a.tag.toLowerCase().includes(searchTerm.toLowerCase()) ||
        a.name.toLowerCase().includes(searchTerm.toLowerCase())
    ).slice(0, 10); // Limit results

    const handleSave = () => {
        if (!selectedAssetId) return;
        onSave(selectedAssetId, quantity);
    };

    return (
        <div className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-md rounded-2xl shadow-xl overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                    <h3 className="font-bold text-slate-800">Assign Part to Asset</h3>
                    <button onClick={onClose}><X size={20} className="text-slate-400 hover:text-slate-600" /></button>
                </div>
                <div className="p-6 space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Search Asset</label>
                        <div className="relative">
                            <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
                            <input
                                type="text"
                                className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm"
                                placeholder="Search by Tag or Name..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="border border-slate-200 rounded-lg max-h-48 overflow-y-auto">
                        {filteredAssets.map(asset => (
                            <div
                                key={asset.id}
                                onClick={() => setSelectedAssetId(asset.id)}
                                className={`p-3 cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50 flex justify-between items-center ${selectedAssetId === asset.id ? 'bg-blue-50' : ''}`}
                            >
                                <div>
                                    <div className="font-bold text-sm text-slate-800">{asset.tag}</div>
                                    <div className="text-xs text-slate-500">{asset.name}</div>
                                </div>
                                {selectedAssetId === asset.id && <CheckCircle size={16} className="text-blue-600" />}
                            </div>
                        ))}
                        {filteredAssets.length === 0 && (
                            <div className="p-4 text-center text-xs text-slate-400">No assets found.</div>
                        )}
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Quantity Required</label>
                        <input
                            type="number"
                            className="w-full p-2 border border-slate-300 rounded-lg font-bold"
                            value={quantity}
                            onChange={e => setQuantity(Number(e.target.value))}
                            min={1}
                        />
                    </div>
                </div>
                <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
                    <button onClick={onClose} className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-100 rounded-lg">Cancel</button>
                    <button
                        onClick={handleSave}
                        disabled={!selectedAssetId}
                        className={`px-4 py-2 text-white font-bold rounded-lg ${!selectedAssetId ? 'bg-slate-300 cursor-not-allowed' : 'bg-primary-600 hover:bg-primary-500'}`}
                    >
                        Assign to Asset
                    </button>
                </div>
            </div>
        </div>
    );
};

function JobsTab({ item }: { item: InventoryItem }) {
    const [workOrders, setWorkOrders] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        DatabaseService.getInstance().getWorkOrders().then(wos => {
            setWorkOrders(wos);
            setLoading(false);
        }).catch(() => setLoading(false));
    }, []);

    // Filter WOs that reference this inventory item
    const activeJobs = workOrders.filter(wo =>
        wo.status !== 'CLOSED' && wo.inventory?.some((i: any) => i.inventoryId === item.id || i.description?.includes(item.code))
    );
    const historyJobs = workOrders.filter(wo =>
        wo.status === 'CLOSED' && wo.inventory?.some((i: any) => i.inventoryId === item.id || i.description?.includes(item.code))
    );

    if (loading) return <div className="p-8 text-center text-slate-400">Loading jobs...</div>;

    return (
        <div className="space-y-6">
            <JobSection title="Current Jobs" jobs={activeJobs} type="WO" />
            <JobSection title="Completed Jobs" jobs={historyJobs} type="WO" />

            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <div className="p-3 bg-slate-50 border-b border-slate-200 font-bold text-slate-700 text-sm">Recurring Jobs (PMs)</div>
                <div className="p-4 text-sm text-slate-500 italic">
                    Recurring job linkage is tracked via the BOM/Where Used tab.
                </div>
            </div>
        </div>
    );
};

function JobSection({ title, jobs, type }: { title: string, jobs: any[], type: string }) {
    return (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="p-3 bg-slate-50 border-b border-slate-200 font-bold text-slate-700 text-sm flex justify-between">
                <span>{title}</span>
                <span className="text-xs bg-white px-2 py-0.5 rounded border">{jobs.length}</span>
            </div>
            <table className="min-w-full divide-y divide-slate-200">
                <tbody className="divide-y divide-slate-200">
                    {jobs.map(job => (
                        <tr key={job.id} className="hover:bg-slate-50">
                            <td className="px-4 py-2 text-sm font-medium text-blue-600">{job.id}</td>
                            <td className="px-4 py-2 text-sm text-slate-900">{job.title}</td>
                            <td className="px-4 py-2 text-right text-xs text-slate-500">{job.status}</td>
                        </tr>
                    ))}
                    {jobs.length === 0 && <tr><td colSpan={3} className="p-4 text-center text-xs text-slate-400">None found.</td></tr>}
                </tbody>
            </table>
        </div>
    );
}

function PurchasingTab({ item }: { item: InventoryItem }) {
    const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        DatabaseService.getInstance().getPurchaseOrders().then(pos => {
            setPurchaseOrders(pos);
            setLoading(false);
        }).catch(() => setLoading(false));
    }, []);

    // Filter POs that contain line items for this inventory item
    const activePOs = purchaseOrders.filter(po =>
        ['OPEN', 'PART_RECEIVED', 'DRAFT'].includes(po.status) &&
        po.items?.some((li: any) => li.inventoryId === item.id)
    );
    const historyPOs = purchaseOrders.filter(po =>
        ['ALL_RECEIVED', 'COMPLETED', 'CANCELLED'].includes(po.status) &&
        po.items?.some((li: any) => li.inventoryId === item.id)
    );

    if (loading) return <div className="p-8 text-center text-slate-400">Loading purchase orders...</div>;

    const POTable = ({ pos, emptyMsg }: { pos: any[], emptyMsg: string }) => (
        <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
                <tr>
                    <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">PO #</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Date Required</th>
                    <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase">Qty Ordered</th>
                    <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase">Qty Received</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
                {pos.map(po => {
                    const lineItem = po.items?.find((li: any) => li.inventoryId === item.id);
                    return (
                        <tr key={po.id} className="hover:bg-slate-50">
                            <td className="px-4 py-3 text-sm font-medium text-blue-600">{po.poCode}</td>
                            <td className="px-4 py-3"><span className="text-xs px-2 py-0.5 rounded font-bold uppercase bg-slate-100 text-slate-600">{po.status?.replace('_', ' ')}</span></td>
                            <td className="px-4 py-3 text-sm text-slate-600">{po.dateRequired}</td>
                            <td className="px-4 py-3 text-sm text-right font-medium">{lineItem?.qtyOrdered || 0}</td>
                            <td className="px-4 py-3 text-sm text-right font-medium text-green-600">{lineItem?.qtyReceivedTotal || 0}</td>
                        </tr>
                    );
                })}
                {pos.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-slate-400 italic text-sm">{emptyMsg}</td></tr>}
            </tbody>
        </table>
    );

    return (
        <div className="space-y-6">
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <div className="p-3 bg-slate-50 border-b border-slate-200 font-bold text-slate-700 text-sm flex justify-between">
                    <span>Current Purchase Orders</span>
                    <span className="text-xs bg-white px-2 py-0.5 rounded border">{activePOs.length}</span>
                </div>
                <POTable pos={activePOs} emptyMsg="No active POs for this item." />
            </div>
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <div className="p-3 bg-slate-50 border-b border-slate-200 font-bold text-slate-700 text-sm flex justify-between">
                    <span>Order History</span>
                    <span className="text-xs bg-white px-2 py-0.5 rounded border">{historyPOs.length}</span>
                </div>
                <POTable pos={historyPOs} emptyMsg="No historical POs found." />
            </div>
        </div>
    );
}

function HistoryTab({ item }: { item: InventoryItem }) {
    return (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                    <tr>
                        <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Date</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Type</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Store</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Reference</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">User</th>
                        <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase">Qty Change</th>
                        <th className="px-4 py-3 text-right text-xs font-bold text-slate-900 uppercase bg-slate-50">Balance</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                    {item.transactions.map(tx => (
                        <tr key={tx.id} className="hover:bg-slate-50">
                            <td className="px-4 py-3 text-sm text-slate-900">{tx.date}</td>
                            <td className="px-4 py-3">
                                <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${tx.type === 'ISSUE' ? 'bg-amber-100 text-amber-800' :
                                    tx.type === 'RECEIPT' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'
                                    }`}>{tx.type}</span>
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-600">{tx.storeName}</td>
                            <td className="px-4 py-3 text-sm text-blue-600 font-mono">{tx.reference || '-'}</td>
                            <td className="px-4 py-3 text-sm text-slate-500">{tx.performedBy}</td>
                            <td className={`px-4 py-3 text-sm text-right font-medium ${tx.qtyChange < 0 ? 'text-red-600' : 'text-green-600'}`}>
                                {tx.qtyChange > 0 ? '+' : ''}{tx.qtyChange}
                            </td>
                            <td className="px-4 py-3 text-sm text-right font-bold text-slate-900 bg-slate-50">{tx.newBalance}</td>
                        </tr>
                    ))}
                    {item.transactions.length === 0 && (
                        <tr><td colSpan={7} className="p-8 text-center text-slate-400 italic">No movement history.</td></tr>
                    )}
                </tbody>
            </table>
        </div>
    );
}

function PropertiesTab({ item, onUpdate }: { item: InventoryItem; onUpdate?: (item: InventoryItem) => void }) {
    return (
        <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm space-y-6">
            <div>
                <h3 className="font-bold text-slate-800 border-b border-slate-100 pb-2 mb-4">Record Metadata</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase">Created By</label>
                        <div className="mt-1">{item.createdById}</div>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase">Created Date</label>
                        <div className="mt-1">{item.createdAt}</div>
                    </div>
                </div>
            </div>
            <div>
                <h3 className="font-bold text-slate-800 border-b border-slate-100 pb-2 mb-4">Comments</h3>
                <textarea defaultValue={item.comments} className="w-full h-32 text-sm border-slate-300 rounded-md bg-white p-2" placeholder="Internal notes..." />
            </div>
            <div>
                <h3 className="font-bold text-slate-800 border-b border-slate-100 pb-2 mb-4">Image</h3>
                <div className="flex items-center gap-4">
                    <ImageCapture
                        bucket="assets"
                        prefix="inv_"
                        currentImage={item.image}
                        onImageCaptured={(url) => onUpdate?.({ ...item, image: url })}
                        onRemove={() => onUpdate?.({ ...item, image: undefined })}
                        shape="square"
                        size="lg"
                    />
                    <div className="flex-1">
                        <p className="text-xs text-slate-500">
                            Upload or take a photo of this part. Supports JPG, PNG up to 10MB. Images are auto-compressed.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}

// --- New Financials Tab ---
function InventoryFinancialsTab({ item, onUpdate, dictionaries }: { item: InventoryItem; onUpdate: (item: InventoryItem) => void; dictionaries: any[] }) {

    const handleChange = (field: keyof InventoryItem, value: any) => {
        onUpdate({ ...item, [field]: value });
    };

    return (
        <div className="space-y-6">
            {/* Warranty Policy */}
            <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm">
                <h3 className="font-bold text-slate-800 border-b border-slate-100 pb-2 mb-4 flex items-center gap-2">
                    <ShieldCheck size={16} className="text-green-600" /> Warranty Policy
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Default Warranty (Months)</label>
                        <input
                            type="number"
                            value={item.defaultWarrantyMonths || ''}
                            onChange={e => handleChange('defaultWarrantyMonths', parseInt(e.target.value) || 0)}
                            className="w-full text-sm border-slate-300 rounded-lg bg-white p-2"
                            placeholder="e.g. 12"
                        />
                        <p className="text-[10px] text-slate-400 mt-1">Standard manufacturer warranty duration.</p>
                    </div>
                    <div className="flex items-center pt-6">
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={item.warrantyFromInstall || false}
                                onChange={e => handleChange('warrantyFromInstall', e.target.checked)}
                                className="rounded text-blue-600 focus:ring-primary-500"
                            />
                            <div>
                                <span className="text-sm font-medium text-slate-700">Warranty Starts on Installation?</span>
                                <p className="text-[10px] text-slate-400">If checked, warranty clock starts when installed on asset. If unchecked, starts on purchase receipt.</p>
                            </div>
                        </label>
                    </div>
                </div>
            </div>

            {/* Lifecycle Management */}
            <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm">
                <h3 className="font-bold text-slate-800 border-b border-slate-100 pb-2 mb-4 flex items-center gap-2">
                    <RefreshCw size={16} className="text-blue-600" /> Lifecycle & Classification
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="flex items-start pt-2">
                        <label className="flex items-start gap-3 cursor-pointer p-3 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors w-full">
                            <input
                                type="checkbox"
                                checked={item.isCapitalSpare || false}
                                onChange={e => handleChange('isCapitalSpare', e.target.checked)}
                                className="mt-1 rounded text-blue-600 focus:ring-primary-500"
                            />
                            <div>
                                <span className="text-sm font-bold text-slate-800 flex items-center gap-2">
                                    Capital Spare (Rotable)
                                    {item.isCapitalSpare && <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded border border-blue-200">ACTIVE</span>}
                                </span>
                                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                                    Treat as a serialized asset. Individual items will be tracked with unique serial numbers and history.
                                    Value is capitalized rather than expensed on purchase.
                                </p>
                            </div>
                        </label>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Shelf Life (Days)</label>
                        <input
                            type="number"
                            value={item.shelfLifeDays || ''}
                            onChange={e => handleChange('shelfLifeDays', parseInt(e.target.value) || 0)}
                            className="w-full text-sm border-slate-300 rounded-lg bg-white p-2"
                            placeholder="e.g. 365"
                        />
                        <p className="text-[10px] text-slate-400 mt-1">Maximum storage time before expiration (for perishable goods like seals, chemicals).</p>
                    </div>
                </div>
            </div>

            {/* Valuation & Depreciation */}
            <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm">
                <h3 className="font-bold text-slate-800 border-b border-slate-100 pb-2 mb-4 flex items-center gap-2">
                    <Calculator size={16} className="text-amber-600" /> Valuation Settings
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Depreciation Method</label>
                        <select
                            value={item.depreciationMethod || ''}
                            onChange={e => handleChange('depreciationMethod', e.target.value)}
                            className="w-full text-sm border-slate-300 rounded-lg bg-white p-2"
                        >
                            <option value="">(None / Expensed)</option>
                            <option value="SL">Straight Line (SL)</option>
                            <option value="DB">Declining Balance (DB)</option>
                            <option value="SYD">Sum of Years Digits (SYD)</option>
                            <option value="UOP">Units of Production</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Salvage Value Estimate ($)</label>
                        <div className="relative">
                            <span className="absolute left-2 top-2 text-slate-400">$</span>
                            <input
                                type="number"
                                value={item.salvageValue || ''}
                                onChange={e => handleChange('salvageValue', parseFloat(e.target.value) || 0)}
                                className="w-full text-sm border-slate-300 rounded-lg bg-white p-2 pl-6"
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export function Inventory({ onAnalyze }: InventoryProps) {
    const { profile, permissions } = useAuth();
    const canCreate = permissions?.inventory?.create === true;
    const canEdit = permissions?.inventory?.edit === true;
    const canDelete = permissions?.inventory?.delete === true;
    const { showToast } = useToast();
    const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
    // ATP netting (0201): qty reserved by planned parts on open WOs, per item.
    const [reservedByItem, setReservedByItem] = useState<Record<string, number>>({});
    const [stores, setStores] = useState<Store[]>([]);
    const [dictionaries, setDictionaries] = useState<any[]>([]); // Added dictionary state
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [vendors, setVendors] = useState<Vendor[]>([]);
    const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [activeTab, setActiveTab] = useState<TabId>('details');
    const [showStockModal, setShowStockModal] = useState(false);
    const [showAddModal, setShowAddModal] = useState(false);
    const [showStoreManager, setShowStoreManager] = useState(false);
    // Deep-linked from Admin › Migration Center (/inventory?action=import).
    const [showBulkImport, setShowBulkImport] = useState(
        new URLSearchParams(window.location.search).get('action') === 'import'
    );
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [bulkDeleteModal, setBulkDeleteModal] = useState(false);

    useEffect(() => {
        loadInventory();
        loadDictionaries();
        loadStores();
        loadContacts();
        loadVendors();
    }, []);

    const loadDictionaries = async () => {
        try {
            const dicts = await DatabaseService.getInstance().getDictionaries();
            setDictionaries(dicts);
        } catch (e) {
            console.error("Failed to load dictionaries", e);
        }
    };

    const loadStores = async () => {
        try {
            const locs = await DatabaseService.getInstance().getInventoryLocations();
            setStores(locs);
        } catch (e) {
            console.error("Failed to load stores", e);
            setStores([]);
        }
    };

    const loadContacts = async () => {
        try {
            const data = await DatabaseService.getInstance().getContacts();
            setContacts(data);
        } catch (e) {
            console.error("Failed to load contacts", e);
        }
    };

    const loadVendors = async () => {
        try {
            const data = await DatabaseService.getInstance().getVendors();
            setVendors(data);
        } catch (e) {
            console.error("Failed to load vendors", e);
        }
    };

    const loadInventory = async () => {
        try {
            // Service now returns fully mapped InventoryItem[]
            const items = await DatabaseService.getInstance().getInventory();
            if (items.length === 0) {
                // Fallback to MOCK if strictly empty? Or just show empty.
                // For dev/demo speed, if empty, maybe show mock? 
                // User wants "Implement in Database", so let's show empty or Seeded DB data.
                // I prefer showing empty so they know it's real.
                setInventoryItems([]);
            } else {
                setInventoryItems(items);
                fetchReservedByItem(items.map(i => i.id)).then(setReservedByItem);
                return items;
            }
        } catch (e) {
            console.error("Failed to load inventory", e);
            return [];
            // setInventoryItems(MOCK_INVENTORY); // Disable mock fallback to force DB usage verification
        }
    };

    const handleLocalUpdate = (updated: InventoryItem) => {
        setSelectedItem(updated);
        // Update list view purely for "draft" visualization
        setInventoryItems(prev => prev.map(i => i.id === updated.id ? updated : i));
    };

    const handleCreateItem = async (newItem: InventoryItem) => {
        // ═══ RBAC Layer 2: Submit-level guard (ISO 27001 / NIST CSF) ═══
        if (!canCreate) {
            console.warn('[RBAC-AUDIT] BLOCKED: inventory.create attempt by unauthorized user', profile?.username);
            showToast('Access Denied: You do not have permission to create inventory items.', 'error');
            return;
        }
        try {
            // Map UI -> DB
            // Note: Schema doesn't support all fields yet (uom, type, critical...)
            const isTempId = newItem.id && (newItem.id.startsWith('inv-new') || newItem.id.length < 10);
            const dbRecord: any = {
                id: (!isTempId && newItem.id) ? newItem.id : crypto.randomUUID(),
                part_number: newItem.code,
                description: newItem.description,
                type: newItem.type,
                uom: newItem.uom,
                manufacturer: newItem.manufacturer,
                model: newItem.model,
                unit_cost: newItem.itemCost,
                stock_on_hand: newItem.totalQtyOnHand,
                min_level: newItem.minLevel,
                max_level: newItem.maxLevel,
                is_active: newItem.isActive,
                is_critical: newItem.isCritical,
                image_url: newItem.image,
                comments: newItem.comments,

                // Mapped Financials
                default_warranty_months: newItem.defaultWarrantyMonths,
                warranty_from_install: newItem.warrantyFromInstall,
                is_capital_spare: newItem.isCapitalSpare,
                shelf_life_days: newItem.shelfLifeDays,
                depreciation_method: newItem.depreciationMethod,
                salvage_value: newItem.salvageValue,

                costCenterInbound: newItem.costCenterInbound,
                costCenterOutbound: newItem.costCenterOutbound,

                properties: {
                    customFields: newItem.customFields || [],
                    suppliers: newItem.suppliers || []
                }
            };

            await DatabaseService.getInstance().addInventoryItem(dbRecord, newItem.stockLocations);
            loadInventory(); // Refresh list
            setSelectedItem(newItem); // Optimistic selection? Or wait for reload
            setActiveTab('details');
            setShowAddModal(false);
        } catch (e: any) {
            showToast('Error saving item: ' + e.message, 'error');
        }
    };

    const handleSaveItem = async () => {
        // ═══ RBAC Layer 2: Submit-level guard (ISO 27001 / NIST CSF) ═══
        if (!canEdit) {
            console.warn('[RBAC-AUDIT] BLOCKED: inventory.edit attempt by unauthorized user', profile?.username);
            showToast('Access Denied: You do not have permission to edit inventory items.', 'error');
            return;
        }
        if (!selectedItem) return;
        const updatedItem = selectedItem;
        console.log("Saving Item:", updatedItem);

        // DEBUG: Verify payload (Uncommented for user)
        // DEBUG: Verify payload (Uncommented for user)
        // console.log(`Saving Stock Locations: ${JSON.stringify(updatedItem.stockLocations)}`);

        try {
            // Map to DB Record
            const dbRecord: any = {
                part_number: updatedItem.code,
                description: updatedItem.description,
                type: updatedItem.type,
                uom: updatedItem.uom,
                manufacturer: updatedItem.manufacturer,
                model: updatedItem.model,
                unit_cost: updatedItem.itemCost,
                // stock_on_hand: updatedItem.totalQtyOnHand, // Let service/DB handle this via transaction sum? Or update explicitly.
                min_level: updatedItem.minLevel,
                max_level: updatedItem.maxLevel,
                is_active: updatedItem.isActive,
                is_critical: updatedItem.isCritical,
                image_url: updatedItem.image,
                comments: updatedItem.comments,

                // Mapped Financials
                default_warranty_months: updatedItem.defaultWarrantyMonths,
                warranty_from_install: updatedItem.warrantyFromInstall,
                is_capital_spare: updatedItem.isCapitalSpare,
                shelf_life_days: updatedItem.shelfLifeDays,
                depreciation_method: updatedItem.depreciationMethod,
                salvage_value: updatedItem.salvageValue,

                costCenterInbound: updatedItem.costCenterInbound,
                costCenterOutbound: updatedItem.costCenterOutbound,

                properties: {
                    customFields: updatedItem.customFields || [],
                    suppliers: updatedItem.suppliers || []
                }
            };

            await DatabaseService.getInstance().updateInventoryItem(updatedItem.id, dbRecord, updatedItem.stockLocations);

            // Confirmed Save
            setInventoryItems(prev => prev.map(i => i.id === updatedItem.id ? updatedItem : i));

            // Notification hook-in: Stock Low Check — netted against open-WO
            // reservations (0201), so fully-committed stock alerts before the
            // shelf is physically empty.
            const availableNow = availableQty(updatedItem.totalQtyOnHand, reservedByItem[updatedItem.id] || 0);
            if (availableNow <= updatedItem.minLevel && updatedItem.minLevel > 0) {
                const eventCode = availableNow === 0 ? 'STOCK_OUT' : 'STOCK_LOW';
                NotificationService.checkRules('inventory', eventCode, {
                    ...updatedItem,
                    itemCode: updatedItem.code,
                    itemDescription: updatedItem.description,
                    qtyOnHand: updatedItem.totalQtyOnHand,
                    qtyAvailable: availableNow,
                    reorderPoint: updatedItem.minLevel
                }, { currentUserId: profile?.id || 'SYSTEM' });
            }

            showToast('Item saved successfully!', 'success');
        } catch (e: any) {
            showToast('Failed to update item: ' + (e.message || JSON.stringify(e)), 'error');
            console.error(e);
        }
    };

    const TABS: { id: TabId; label: string; icon: any }[] = [
        { id: 'details', label: 'Details', icon: FileText },
        { id: 'properties', label: 'Properties', icon: Settings },
        { id: 'stores', label: 'Stores', icon: Warehouse },
        { id: 'suppliers', label: 'Suppliers', icon: Truck },
        { id: 'bom', label: 'Where Used (BOM)', icon: Layers },
        { id: 'jobs', label: 'Jobs', icon: Briefcase },
        { id: 'financials', label: 'Financials', icon: DollarSign },
        { id: 'purchasing', label: 'Purchasing', icon: ShoppingCart },
        { id: 'history', label: 'History', icon: History },
        { id: 'fields', label: 'Fields', icon: Tag },
    ];

    const filteredInventory = inventoryItems.filter(item =>
        item.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.description.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const handleRowClick = (item: InventoryItem) => {
        setSelectedItem(item);
        setActiveTab('details');
        setSelectedIds(new Set()); // Clear bulk selection on detail view
    };

    // --- Bulk Selection Handlers ---
    const toggleSelectItem = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === filteredInventory.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(filteredInventory.map(i => i.id)));
        }
    };

    const handleBulkDelete = async () => {
        if (!canDelete) {
            console.warn('[RBAC-AUDIT] BLOCKED: inventory.bulkDelete attempt by unauthorized user', profile?.username);
            showToast('Access Denied: You do not have permission to delete inventory items.', 'error');
            return;
        }
        const ids = Array.from(selectedIds);
        let deleted = 0;
        for (const id of ids) {
            try {
                await DatabaseService.getInstance().deleteInventoryItem(id);
                deleted++;
            } catch (e: any) {
                console.warn(`Failed to delete inventory item ${id}:`, e.message);
            }
        }
        setSelectedIds(new Set());
        setBulkDeleteModal(false);
        if (selectedItem && ids.includes(selectedItem.id)) setSelectedItem(null);
        await loadInventory();
        showToast(`Deleted ${deleted} of ${ids.length} item(s).`, deleted === ids.length ? 'success' : 'warning');
    };

    // --- Bulk Import Handler for Inventory ---
    const handleBulkImportData = async (type: ImportType, rows: Record<string, string>[]) => {
        // ═══ RBAC Layer 2: Submit-level guard (ISO 27001 / NIST CSF) ═══
        if (!canCreate) {
            console.warn('[RBAC-AUDIT] BLOCKED: inventory.bulkImport attempt by unauthorized user', profile?.username);
            showToast('Access Denied: You do not have permission to import inventory items.', 'error');
            return;
        }
        if (type !== 'inventory') return;

        // Header names must match the template exactly (parseImportFile
        // lowercases them). These used to read 'unitcost' and 'storelocation',
        // which the template never ships — so every imported item landed at
        // cost 0 with no stock row at all.
        const res = emptyResult();
        const existingCodes = new Set(inventoryItems.map(i => (i.code || '').toUpperCase()));

        // Storerooms must exist as real inventory_locations rows before stock can
        // reference them (stock.location_id is an FK). Resolve by name, creating
        // any the file mentions but the tenant doesn't have yet.
        const storeIdByName = new Map<string, string>();
        try {
            const existingStores = await DatabaseService.getInstance().getInventoryLocations();
            for (const s of existingStores) storeIdByName.set(String(s.name || '').toUpperCase(), s.id);
        } catch { /* fall through — names below simply won't resolve */ }

        const resolveStore = async (name: string): Promise<string | null> => {
            const key = name.toUpperCase();
            const hit = storeIdByName.get(key);
            if (hit) return hit;
            try {
                const created = await DatabaseService.getInstance().addStore({ name, code: name.slice(0, 12).toUpperCase() });
                if (created?.id) {
                    storeIdByName.set(key, created.id);
                    res.notes!.push(`Storeroom "${name}" created.`);
                    return created.id;
                }
            } catch (e: unknown) {
                res.notes!.push(`Could not create storeroom "${name}" (${errMessage(e)}).`);
            }
            return null;
        };

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rowNo = Number(row.__row) || i + 2;
            const code = row['code'] || `INV-${Date.now()}-${i}`;

            if (existingCodes.has(code.toUpperCase())) {
                tally(res, { row: rowNo, key: code, status: 'skipped', reason: 'Item code already exists' });
                continue;
            }

            try {
                const qtyOnHand = parseInt(row['qtyonhand'] || '0') || 0;
                const storeName = row['storename'] || '';
                const storeId = storeName ? await resolveStore(storeName) : null;
                const newItem: InventoryItem = {
                    id: crypto.randomUUID(),
                    code,
                    description: row['description'] || 'Imported Item',
                    type: (row['type'] || 'SPARE').toUpperCase(),
                    uom: row['uom'] || 'EA',
                    manufacturer: row['manufacturer'] || '',
                    model: row['model'] || '',
                    itemCost: parseFloat(row['itemcost'] || '0') || 0,
                    totalQtyOnHand: qtyOnHand,
                    totalQtyOnOrder: 0,
                    minLevel: parseInt(row['minlevel'] || '0') || 0,
                    maxLevel: parseInt(row['maxlevel'] || '0') || 0,
                    isActive: true,
                    isCritical: ['yes', 'true', 'y'].includes((row['iscritical'] || '').toLowerCase()),
                    // addInventoryItem keys stock off stock.id, which must be a
                    // REAL inventory_locations uuid — a synthetic one trips the FK.
                    stockLocations: storeId ? [{
                        id: storeId,
                        storeId,
                        storeName,
                        binLocation: row['binlocation'] || '',
                        minQty: parseInt(row['minlevel'] || '0') || 0,
                        maxQty: parseInt(row['maxlevel'] || '0') || 0,
                        reorderQty: 0,
                        qtyOnHand,
                        qtyOnOrder: 0,
                    }] : [],
                    transactions: [],
                    suppliers: [],
                    customFields: [],
                    comments: '',
                    barcode: '',
                    markupPercentage: 0,
                    createdAt: new Date().toISOString(),
                    createdById: 'bulk-import',
                };
                // Straight to the service: handleCreateItem swallows failures into
                // a toast, which would let this loop report phantom successes.
                await DatabaseService.getInstance().addInventoryItem({
                    id: newItem.id,
                    // Blank — the auto_material_number BEFORE INSERT trigger fills it.
                    material_number: '',
                    part_number: newItem.code,
                    description: newItem.description,
                    type: newItem.type,
                    uom: newItem.uom,
                    manufacturer: newItem.manufacturer,
                    model: newItem.model,
                    unit_cost: newItem.itemCost,
                    stock_on_hand: newItem.totalQtyOnHand,
                    min_level: newItem.minLevel,
                    max_level: newItem.maxLevel,
                    is_active: true,
                    is_critical: newItem.isCritical,
                    properties: { customFields: [], suppliers: [] },
                }, newItem.stockLocations);
                existingCodes.add(code.toUpperCase());
                if (row['assettag'] || row['preferredsupplier']) {
                    res.notes!.push(`Row ${rowNo}: assetTag / preferredSupplier are not linked on import — set them on the item afterwards.`);
                }
                tally(res, { row: rowNo, key: code, status: 'inserted' });
            } catch (e: unknown) {
                tally(res, { row: rowNo, key: code, status: 'failed', reason: errMessage(e) });
            }
        }

        showToast(`Imported ${res.inserted} of ${rows.length} inventory items.`, res.failed === 0 ? 'success' : 'warning');
        loadInventory();
        return res;
    };

    return (
        <div className="flex h-full gap-6 relative">
            {/* List Sidebar */}
            <div className={`flex flex-col bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden transition-all duration-300 ${selectedItem ? 'w-1/3 hidden lg:flex' : 'w-full'}`}>
                <div className="p-4 border-b border-slate-200 flex justify-between items-center">
                    <h2 className="font-bold text-slate-900">Inventory Registry</h2>
                    <div className="flex gap-2 items-center">
                        <AskRelanternButton
                            contextType="inventory"
                            contextSummary={`Inventory Overview: ${inventoryItems.length} items registered. Low Stock: ${inventoryItems.filter(i => i.totalQtyOnHand <= (i.minLevel || 0)).length}. Critical Spares: ${inventoryItems.filter(i => i.isCritical).length}. ${stores.length} store locations. Total Inventory Value: $${inventoryItems.reduce((sum, i) => sum + (i.itemCost || 0) * (i.totalQtyOnHand || 0), 0).toLocaleString()}. Ask about stock optimization, EOQ analysis, reorder strategies, dead stock identification, or spare parts criticality.`}
                            compact
                        />
                        <button
                            onClick={() => setShowStoreManager(true)}
                            disabled={!canEdit}
                            className={`p-2 bg-slate-100 text-slate-600 rounded-lg transition border border-slate-200 ${!canEdit ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-200'}`}
                            title={!canEdit ? 'Insufficient permissions' : 'Manage Warehouses'}
                        >
                            <Warehouse size={18} />
                        </button>
                        <button
                            onClick={() => setShowBulkImport(true)}
                            disabled={!canCreate}
                            className={`p-2 bg-white border border-slate-300 text-slate-600 rounded-lg transition shadow-sm ${!canCreate ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-50'}`}
                            title={!canCreate ? 'Insufficient permissions' : 'Bulk Import Inventory'}
                        >
                            <Upload size={18} />
                        </button>
                        <button
                            onClick={() => setShowAddModal(true)}
                            disabled={!canCreate}
                            className={`bg-primary-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-2 ${!canCreate ? 'opacity-50 cursor-not-allowed' : 'hover:bg-primary-500'}`}
                            title={!canCreate ? 'Insufficient permissions' : 'Create new inventory item'}
                        >
                            <Plus size={16} /> New Item
                        </button>
                    </div>
                </div>

                <div className="p-4 border-b border-slate-200 bg-slate-50 flex gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
                        <input
                            type="text"
                            placeholder="Search Code, Description..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm"
                        />
                    </div>
                    <button className="p-2 border border-slate-300 rounded-lg bg-white text-slate-600 hover:bg-slate-50">
                        <Filter size={18} />
                    </button>
                </div>

                {/* Bulk Action Bar */}
                {selectedIds.size > 0 && (
                    <div className="px-4 py-2.5 bg-gradient-to-r from-blue-600 to-blue-700 flex items-center justify-between gap-3 animate-in slide-in-from-top duration-200">
                        <div className="flex items-center gap-2">
                            <CheckSquare size={16} className="text-white/80" />
                            <span className="text-sm font-semibold text-white">{selectedIds.size} item{selectedIds.size > 1 ? 's' : ''} selected</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setSelectedIds(new Set())}
                                className="px-3 py-1 text-xs font-medium text-white/90 bg-white/15 hover:bg-white/25 rounded-md transition"
                            >
                                Clear
                            </button>
                            <button
                                onClick={() => setBulkDeleteModal(true)}
                                disabled={!canDelete}
                                className={`px-3 py-1 text-xs font-bold rounded-md flex items-center gap-1.5 transition ${!canDelete ? 'bg-white/10 text-white/40 cursor-not-allowed' : 'bg-red-500 text-white hover:bg-red-600 shadow-sm'}`}
                                title={!canDelete ? 'Insufficient permissions' : 'Delete selected items'}
                            >
                                <Trash2 size={13} /> Delete Selected
                            </button>
                        </div>
                    </div>
                )}

                <div className="flex-1 overflow-y-auto">
                    {/* Select All Header */}
                    {filteredInventory.length > 0 && (
                        <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-3 sticky top-0 z-10">
                            <input
                                type="checkbox"
                                checked={selectedIds.size === filteredInventory.length && filteredInventory.length > 0}
                                onChange={toggleSelectAll}
                                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-primary-500 cursor-pointer"
                                title="Select all"
                            />
                            <span className="text-xs text-slate-500 font-medium">
                                {selectedIds.size > 0 ? `${selectedIds.size} of ${filteredInventory.length}` : `${filteredInventory.length} items`}
                            </span>
                        </div>
                    )}

                    {filteredInventory.map(item => {
                        const stockStatus = item.totalQtyOnHand === 0 ? 'OUT' : item.totalQtyOnHand <= (item.minLevel || 0) ? 'LOW' : 'OK';
                        const stockTones: Record<string, Tone> = { OUT: 'danger', LOW: 'warning', OK: 'success' };
                        const stockLabels = { OUT: 'Out of Stock', LOW: 'Low Stock', OK: 'In Stock' };
                        const primaryLocation = item.stockLocations?.[0];
                        const reserved = reservedByItem[item.id] || 0;
                        const available = availableQty(item.totalQtyOnHand, reserved);

                        return (
                            <div
                                key={item.id}
                                onClick={() => handleRowClick(item)}
                                className={`mobile-card gap-2 ${selectedItem?.id === item.id ? 'bg-blue-50 border-l-4 border-l-blue-600' : selectedIds.has(item.id) ? 'bg-blue-50/50' : ''} ${item.isCritical ? 'overdue-strip' : ''}`}
                            >
                                <div className="flex gap-3">
                                    {/* Checkbox */}
                                    <div className="flex items-center flex-shrink-0" onClick={e => e.stopPropagation()}>
                                        <input
                                            type="checkbox"
                                            checked={selectedIds.has(item.id)}
                                            onChange={() => {
                                                setSelectedIds(prev => {
                                                    const next = new Set(prev);
                                                    if (next.has(item.id)) next.delete(item.id);
                                                    else next.add(item.id);
                                                    return next;
                                                });
                                            }}
                                            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-primary-500 cursor-pointer"
                                        />
                                    </div>
                                    <div className="w-10 h-10 bg-slate-200 rounded flex-shrink-0 flex items-center justify-center text-slate-500">
                                        {item.image ? <img src={item.image} alt="" className="w-full h-full object-cover rounded" /> : <Box size={20} />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        {/* Row 1: Code + Badges */}
                                        <div className="flex justify-between items-start mb-0.5">
                                            <span className="font-mono text-xs font-bold text-slate-700">{item.code}</span>
                                            <div className="flex items-center gap-1 flex-shrink-0">
                                                {item.isCritical && <Badge tone="warning">⚡ Critical</Badge>}
                                                <Badge tone={stockTones[stockStatus]} dot>{stockLabels[stockStatus]}</Badge>
                                            </div>
                                        </div>
                                        {/* Row 2: Description */}
                                        <h3 className="text-sm font-medium text-slate-900 mb-1 line-clamp-1">{item.description}</h3>
                                        {/* Row 3: Qty + Store + Type */}
                                        <div className="flex justify-between items-center text-[11px] text-slate-500">
                                            <div className="flex items-center gap-2">
                                                <span className={`font-bold ${stockStatus === 'OUT' ? 'text-red-600' : stockStatus === 'LOW' ? 'text-amber-600' : 'text-green-600'}`}>
                                                    Qty: {item.totalQtyOnHand} {item.uom}
                                                </span>
                                                {reserved > 0 && (
                                                    <span className={`font-bold ${available === 0 ? 'text-red-600' : 'text-amber-600'}`} title={`${reserved} reserved by open work orders`}>
                                                        Avail: {available}
                                                    </span>
                                                )}
                                                {primaryLocation && (
                                                    <span className="text-slate-400">
                                                        {primaryLocation.storeName}{primaryLocation.binLocation ? ` / ${primaryLocation.binLocation}` : ''}
                                                    </span>
                                                )}
                                            </div>
                                            <span className="text-slate-400 text-[10px]">{item.type}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Detail View */}
            {selectedItem && (
                <div className="flex-1 bg-white rounded-xl shadow-lg border border-slate-200 flex flex-col overflow-hidden relative">
                    <UnifiedDetailHeader
                        title={selectedItem.code}
                        subtitle={selectedItem.description}
                        icon={selectedItem.image
                            ? <img src={selectedItem.image} alt="Preview" className="w-full h-full object-cover rounded" />
                            : <Package size={18} />
                        }
                        onClose={() => setSelectedItem(null)}
                        badges={
                            <>
                                {!selectedItem.isActive && (
                                    <span className="bg-red-100 text-red-700 text-[10px] px-2 py-0.5 rounded-full font-bold uppercase">Inactive</span>
                                )}
                                {selectedItem.isCritical && (
                                    <span className="bg-amber-100 text-amber-700 text-[10px] px-2 py-0.5 rounded-full font-bold uppercase">Critical</span>
                                )}
                                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${selectedItem.totalQtyOnHand === 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                                    {selectedItem.totalQtyOnHand} {selectedItem.uom}
                                </span>
                                {(reservedByItem[selectedItem.id] || 0) > 0 && (
                                    <span
                                        className={`text-xs font-bold px-2 py-0.5 rounded-full ${availableQty(selectedItem.totalQtyOnHand, reservedByItem[selectedItem.id]) === 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}
                                        title={`${reservedByItem[selectedItem.id]} reserved by open work orders`}
                                    >
                                        Avail {availableQty(selectedItem.totalQtyOnHand, reservedByItem[selectedItem.id])}
                                    </span>
                                )}
                            </>
                        }
                        actions={
                            <>
                                <Button variant="secondary" size="sm" onClick={() => setShowStockModal(true)} disabled={!canEdit} leftIcon={<ClipboardCheck size={14} />} title={!canEdit ? 'Insufficient permissions' : 'Adjust stock'}>
                                    Adjust
                                </Button>
                                <Button size="sm" onClick={handleSaveItem} disabled={!canEdit} leftIcon={<Save size={14} />} title={!canEdit ? 'Insufficient permissions' : 'Save changes'}>
                                    Save
                                </Button>
                            </>
                        }
                    />

                    {/* Tabs */}
                    <UnifiedTabBar
                        tabs={TABS.map(tab => ({
                            id: tab.id,
                            label: tab.label,
                            icon: tab.icon
                        }))}
                        activeTab={activeTab}
                        onTabChange={(id) => setActiveTab(id as TabId)}
                    />

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
                        {activeTab === 'details' && <DetailsTab item={selectedItem} dictionaries={dictionaries} contacts={contacts} vendors={vendors} onUpdate={handleLocalUpdate} />}
                        {activeTab === 'stores' && <StoresTab item={selectedItem} stores={stores} onUpdate={handleLocalUpdate} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />}
                        {activeTab === 'suppliers' && <SuppliersTab item={selectedItem} onUpdate={handleLocalUpdate} canCreate={canCreate} />}
                        {activeTab === 'bom' && <BOMTab item={selectedItem} {...{canEdit, canDelete} as any} />}
                        {activeTab === 'jobs' && <JobsTab item={selectedItem} />}
                        {activeTab === 'financials' && <InventoryFinancialsTab item={selectedItem} onUpdate={handleLocalUpdate} dictionaries={dictionaries} />}
                        {activeTab === 'purchasing' && <PurchasingTab item={selectedItem} />}
                        {activeTab === 'history' && <HistoryTab item={selectedItem} />}
                        {activeTab === 'properties' && <PropertiesTab item={selectedItem} onUpdate={handleLocalUpdate} />}
                        {activeTab === 'fields' && <div className="p-12 text-center text-slate-400">Custom Fields configuration based on Inventory Type '{selectedItem.type}'.</div>}
                    </div>

                    {/* Stock Adjustment Modal */}
                    {/* Stock Adjustment Modal */}
                    {showStockModal && selectedItem && (
                        <StockAdjustmentModal
                            isOpen={showStockModal}
                            onClose={() => setShowStockModal(false)}
                            item={selectedItem}
                            onSuccess={async () => {
                                const newItems = await loadInventory(); // Reload to get fresh stock
                                if (newItems && selectedItem) {
                                    const refreshed = newItems.find(i => i.id === selectedItem.id);
                                    if (refreshed) setSelectedItem(refreshed);
                                }
                                setShowStockModal(false);
                            }}
                        />
                    )}
                </div>
            )}

            {/* Add New Item Modal */}
            {showAddModal && (
                <AddInventoryModal
                    isOpen={showAddModal}
                    onClose={() => setShowAddModal(false)}
                    onSave={handleCreateItem}
                    availableStores={stores}
                    dictionaries={dictionaries}
                />
            )}

            {/* Bulk Import Modal */}
            <BulkImportModal
                isOpen={showBulkImport}
                onClose={() => setShowBulkImport(false)}
                preSelectedType="inventory"
                onImportData={handleBulkImportData}
            />

            {/* Bulk Delete Confirmation */}
            <ConfirmationModal
                isOpen={bulkDeleteModal}
                onClose={() => setBulkDeleteModal(false)}
                onConfirm={handleBulkDelete}
                title="Delete Selected Items?"
                message={`You are about to permanently delete ${selectedIds.size} inventory item(s). Associated stock locations and transaction history will also be removed. This action cannot be undone.`}
                type={'danger' as ConfirmationType}
                confirmText={`Delete ${selectedIds.size} Item${selectedIds.size > 1 ? 's' : ''}`}
            />

            {/* Store Manager Modal */}
            {showStoreManager && (
                <StoreManagerModal
                    isOpen={showStoreManager}
                    onClose={() => setShowStoreManager(false)}
                    stores={stores}
                    onUpdateStores={setStores as any}
                    {...{canCreate, canEdit, canDelete} as any}
                />
            )}
        </div>
    );
};
