/**
 * ItemFormModal — Create / Edit Inventory Item
 * ═════════════════════════════════════════════
 * Governance: auto criticality flagging for Crit A assets, BOM section.
 */

import React, { useState } from 'react';
import { X, Save, Plus, Package } from 'lucide-react';
import type { InventoryItem } from '../../types/inventory';
import { AssetPartLink } from './AssetPartLink';
import { useAssetLookup } from '../../hooks/useAssetLookup';

const CATEGORIES = [
    { value: 'spare_part', label: 'Spare Part' },
    { value: 'consumable', label: 'Consumable' },
    { value: 'tool', label: 'Tool / Equipment' },
    { value: 'safety', label: 'Safety Stock' },
    { value: 'raw_material', label: 'Raw Material' },
];

const ABC_CLASSES = ['A', 'B', 'C'] as const;

interface ItemFormModalProps {
    mode: 'create' | 'edit';
    item?: InventoryItem;   // Pre-populated in edit mode
    storeroomId?: string;   // Default storeroom
    onClose: () => void;
    onSave: (item: InventoryItem) => void;
    onUpdate?: (id: string, patch: Partial<InventoryItem>) => void;
}

export const ItemFormModal: React.FC<ItemFormModalProps> = ({
    mode, item, storeroomId = 'str-01', onClose, onSave, onUpdate,
}) => {
    const isEdit = mode === 'edit' && item;

    const [partNumber, setPartNumber] = useState(item?.part_number || '');
    const [description, setDescription] = useState(item?.description || '');
    const [category, setCategory] = useState<InventoryItem['category']>(item?.category || 'spare_part');
    const [abcClass, setAbcClass] = useState<'A' | 'B' | 'C'>(item?.abc_class || 'B');
    const [unitCost, setUnitCost] = useState(item?.unit_cost_usd || 0);
    const [qtyOnHand, setQtyOnHand] = useState(item?.qty_on_hand || 0);
    const [minQty, setMinQty] = useState(item?.min_qty || 5);
    const [maxQty, setMaxQty] = useState(item?.max_qty || 20);
    const [reorderPoint, setReorderPoint] = useState(item?.reorder_point || 5);
    const [supplierName, setSupplierName] = useState(item?.supplier_name || '');
    const [supplierPart, setSupplierPart] = useState(item?.supplier_part_number || '');
    const [linkedAssetIds, setLinkedAssetIds] = useState<string[]>(item?.linked_asset_ids || []);

    const [error, setError] = useState('');

    // Rule 1: Auto criticality flagging
    const { getAssetById } = useAssetLookup();
    const hasCritAAsset = linkedAssetIds.some(id => {
        const asset = getAssetById(id);
        return asset?.criticality === 'A';
    });

    const handleSubmit = () => {
        if (!partNumber.trim() || !description.trim()) {
            setError('Part Number and Description are required.');
            return;
        }

        const stockStatus = qtyOnHand === 0 ? 'out_of_stock' : qtyOnHand <= reorderPoint ? 'low_stock' : 'in_stock';

        if (isEdit && onUpdate && item) {
            onUpdate(item.id, {
                part_number: partNumber, description, category: category as any,
                abc_class: abcClass, unit_cost_usd: unitCost,
                qty_on_hand: qtyOnHand, min_qty: minQty, max_qty: maxQty,
                reorder_point: reorderPoint, supplier_name: supplierName,
                supplier_part_number: supplierPart, linked_asset_ids: linkedAssetIds,
                criticality_flag: hasCritAAsset, stock_status: stockStatus as any,
            });
        } else {
            const newItem: InventoryItem = {
                id: `inv-${Date.now()}`,
                part_number: partNumber, description,
                category: category as any, abc_class: abcClass,
                storeroom_id: storeroomId, storeroom_name: 'Main Warehouse',
                qty_on_hand: qtyOnHand, min_qty: minQty,
                max_qty: maxQty, reorder_point: reorderPoint,
                unit_cost_usd: unitCost,
                unit_of_measure: 'each' as any, lead_time_days: 14,
                linked_asset_ids: linkedAssetIds,
                criticality_flag: hasCritAAsset,
                supplier_name: supplierName, supplier_part_number: supplierPart,
                stock_status: stockStatus as any,
                annual_usage_qty: 0, ordering_cost_usd: 50,
                holding_cost_pct: 0.20,
            };
            onSave(newItem);
        }
        onClose();
    };

    const fld = "w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:border-relantern-500 transition-colors";

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white border border-slate-200 rounded-2xl w-[600px] max-h-[85vh] overflow-y-auto shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
                    <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <Package size={18} className="text-accent-cyan" />
                        {isEdit ? `Edit ${item.part_number}` : 'New Inventory Item'}
                    </h2>
                    <button onClick={onClose} className="p-1.5 text-slate-500 hover:text-white hover:bg-slate-100 rounded-lg transition-colors">
                        <X size={18} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 space-y-4">
                    {error && (
                        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                            {error}
                        </div>
                    )}

                    {hasCritAAsset && (
                        <div className="p-3 bg-orange-500/10 border border-orange-500/30 rounded-lg text-orange-400 text-xs font-medium">
                            ⚠️ Linked to Criticality A asset — part auto-flagged as safety-critical stock.
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wider">Part Number *</label>
                            <input value={partNumber} onChange={e => setPartNumber(e.target.value)} className={fld} placeholder="BRG-6205-2RS" />
                        </div>
                        <div>
                            <label className="block text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wider">Category</label>
                            <select value={category} onChange={e => setCategory(e.target.value as InventoryItem['category'])} className={fld}>
                                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wider">Description *</label>
                        <input value={description} onChange={e => setDescription(e.target.value)} className={fld} placeholder="DE Ball Bearing 6205-2RS" />
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                        <div>
                            <label className="block text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wider">ABC Class</label>
                            <select value={abcClass} onChange={e => setAbcClass(e.target.value as any)} className={fld}>
                                {ABC_CLASSES.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wider">Unit Cost ($)</label>
                            <input type="number" min={0} step="0.01" value={unitCost} onChange={e => setUnitCost(Number(e.target.value))} className={fld} />
                        </div>
                        <div>
                            <label className="block text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wider">Qty On Hand</label>
                            <input type="number" min={0} value={qtyOnHand} onChange={e => setQtyOnHand(Number(e.target.value))} className={fld} />
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                        <div>
                            <label className="block text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wider">Min Qty</label>
                            <input type="number" min={0} value={minQty} onChange={e => setMinQty(Number(e.target.value))} className={fld} />
                        </div>
                        <div>
                            <label className="block text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wider">Max Qty</label>
                            <input type="number" min={0} value={maxQty} onChange={e => setMaxQty(Number(e.target.value))} className={fld} />
                        </div>
                        <div>
                            <label className="block text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wider">Reorder Point</label>
                            <input type="number" min={0} value={reorderPoint} onChange={e => setReorderPoint(Number(e.target.value))} className={fld} />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wider">Supplier</label>
                            <input value={supplierName} onChange={e => setSupplierName(e.target.value)} className={fld} placeholder="John Crane" />
                        </div>
                        <div>
                            <label className="block text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wider">Supplier P/N</label>
                            <input value={supplierPart} onChange={e => setSupplierPart(e.target.value)} className={fld} placeholder="JC-TC65-SS316" />
                        </div>
                    </div>

                    {/* Asset Linking Section */}
                    <div className="border-t border-slate-200 pt-4">
                        <AssetPartLink linkedAssetIds={linkedAssetIds} onChange={setLinkedAssetIds} />
                    </div>
                </div>

                {/* Footer */}
                <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200">
                    <button onClick={onClose} className="px-4 py-2 bg-slate-100 text-slate-600 rounded-lg text-sm hover:bg-slate-200 transition-colors">
                        Cancel
                    </button>
                    <button onClick={handleSubmit} className="flex items-center gap-2 px-5 py-2 bg-accent-cyan text-brand-900 font-bold rounded-lg text-sm hover:bg-cyan-400 transition-all shadow-[0_0_12px_rgba(6,182,212,0.15)]">
                        {isEdit ? <><Save size={14} /> Save Changes</> : <><Plus size={14} /> Create Item</>}
                    </button>
                </div>
            </div>
        </div>
    );
};
