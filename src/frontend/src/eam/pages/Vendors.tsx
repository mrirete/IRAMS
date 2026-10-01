import React, { useState, useEffect } from 'react';
import {
    Search, Plus, Truck, Mail, Phone, MapPin, Globe, Save, Trash2, X, FileText, DollarSign,
    Calendar, Users, Building, Package, Upload, History, Receipt, Loader2
} from 'lucide-react';
import { getVendorHistory, VendorHistory } from '../services/vendorHistory';
import BulkImportModal from '../components/modals/BulkImportModal';
import { emptyResult, tally, errMessage } from '../services/importTypes';
import type { ImportType } from '../services/assetTemplates';
import { AskRelanternButton } from '../components/AskRelanternButton';
import { aiContextService } from '../services/AIContextService';
import { Vendor, DictionaryEntry } from '../types';
import { DatabaseService } from '../services/DatabaseService';
import { ConfirmationModal } from '../components/modals/ConfirmationModal';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { Button, Badge } from '../components/ui';

interface VendorsProps {
    onAnalyze?: (context: string) => void;
}

export const Vendors: React.FC<VendorsProps> = ({ onAnalyze }) => {
    const [vendors, setVendors] = useState<Vendor[]>([]);
    const { showToast } = useToast();
    const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);
    // What the open vendor looked like when opened / last saved: unsaved edits
    // were dropped without a word when another vendor or Back was clicked.
    const [savedSnapshot, setSavedSnapshot] = useState('');
    const confirm = useConfirm();
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    // Deep-linked from Admin › Migration Center (/vendors?action=import).
    const [isBulkImportOpen, setIsBulkImportOpen] = useState(
        new URLSearchParams(window.location.search).get('action') === 'import'
    );
    const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; vendorId: string | null; vendorName: string | null }>({
        isOpen: false,
        vendorId: null,
        vendorName: null
    });
    const [vendorTypes, setVendorTypes] = useState<DictionaryEntry[]>([]);
    const [vendorModels, setVendorModels] = useState<any[]>([]);
    const [newModelCode, setNewModelCode] = useState('');
    const [newModelDesc, setNewModelDesc] = useState('');
    const [addingModel, setAddingModel] = useState(false);

    // Supplier history — the orders, receipts and invoices behind this vendor.
    const [history, setHistory] = useState<VendorHistory | null>(null);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyTab, setHistoryTab] = useState<'orders' | 'receipts' | 'invoices'>('orders');

    useEffect(() => {
        const id = selectedVendor?.id;
        if (!id) { setHistory(null); return; }
        let cancelled = false;
        setHistoryLoading(true);
        getVendorHistory(id)
            .then(h => { if (!cancelled) setHistory(h); })
            .catch(e => { if (!cancelled) setHistory({ purchaseOrders: [], goodsReceipts: [], invoices: [], warnings: [e?.message || 'History could not be read.'] }); })
            .finally(() => { if (!cancelled) setHistoryLoading(false); });
        return () => { cancelled = true; };
    }, [selectedVendor?.id]);

    const fmtDate = (d?: string | null) => d ? new Date(d).toLocaleDateString() : '—';
    const fmtMoney = (n: number, ccy?: string | null) =>
        `${ccy || selectedVendor?.currency || 'USD'} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const matchTone = (s: string): 'success' | 'danger' | 'warning' | 'neutral' =>
        s === 'MATCHED' ? 'success' : s === 'BLOCKED' ? 'danger' : s === 'VARIANCE' ? 'warning' : 'neutral';

    useEffect(() => {
        loadData();
        // Load vendor types from dictionary
        DatabaseService.getInstance().getDictionaries().then(dicts => {
            setVendorTypes(dicts.filter(d => d.type === 'VENDOR_TYPE' && d.active));
        });
    }, []);

    // Load models when a MANUFACTURER vendor is selected
    useEffect(() => {
        if (selectedVendor && (selectedVendor.type === 'MANUFACTURER' || selectedVendor.type === 'SUPPLIER')) {
            DatabaseService.getInstance().getVendorModels(selectedVendor.id).then(setVendorModels).catch(() => setVendorModels([]));
        } else {
            setVendorModels([]);
        }
        setNewModelCode('');
        setNewModelDesc('');
    }, [selectedVendor?.id, selectedVendor?.type]);

    const loadData = async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const db = DatabaseService.getInstance();
            const data = await db.getVendors({ throwOnError: true });
            setVendors(data);
        } catch (e: any) {
            console.error("Failed to load vendors", e);
            setLoadError(e?.message || 'The vendor list could not be loaded.');
        } finally {
            setLoading(false);
        }
    };

    const dirty = !!selectedVendor && JSON.stringify(selectedVendor) !== savedSnapshot;
    const selectVendor = async (v: Vendor | null) => {
        if (v?.id === selectedVendor?.id) return;
        if (dirty && !(await confirm(`Discard your unsaved changes to ${selectedVendor?.name || 'this vendor'}?`))) return;
        setSelectedVendor(v);
        setSavedSnapshot(v ? JSON.stringify(v) : '');
    };

    // Name-only directory rows (callers without vendors.view) have no code;
    // `v.code.toLowerCase()` threw on the first keystroke.
    const q = searchTerm.trim().toLowerCase();
    const shownVendors = vendors.filter(v => !q || [v.name, v.code, v.email, v.primaryContactName, v.type]
        .some(f => (f || '').toLowerCase().includes(q)));

    // Next free V-#### code (random V-0..999 collided).
    const nextVendorCode = () => {
        const max = vendors.reduce((m, v) => {
            const n = /^V-(\d+)$/i.exec(v.code || '');
            return n ? Math.max(m, parseInt(n[1], 10)) : m;
        }, 0);
        return `V-${String(max + 1).padStart(4, '0')}`;
    };

    type RateLine = { craft: string; regRate?: number; otRate?: number };
    const rateCard: RateLine[] = selectedVendor?.properties?.rateCard || [];
    const setRateCard = (next: RateLine[]) => selectedVendor && setSelectedVendor({
        ...selectedVendor, properties: { ...(selectedVendor.properties || {}), rateCard: next },
    });
    // Copy-on-write: the old handlers mutated the shared row, so the list's copy changed too.
    const updateRate = (idx: number, patch: Partial<RateLine>) => setRateCard(rateCard.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
    const ccy = selectedVendor?.currency || 'USD';

    const handleDeleteClick = (id: string, name: string) => {
        setDeleteModal({ isOpen: true, vendorId: id, vendorName: name });
    };

    const handleConfirmDelete = async () => {
        if (!deleteModal.vendorId) return;
        try {
            await DatabaseService.getInstance().deleteVendor(deleteModal.vendorId);
            setVendors(prev => prev.filter(v => v.id !== deleteModal.vendorId));
            if (selectedVendor?.id === deleteModal.vendorId) { setSelectedVendor(null); setSavedSnapshot(''); }
        } catch (e: any) {
            showToast('Delete failed: ' + e.message, 'error');
        } finally {
            setDeleteModal({ isOpen: false, vendorId: null, vendorName: null });
        }
    };

    const handleSave = async () => {
        if (!selectedVendor) return;
        try {
            await DatabaseService.getInstance().updateVendor(selectedVendor);
            setSavedSnapshot(JSON.stringify(selectedVendor));
            showToast('Vendor saved successfully.', 'success');
            loadData();
        } catch (e: any) {
            showToast('Save failed: ' + e.message, 'error');
        }
    };

    const handleAddModel = async () => {
        if (!selectedVendor || !newModelCode.trim()) return;
        setAddingModel(true);
        try {
            const model = await DatabaseService.getInstance().addVendorModel(selectedVendor.id, {
                code: newModelCode.trim(),
                description: newModelDesc.trim(),
                active: true
            });
            setVendorModels(prev => [...prev, { id: model.id, code: newModelCode.trim(), description: newModelDesc.trim(), active: true }]);
            setNewModelCode('');
            setNewModelDesc('');
        } catch (e: any) {
            showToast('Failed to add model: ' + e.message, 'error');
        } finally {
            setAddingModel(false);
        }
    };

    const handleDeleteModel = async (modelId: string) => {
        const model = vendorModels.find(m => m.id === modelId);
        if (!(await confirm(`Delete model ${model?.model_code || model?.code || ''}?`.replace(' ?', '?')))) return;
        try {
            await DatabaseService.getInstance().deleteVendorModel(modelId);
            setVendorModels(prev => prev.filter(m => m.id !== modelId));
        } catch (e: any) {
            showToast('Failed to delete model: ' + e.message, 'error');
        }
    };

    /** Bulk vendor import. vendors.code has no DB unique constraint, so the
     *  dedupe has to happen here or a re-run silently doubles the directory. */
    const handleBulkImportData = async (type: ImportType, rows: Record<string, string>[]) => {
        if (type !== 'vendor') return;
        const res = emptyResult();
        const existingCodes = new Set(vendors.map(v => (v.code || '').toUpperCase()));

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rowNo = Number(row.__row) || i + 2;
            const code = row['code'] || `V-${Date.now()}-${i}`;

            if (existingCodes.has(code.toUpperCase())) {
                tally(res, { row: rowNo, key: code, status: 'skipped', reason: 'Vendor code already exists' });
                continue;
            }

            try {
                await DatabaseService.getInstance().addVendor({
                    id: crypto.randomUUID(),
                    name: row['name'] || 'Imported Vendor',
                    code,
                    type: (row['category'] || 'SUPPLIER').toUpperCase(),
                    active: true,
                    email: row['email'] || '',
                    phone: row['phone'] || '',
                    contactPerson: row['contactperson'] || '',
                    paymentTerms: row['paymentterms'] || '',
                    currency: row['currency'] || 'USD',
                    address: { street: row['address'] || '', city: '', state: '', zip: '', country: '' },
                } as unknown as Vendor);
                existingCodes.add(code.toUpperCase());
                tally(res, { row: rowNo, key: code, status: 'inserted' });
            } catch (e: unknown) {
                tally(res, { row: rowNo, key: code, status: 'failed', reason: errMessage(e) });
            }
        }

        showToast(`Imported ${res.inserted} of ${rows.length} vendors`, res.failed === 0 ? 'success' : 'warning');
        loadData();
        return res;
    };

    return (
        <div className="ers-page-wide w-full flex h-full gap-6">
            {/* List View */}
            <div className={`${selectedVendor ? 'hidden lg:flex lg:w-1/3' : 'w-full flex'} flex-col bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden transition-all duration-300`}>
                <div className="p-4 border-b border-slate-100 bg-white flex flex-col gap-4">
                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                            <Truck className="text-blue-600" size={24} />
                            <h2 className="text-xl font-bold text-slate-900">Vendor Directory</h2>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                onClick={() => setIsBulkImportOpen(true)}
                                size="sm"
                                variant="secondary"
                                leftIcon={<Upload size={16} />}
                                className="hidden sm:inline-flex"
                            >
                                Import
                            </Button>
                            <Button
                                onClick={() => setIsAddModalOpen(true)}
                                size="sm"
                                leftIcon={<Plus size={16} />}
                                className="hidden sm:inline-flex"
                            >
                                Add Vendor
                            </Button>
                        </div>
                    </div>
                    <div className="relative">
                        <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
                        <input
                            type="text"
                            placeholder="Search vendors..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-1 focus:ring-primary-500 focus:outline-none"
                        />
                    </div>
                </div>

                {loadError && (
                    <div className="m-4 p-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-800 flex items-center justify-between gap-3">
                        <span>Vendors could not be loaded: {loadError}</span>
                        <button onClick={loadData} className="px-3 py-1 rounded-md bg-white border border-red-300 text-red-700 text-xs font-semibold hover:bg-red-100">Retry</button>
                    </div>
                )}
                {loading && !vendors.length && <div className="p-6 text-sm text-slate-400">Loading vendors...</div>}
                {!loading && !loadError && shownVendors.length === 0 && (
                    <div className="p-8 text-center text-sm text-slate-500">
                        {vendors.length === 0 ? 'No vendors yet. Add one or import your supplier list.' : `No vendors match "${searchTerm}".`}
                    </div>
                )}
                <div className="flex-1 overflow-auto table-responsive">
                    {/* ═══ Mobile Card View (≤640px) ═══ */}
                    <div className="mobile-cards">
                        {shownVendors
                            .map(vendor => (
                                <div
                                    key={vendor.id}
                                    className={`mobile-card-contact ${selectedVendor?.id === vendor.id ? 'bg-blue-50' : ''}`}
                                    onClick={() => selectVendor(vendor)}
                                >
                                    <div className={`mobile-card-contact-avatar ${vendor.type === 'MANUFACTURER' ? 'bg-blue-100 text-blue-600' : 'bg-green-100 text-green-600'}`}>
                                        {vendor.name.charAt(0)}
                                    </div>
                                    <div className="mobile-card-contact-body">
                                        <div className="mobile-card-contact-name">{vendor.name}</div>
                                        <div className="mobile-card-contact-sub">
                                            {vendor.code} · {vendor.email || vendor.phone || vendor.type}
                                        </div>
                                    </div>
                                    <div className="mobile-card-contact-badge">
                                        <Badge tone={vendor.type === 'MANUFACTURER' ? 'info' : 'success'}>
                                            {vendor.type === 'MANUFACTURER' ? 'MFR' : vendor.type === 'SUPPLIER' ? 'SUP' : 'VND'}
                                        </Badge>
                                    </div>
                                </div>
                            ))}
                    </div>

                    {/* ═══ Desktop Table View (≥640px) ═══ */}
                    <div className="desktop-table">
                    <table className="min-w-full divide-y divide-slate-200">
                        <thead className="bg-slate-50 sticky top-0">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase">Name</th>
                                <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase">Type</th>
                                <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase hidden sm:table-cell">Contact</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-slate-200">
                            {shownVendors
                                .map(vendor => (
                                    <tr
                                        key={vendor.id}
                                        onClick={() => selectVendor(vendor)}
                                        className={`cursor-pointer hover:bg-slate-50 ${selectedVendor?.id === vendor.id ? 'bg-blue-50' : ''}`}
                                    >
                                        <td className="px-6 py-4">
                                            <div className="text-sm font-medium text-slate-900">{vendor.name}</div>
                                            <div className="text-xs text-slate-500">{vendor.code}</div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <Badge tone={vendor.type === 'MANUFACTURER' ? 'info' : 'success'}>{vendor.type}</Badge>
                                        </td>
                                        <td className="px-6 py-4 text-sm text-slate-500 hidden sm:table-cell">
                                            <div>{vendor.phone || '-'}</div>
                                            <div>{vendor.email || '-'}</div>
                                        </td>
                                    </tr>
                                ))}
                        </tbody>
                    </table>
                    </div>
                </div>
            </div>

            {/* Detail View */}
            {selectedVendor && (
                <div className="w-full lg:w-2/3 bg-white rounded-xl shadow-lg border border-slate-200 flex flex-col overflow-hidden animate-in slide-in-from-right duration-300">
                    <div className="p-6 border-b border-slate-100 flex justify-between items-start bg-slate-50">
                        <div>
                            <h1 className="text-xl font-bold text-slate-900">{selectedVendor.name}</h1>
                            <div className="flex items-center gap-2 mt-1">
                                <span className="text-sm font-mono bg-slate-200 px-2 py-0.5 rounded text-slate-700">{selectedVendor.code}</span>
                                <span className="text-sm text-slate-500">{selectedVendor.type}</span>
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <AskRelanternButton
                                contextType="vendor"
                                contextSummary={`═══ VENDOR CONTEXT ═══\nVendor: ${selectedVendor.code} — ${selectedVendor.name}\nType: ${selectedVendor.type || 'N/A'} | Active: ${selectedVendor.active ? 'Yes' : 'No'}\nPayment Terms: ${selectedVendor.paymentTerms || 'N/A'} | Currency: ${selectedVendor.currency || 'USD'}\nHourly Rate: $${selectedVendor.hourlyRate || 0}/hr\nContact: ${selectedVendor.primaryContactName || 'N/A'} | Email: ${selectedVendor.email || 'N/A'}\nTotal Vendors in Directory: ${vendors.length}`}
                            />
                            <button onClick={() => selectVendor(null)} className="lg:hidden text-slate-400 hover:text-slate-600 p-1 flex items-center gap-1 text-sm">
                                <X size={18} /> Back
                            </button>
                            <Button onClick={handleSave} size="sm" leftIcon={<Save size={16} />}>
                                Save
                            </Button>
                            <button onClick={() => handleDeleteClick(selectedVendor.id, selectedVendor.name)} className="px-3 py-1.5 text-red-600 border border-red-200 rounded hover:bg-red-50 flex items-center gap-2 text-sm">
                                <Trash2 size={16} /> Delete
                            </button>
                            <button onClick={() => selectVendor(null)} className="hidden lg:block text-slate-400 hover:text-slate-600 ml-2">
                                <X size={20} />
                            </button>
                        </div>
                    </div>

                    <div className="p-6 overflow-y-auto space-y-6">
                        {/* General Info */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Vendor Name</label>
                                <input
                                    type="text"
                                    value={selectedVendor.name}
                                    onChange={e => setSelectedVendor({ ...selectedVendor, name: e.target.value })}
                                    className="w-full p-2 border border-slate-300 rounded text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Vendor Code</label>
                                <input
                                    type="text"
                                    value={selectedVendor.code}
                                    onChange={e => setSelectedVendor({ ...selectedVendor, code: e.target.value })}
                                    className="w-full p-2 border border-slate-300 rounded text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
                                <select
                                    value={selectedVendor.type}
                                    onChange={e => setSelectedVendor({ ...selectedVendor, type: e.target.value as any })}
                                    className="w-full p-2 border border-slate-300 rounded text-sm"
                                >
                                    {vendorTypes.length > 0 ? vendorTypes.map(vt => (
                                        <option key={vt.id} value={vt.code}>{vt.description}</option>
                                    )) : (
                                        <>
                                            <option value="VENDOR">Vendor</option>
                                            <option value="MANUFACTURER">Manufacturer</option>
                                            <option value="SUPPLIER">Supplier</option>
                                        </>
                                    )}
                                </select>
                            </div>
                        </div>

                        {/* Models Section — Only for MANUFACTURER type */}
                        {(selectedVendor.type === 'MANUFACTURER' || selectedVendor.type === 'SUPPLIER') && (
                            <>
                                <hr className="border-slate-100" />

                                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                                    <Package size={16} /> Equipment Models
                                </h3>
                                <p className="text-xs text-slate-500 -mt-4">
                                    Manage model numbers for this manufacturer. These will be available in the Asset Details model dropdown.
                                </p>

                                {/* Add Model Inline Form */}
                                <div className="flex flex-wrap items-end gap-3">
                                    <div className="flex-1">
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Model Code <span className="text-red-500">*</span></label>
                                        <input
                                            type="text"
                                            value={newModelCode}
                                            onChange={e => setNewModelCode(e.target.value)}
                                            placeholder="e.g. HPX-200, 1LA7-096"
                                            className="w-full p-2 border border-slate-300 rounded text-sm"
                                        />
                                    </div>
                                    <div className="flex-1">
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                                        <input
                                            type="text"
                                            value={newModelDesc}
                                            onChange={e => setNewModelDesc(e.target.value)}
                                            placeholder="e.g. High-Pressure Centrifugal Pump"
                                            className="w-full p-2 border border-slate-300 rounded text-sm"
                                        />
                                    </div>
                                    <button
                                        onClick={handleAddModel}
                                        disabled={addingModel || !newModelCode.trim()}
                                        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-primary-500 disabled:opacity-50 flex items-center gap-1 text-sm whitespace-nowrap"
                                    >
                                        <Plus size={14} /> {addingModel ? 'Adding...' : 'Add Model'}
                                    </button>
                                </div>

                                {/* Models Table */}
                                {vendorModels.length > 0 ? (
                                    <div className="border border-slate-200 rounded-lg overflow-hidden table-responsive">
                                        <table className="min-w-full divide-y divide-slate-200">
                                            <thead className="bg-slate-50">
                                                <tr>
                                                    <th className="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase">Model Code</th>
                                                    <th className="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase">Description</th>
                                                    <th className="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase">Status</th>
                                                    <th className="px-4 py-2 text-right text-xs font-bold text-slate-500 uppercase">Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100">
                                                {vendorModels.map(model => (
                                                    <tr key={model.id} className="hover:bg-slate-50">
                                                        <td className="px-4 py-2 text-sm font-mono font-medium text-slate-900">{model.code}</td>
                                                        <td className="px-4 py-2 text-sm text-slate-600">{model.description || '-'}</td>
                                                        <td className="px-4 py-2">
                                                            <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${model.active ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-500'}`}>
                                                                {model.active ? 'Active' : 'Inactive'}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-2 text-right">
                                                            <button
                                                                onClick={() => handleDeleteModel(model.id)}
                                                                className="text-red-500 hover:text-red-700 p-1"
                                                                title="Delete Model"
                                                            >
                                                                <Trash2 size={14} />
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    <div className="text-center py-6 text-slate-400 text-sm border border-dashed border-slate-200 rounded-lg">
                                        No models registered yet. Add a model above.
                                    </div>
                                )}
                            </>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                            <div className="flex items-center gap-2 mt-6">
                                <input
                                    type="checkbox"
                                    checked={selectedVendor.active}
                                    onChange={e => setSelectedVendor({ ...selectedVendor, active: e.target.checked })}
                                    className="h-4 w-4 text-blue-600 rounded"
                                />
                                <span className="text-sm text-slate-700">Active Status</span>
                            </div>
                        </div>

                        <hr className="border-slate-100" />

                        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                            <Building size={16} /> Contact & Address
                        </h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                                <div className="flex items-center gap-2 border border-slate-300 rounded px-2 bg-white">
                                    <Mail size={16} className="text-slate-400" />
                                    <input
                                        type="email"
                                        value={selectedVendor.email || ''}
                                        onChange={e => setSelectedVendor({ ...selectedVendor, email: e.target.value })}
                                        className="w-full p-2 text-sm outline-none border-none"
                                        placeholder="contact@vendor.com"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
                                <div className="flex items-center gap-2 border border-slate-300 rounded px-2 bg-white">
                                    <Phone size={16} className="text-slate-400" />
                                    <input
                                        type="tel"
                                        value={selectedVendor.phone || ''}
                                        onChange={e => setSelectedVendor({ ...selectedVendor, phone: e.target.value })}
                                        className="w-full p-2 text-sm outline-none border-none"
                                        placeholder="+1 555-0000"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Website</label>
                                <div className="flex items-center gap-2 border border-slate-300 rounded px-2 bg-white">
                                    <Globe size={16} className="text-slate-400" />
                                    <input
                                        type="url"
                                        value={selectedVendor.website || ''}
                                        onChange={e => setSelectedVendor({ ...selectedVendor, website: e.target.value })}
                                        className="w-full p-2 text-sm outline-none border-none"
                                        placeholder="https://vendor.com"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Primary Contact</label>
                                <div className="flex items-center gap-2 border border-slate-300 rounded px-2 bg-white">
                                    <Users size={16} className="text-slate-400" />
                                    <input
                                        type="text"
                                        value={selectedVendor.primaryContactName || ''}
                                        onChange={e => setSelectedVendor({ ...selectedVendor, primaryContactName: e.target.value })}
                                        className="w-full p-2 text-sm outline-none border-none"
                                        placeholder="John Salesman"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                            <div className="col-span-2">
                                <label className="block text-sm font-medium text-slate-700 mb-1">Address</label>
                                <div className="flex items-start gap-2 border border-slate-300 rounded px-2 bg-white">
                                    <MapPin size={16} className="text-slate-400 mt-2.5" />
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full p-2">
                                        <input
                                            placeholder="Street"
                                            className="col-span-2 p-1 border-b border-slate-100 outline-none text-sm"
                                            value={selectedVendor.address?.street || ''}
                                            onChange={e => setSelectedVendor({ ...selectedVendor, address: { ...selectedVendor.address!, street: e.target.value } })}
                                        />
                                        <input
                                            placeholder="City"
                                            className="p-1 border-b border-slate-100 outline-none text-sm"
                                            value={selectedVendor.address?.city || ''}
                                            onChange={e => setSelectedVendor({ ...selectedVendor, address: { ...selectedVendor.address!, city: e.target.value } })}
                                        />
                                        <input
                                            placeholder="State"
                                            className="p-1 border-b border-slate-100 outline-none text-sm"
                                            value={selectedVendor.address?.state || ''}
                                            onChange={e => setSelectedVendor({ ...selectedVendor, address: { ...selectedVendor.address!, state: e.target.value } })}
                                        />
                                        <input
                                            placeholder="Zip"
                                            className="p-1 border-b border-slate-100 outline-none text-sm"
                                            value={selectedVendor.address?.zip || ''}
                                            onChange={e => setSelectedVendor({ ...selectedVendor, address: { ...selectedVendor.address!, zip: e.target.value } })}
                                        />
                                        <input
                                            placeholder="Country"
                                            className="p-1 outline-none text-sm"
                                            value={selectedVendor.address?.country || ''}
                                            onChange={e => setSelectedVendor({ ...selectedVendor, address: { ...selectedVendor.address!, country: e.target.value } })}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <hr className="border-slate-100" />

                        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                            <DollarSign size={16} /> Financials
                        </h3>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Payment Terms</label>
                                <input
                                    type="text"
                                    value={selectedVendor.paymentTerms || ''}
                                    onChange={e => setSelectedVendor({ ...selectedVendor, paymentTerms: e.target.value })}
                                    className="w-full p-2 border border-slate-300 rounded text-sm"
                                    placeholder="Net 30"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Currency</label>
                                <input
                                    type="text"
                                    value={selectedVendor.currency || 'USD'}
                                    onChange={e => setSelectedVendor({ ...selectedVendor, currency: e.target.value })}
                                    className="w-full p-2 border border-slate-300 rounded text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Hourly Rate</label>
                                <input
                                    type="number"
                                    value={selectedVendor.hourlyRate || 0}
                                    onChange={e => setSelectedVendor({ ...selectedVendor, hourlyRate: parseFloat(e.target.value) })}
                                    className="w-full p-2 border border-slate-300 rounded text-sm"
                                />
                            </div>
                        </div>

                        <hr className="border-slate-100" />

                        {/* Supplier History — what has actually been bought from, received from and invoiced by this vendor */}
                        <div>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                                    <History size={16} /> Supplier History
                                    {historyLoading && <Loader2 size={14} className="animate-spin text-slate-400" />}
                                </h3>
                                <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
                                    {([
                                        { id: 'orders', label: 'Orders', n: history?.purchaseOrders.length ?? 0, icon: FileText },
                                        { id: 'receipts', label: 'Receipts', n: history?.goodsReceipts.length ?? 0, icon: Package },
                                        { id: 'invoices', label: 'Invoices', n: history?.invoices.length ?? 0, icon: Receipt },
                                    ] as const).map(t => (
                                        <button
                                            key={t.id}
                                            type="button"
                                            onClick={() => setHistoryTab(t.id)}
                                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition ${historyTab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                                        >
                                            <t.icon size={13} /> {t.label}
                                            <span className={`ml-0.5 px-1.5 rounded-full text-[10px] ${historyTab === t.id ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-600'}`}>{t.n}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {history && history.warnings.length > 0 && (
                                <div className="mt-3 p-2.5 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800 space-y-0.5">
                                    {history.warnings.map((w, i) => <div key={i}>{w}</div>)}
                                </div>
                            )}

                            <div className="mt-3 border border-slate-200 rounded-lg overflow-hidden">
                                {historyLoading && !history ? (
                                    <div className="py-8 text-center text-sm text-slate-400">Loading history…</div>
                                ) : historyTab === 'orders' ? (
                                    history && history.purchaseOrders.length > 0 ? (
                                        <div className="overflow-x-auto">
                                            <table className="min-w-full divide-y divide-slate-200 text-sm">
                                                <thead className="bg-slate-50">
                                                    <tr>
                                                        <th className="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase">PO</th>
                                                        <th className="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase">Status</th>
                                                        <th className="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase">Created</th>
                                                        <th className="px-4 py-2 text-right text-xs font-bold text-slate-500 uppercase">Lines</th>
                                                        <th className="px-4 py-2 text-right text-xs font-bold text-slate-500 uppercase">Total</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100 bg-white">
                                                    {history.purchaseOrders.map(po => (
                                                        <tr key={po.id} className="hover:bg-slate-50">
                                                            <td className="px-4 py-2 font-mono font-medium text-slate-900">{po.poCode}</td>
                                                            <td className="px-4 py-2"><Badge tone="neutral">{po.status}</Badge></td>
                                                            <td className="px-4 py-2 text-slate-600">{fmtDate(po.dateCreated)}</td>
                                                            <td className="px-4 py-2 text-right text-slate-600">{po.lineCount}</td>
                                                            <td className="px-4 py-2 text-right font-medium text-slate-900">{fmtMoney(po.total, po.currency)}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                                <tfoot className="bg-slate-50">
                                                    <tr>
                                                        <td colSpan={4} className="px-4 py-2 text-xs font-bold text-slate-500 uppercase text-right">Ordered to date</td>
                                                        <td className="px-4 py-2 text-right font-bold text-slate-900">
                                                            {fmtMoney(history.purchaseOrders.reduce((s, p) => s + p.total, 0))}
                                                        </td>
                                                    </tr>
                                                </tfoot>
                                            </table>
                                        </div>
                                    ) : (
                                        <div className="py-8 text-center text-sm text-slate-400">No purchase orders have been placed with this vendor.</div>
                                    )
                                ) : historyTab === 'receipts' ? (
                                    history && history.goodsReceipts.length > 0 ? (
                                        <div className="overflow-x-auto">
                                            <table className="min-w-full divide-y divide-slate-200 text-sm">
                                                <thead className="bg-slate-50">
                                                    <tr>
                                                        <th className="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase">GRN</th>
                                                        <th className="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase">PO</th>
                                                        <th className="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase">Received</th>
                                                        <th className="px-4 py-2 text-right text-xs font-bold text-slate-500 uppercase">Qty</th>
                                                        <th className="px-4 py-2 text-right text-xs font-bold text-slate-500 uppercase">Value</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100 bg-white">
                                                    {history.goodsReceipts.map(gr => (
                                                        <tr key={gr.id} className="hover:bg-slate-50">
                                                            <td className="px-4 py-2 font-mono font-medium text-slate-900">{gr.grnNumber}</td>
                                                            <td className="px-4 py-2 font-mono text-slate-600">{gr.poCode || '—'}</td>
                                                            <td className="px-4 py-2 text-slate-600">{fmtDate(gr.receivedDate)}</td>
                                                            <td className="px-4 py-2 text-right text-slate-600">{gr.quantity.toLocaleString()}</td>
                                                            <td className="px-4 py-2 text-right font-medium text-slate-900">{fmtMoney(gr.totalCost)}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    ) : (
                                        <div className="py-8 text-center text-sm text-slate-400">
                                            {history && history.purchaseOrders.length > 0
                                                ? 'Nothing has been received against this vendor\'s orders yet.'
                                                : 'No goods receipts — nothing has been ordered from this vendor.'}
                                        </div>
                                    )
                                ) : (
                                    history && history.invoices.length > 0 ? (
                                        <div className="overflow-x-auto">
                                            <table className="min-w-full divide-y divide-slate-200 text-sm">
                                                <thead className="bg-slate-50">
                                                    <tr>
                                                        <th className="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase">Invoice</th>
                                                        <th className="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase">PO</th>
                                                        <th className="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase">Date</th>
                                                        <th className="px-4 py-2 text-right text-xs font-bold text-slate-500 uppercase">Amount</th>
                                                        <th className="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase">Match</th>
                                                        <th className="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase">Payables</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100 bg-white">
                                                    {history.invoices.map(inv => (
                                                        <tr key={inv.id} className="hover:bg-slate-50">
                                                            <td className="px-4 py-2 font-mono font-medium text-slate-900">{inv.invoiceNumber}</td>
                                                            <td className="px-4 py-2 font-mono text-slate-600">{inv.poCode || '—'}</td>
                                                            <td className="px-4 py-2 text-slate-600">{fmtDate(inv.invoiceDate)}</td>
                                                            <td className="px-4 py-2 text-right font-medium text-slate-900">{fmtMoney(inv.invoiceAmount, inv.currency)}</td>
                                                            <td className="px-4 py-2"><Badge tone={matchTone(inv.matchStatus)}>{inv.matchStatus}</Badge></td>
                                                            <td className="px-4 py-2 text-slate-600">{inv.payablesStatus}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    ) : (
                                        <div className="py-8 text-center text-sm text-slate-400">No invoices have been entered for this vendor.</div>
                                    )
                                )}
                            </div>
                        </div>

                        {/* Contractor rates: saved with the vendor (contact_details.rateCard) */}
                        {selectedVendor.type !== 'MANUFACTURER' && (
                        <div className="border-t border-slate-100 pt-6 mt-6">
                            <h4 className="text-sm font-bold text-slate-800 mb-1 flex items-center gap-2">
                                <Users size={16} className="text-blue-600" />
                                Contractor rates
                            </h4>
                            <p className="text-xs text-slate-500 mb-4">
                                Agreed hourly rates per craft, kept on this vendor as the reference for costing contractor work. Saved with the vendor.
                            </p>
                            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-4">
                                <div className="overflow-x-auto">
                                    <table className="min-w-full divide-y divide-slate-200 text-xs">
                                        <thead className="bg-slate-100">
                                            <tr>
                                                <th className="px-4 py-2.5 text-left font-bold text-slate-600 uppercase">Craft / specialty</th>
                                                <th className="px-4 py-2.5 text-right font-bold text-slate-600 uppercase">Regular ({ccy}/h)</th>
                                                <th className="px-4 py-2.5 text-right font-bold text-slate-600 uppercase">Overtime ({ccy}/h)</th>
                                                <th className="px-4 py-2.5 w-16"><span className="sr-only">Remove</span></th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 bg-white">
                                            {rateCard.map((line, idx) => (
                                                <tr key={idx}>
                                                    <td className="px-4 py-2">
                                                        <input
                                                            type="text"
                                                            value={line.craft}
                                                            onChange={(e) => updateRate(idx, { craft: e.target.value })}
                                                            placeholder="e.g. Mechanical technician"
                                                            className="w-full bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 outline-none py-0.5"
                                                        />
                                                    </td>
                                                    <td className="px-4 py-2 text-right">
                                                        <input
                                                            type="number" inputMode="decimal" min={0}
                                                            value={line.regRate ?? ''}
                                                            onChange={(e) => updateRate(idx, { regRate: e.target.value === '' ? undefined : Number(e.target.value) })}
                                                            className="w-24 text-right bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 outline-none py-0.5"
                                                        />
                                                    </td>
                                                    <td className="px-4 py-2 text-right">
                                                        <input
                                                            type="number" inputMode="decimal" min={0}
                                                            value={line.otRate ?? ''}
                                                            onChange={(e) => updateRate(idx, { otRate: e.target.value === '' ? undefined : Number(e.target.value) })}
                                                            className="w-24 text-right bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 outline-none py-0.5"
                                                        />
                                                    </td>
                                                    <td className="px-4 py-2 text-center">
                                                        <button onClick={() => setRateCard(rateCard.filter((_, i) => i !== idx))} className="text-red-500 hover:text-red-700 font-medium">
                                                            Remove
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                            {rateCard.length === 0 && (
                                                <tr>
                                                    <td colSpan={4} className="px-4 py-4 text-center text-slate-400">No contractor rates recorded for this vendor.</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                                <button
                                    onClick={() => setRateCard([...rateCard, { craft: '' }])}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-bold transition-all border border-blue-200"
                                >
                                    <Plus size={14} /> Add craft line
                                </button>
                            </div>
                        </div>
                        )}


                    </div>
                </div>
            )}

            {/* Add Modal */}
            {isAddModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-xl shadow-xl max-w-lg w-full overflow-hidden modal-responsive">
                        <div className="p-6">
                            <h3 className="text-lg font-bold text-slate-900 mb-4">Add New Vendor</h3>
                            <form onSubmit={async (e) => {
                                e.preventDefault();
                                if (creating) return;
                                const formData = new FormData(e.currentTarget);
                                const name = String(formData.get('name') || '').trim();
                                const code = String(formData.get('code') || '').trim() || nextVendorCode();
                                // vendors.code has no unique constraint; check here like the bulk import does.
                                const clash = vendors.find(v => (v.code || '').toLowerCase() === code.toLowerCase() || v.name.trim().toLowerCase() === name.toLowerCase());
                                if (clash) { showToast(`${clash.name} (${clash.code || 'no code'}) already exists.`, 'warning'); return; }
                                const newVendor: Vendor = {
                                    id: crypto.randomUUID(),
                                    name,
                                    code,
                                    type: formData.get('type') as any,
                                    active: true,
                                    email: formData.get('email') as string,
                                    phone: formData.get('phone') as string,
                                    address: { street: '', city: '', state: '', zip: '', country: '' }
                                };
                                setCreating(true);
                                try {
                                    const created = await DatabaseService.getInstance().addVendor(newVendor);
                                    await loadData();
                                    setIsAddModalOpen(false);
                                    setSelectedVendor(created);
                                    setSavedSnapshot(JSON.stringify(created));
                                    showToast(`${created.name} created.`, 'success');
                                } catch (err: any) { showToast(err.message, 'error'); }
                                finally { setCreating(false); }
                            }}>
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700">Name</label>
                                        <input name="name" required className="w-full p-2 border border-slate-300 rounded" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700">Code</label>
                                        <input name="code" placeholder={nextVendorCode()} className="w-full p-2 border border-slate-300 rounded font-mono" />
                                        <p className="mt-1 text-xs text-slate-500">Leave blank to use {nextVendorCode()}.</p>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700">Type</label>
                                        <select name="type" className="w-full p-2 border border-slate-300 rounded">
                                            {vendorTypes.length > 0 ? vendorTypes.map(vt => (
                                                <option key={vt.id} value={vt.code}>{vt.description}</option>
                                            )) : (
                                                <>
                                                    <option value="VENDOR">Vendor</option>
                                                    <option value="MANUFACTURER">Manufacturer</option>
                                                    <option value="SUPPLIER">Supplier</option>
                                                </>
                                            )}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700">Email</label>
                                        <input name="email" type="email" className="w-full p-2 border border-slate-300 rounded" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700">Phone</label>
                                        <input name="phone" type="tel" className="w-full p-2 border border-slate-300 rounded" />
                                    </div>
                                </div>
                                <div className="mt-6 flex justify-end gap-2">
                                    <button type="button" onClick={() => setIsAddModalOpen(false)} className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded">Cancel</button>
                                    <button type="submit" disabled={creating} className="px-4 py-2 bg-primary-600 text-white rounded hover:bg-primary-500 disabled:opacity-50">{creating ? 'Creating...' : 'Create Vendor'}</button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}

            <ConfirmationModal
                isOpen={deleteModal.isOpen}
                onClose={() => setDeleteModal({ isOpen: false, vendorId: null, vendorName: null })}
                onConfirm={handleConfirmDelete}
                title="Delete Vendor"
                message={`Are you sure you want to delete ${deleteModal.vendorName}? This action cannot be undone.`}
                type="danger"
                confirmText="Delete Vendor"
            />

            {/* Bulk vendor import — the supplier master a CMMS migration brings along */}
            <BulkImportModal
                isOpen={isBulkImportOpen}
                onClose={() => setIsBulkImportOpen(false)}
                preSelectedType="vendor"
                allowedTypes={['vendor']}
                onImportData={handleBulkImportData}
            />

            {/* ═══ Mobile FAB — Add Vendor (≤640px only) ═══ */}
            {!selectedVendor && (
                <button
                    className="fab"
                    onClick={() => setIsAddModalOpen(true)}
                    aria-label="Add Vendor"
                >
                    <Plus size={24} />
                </button>
            )}
        </div>
    );
};
