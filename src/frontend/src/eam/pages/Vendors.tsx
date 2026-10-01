import React, { useState, useEffect, useRef } from 'react';
import {
    Search, Plus, Truck, Mail, Phone, MapPin, Globe, Trash2, X, FileText, DollarSign,
    Users, Building, Package, Upload, History, Receipt, Loader2, MoreVertical, ChevronLeft,
    ArrowUp, ArrowDown, Info
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
import { Button, Badge, Modal, Tabs, cn } from '../components/ui';
import type { Tone } from '../components/ui';

interface VendorsProps {
    onAnalyze?: (context: string) => void;
}

// A directory of thousands renders 100 rows at a time.
const PAGE = 100;

// Common ISO 4217 codes. A vendor already holding another code keeps it as an option.
const CURRENCIES = [
    'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'CHF', 'JPY', 'CNY', 'HKD', 'SGD', 'INR',
    'AED', 'SAR', 'QAR', 'ZAR', 'NGN', 'GHS', 'KES', 'EGP', 'BRL', 'MXN', 'CLP', 'COP',
    'PEN', 'IDR', 'MYR', 'PHP', 'THB', 'KRW', 'TRY', 'PLN', 'SEK', 'NOK', 'DKK',
];
let ccyNames: Intl.DisplayNames | null = null;
try { ccyNames = new Intl.DisplayNames(undefined, { type: 'currency' }); } catch { /* engine without DisplayNames */ }
const currencyName = (code: string) => {
    try { return ccyNames?.of(code) ?? code; } catch { return code; }
};

// Used until the VENDOR_TYPE dictionary loads, or for a code it no longer lists.
const TYPE_FALLBACK: Record<string, string> = { VENDOR: 'Vendor', MANUFACTURER: 'Manufacturer', SUPPLIER: 'Supplier' };
const typeTone = (t?: string): Tone => (t === 'MANUFACTURER' ? 'info' : t === 'SUPPLIER' ? 'success' : 'purple');

const FIELD_LABEL = 'block text-xs font-semibold text-slate-600 mb-1';
const FIELD_INPUT = 'w-full px-3 py-2 min-h-[44px] md:min-h-0 border border-slate-300 rounded-lg text-sm bg-white focus:ring-1 focus:ring-primary-500 focus:outline-none';
const ICON_INPUT = 'flex items-center gap-2 border border-slate-300 rounded-lg px-2 bg-white focus-within:ring-1 focus-within:ring-primary-500';
const SECTION_TITLE = 'text-xs font-bold text-slate-500 uppercase tracking-wide flex items-center gap-2 mb-3';

type MenuItem = { label: string; icon: React.ReactNode; onClick: () => void; danger?: boolean };

/** Kebab menu — keeps rare or destructive actions off the resting screen. */
const OverflowMenu: React.FC<{ items: MenuItem[]; label: string; className?: string }> = ({ items, label, className }) => {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent | TouchEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('touchstart', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('touchstart', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);
    return (
        <div ref={ref} className={cn('relative', className)}>
            <button
                type="button"
                aria-label={label}
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen(o => !o)}
                className="inline-flex items-center justify-center w-11 h-11 md:w-8 md:h-8 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            >
                <MoreVertical size={18} />
            </button>
            {open && (
                <div role="menu" className="absolute right-0 top-full mt-1 z-30 min-w-[180px] bg-white rounded-lg border border-slate-200 shadow-lg py-1">
                    {items.map(it => (
                        <button
                            key={it.label}
                            type="button"
                            role="menuitem"
                            onClick={() => { setOpen(false); it.onClick(); }}
                            className={cn(
                                'w-full flex items-center gap-2 px-3 min-h-[44px] md:min-h-[36px] text-sm text-left hover:bg-slate-50',
                                it.danger ? 'text-red-600' : 'text-slate-700'
                            )}
                        >
                            {it.icon}{it.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

type SortKey = 'name' | 'code' | 'type';
type StatusFilter = 'active' | 'inactive' | 'all';
type DetailTab = 'details' | 'models' | 'rates' | 'history';

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
    const [saving, setSaving] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'name', dir: 1 });
    const [typeFilter, setTypeFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
    const [limit, setLimit] = useState(PAGE);
    const [detailTab, setDetailTab] = useState<DetailTab>('details');
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
    const [isAddModelOpen, setIsAddModelOpen] = useState(false);

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
        setDetailTab('details');
    };
    const discardChanges = () => { if (savedSnapshot) setSelectedVendor(JSON.parse(savedSnapshot)); };

    const typeLabel = (code?: string | null) =>
        (code && (vendorTypes.find(t => t.code === code)?.description || TYPE_FALLBACK[code])) || code || '—';
    // Name-only directory rows may carry no `active`; treat them as active.
    const isActive = (v: Vendor) => v.active !== false;

    // Name-only directory rows (callers without vendors.view) have no code;
    // `v.code.toLowerCase()` threw on the first keystroke.
    const q = searchTerm.trim().toLowerCase();
    const filteredVendors = vendors
        .filter(v => statusFilter === 'all' || (statusFilter === 'active') === isActive(v))
        .filter(v => !typeFilter || v.type === typeFilter)
        .filter(v => !q || [v.name, v.code, v.email, v.primaryContactName, v.type, typeLabel(v.type)]
            .some(f => (f || '').toLowerCase().includes(q)))
        .sort((a, b) => {
            const pick = (v: Vendor) => (sort.key === 'type' ? typeLabel(v.type) : v[sort.key]) || '';
            return (pick(a).localeCompare(pick(b), undefined, { numeric: true, sensitivity: 'base' })
                || (a.name || '').localeCompare(b.name || '')) * sort.dir;
        });
    const shownVendors = filteredVendors.slice(0, limit);
    const inactiveCount = vendors.filter(v => !isActive(v)).length;
    // Chips for the types actually in the directory, in dictionary order.
    const typeChips = [
        ...vendorTypes.map(t => t.code),
        ...vendors.map(v => v.type).filter(t => t && !vendorTypes.some(d => d.code === t)),
    ].filter((t, i, all) => all.indexOf(t) === i && vendors.some(v => v.type === t));
    const filtersOn = !!q || !!typeFilter || statusFilter !== 'active';

    const toggleSort = (key: SortKey) => { setSort(s => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : 1 })); setLimit(PAGE); };
    const sortIcon = (key: SortKey) => sort.key !== key ? null : sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />;
    const sortTh = (k: SortKey, label: string) => (
        <th key={k} className="px-4 py-2 text-left" aria-sort={sort.key === k ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
            <button type="button" onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 uppercase hover:text-slate-800">
                {label}{sortIcon(k)}
            </button>
        </th>
    );

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
    const currencyOptions = CURRENCIES.includes(ccy) ? CURRENCIES : [ccy, ...CURRENCIES];

    // Orders in different currencies cannot be added together; total each one.
    // GRNs carry no currency of their own — they are valued at their order's.
    const orderedByCcy = Object.entries((history?.purchaseOrders || []).reduce<Record<string, number>>((m, p) => {
        const c = p.currency || ccy;
        m[c] = (m[c] || 0) + p.total;
        return m;
    }, {}));
    const poCurrency = new Map((history?.purchaseOrders || []).map(p => [p.id, p.currency]));

    const showModels = selectedVendor?.type === 'MANUFACTURER' || selectedVendor?.type === 'SUPPLIER';
    const showRates = !!selectedVendor && selectedVendor.type !== 'MANUFACTURER';
    const activeTab: DetailTab =
        (detailTab === 'models' && !showModels) || (detailTab === 'rates' && !showRates) ? 'details' : detailTab;
    const modelOwner = selectedVendor?.type === 'MANUFACTURER' ? 'manufacturer' : 'supplier';

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
        if (!selectedVendor || saving) return;
        setSaving(true);
        try {
            await DatabaseService.getInstance().updateVendor(selectedVendor);
            setSavedSnapshot(JSON.stringify(selectedVendor));
            showToast('Vendor saved successfully.', 'success');
            loadData();
        } catch (e: any) {
            showToast('Save failed: ' + e.message, 'error');
        } finally {
            setSaving(false);
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
            setIsAddModelOpen(false);
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

    const chip = (on: boolean) => cn(
        'inline-flex items-center gap-1 px-2.5 min-h-[36px] md:min-h-[28px] rounded-full border text-xs font-medium whitespace-nowrap transition-colors',
        on ? 'bg-primary-50 border-primary-300 text-primary-700' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
    );

    return (
        <div className="ers-page-wide w-full flex h-full gap-4">
            {/* List View */}
            <div className={cn(
                'flex-col bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden',
                selectedVendor ? 'hidden lg:flex lg:w-72 xl:w-80 flex-shrink-0' : 'w-full flex'
            )}>
                <div className="p-4 border-b border-slate-100 bg-white flex flex-col gap-3">
                    <div className="flex justify-between items-center gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                            <Truck className="text-blue-600 flex-shrink-0" size={selectedVendor ? 20 : 24} />
                            <h2 className={cn('font-bold text-slate-900 truncate', selectedVendor ? 'text-base' : 'text-xl')}>Vendor Directory</h2>
                        </div>
                        {!selectedVendor && (
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
                                {/* Phones: header buttons are hidden, so Import lives here with Add. */}
                                <OverflowMenu
                                    label="Vendor actions"
                                    className="sm:hidden"
                                    items={[
                                        { label: 'Add vendor', icon: <Plus size={16} />, onClick: () => setIsAddModalOpen(true) },
                                        { label: 'Import vendors', icon: <Upload size={16} />, onClick: () => setIsBulkImportOpen(true) },
                                    ]}
                                />
                            </div>
                        )}
                    </div>
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                        <input
                            type="text"
                            placeholder="Search vendors..."
                            value={searchTerm}
                            onChange={(e) => { setSearchTerm(e.target.value); setLimit(PAGE); }}
                            className="w-full pl-9 pr-3 py-2 min-h-[44px] md:min-h-0 border border-slate-300 rounded-lg text-sm focus:ring-1 focus:ring-primary-500 focus:outline-none"
                        />
                    </div>
                    {(typeChips.length > 1 || inactiveCount > 0 || statusFilter !== 'active') && (
                        <div className="flex flex-wrap items-center gap-1.5">
                            {(inactiveCount > 0 || statusFilter !== 'active') && ([
                                ['active', 'Active'], ['inactive', `Inactive · ${inactiveCount}`], ['all', 'All'],
                            ] as const).map(([id, label]) => (
                                <button key={id} type="button" aria-pressed={statusFilter === id} onClick={() => { setStatusFilter(id); setLimit(PAGE); }} className={chip(statusFilter === id)}>
                                    {label}
                                </button>
                            ))}
                            {typeChips.length > 1 && (inactiveCount > 0 || statusFilter !== 'active') && <span className="w-px h-4 bg-slate-200 mx-0.5" aria-hidden />}
                            {typeChips.length > 1 && typeChips.map(t => (
                                <button key={t} type="button" aria-pressed={typeFilter === t} onClick={() => { setTypeFilter(f => (f === t ? '' : t)); setLimit(PAGE); }} className={chip(typeFilter === t)}>
                                    {typeLabel(t)}
                                </button>
                            ))}
                        </div>
                    )}
                    {!loading && vendors.length > 0 && (
                        <div className="flex items-center justify-between text-xs text-slate-500">
                            <span>{filteredVendors.length.toLocaleString()} of {vendors.length.toLocaleString()} vendors</span>
                            {filtersOn && (
                                <button
                                    type="button"
                                    onClick={() => { setSearchTerm(''); setTypeFilter(''); setStatusFilter('active'); setLimit(PAGE); }}
                                    className="font-medium text-primary-600 hover:text-primary-700"
                                >
                                    Clear filters
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {loadError && (
                    <div className="m-4 p-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-800 flex items-center justify-between gap-3">
                        <span>Vendors could not be loaded: {loadError}</span>
                        <button onClick={loadData} className="px-3 py-1 rounded-md bg-white border border-red-300 text-red-700 text-xs font-semibold hover:bg-red-100">Retry</button>
                    </div>
                )}
                {loading && !vendors.length && <div className="p-6 text-sm text-slate-400">Loading vendors...</div>}
                {!loading && !loadError && filteredVendors.length === 0 && (
                    <div className="p-8 text-center text-sm text-slate-500">
                        {vendors.length === 0
                            ? 'No vendors yet. Add one or import your supplier list.'
                            : q ? `No vendors match "${searchTerm}".` : 'No vendors match these filters.'}
                    </div>
                )}
                <div className="flex-1 overflow-auto table-responsive">
                    {/* ═══ Mobile Card View (≤640px) ═══ */}
                    <div className="mobile-cards">
                        {shownVendors.map(vendor => (
                            <div
                                key={vendor.id}
                                className={cn('mobile-card-contact', selectedVendor?.id === vendor.id && 'bg-blue-50', !isActive(vendor) && 'opacity-60')}
                                onClick={() => selectVendor(vendor)}
                            >
                                <div className={`mobile-card-contact-avatar ${vendor.type === 'MANUFACTURER' ? 'bg-blue-100 text-blue-600' : 'bg-green-100 text-green-600'}`}>
                                    {vendor.name.charAt(0)}
                                </div>
                                <div className="mobile-card-contact-body">
                                    <div className="mobile-card-contact-name">{vendor.name}</div>
                                    <div className="mobile-card-contact-sub">
                                        {[vendor.code, vendor.email || vendor.phone].filter(Boolean).join(' · ')}
                                    </div>
                                </div>
                                <div className="mobile-card-contact-badge flex flex-col items-end gap-1">
                                    <Badge tone={typeTone(vendor.type)}>{typeLabel(vendor.type)}</Badge>
                                    {!isActive(vendor) && <Badge tone="neutral">Inactive</Badge>}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* ═══ Desktop (≥640px) ═══ */}
                    <div className="desktop-table">
                        {selectedVendor ? (
                            // Master–detail: one dense column so the detail pane gets the width.
                            <>
                                <div className="sticky top-0 z-10 flex items-center gap-3 px-3 py-1.5 bg-slate-50 border-b border-slate-200 text-[11px] text-slate-500">
                                    <span className="font-semibold uppercase">Sort</span>
                                    {(['name', 'code', 'type'] as const).map(k => (
                                        <button key={k} type="button" onClick={() => toggleSort(k)} className={cn('inline-flex items-center gap-0.5 capitalize hover:text-slate-800', sort.key === k && 'font-bold text-slate-800')}>
                                            {k}{sortIcon(k)}
                                        </button>
                                    ))}
                                </div>
                                <ul className="divide-y divide-slate-100">
                                    {shownVendors.map(vendor => (
                                        <li key={vendor.id}>
                                            <button
                                                type="button"
                                                onClick={() => selectVendor(vendor)}
                                                aria-current={selectedVendor.id === vendor.id}
                                                className={cn(
                                                    'w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-slate-50 border-l-2',
                                                    selectedVendor.id === vendor.id ? 'bg-blue-50 border-blue-600' : 'border-transparent',
                                                    !isActive(vendor) && 'opacity-60'
                                                )}
                                            >
                                                <span
                                                    className={cn('w-2 h-2 rounded-full flex-shrink-0', isActive(vendor) ? 'bg-emerald-500' : 'bg-slate-300')}
                                                    title={isActive(vendor) ? 'Active' : 'Inactive'}
                                                />
                                                <span className="min-w-0">
                                                    <span className="block text-sm font-medium text-slate-900 truncate">{vendor.name}</span>
                                                    <span className="block text-[11px] font-mono text-slate-500 truncate">{vendor.code || '—'}</span>
                                                </span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </>
                        ) : (
                            <table className="min-w-full divide-y divide-slate-200">
                                <thead className="bg-slate-50 sticky top-0 z-10">
                                    <tr>
                                        {sortTh('name', 'Name')}
                                        {sortTh('code', 'Code')}
                                        {sortTh('type', 'Type')}
                                        <th className="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase hidden md:table-cell">Contact</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-slate-100">
                                    {shownVendors.map(vendor => (
                                        <tr
                                            key={vendor.id}
                                            onClick={() => selectVendor(vendor)}
                                            className={cn('cursor-pointer hover:bg-slate-50', !isActive(vendor) && 'opacity-60')}
                                        >
                                            <td className="px-4 py-2.5">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm font-medium text-slate-900">{vendor.name}</span>
                                                    {!isActive(vendor) && <Badge tone="neutral">Inactive</Badge>}
                                                </div>
                                            </td>
                                            <td className="px-4 py-2.5 text-xs font-mono text-slate-600">{vendor.code || '—'}</td>
                                            <td className="px-4 py-2.5">
                                                <Badge tone={typeTone(vendor.type)}>{typeLabel(vendor.type)}</Badge>
                                            </td>
                                            <td className="px-4 py-2.5 text-xs text-slate-500 hidden md:table-cell">
                                                <div className="truncate max-w-[16rem]">{vendor.primaryContactName || vendor.email || '—'}</div>
                                                {vendor.phone && <div>{vendor.phone}</div>}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>

                    {filteredVendors.length > shownVendors.length && (
                        <div className="p-3 text-center border-t border-slate-100">
                            <button
                                type="button"
                                onClick={() => setLimit(l => l + PAGE)}
                                className="px-4 min-h-[44px] md:min-h-[32px] text-sm font-medium text-primary-600 hover:text-primary-700"
                            >
                                Show more ({(filteredVendors.length - shownVendors.length).toLocaleString()} left)
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Detail View */}
            {selectedVendor && (
                <div className="w-full lg:flex-1 min-w-0 bg-white rounded-xl shadow-lg border border-slate-200 flex flex-col overflow-hidden animate-in slide-in-from-right duration-300">
                    <div className="px-3 md:px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-start gap-2 flex-shrink-0">
                        <button
                            type="button"
                            onClick={() => selectVendor(null)}
                            aria-label="Back to vendors"
                            className="lg:hidden -ml-1 inline-flex items-center gap-1 min-h-[44px] min-w-[44px] px-1.5 text-sm font-medium text-primary-600 rounded-lg hover:bg-slate-100"
                        >
                            <ChevronLeft size={20} /> <span className="hidden sm:inline">Back</span>
                        </button>
                        <div className="min-w-0 flex-1 pt-1 lg:pt-0">
                            <h1 className="text-lg font-bold text-slate-900 truncate">{selectedVendor.name || 'Unnamed vendor'}</h1>
                            <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                <span className="text-xs font-mono bg-slate-200 px-1.5 py-0.5 rounded text-slate-700">{selectedVendor.code || 'no code'}</span>
                                <Badge tone={typeTone(selectedVendor.type)}>{typeLabel(selectedVendor.type)}</Badge>
                                <Badge tone={isActive(selectedVendor) ? 'success' : 'neutral'} dot>{isActive(selectedVendor) ? 'Active' : 'Inactive'}</Badge>
                            </div>
                            {(selectedVendor.primaryContactName || selectedVendor.email) && (
                                <div className="mt-1 text-xs text-slate-500 truncate">
                                    {selectedVendor.primaryContactName}
                                    {selectedVendor.primaryContactName && selectedVendor.email && ' · '}
                                    {selectedVendor.email && <a href={`mailto:${selectedVendor.email}`} className="text-primary-600 hover:underline">{selectedVendor.email}</a>}
                                </div>
                            )}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                            <AskRelanternButton
                                compact
                                className="min-h-[44px] min-w-[44px] md:min-h-[32px] md:min-w-[32px]"
                                contextType="vendor"
                                contextSummary={`═══ VENDOR CONTEXT ═══\nVendor: ${selectedVendor.code} — ${selectedVendor.name}\nType: ${typeLabel(selectedVendor.type)} | Active: ${selectedVendor.active ? 'Yes' : 'No'}\nPayment Terms: ${selectedVendor.paymentTerms || 'N/A'} | Currency: ${ccy}\nHourly Rate: ${ccy} ${selectedVendor.hourlyRate || 0}/hr\nContact: ${selectedVendor.primaryContactName || 'N/A'} | Email: ${selectedVendor.email || 'N/A'}\nTotal Vendors in Directory: ${vendors.length}`}
                            />
                            <OverflowMenu
                                label="More vendor actions"
                                items={[{
                                    label: 'Delete vendor', icon: <Trash2 size={16} />, danger: true,
                                    onClick: () => handleDeleteClick(selectedVendor.id, selectedVendor.name),
                                }]}
                            />
                            <button onClick={() => selectVendor(null)} aria-label="Close" className="hidden lg:inline-flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100">
                                <X size={18} />
                            </button>
                        </div>
                    </div>

                    <Tabs
                        activeTab={activeTab}
                        onTabChange={id => setDetailTab(id as DetailTab)}
                        tabs={[
                            { id: 'details', label: 'Details', icon: Building },
                            { id: 'models', label: 'Models', icon: Package, show: showModels, badge: vendorModels.length },
                            { id: 'rates', label: 'Rates', icon: Users, show: showRates, badge: rateCard.length },
                            { id: 'history', label: 'History', icon: History, badge: history?.purchaseOrders.length },
                        ]}
                    />

                    <div className="flex-1 overflow-y-auto p-4 md:p-5">
                        {activeTab === 'details' && (
                            <div className="space-y-6 max-w-3xl">
                                <section>
                                    <h3 className={SECTION_TITLE}><Info size={14} /> General</h3>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div>
                                            <label className={FIELD_LABEL}>Vendor name</label>
                                            <input
                                                type="text"
                                                value={selectedVendor.name}
                                                onChange={e => setSelectedVendor({ ...selectedVendor, name: e.target.value })}
                                                className={FIELD_INPUT}
                                            />
                                        </div>
                                        <div>
                                            <label className={FIELD_LABEL}>Vendor code</label>
                                            <input
                                                type="text"
                                                value={selectedVendor.code}
                                                onChange={e => setSelectedVendor({ ...selectedVendor, code: e.target.value })}
                                                className={cn(FIELD_INPUT, 'font-mono')}
                                            />
                                        </div>
                                        <div>
                                            <label className={FIELD_LABEL}>Type</label>
                                            <select
                                                value={selectedVendor.type}
                                                onChange={e => setSelectedVendor({ ...selectedVendor, type: e.target.value as any })}
                                                className={FIELD_INPUT}
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
                                        <label className="flex items-center gap-3 sm:mt-5 min-h-[44px] md:min-h-0 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={selectedVendor.active}
                                                onChange={e => setSelectedVendor({ ...selectedVendor, active: e.target.checked })}
                                                className="h-4 w-4 text-blue-600 rounded"
                                            />
                                            <span className="text-sm text-slate-700">
                                                Active
                                                <span className="block text-xs text-slate-400">Inactive vendors drop out of the default list.</span>
                                            </span>
                                        </label>
                                    </div>
                                </section>

                                <section>
                                    <h3 className={SECTION_TITLE}><Building size={14} /> Contact</h3>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div>
                                            <label className={FIELD_LABEL}>Email</label>
                                            <div className={ICON_INPUT}>
                                                <Mail size={16} className="text-slate-400" />
                                                <input
                                                    type="email"
                                                    value={selectedVendor.email || ''}
                                                    onChange={e => setSelectedVendor({ ...selectedVendor, email: e.target.value })}
                                                    className="w-full p-2 min-h-[42px] md:min-h-0 text-sm outline-none border-none"
                                                    placeholder="contact@vendor.com"
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className={FIELD_LABEL}>Phone</label>
                                            <div className={ICON_INPUT}>
                                                <Phone size={16} className="text-slate-400" />
                                                <input
                                                    type="tel"
                                                    value={selectedVendor.phone || ''}
                                                    onChange={e => setSelectedVendor({ ...selectedVendor, phone: e.target.value })}
                                                    className="w-full p-2 min-h-[42px] md:min-h-0 text-sm outline-none border-none"
                                                    placeholder="+1 555-0000"
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className={FIELD_LABEL}>Website</label>
                                            <div className={ICON_INPUT}>
                                                <Globe size={16} className="text-slate-400" />
                                                <input
                                                    type="url"
                                                    value={selectedVendor.website || ''}
                                                    onChange={e => setSelectedVendor({ ...selectedVendor, website: e.target.value })}
                                                    className="w-full p-2 min-h-[42px] md:min-h-0 text-sm outline-none border-none"
                                                    placeholder="https://vendor.com"
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className={FIELD_LABEL}>Primary contact</label>
                                            <div className={ICON_INPUT}>
                                                <Users size={16} className="text-slate-400" />
                                                <input
                                                    type="text"
                                                    value={selectedVendor.primaryContactName || ''}
                                                    onChange={e => setSelectedVendor({ ...selectedVendor, primaryContactName: e.target.value })}
                                                    className="w-full p-2 min-h-[42px] md:min-h-0 text-sm outline-none border-none"
                                                    placeholder="John Salesman"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </section>

                                <section>
                                    <h3 className={SECTION_TITLE}><MapPin size={14} /> Address</h3>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <input
                                            placeholder="Street"
                                            className={cn(FIELD_INPUT, 'sm:col-span-2')}
                                            value={selectedVendor.address?.street || ''}
                                            onChange={e => setSelectedVendor({ ...selectedVendor, address: { ...selectedVendor.address!, street: e.target.value } })}
                                        />
                                        <input
                                            placeholder="City"
                                            className={FIELD_INPUT}
                                            value={selectedVendor.address?.city || ''}
                                            onChange={e => setSelectedVendor({ ...selectedVendor, address: { ...selectedVendor.address!, city: e.target.value } })}
                                        />
                                        <input
                                            placeholder="State"
                                            className={FIELD_INPUT}
                                            value={selectedVendor.address?.state || ''}
                                            onChange={e => setSelectedVendor({ ...selectedVendor, address: { ...selectedVendor.address!, state: e.target.value } })}
                                        />
                                        <input
                                            placeholder="Zip"
                                            className={FIELD_INPUT}
                                            value={selectedVendor.address?.zip || ''}
                                            onChange={e => setSelectedVendor({ ...selectedVendor, address: { ...selectedVendor.address!, zip: e.target.value } })}
                                        />
                                        <input
                                            placeholder="Country"
                                            className={FIELD_INPUT}
                                            value={selectedVendor.address?.country || ''}
                                            onChange={e => setSelectedVendor({ ...selectedVendor, address: { ...selectedVendor.address!, country: e.target.value } })}
                                        />
                                    </div>
                                </section>

                                <section>
                                    <h3 className={SECTION_TITLE}><DollarSign size={14} /> Financials</h3>
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                        <div>
                                            <label className={FIELD_LABEL}>Payment terms</label>
                                            <input
                                                type="text"
                                                value={selectedVendor.paymentTerms || ''}
                                                onChange={e => setSelectedVendor({ ...selectedVendor, paymentTerms: e.target.value })}
                                                className={FIELD_INPUT}
                                                placeholder="Net 30"
                                            />
                                        </div>
                                        <div>
                                            <label className={FIELD_LABEL}>Currency</label>
                                            <select
                                                value={ccy}
                                                onChange={e => setSelectedVendor({ ...selectedVendor, currency: e.target.value })}
                                                className={FIELD_INPUT}
                                            >
                                                {currencyOptions.map(c => (
                                                    <option key={c} value={c}>{c} — {currencyName(c)}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className={FIELD_LABEL}>Hourly rate ({ccy}/h)</label>
                                            <input
                                                type="number"
                                                value={selectedVendor.hourlyRate || 0}
                                                onChange={e => setSelectedVendor({ ...selectedVendor, hourlyRate: parseFloat(e.target.value) })}
                                                className={FIELD_INPUT}
                                            />
                                        </div>
                                    </div>
                                </section>
                            </div>
                        )}

                        {activeTab === 'models' && (
                            <div className="space-y-3 max-w-3xl">
                                <div className="flex items-start justify-between gap-3">
                                    <p className="text-xs text-slate-500">
                                        {modelOwner === 'manufacturer'
                                            ? 'Model numbers made by this manufacturer.'
                                            : 'Model numbers this supplier carries.'}
                                        {' '}They appear in the Asset Details model dropdown.
                                    </p>
                                    <Button size="sm" variant="secondary" leftIcon={<Plus size={14} />} onClick={() => setIsAddModelOpen(true)} className="flex-shrink-0">
                                        Add model
                                    </Button>
                                </div>
                                {vendorModels.length > 0 ? (
                                    <ul className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                                        {vendorModels.map(model => (
                                            <li key={model.id} className="flex items-center gap-3 pl-3 pr-1 py-1.5 hover:bg-slate-50">
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-sm font-mono font-medium text-slate-900 truncate">{model.code}</div>
                                                    {model.description && <div className="text-xs text-slate-500 truncate">{model.description}</div>}
                                                </div>
                                                {!model.active && <Badge tone="neutral">Inactive</Badge>}
                                                <button
                                                    type="button"
                                                    onClick={() => handleDeleteModel(model.id)}
                                                    aria-label={`Delete model ${model.code}`}
                                                    className="inline-flex items-center justify-center w-11 h-11 md:w-8 md:h-8 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"
                                                >
                                                    <Trash2 size={15} />
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <div className="text-center py-8 text-slate-400 text-sm border border-dashed border-slate-200 rounded-lg">
                                        No models registered for this {modelOwner} yet.
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Contractor rates: saved with the vendor (contact_details.rateCard) */}
                        {activeTab === 'rates' && (
                            <div className="space-y-3 max-w-3xl">
                                <p className="text-xs text-slate-500">
                                    Agreed hourly rates per craft, kept on this vendor as the reference for costing contractor work. Saved with the vendor, in {ccy}.
                                </p>
                                <div className="border border-slate-200 rounded-lg overflow-x-auto">
                                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                                        <thead className="bg-slate-50">
                                            <tr>
                                                <th className="px-3 py-2 text-left text-xs font-bold text-slate-500 uppercase">Craft / specialty</th>
                                                <th className="px-3 py-2 text-right text-xs font-bold text-slate-500 uppercase whitespace-nowrap">Regular ({ccy}/h)</th>
                                                <th className="px-3 py-2 text-right text-xs font-bold text-slate-500 uppercase whitespace-nowrap">Overtime ({ccy}/h)</th>
                                                <th className="px-1 py-2 w-12"><span className="sr-only">Remove</span></th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 bg-white">
                                            {rateCard.map((line, idx) => (
                                                <tr key={idx}>
                                                    <td className="px-3 py-1.5">
                                                        <input
                                                            type="text"
                                                            value={line.craft}
                                                            onChange={(e) => updateRate(idx, { craft: e.target.value })}
                                                            placeholder="e.g. Mechanical technician"
                                                            className="w-full min-w-[10rem] min-h-[44px] md:min-h-0 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 outline-none py-1"
                                                        />
                                                    </td>
                                                    <td className="px-3 py-1.5 text-right">
                                                        <input
                                                            type="number" inputMode="decimal" min={0}
                                                            value={line.regRate ?? ''}
                                                            onChange={(e) => updateRate(idx, { regRate: e.target.value === '' ? undefined : Number(e.target.value) })}
                                                            className="w-24 min-h-[44px] md:min-h-0 text-right bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 outline-none py-1"
                                                        />
                                                    </td>
                                                    <td className="px-3 py-1.5 text-right">
                                                        <input
                                                            type="number" inputMode="decimal" min={0}
                                                            value={line.otRate ?? ''}
                                                            onChange={(e) => updateRate(idx, { otRate: e.target.value === '' ? undefined : Number(e.target.value) })}
                                                            className="w-24 min-h-[44px] md:min-h-0 text-right bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 outline-none py-1"
                                                        />
                                                    </td>
                                                    <td className="px-1 py-1 text-center">
                                                        <button
                                                            type="button"
                                                            onClick={() => setRateCard(rateCard.filter((_, i) => i !== idx))}
                                                            aria-label={`Remove ${line.craft || 'rate line'}`}
                                                            className="inline-flex items-center justify-center w-11 h-11 md:w-8 md:h-8 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"
                                                        >
                                                            <Trash2 size={15} />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                            {rateCard.length === 0 && (
                                                <tr>
                                                    <td colSpan={4} className="px-4 py-6 text-center text-slate-400">No contractor rates recorded for this vendor.</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                                <Button size="sm" variant="secondary" leftIcon={<Plus size={14} />} onClick={() => setRateCard([...rateCard, { craft: '' }])}>
                                    Add craft line
                                </Button>
                            </div>
                        )}

                        {/* Supplier History — what has actually been bought from, received from and invoiced by this vendor */}
                        {activeTab === 'history' && (
                            <div>
                                <div className="flex flex-wrap items-center justify-between gap-2">
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
                                                className={`flex items-center gap-1.5 px-3 min-h-[40px] md:min-h-[30px] rounded-md font-medium transition ${historyTab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                                            >
                                                <t.icon size={13} /> {t.label}
                                                <span className={`ml-0.5 px-1.5 rounded-full text-[10px] ${historyTab === t.id ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-600'}`}>{t.n}</span>
                                            </button>
                                        ))}
                                    </div>
                                    {historyLoading && <Loader2 size={14} className="animate-spin text-slate-400" />}
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
                                                                <td className="px-4 py-2 text-right font-medium text-slate-900 whitespace-nowrap">{fmtMoney(po.total, po.currency)}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                    <tfoot className="bg-slate-50">
                                                        {orderedByCcy.length > 1 && (
                                                            <tr>
                                                                <td colSpan={5} className="px-4 pt-2 text-xs text-slate-500 text-right">
                                                                    Mixed currencies — totalled per currency, not added together.
                                                                </td>
                                                            </tr>
                                                        )}
                                                        {orderedByCcy.map(([c, total], i) => (
                                                            <tr key={c}>
                                                                <td colSpan={4} className="px-4 py-2 text-xs font-bold text-slate-500 uppercase text-right">
                                                                    {i === 0 ? 'Ordered to date' : ''}
                                                                </td>
                                                                <td className="px-4 py-2 text-right font-bold text-slate-900 whitespace-nowrap">{fmtMoney(total, c)}</td>
                                                            </tr>
                                                        ))}
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
                                                                <td className="px-4 py-2 text-right font-medium text-slate-900 whitespace-nowrap">
                                                                    {fmtMoney(gr.totalCost, gr.poId ? poCurrency.get(gr.poId) : null)}
                                                                </td>
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
                                                                <td className="px-4 py-2 text-right font-medium text-slate-900 whitespace-nowrap">{fmtMoney(inv.invoiceAmount, inv.currency)}</td>
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
                        )}
                    </div>

                    {/* Save appears only when there is something to save. */}
                    {dirty && (
                        <div
                            className="flex items-center gap-2 px-4 py-2.5 border-t border-slate-200 bg-white flex-shrink-0 shadow-[0_-2px_8px_rgba(15,23,42,0.06)]"
                            style={{ paddingBottom: 'calc(0.625rem + env(safe-area-inset-bottom, 0px))' }}
                        >
                            <span className="flex-1 min-w-0 text-sm font-medium text-amber-700 truncate">Unsaved changes</span>
                            <Button variant="ghost" size="md" onClick={discardChanges} disabled={saving}>Discard</Button>
                            <Button size="md" onClick={handleSave} loading={saving}>Save</Button>
                        </div>
                    )}
                </div>
            )}

            {/* Add model — models save straight away, not with the vendor's Save. */}
            <Modal
                open={isAddModelOpen}
                onClose={() => { if (!addingModel) setIsAddModelOpen(false); }}
                title={`Add model${selectedVendor ? ` · ${selectedVendor.name}` : ''}`}
                size="sm"
                footer={(
                    <>
                        <Button variant="ghost" onClick={() => setIsAddModelOpen(false)} disabled={addingModel}>Cancel</Button>
                        <Button onClick={handleAddModel} loading={addingModel} disabled={!newModelCode.trim()}>Add model</Button>
                    </>
                )}
            >
                <form
                    className="space-y-4"
                    onSubmit={e => { e.preventDefault(); handleAddModel(); }}
                    // Enter submits from either field; the submit button sits in the Modal footer, outside the form.
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddModel(); } }}
                >
                    <div>
                        <label className={FIELD_LABEL}>Model code <span className="text-red-500">*</span></label>
                        <input
                            type="text"
                            autoFocus
                            value={newModelCode}
                            onChange={e => setNewModelCode(e.target.value)}
                            placeholder="e.g. HPX-200, 1LA7-096"
                            className={cn(FIELD_INPUT, 'font-mono')}
                        />
                    </div>
                    <div>
                        <label className={FIELD_LABEL}>Description</label>
                        <input
                            type="text"
                            value={newModelDesc}
                            onChange={e => setNewModelDesc(e.target.value)}
                            placeholder="e.g. High-Pressure Centrifugal Pump"
                            className={FIELD_INPUT}
                        />
                    </div>
                </form>
            </Modal>

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
                                    setDetailTab('details');
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
