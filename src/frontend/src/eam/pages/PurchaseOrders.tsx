
import React, { useState, useMemo, useEffect } from 'react';
import {
    Search, Plus, Filter, Save, ShoppingCart, Truck, FileText,
    CheckCircle, Settings, Users, Printer, Upload, Box,
    MoreHorizontal, DollarSign, X, ChevronRight, Clock, AlertTriangle, Briefcase, Trash2, Copy
} from 'lucide-react';
import {
    PurchaseOrder, POStatus, PurchaseOrderItem, Contact, Store, Vendor, InventoryItem
} from '../types';

type TabId = 'details' | 'items' | 'properties' | 'authorise';

import { DatabaseService } from '../services/DatabaseService';
import { NotificationService } from '../services/NotificationService';
import { ImageGallery } from '../components/ui/ImageGallery';
import { UnifiedDetailHeader } from '../components/ui/UnifiedDetailHeader';
import { UnifiedTabBar } from '../components/ui/UnifiedTabBar';
import { Badge, Button, type Tone } from '../components/ui';

// PO status → design-system tone (parallels getStatusColor for the new Badge primitive)
const poStatusTone = (status: string): Tone => {
    switch (status) {
        case 'OPEN': return 'info';
        case 'PART_RECEIVED': return 'warning';
        case 'ALL_RECEIVED': return 'success';
        case 'CANCELLED': return 'danger';
        case 'COMPLETED':
        case 'DRAFT':
        default: return 'neutral';
    }
};
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { ConfirmationModal } from '../components/modals/ConfirmationModal';

export const PurchaseOrders: React.FC = () => {
    const { user, profile, permissions } = useAuth();
    // ═══ RBAC Permission Extraction (ISO 27001 / NIST CSF) ═══
    const canCreate = permissions?.purchasing?.create === true;
    const canEdit = permissions?.purchasing?.edit === true;
    const canDelete = permissions?.purchasing?.delete === true;
    const canApprove = permissions?.purchasing?.approve === true;
    const { showToast } = useToast();
    const [orders, setOrders] = useState<PurchaseOrder[]>([]);
    const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);
    const [activeTab, setActiveTab] = useState<TabId>('details');
    const [searchTerm, setSearchTerm] = useState('');
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [inventoryLocations, setInventoryLocations] = useState<Store[]>([]);
    const [vendors, setVendors] = useState<Vendor[]>([]);
    const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
    const [workOrders, setWorkOrders] = useState<any[]>([]);
    // Confirmation modal state
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [showCompleteConfirm, setShowCompleteConfirm] = useState(false);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            const db = DatabaseService.getInstance();
            const [dbOrders, dbContacts, dbLocations, dbVendors, dbInventory, dbWorkOrders] = await Promise.all([
                db.getPurchaseOrders(),
                db.getContacts(),
                db.getInventoryLocations(),
                db.getVendors(),
                db.getInventory(),
                db.getWorkOrders()
            ]);

            setOrders(dbOrders);
            setContacts(dbContacts);
            setInventoryLocations(dbLocations);
            setVendors(dbVendors);
            setInventoryItems(dbInventory);
            setWorkOrders(dbWorkOrders);
        } catch (e) {
            console.error('Failed to load PO data:', e);
        }
    };

    const getSupplierName = (id: string) => {
        const contact = contacts.find(c => c.id === id);
        if (contact) return contact.name;
        const vendor = vendors.find(v => v.id === id);
        return vendor ? vendor.name : '';
    };

    const filteredOrders = useMemo(() => {
        return orders.filter(po => {
            const supplierName = getSupplierName(po.supplierId);
            const matchesSearch = po.poCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
                supplierName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                (po.supplierContactName || '').toLowerCase().includes(searchTerm.toLowerCase());
            return matchesSearch;
        });
    }, [orders, searchTerm, contacts, vendors]);

    const handleCreatePO = async () => {
        // ═══ RBAC Layer 2: Submit-level guard (ISO 27001 / NIST CSF) ═══
        if (!canCreate) {
            console.warn('[RBAC-AUDIT] BLOCKED: purchasing.create attempt by unauthorized user', profile?.username);
            showToast('Access Denied: You do not have permission to create purchase orders.', 'error');
            return;
        }
        const newPO: PurchaseOrder = {
            id: crypto.randomUUID(),
            poCode: `PO-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
            status: POStatus.DRAFT,
            supplierId: '',
            dateCreated: new Date().toISOString().split('T')[0],
            dateRequired: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
            taxInclusive: false,
            currency: 'USD',
            createdById: profile?.username || profile?.fullName || 'Unknown User',
            items: []
        };

        try {
            await DatabaseService.getInstance().createPurchaseOrder(newPO);
            setOrders([newPO, ...orders]);
            setSelectedPO(newPO);
            setActiveTab('details');

            // Notification hook-in: PO Created
            NotificationService.checkRules('purchasing', 'PO_CREATED', newPO, { currentUserId: user?.id || 'SYSTEM' });
        } catch (e: any) {
            showToast('Error creating PO: ' + e.message, 'error');
        }
    };

    const handleUpdatePO = async (updates: Partial<PurchaseOrder>) => {
        if (!selectedPO) return;
        const updated = { ...selectedPO, ...updates };
        setOrders(prev => prev.map(o => o.id === selectedPO.id ? updated : o));
        setSelectedPO(updated);
    };

    const handleSavePO = async () => {
        // ═══ RBAC Layer 2: Submit-level guard (ISO 27001 / NIST CSF) ═══
        if (!canEdit) {
            console.warn('[RBAC-AUDIT] BLOCKED: purchasing.edit attempt by unauthorized user', profile?.username);
            showToast('Access Denied: You do not have permission to edit purchase orders.', 'error');
            return;
        }
        if (!selectedPO) return;
        try {
            await DatabaseService.getInstance().updatePurchaseOrder(selectedPO.id, selectedPO);
            showToast('Purchase Order saved successfully!', 'success');
        } catch (e: any) {
            showToast('Failed to save: ' + e.message, 'error');
        }
    };

    const handleDeletePO = async () => {
        // ═══ RBAC Layer 2: Submit-level guard (ISO 27001 / NIST CSF) ═══
        if (!canDelete) {
            console.warn('[RBAC-AUDIT] BLOCKED: purchasing.delete attempt by unauthorized user', profile?.username);
            showToast('Access Denied: You do not have permission to delete purchase orders.', 'error');
            return;
        }
        if (!selectedPO) return;
        setShowDeleteConfirm(true);
    };

    const confirmDeletePO = async () => {
        if (!selectedPO) return;
        setShowDeleteConfirm(false);
        try {
            await DatabaseService.getInstance().deletePurchaseOrder(selectedPO.id);
            setOrders(prev => prev.filter(o => o.id !== selectedPO.id));
            setSelectedPO(null);
            showToast('Purchase Order deleted.', 'success');
        } catch (e: any) {
            showToast('Failed to delete: ' + e.message, 'error');
        }
    };

    const handleDuplicatePO = async () => {
        // ═══ RBAC Layer 2: Submit-level guard (ISO 27001 / NIST CSF) ═══
        if (!canCreate) {
            console.warn('[RBAC-AUDIT] BLOCKED: purchasing.duplicate attempt by unauthorized user', profile?.username);
            showToast('Access Denied: You do not have permission to create purchase orders.', 'error');
            return;
        }
        if (!selectedPO) return;

        const duplicatedPO: PurchaseOrder = {
            ...selectedPO,
            id: crypto.randomUUID(),
            poCode: `PO-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
            status: POStatus.DRAFT,
            dateCreated: new Date().toISOString().split('T')[0],
            dateFinished: undefined,
            authorizedById: undefined,
            items: selectedPO.items.map(item => ({
                ...item,
                id: `pi-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                qtyReceivedTotal: 0,
                qtyReceivedNow: 0,
                invoiceMatched: false,
                invoiceNumber: undefined
            }))
        };

        try {
            await DatabaseService.getInstance().createPurchaseOrder(duplicatedPO);
            setOrders([duplicatedPO, ...orders]);
            setSelectedPO(duplicatedPO);
            showToast(`Duplicated as ${duplicatedPO.poCode}`, 'success');
        } catch (e: any) {
            showToast('Failed to duplicate: ' + e.message, 'error');
        }
    };

    const handleCompletePO = () => {
        // ═══ RBAC Layer 2: Submit-level guard (ISO 27001 / NIST CSF) ═══
        if (!canApprove) {
            console.warn('[RBAC-AUDIT] BLOCKED: purchasing.complete attempt by unauthorized user', profile?.username);
            showToast('Access Denied: You do not have permission to complete purchase orders.', 'error');
            return;
        }
        if (!selectedPO) return;
        setShowCompleteConfirm(true);
    };

    const confirmCompletePO = () => {
        if (!selectedPO) return;
        setShowCompleteConfirm(false);
        handleUpdatePO({
            status: POStatus.COMPLETED,
            dateFinished: new Date().toISOString().split('T')[0]
        });
        showToast('Purchase Order marked as COMPLETED.', 'success');
    };

    const getStatusColor = (status: POStatus) => {
        switch (status) {
            case POStatus.DRAFT: return 'bg-slate-100 text-slate-600 border-slate-200';
            case POStatus.OPEN: return 'bg-blue-100 text-blue-700 border-blue-200';
            case POStatus.PART_RECEIVED: return 'bg-amber-100 text-amber-700 border-amber-200';
            case POStatus.ALL_RECEIVED: return 'bg-green-100 text-green-700 border-green-200';
            case POStatus.COMPLETED: return 'bg-slate-800 text-slate-100 border-slate-700';
            case POStatus.CANCELLED: return 'bg-red-100 text-red-700 border-red-200';
            default: return 'bg-slate-100 text-slate-600';
        }
    };

    // Calculate Totals
    const totalAmount = selectedPO?.items.reduce((sum, item) => sum + item.lineTotal, 0) || 0;

    return (
        <div className="flex h-[calc(100vh-6rem)] gap-6">
            {/* List Sidebar */}
            <div className={`flex flex-col bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden transition-all duration-300 ${selectedPO ? 'w-1/3 hidden lg:flex' : 'w-full'}`}>
                <div className="p-4 border-b border-slate-200 flex justify-between items-center">
                    <h2 className="font-bold text-slate-900">Purchase Orders</h2>
                    <Button
                        onClick={handleCreatePO}
                        disabled={!canCreate}
                        size="sm"
                        leftIcon={<Plus size={16} />}
                        className="hidden sm:inline-flex"
                        title={!canCreate ? 'Insufficient permissions' : 'Create new purchase order'}
                    >
                        New PO
                    </Button>
                </div>

                <div className="p-4 border-b border-slate-200 bg-slate-50 flex gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
                        <input
                            type="text"
                            placeholder="Search PO #, Supplier..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm"
                        />
                    </div>
                    <button className="p-2 border border-slate-300 rounded-lg bg-white text-slate-600 hover:bg-slate-50">
                        <Filter size={18} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {filteredOrders.map(po => {
                        const supplierName = getSupplierName(po.supplierId);
                        return (
                            <div
                                key={po.id}
                                onClick={() => { setSelectedPO(po); setActiveTab('details'); }}
                                className={`mobile-card ${selectedPO?.id === po.id ? 'bg-blue-50 border-l-4 border-l-blue-600' : ''}`}
                            >
                                <div className="flex justify-between items-start mb-0.5">
                                    <span className="font-mono text-xs font-bold text-slate-700">{po.poCode}</span>
                                    <Badge tone={poStatusTone(po.status)} dot>{po.status.replace('_', ' ')}</Badge>
                                </div>
                                <h3 className="text-sm font-bold text-slate-900 mb-1 line-clamp-1">{supplierName || 'Unknown Supplier'}</h3>
                                <div className="flex justify-between items-center text-[11px] text-slate-500">
                                    <span>Req: {po.dateRequired}</span>
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-slate-700">{po.items.length} Items</span>
                                        <span className="font-bold text-slate-800">${po.items.reduce((s, i) => s + i.lineTotal, 0).toFixed(0)}</span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Detail View */}
            {selectedPO && (
                <div className="flex-1 bg-white rounded-xl shadow-lg border border-slate-200 flex flex-col overflow-hidden">
                    {/* Mobile Back Button */}
                    <button
                        onClick={() => setSelectedPO(null)}
                        className="lg:hidden flex items-center gap-1.5 px-4 py-2.5 text-sm text-slate-600 border-b border-slate-100 hover:bg-slate-50 transition"
                    >
                        <X size={16} /> Back to list
                    </button>
                    {/* Header */}
                    <UnifiedDetailHeader
                        title={selectedPO.poCode}
                        subtitle={getSupplierName(selectedPO.supplierId) || 'Select Supplier'}
                        status={selectedPO.status.replace('_', ' ')}
                        statusClassName={getStatusColor(selectedPO.status)}
                        icon={<ShoppingCart size={20} className="text-blue-500" />}
                        onClose={() => setSelectedPO(null)}
                        actions={[
                            { label: 'Save', icon: <Save size={14} />, onClick: handleSavePO, variant: 'primary' as const },
                            { label: 'Duplicate', icon: <Copy size={14} />, onClick: handleDuplicatePO, variant: 'ghost' as const },
                            { label: 'Print', icon: <Printer size={14} />, onClick: () => {}, variant: 'ghost' as const },
                            ...(selectedPO.status !== POStatus.COMPLETED ? [{ label: 'Complete', icon: <CheckCircle size={14} />, onClick: handleCompletePO, variant: 'secondary' as const }] : []),
                            { label: 'Delete', icon: <Trash2 size={14} />, onClick: handleDeletePO, variant: 'danger' as const },
                        ]}
                    />

                    {/* Tabs */}
                    <UnifiedTabBar
                        tabs={[
                            { id: 'details', label: 'Details', icon: FileText },
                            { id: 'items', label: 'Items & Receiving', icon: Box },
                            { id: 'properties', label: 'Properties', icon: Settings },
                            { id: 'authorise', label: 'Authorise', icon: CheckCircle },
                        ]}
                        activeTab={activeTab}
                        onTabChange={(id) => setActiveTab(id as TabId)}
                    />

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto p-6 bg-slate-50/30">
                        {activeTab === 'details' && <DetailsTab po={selectedPO} onUpdate={handleUpdatePO} contacts={contacts} locations={inventoryLocations} vendors={vendors} />}
                        {activeTab === 'items' && <ItemsTab po={selectedPO} onUpdate={handleUpdatePO} inventoryItems={inventoryItems} workOrders={workOrders} />}
                        {activeTab === 'properties' && <PropertiesTab po={selectedPO} />}
                        {activeTab === 'authorise' && <AuthoriseTab po={selectedPO} onUpdate={handleUpdatePO} totalAmount={totalAmount} />}
                    </div>

                    {/* Footer Totals */}
                    <div className="p-4 border-t border-slate-200 bg-white flex flex-wrap justify-between items-center gap-4 text-sm mobile-footer-totals">
                        <div className="text-slate-500">
                            {selectedPO.items.length} Items
                        </div>
                        <div className="flex gap-6 items-center mobile-footer-totals">
                            <div className="text-right">
                                <span className="block text-xs text-slate-500 uppercase font-bold">Subtotal</span>
                                <span className="font-medium">${totalAmount.toFixed(2)}</span>
                            </div>
                            <div className="text-right">
                                <span className="block text-xs text-slate-500 uppercase font-bold">Tax</span>
                                <span className="font-medium">${(selectedPO.taxInclusive ? 0 : totalAmount * 0.1).toFixed(2)}</span>
                            </div>
                            <div className="text-right pl-6 border-l border-slate-200 footer-total-main">
                                <span className="block text-xs text-slate-500 uppercase font-bold">Total</span>
                                <span className="text-xl font-bold text-slate-900">${(totalAmount * 1.1).toFixed(2)}</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ═══ Mobile FAB — New PO (RBAC-gated, ≤640px only) ═══ */}
            {!selectedPO && canCreate && (
                <button
                    className="fab"
                    onClick={handleCreatePO}
                    aria-label="New Purchase Order"
                >
                    <Plus size={24} />
                </button>
            )}

            {/* GAP-04/21: Delete PO Confirmation */}
            <ConfirmationModal
                isOpen={showDeleteConfirm}
                onClose={() => setShowDeleteConfirm(false)}
                onConfirm={confirmDeletePO}
                title={`Delete ${selectedPO?.poCode}?`}
                message="This purchase order will be permanently deleted. This action cannot be undone."
                type="danger"
                confirmText="Delete PO"
            />

            {/* GAP-04/21: Complete PO Confirmation */}
            <ConfirmationModal
                isOpen={showCompleteConfirm}
                onClose={() => setShowCompleteConfirm(false)}
                onConfirm={confirmCompletePO}
                title="Complete Purchase Order?"
                message="This will finalize the purchase order and lock it from further changes."
                type="warning"
                confirmText="Complete PO"
            />
        </div>
    );
};

// --- Sub-Components ---

const DetailsTab: React.FC<{ po: PurchaseOrder, onUpdate: (u: Partial<PurchaseOrder>) => void, contacts: Contact[], locations: Store[], vendors: Vendor[] }> = ({ po, onUpdate, contacts, locations, vendors }) => {
    // Filter Vendors: Unified separate Vendors table and Contacts with Vendor flag
    const supplierOptions = useMemo(() => {
        const contactVendors = contacts.filter(c =>
            c.flags?.isVendor ||
            c.types.some(t => ['SUPPLIER', 'VENDOR'].includes(t.toUpperCase()))
        ).map(c => ({ id: c.id, name: c.name }));

        const dedicatedVendors = vendors.map(v => ({ id: v.id, name: v.name }));

        return [...dedicatedVendors, ...contactVendors];
    }, [contacts, vendors]);

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-in fade-in">
            {/* Supplier & Delivery */}
            <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm space-y-4">
                <h3 className="font-bold text-slate-800 border-b border-slate-100 pb-2 mb-4 flex items-center gap-2">
                    <Truck size={18} className="text-blue-600" /> Logistics
                </h3>

                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Supplier</label>
                    <select
                        value={po.supplierId}
                        onChange={(e) => onUpdate({ supplierId: e.target.value })}
                        className="w-full p-2 border border-slate-300 rounded-lg text-sm bg-white"
                    >
                        <option value="">-- Select Vendor --</option>
                        {supplierOptions.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                </div>

                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Attention To (Supplier)</label>
                    <input
                        type="text"
                        value={po.supplierContactName || ''}
                        onChange={(e) => onUpdate({ supplierContactName: e.target.value })}
                        className="w-full p-2 border border-slate-300 rounded-lg text-sm"
                        placeholder="Sales Rep Name"
                    />
                </div>

                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Delivery Location (Ship To)</label>
                    <select
                        value={po.deliveryContactId || ''}
                        onChange={(e) => onUpdate({ deliveryContactId: e.target.value })}
                        className="w-full p-2 border border-slate-300 rounded-lg text-sm bg-white"
                    >
                        <option value="">-- Select Location --</option>
                        {locations.map(l => <option key={l.id} value={l.id}>{l.name} {l.location ? ` - ${l.location}` : ''}</option>)}
                    </select>
                </div>

                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Invoice To</label>
                    <select
                        value={po.invoiceContactId || ''}
                        onChange={(e) => onUpdate({ invoiceContactId: e.target.value })}
                        className="w-full p-2 border border-slate-300 rounded-lg text-sm bg-white"
                    >
                        <option value="">-- Select Entity --</option>
                        {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                </div>
            </div>

            {/* Dates & Status */}
            <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm space-y-4">
                <h3 className="font-bold text-slate-800 border-b border-slate-100 pb-2 mb-4 flex items-center gap-2">
                    <Clock size={18} className="text-blue-600" /> Scheduling & Terms
                </h3>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Date Created</label>
                        <input type="date" value={po.dateCreated} disabled className="w-full p-2 border border-slate-300 rounded-lg text-sm bg-slate-50 text-slate-500" />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Date Required</label>
                        <input
                            type="date"
                            value={po.dateRequired}
                            onChange={(e) => onUpdate({ dateRequired: e.target.value })}
                            className="w-full p-2 border border-slate-300 rounded-lg text-sm bg-white"
                        />
                    </div>
                </div>

                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Date Finished</label>
                    <input type="date" value={po.dateFinished || ''} disabled className="w-full p-2 border border-slate-300 rounded-lg text-sm bg-slate-50 text-slate-500" placeholder="Open" />
                </div>

                <div className="pt-4 border-t border-slate-100">
                    <label className="flex items-center gap-3 p-3 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50">
                        <input
                            type="checkbox"
                            checked={po.taxInclusive}
                            onChange={(e) => onUpdate({ taxInclusive: e.target.checked })}
                            className="w-5 h-5 text-blue-600 rounded"
                        />
                        <div>
                            <div className="text-sm font-bold text-slate-800">Tax Inclusive Pricing</div>
                            <div className="text-xs text-slate-500">Unit costs include GST/VAT</div>
                        </div>
                    </label>
                </div>
            </div>
        </div>
    );
};

const ItemsTab: React.FC<{ po: PurchaseOrder, onUpdate: (u: Partial<PurchaseOrder>) => void, inventoryItems: InventoryItem[], workOrders: any[] }> = ({ po, onUpdate, inventoryItems, workOrders }) => {
    const { user, profile } = useAuth();
    const { showToast } = useToast();
    // Local state for the "Add Item" row
    const [newItem, setNewItem] = useState<Partial<PurchaseOrderItem>>({ qtyOrdered: 1, unitCost: 0 });
    const [importOpen, setImportOpen] = useState(false);
    const [deleteItemId, setDeleteItemId] = useState<string | null>(null);
    const [invoiceMatchId, setInvoiceMatchId] = useState<string | null>(null);
    const [invoiceInput, setInvoiceInput] = useState('');

    // Helper to calculate status based on items
    const calculateStatus = (items: PurchaseOrderItem[]): POStatus => {
        const totalOrdered = items.reduce((sum, i) => sum + i.qtyOrdered, 0);
        const totalReceived = items.reduce((sum, i) => sum + i.qtyReceivedTotal, 0);

        if (totalReceived === 0) return POStatus.OPEN;
        if (totalReceived >= totalOrdered) return POStatus.ALL_RECEIVED;
        return POStatus.PART_RECEIVED;
    };

    const handleAddItem = async () => {
        if (!newItem.description || !newItem.qtyOrdered) {
            showToast('Description and Quantity are required.', 'warning');
            return;
        }

        const item: PurchaseOrderItem = {
            id: `pi-${Date.now()}`,
            description: newItem.description,
            inventoryId: newItem.inventoryId,
            uom: newItem.uom || 'EA',
            qtyOrdered: newItem.qtyOrdered,
            qtyReceivedTotal: 0,
            unitCost: newItem.unitCost || 0,
            taxAmount: 0,
            lineTotal: (newItem.qtyOrdered) * (newItem.unitCost || 0),
            jobId: newItem.jobId,
            invoiceMatched: false
        };

        // F: Update qty_on_order on inventory_stock when adding PO line with linked inventory item
        if (item.inventoryId && po.deliveryContactId) {
            try {
                const db = DatabaseService.getInstance();
                const invItem = inventoryItems.find(i => i.id === item.inventoryId);
                const stockLoc = invItem?.stockLocations?.find((sl: any) => sl.id === po.deliveryContactId);
                const currentOnOrder = stockLoc?.qtyOnOrder || 0;
                // Increment qty_on_order via direct stock update
                await db.updateInventoryItem(item.inventoryId, {}, [{
                    id: po.deliveryContactId,
                    qtyOnHand: stockLoc?.qtyOnHand || 0,
                    minQty: stockLoc?.minQty || 0,
                    maxQty: stockLoc?.maxQty || 0,
                    reorderQty: stockLoc?.reorderQty || 0,
                    qtyOnOrder: currentOnOrder + item.qtyOrdered,
                    binLocation: stockLoc?.binLocation || ''
                }]);
            } catch (e: any) {
                console.warn('Could not update qty_on_order:', e.message);
            }
        }

        const updatedItems = [...po.items, item];
        onUpdate({ items: updatedItems, status: po.status === POStatus.DRAFT ? POStatus.OPEN : po.status });
        setNewItem({ qtyOrdered: 1, unitCost: 0, description: '', uom: 'EA' });
    };

    const handleReceiveItem = async (itemId: string) => {
        const targetItem = po.items.find(i => i.id === itemId);
        if (!targetItem || !targetItem.qtyReceivedNow || targetItem.qtyReceivedNow <= 0) return;

        const qtyReceiving = targetItem.qtyReceivedNow;

        // E: Update inventory stock when receiving items
        if (targetItem.inventoryId) {
            const deliveryLocationId = po.deliveryContactId;
            if (!deliveryLocationId) {
                showToast('Please set a Delivery Location on the Details tab before receiving items.', 'warning');
                return;
            }
            try {
                const db = DatabaseService.getInstance();
                // Find current stock at this location
                const invItem = inventoryItems.find(i => i.id === targetItem.inventoryId);
                const stockLoc = invItem?.stockLocations?.find((sl: any) => sl.id === deliveryLocationId);
                const currentQty = stockLoc?.qtyOnHand || 0;
                const currentOnOrder = stockLoc?.qtyOnOrder || 0;

                // Create RECEIPT transaction and increase stock
                await db.adjustInventoryStock(
                    targetItem.inventoryId,
                    deliveryLocationId,
                    currentQty + qtyReceiving,
                    'RECEIPT',
                    `PO Receipt: ${po.poCode} — ${targetItem.description}`,
                    profile?.username || profile?.fullName || 'Unknown User'
                );

                // Decrement qty_on_order
                if (currentOnOrder > 0) {
                    const newOnOrder = Math.max(0, currentOnOrder - qtyReceiving);
                    await db.updateInventoryItem(targetItem.inventoryId, {}, [{
                        id: deliveryLocationId,
                        qtyOnHand: currentQty + qtyReceiving,
                        minQty: stockLoc?.minQty || 0,
                        maxQty: stockLoc?.maxQty || 0,
                        reorderQty: stockLoc?.reorderQty || 0,
                        qtyOnOrder: newOnOrder,
                        binLocation: stockLoc?.binLocation || ''
                    }]);
                }
            } catch (e: any) {
                console.error('Stock update failed:', e.message);
                showToast('Item received but stock update failed: ' + e.message, 'warning');
            }
        }

        const updatedItems = po.items.map(i => {
            if (i.id === itemId) {
                return {
                    ...i,
                    qtyReceivedTotal: i.qtyReceivedTotal + qtyReceiving,
                    qtyReceivedNow: 0 // Reset "Receive Now" input
                };
            }
            return i;
        });

        const newStatus = calculateStatus(updatedItems);
        onUpdate({
            items: updatedItems,
            status: newStatus
        });

        // Notification hook-in: Goods Received
        NotificationService.checkRules('purchasing', 'PO_RECEIVED', {
            ...po,
            items: updatedItems,
            status: newStatus,
            receivedItemDescription: targetItem.description,
            qtyReceived: qtyReceiving
        }, { currentUserId: user?.id || 'SYSTEM' });
    };

    const handleItemChange = (id: string, field: keyof PurchaseOrderItem, value: any) => {
        const updatedItems = po.items.map(i => i.id === id ? { ...i, [field]: value } : i);
        onUpdate({ items: updatedItems });
    };

    const handleDeleteItem = (id: string) => {
        setDeleteItemId(id);
    };

    const confirmDeleteItem = () => {
        if (deleteItemId) {
            onUpdate({ items: po.items.filter(i => i.id !== deleteItemId) });
            setDeleteItemId(null);
        }
    };

    const handleInvoiceMatch = (id: string) => {
        setInvoiceMatchId(id);
        setInvoiceInput('');
    };

    const confirmInvoiceMatch = () => {
        if (invoiceMatchId && invoiceInput.trim()) {
            handleItemChange(invoiceMatchId, 'invoiceNumber', invoiceInput.trim());
            handleItemChange(invoiceMatchId, 'invoiceMatched', true);
            setInvoiceMatchId(null);
            setInvoiceInput('');
        }
    };

    return (
        <div className="flex flex-col h-full space-y-4">
            {/* Toolbar */}
            <div className="flex justify-between items-center bg-slate-50 p-3 rounded-lg border border-slate-200">
                <div className="text-sm font-bold text-slate-700">Line Items ({po.items.length})</div>
                <div className="flex gap-2">
                    <button
                        onClick={() => setImportOpen(true)}
                        className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 text-xs font-bold rounded hover:bg-slate-50 flex items-center gap-2"
                    >
                        <Upload size={14} /> Import CSV
                    </button>
                </div>
            </div>

            {/* Import Modal */}
            {importOpen && (
                <div className="absolute inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white p-6 rounded-xl shadow-xl w-96">
                        <h3 className="font-bold text-lg mb-4">Import Items</h3>
                        <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center text-slate-500 bg-slate-50 mb-4">
                            Drag CSV here or click to browse
                        </div>
                        <div className="flex justify-end gap-2">
                            <button onClick={() => setImportOpen(false)} className="px-4 py-2 text-slate-600">Cancel</button>
                            <button onClick={() => { showToast('Imported 5 items (Mock)', 'success'); setImportOpen(false); }} className="px-4 py-2 bg-primary-600 text-white rounded">Process</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Grid */}
            <div className="border border-slate-200 rounded-lg overflow-hidden flex-1 flex flex-col">
                <div className="overflow-auto flex-1 table-responsive">
                    <table className="min-w-full divide-y divide-slate-200">
                        <thead className="bg-slate-100 sticky top-0 z-10">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase w-12">#</th>
                                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase min-w-[200px]">Description</th>
                                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase w-32 hidden md:table-cell">Job Link</th>
                                <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase w-24">Order Qty</th>
                                <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase w-24">Cost</th>
                                <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase w-24 bg-blue-50 text-blue-800 border-l border-blue-200">Receive Now</th>
                                <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase w-24 bg-slate-50">Tot Rec</th>
                                <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase w-28">Total</th>
                                <th className="px-4 py-3 text-center text-xs font-bold text-slate-500 uppercase w-16">Action</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-slate-200">
                            {po.items.map((item, idx) => (
                                <tr key={item.id} className="hover:bg-slate-50 group">
                                    <td className="px-4 py-3 text-xs text-slate-500">{idx + 1}</td>
                                    <td className="px-4 py-3">
                                        {po.status === POStatus.DRAFT ? (
                                            <input
                                                type="text"
                                                value={item.description}
                                                onChange={(e) => handleItemChange(item.id, 'description', e.target.value)}
                                                className="w-full text-sm border-none bg-transparent focus:ring-0 p-0"
                                            />
                                        ) : (
                                            <div className="text-sm font-medium text-slate-900">{item.description}</div>
                                        )}
                                        <div className="text-[10px] text-slate-400">{item.uom}</div>
                                        {item.invoiceMatched && <div className="text-[10px] text-green-600 font-bold flex items-center gap-1 mt-1"><CheckCircle size={10} /> Invoice Matched: {item.invoiceNumber}</div>}
                                    </td>
                                    <td className="px-4 py-3 hidden md:table-cell">
                                        <select
                                            value={item.jobId || ''}
                                            onChange={(e) => handleItemChange(item.id, 'jobId', e.target.value)}
                                            className="w-full text-xs border border-slate-200 rounded bg-white p-1"
                                        >
                                            <option value="">None</option>
                                            {workOrders.map(wo => <option key={wo.id} value={wo.id}>{wo.wo_number || wo.id}</option>)}
                                        </select>
                                    </td>
                                    <td className="px-4 py-3 text-right text-sm">{item.qtyOrdered}</td>
                                    <td className="px-4 py-3 text-right text-sm">${item.unitCost.toFixed(2)}</td>

                                    {/* Receiving Input Column */}
                                    <td className="px-4 py-3 bg-blue-50 border-l border-blue-100">
                                        <div className="flex items-center gap-1">
                                            <input
                                                type="number"
                                                className="w-16 text-right text-sm border border-blue-300 rounded px-1 py-0.5 focus:ring-1 focus:ring-primary-500"
                                                value={item.qtyReceivedNow || ''}
                                                placeholder="0"
                                                onChange={(e) => handleItemChange(item.id, 'qtyReceivedNow', parseFloat(e.target.value))}
                                            />
                                            <button
                                                onClick={() => handleReceiveItem(item.id)}
                                                disabled={!item.qtyReceivedNow}
                                                className="text-blue-600 hover:text-blue-800 disabled:opacity-30"
                                                title="Save Receipt"
                                            >
                                                <Save size={16} />
                                            </button>
                                        </div>
                                    </td>

                                    <td className="px-4 py-3 text-right text-sm font-bold bg-slate-50 text-slate-700">{item.qtyReceivedTotal}</td>
                                    <td className="px-4 py-3 text-right text-sm font-medium">${item.lineTotal.toFixed(2)}</td>
                                    <td className="px-4 py-3 text-center relative group-hover:visible">
                                        <div className="flex justify-center gap-1">
                                            <button
                                                onClick={() => handleInvoiceMatch(item.id)}
                                                className="p-1 text-slate-400 hover:text-green-600"
                                                title="Invoice Match"
                                            >
                                                <DollarSign size={16} />
                                            </button>
                                            <button
                                                onClick={() => handleDeleteItem(item.id)}
                                                className="p-1 text-slate-400 hover:text-red-600"
                                                title="Delete Line"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}

                            {/* Add Item Row (Only in Draft/Open) */}
                            <tr className="bg-slate-50 border-t border-slate-200">
                                <td className="px-4 py-3 text-xs text-slate-400">+</td>
                                <td className="px-4 py-3">
                                    <div className="flex flex-col gap-1">
                                        <select
                                            className="text-xs border border-slate-300 rounded p-1 mb-1"
                                            onChange={(e) => {
                                                const inv = inventoryItems.find(i => i.id === e.target.value);
                                                if (inv) setNewItem({ ...newItem, inventoryId: inv.id, description: inv.description, unitCost: inv.itemCost, uom: inv.uom });
                                            }}
                                            value={newItem.inventoryId || ''}
                                        >
                                            <option value="">Select Inventory Item (Optional)</option>
                                            {inventoryItems.map(inv => <option key={inv.id} value={inv.id}>{inv.code} - {inv.description}</option>)}
                                        </select>
                                        <input
                                            type="text"
                                            placeholder="Description"
                                            className="w-full text-sm border border-slate-300 rounded p-1.5"
                                            value={newItem.description || ''}
                                            onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
                                        />
                                    </div>
                                </td>
                                <td className="px-4 py-3"></td>
                                <td className="px-4 py-3">
                                    <input type="number" className="w-full text-sm border border-slate-300 rounded p-1.5 text-right" placeholder="Qty" value={newItem.qtyOrdered} onChange={(e) => setNewItem({ ...newItem, qtyOrdered: parseFloat(e.target.value) })} />
                                </td>
                                <td className="px-4 py-3">
                                    <input type="number" className="w-full text-sm border border-slate-300 rounded p-1.5 text-right" placeholder="Cost" value={newItem.unitCost} onChange={(e) => setNewItem({ ...newItem, unitCost: parseFloat(e.target.value) })} />
                                </td>
                                <td colSpan={3} className="px-4 py-3"></td>
                                <td className="px-4 py-3 text-center">
                                    <button onClick={handleAddItem} className="bg-primary-600 text-white p-1.5 rounded hover:bg-primary-500"><Plus size={16} /></button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

const PropertiesTab: React.FC<{ po: PurchaseOrder }> = ({ po }) => (
    <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm space-y-6">
        <div>
            <h3 className="font-bold text-slate-800 border-b border-slate-100 pb-2 mb-4">Audit Trail</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase">Created By</label>
                    <div className="mt-1">{po.createdById} on {po.dateCreated}</div>
                </div>
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase">Last Printed</label>
                    <div className="mt-1">-</div>
                </div>
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase">Authorised By</label>
                    <div className="mt-1">{po.authorizedById || 'Pending'}</div>
                </div>
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase">Requested By</label>
                    <div className="mt-1">{po.requestedBy}</div>
                </div>
            </div>
        </div>
        <div>
            <h3 className="font-bold text-slate-800 border-b border-slate-100 pb-2 mb-4">Reference</h3>
            <div className="space-y-4">
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Reference No</label>
                    <input type="text" defaultValue={po.reference} className="w-full p-2 border border-slate-300 rounded-lg text-sm" />
                </div>
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Comments</label>
                    <textarea defaultValue={po.comments} className="w-full h-32 p-2 border border-slate-300 rounded-lg text-sm resize-none" placeholder="Internal notes..." />
                </div>
            </div>
        </div>

        {/* PO Photos & Evidence */}
        <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm">
            <ImageGallery
                entityId={po.id}
                entityType="PURCHASE_ORDER"
                bucket="assets"
                prefix="po_"
                readonly={po.status === POStatus.COMPLETED || po.status === POStatus.CANCELLED}
            />
        </div>
    </div>
);

const AuthoriseTab: React.FC<{ po: PurchaseOrder, onUpdate: (u: Partial<PurchaseOrder>) => void, totalAmount: number }> = ({ po, onUpdate, totalAmount }) => {
    const { profile } = useAuth();
    const { showToast } = useToast();
    // Mock user permission check
    const canAuthorise = true;
    const isAuthorized = !!po.authorizedById;

    return (
        <div className="flex flex-col items-center justify-center h-full space-y-6 p-12">
            <div className={`p-6 rounded-full ${isAuthorized ? 'bg-green-100 text-green-600' : 'bg-slate-100 text-slate-400'}`}>
                <CheckCircle size={64} />
            </div>

            <div className="text-center space-y-2">
                <h3 className="text-xl font-bold text-slate-900">
                    {isAuthorized ? 'Purchase Order Authorized' : 'Authorization Required'}
                </h3>
                <p className="text-slate-500 max-w-md">
                    {isAuthorized
                        ? `Authorized by ${po.authorizedById} on ${po.dateCreated}.`
                        : `This order requires approval. Total value $${totalAmount.toFixed(2)} exceeds auto-approval limit.`}
                </p>
            </div>

            {!isAuthorized && (
                <div className="flex gap-4">
                    <button
                        onClick={() => showToast('Notification sent to manager.', 'success')}
                        className="px-6 py-3 border border-slate-300 rounded-lg font-bold text-slate-700 hover:bg-slate-50"
                    >
                        Request Approval
                    </button>
                    {canAuthorise && (
                        <button
                            onClick={() => onUpdate({ authorizedById: profile?.username || profile?.fullName || 'Unknown User' })}
                            className="px-6 py-3 bg-primary-600 text-white rounded-lg font-bold hover:bg-primary-500 shadow-md"
                        >
                            Authorize Now
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};
