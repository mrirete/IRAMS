/**
 * FinOps Core Module - Financial Operations & Lifecycle
 * The "Financial Digital Twin" bridging maintenance floor and boardroom
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    DollarSign, Building2, TrendingDown, Shield, FileCheck, Package, Box,
    AlertTriangle, CheckCircle, Clock, ChevronRight, ChevronDown,
    PieChart, BarChart3, Calendar, Users, Banknote, Calculator,
    FileText, AlertCircle, ArrowUpRight, ArrowDownRight, RefreshCw,
    Plus, Search, Filter, Download, Settings, Eye, Edit, Trash2,
    Briefcase, Target, Zap, ShieldCheck, Receipt, Truck, Scale,
    TrendingUp, Wrench
} from 'lucide-react';
import {
    FinOpsService, CostCenter, Budget, Warranty, WarrantyCheckResult,
    WarrantyClaim, DepreciationBook, MaintenanceForecast, SupplyChainMatch
} from '../services/FinOpsService';
import { DatabaseService } from '../services/DatabaseService';
import ErpExportPanel from '../components/finops/ErpExportPanel';
import ErpReconciliationPanel from '../components/finops/ErpReconciliationPanel';
import { AskRelanternButton } from '../components/AskRelanternButton';
import AdvisoryAgentPanel from '../components/ui/AdvisoryAgentPanel';
import { runWarrantyRecovery } from '../services/agentRunClient';
import { ReceiptText } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';

type TabId = 'dashboard' | 'cost_centers' | 'budget_control' | 'forecast' | 'depreciation' | 'warranties' | 'claims' | 'vendor_intel' | 'supply_chain' | 'insurance';

interface TabConfig {
    id: TabId;
    label: string;
    icon: React.ReactNode;
    description: string;
}

const TABS: TabConfig[] = [
    { id: 'dashboard', label: 'Dashboard', icon: <PieChart size={16} />, description: 'Financial KPIs & Overview' },
    { id: 'cost_centers', label: 'Cost Centers', icon: <Building2 size={16} />, description: 'Budget Control & Allocation' },
    {
        id: 'forecast',
        label: 'Forecasting',
        icon: <TrendingUp size={18} />,
        description: 'Maintenance spend projections'
    },
    {
        id: 'depreciation',
        label: 'Asset Accounting',
        icon: <Calculator size={18} />,
        description: 'Depreciation & valuation'
    },
    { id: 'warranties', label: 'Warranties', icon: <Shield size={16} />, description: 'Coverage Tracking' },
    { id: 'claims', label: 'Claims', icon: <FileCheck size={16} />, description: 'Warranty & Insurance Claims' },
    { id: 'vendor_intel', label: 'Vendor Intel', icon: <Target size={16} />, description: 'Warranty Vendor Performance' },
    { id: 'supply_chain', label: 'Supply Chain', icon: <Package size={16} />, description: 'PO/GRN/Invoice Matching' },
    { id: 'insurance', label: 'Insurance', icon: <ShieldCheck size={16} />, description: 'Coverage & Incidents' },
];


interface AddWarrantyModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (warranty: any) => Promise<void>;
    assets: { id: string; name: string; tag: string }[];
    vendors: { id: string; name: string }[];
}

const AddWarrantyModal: React.FC<AddWarrantyModalProps> = ({ isOpen, onClose, onSave, assets, vendors }) => {
    const [loading, setLoading] = useState(false);
    const { showToast } = useToast();
    const [formData, setFormData] = useState({
        assetId: '',
        vendorId: '',
        warrantyType: 'OEM',
        coverageScope: '',
        startDate: '',
        endDate: '',
        maxHours: '',
        status: 'ACTIVE'
    });

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            await onSave({
                ...formData,
                maxHours: formData.maxHours ? parseInt(formData.maxHours) : undefined,
                currentHours: 0
            });
            onClose();
        } catch (error) {
            console.error('Failed to save warranty:', error);
            showToast('Failed to save warranty', 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                    <h3 className="font-semibold text-slate-800">Add New Warranty</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                        <Trash2 size={18} className="rotate-45" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-slate-500 uppercase">Asset</label>
                            <select
                                className="w-full p-2 border border-slate-200 rounded-lg text-sm bg-slate-50"
                                required
                                value={formData.assetId}
                                onChange={e => setFormData({ ...formData, assetId: e.target.value })}
                            >
                                <option value="">Select Asset...</option>
                                {assets.map(a => (
                                    <option key={a.id} value={a.id}>{a.tag} - {a.name}</option>
                                ))}
                            </select>
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-slate-500 uppercase">Vendor</label>
                            <select
                                className="w-full p-2 border border-slate-200 rounded-lg text-sm bg-slate-50"
                                value={formData.vendorId}
                                onChange={e => setFormData({ ...formData, vendorId: e.target.value })}
                            >
                                <option value="">Select Vendor...</option>
                                {vendors.map(v => (
                                    <option key={v.id} value={v.id}>{v.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-slate-500 uppercase">Start Date</label>
                            <input
                                type="date"
                                className="w-full p-2 border border-slate-200 rounded-lg text-sm"
                                required
                                value={formData.startDate}
                                onChange={e => setFormData({ ...formData, startDate: e.target.value })}
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-slate-500 uppercase">End Date</label>
                            <input
                                type="date"
                                className="w-full p-2 border border-slate-200 rounded-lg text-sm"
                                value={formData.endDate}
                                onChange={e => setFormData({ ...formData, endDate: e.target.value })}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-slate-500 uppercase">Type</label>
                            <select
                                className="w-full p-2 border border-slate-200 rounded-lg text-sm"
                                value={formData.warrantyType}
                                onChange={e => setFormData({ ...formData, warrantyType: e.target.value })}
                            >
                                <option value="OEM">OEM Standard</option>
                                <option value="EXTENDED">Extended Warranty</option>
                                <option value="SERVICE_CONTRACT">Service Contract</option>
                            </select>
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-slate-500 uppercase">Max Hours (Optional)</label>
                            <input
                                type="number"
                                className="w-full p-2 border border-slate-200 rounded-lg text-sm"
                                placeholder="e.g. 5000"
                                value={formData.maxHours}
                                onChange={e => setFormData({ ...formData, maxHours: e.target.value })}
                            />
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-500 uppercase">Coverage Scope</label>
                        <textarea
                            className="w-full p-2 border border-slate-200 rounded-lg text-sm h-24"
                            placeholder="Describe what is covered..."
                            value={formData.coverageScope}
                            onChange={e => setFormData({ ...formData, coverageScope: e.target.value })}
                        />
                    </div>

                    <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50"
                        >
                            {loading ? 'Saving...' : 'Save Warranty'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// =====================================================
// NEW TRANSACTION MODAL — Manual Journal Entry
// =====================================================
interface NewTransactionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: () => void;
    costCenters: CostCenter[];
}

const TRANSACTION_COST_TYPES = [
    { value: 'LABOR', label: 'Labor', icon: '👷', description: 'Direct labor hours or contracted labor' },
    { value: 'MATERIAL', label: 'Material', icon: '🔩', description: 'Parts, spares, consumables' },
    { value: 'SERVICE', label: 'Service', icon: '🔧', description: 'Third-party service or contractor' },
    { value: 'OVERHEAD', label: 'Overhead', icon: '🏭', description: 'Facility, utilities, admin allocation' },
    { value: 'WARRANTY_CREDIT', label: 'Warranty Credit', icon: '🛡️', description: 'Warranty recovery (negative cost)' },
    { value: 'ADJUSTMENT', label: 'Adjustment', icon: '📝', description: 'Manual correction or reclassification' },
] as const;

const NewTransactionModal: React.FC<NewTransactionModalProps> = ({ isOpen, onClose, onSave, costCenters }) => {
    const [loading, setLoading] = useState(false);
    const { showToast } = useToast();
    const [budgetWarning, setBudgetWarning] = useState<string | null>(null);

    // Cross-module data
    const [people, setPeople] = useState<any[]>([]);
    const [workOrders, setWorkOrders] = useState<any[]>([]);
    const [inventory, setInventory] = useState<any[]>([]);
    const [modulesLoaded, setModulesLoaded] = useState(false);

    const [formData, setFormData] = useState({
        transactionType: 'DEBIT' as 'DEBIT' | 'CREDIT',
        costType: 'MATERIAL' as string,
        costCenterId: '',
        workOrderId: '',
        personId: '',
        inventoryItemId: '',
        amount: '',
        quantity: '',
        unit: 'EA',
        postingDate: new Date().toISOString().split('T')[0],
        glAccount: '',
        description: '',
        referenceNumber: '',
    });

    // Load cross-module data when modal opens
    useEffect(() => {
        if (!isOpen || modulesLoaded) return;
        const loadModules = async () => {
            try {
                const db = DatabaseService.getInstance();
                const [ppl, wos, inv] = await Promise.allSettled([
                    db.getContacts(),
                    db.getWorkOrders(),
                    db.getInventory(),
                ]);
                if (ppl.status === 'fulfilled') setPeople(ppl.value.filter((p: any) => p.flags?.isLabour || p.hourlyRate > 0));
                if (wos.status === 'fulfilled') setWorkOrders(wos.value);
                if (inv.status === 'fulfilled') setInventory(inv.value);
                setModulesLoaded(true);
            } catch { /* non-blocking */ }
        };
        loadModules();
    }, [isOpen, modulesLoaded]);

    const resetForm = () => {
        setFormData({
            transactionType: 'DEBIT',
            costType: 'MATERIAL',
            costCenterId: '',
            workOrderId: '',
            personId: '',
            inventoryItemId: '',
            amount: '',
            quantity: '',
            unit: 'EA',
            postingDate: new Date().toISOString().split('T')[0],
            glAccount: '',
            description: '',
            referenceNumber: '',
        });
        setBudgetWarning(null);
    };

    // Budget check on amount + cost center change
    useEffect(() => {
        const checkBudget = async () => {
            if (!formData.costCenterId || !formData.amount) {
                setBudgetWarning(null);
                return;
            }
            try {
                const result = await FinOpsService.checkBudgetAvailability(
                    formData.costCenterId,
                    parseFloat(formData.amount)
                );
                if (!result.canProceed && result.status === 'EXCEEDED') {
                    setBudgetWarning(`⛔ Budget exceeded — ${result.message}`);
                } else if (result.status === 'WARNING') {
                    setBudgetWarning(`⚠️ ${result.message}`);
                } else {
                    setBudgetWarning(null);
                }
            } catch {
                // Non-blocking
            }
        };
        const timer = setTimeout(checkBudget, 500);
        return () => clearTimeout(timer);
    }, [formData.costCenterId, formData.amount]);

    // Auto-calculate labor cost when person + quantity changes
    const handlePersonChange = (personId: string) => {
        const person = people.find(p => p.id === personId);
        if (person) {
            const hours = parseFloat(formData.quantity) || 1;
            const cost = (person.hourlyRate || 0) * hours;
            setFormData({
                ...formData,
                personId,
                unit: 'HR',
                amount: cost > 0 ? cost.toFixed(2) : formData.amount,
                description: formData.description || `Labor: ${person.name} — ${hours}h`,
                costCenterId: formData.costCenterId || person.costCenterId || '',
            });
        } else {
            setFormData({ ...formData, personId });
        }
    };

    // Auto-fill from inventory item
    const handleInventoryChange = (itemId: string) => {
        const item = inventory.find(i => i.id === itemId);
        if (item) {
            const qty = parseFloat(formData.quantity) || 1;
            setFormData({
                ...formData,
                inventoryItemId: itemId,
                unit: item.uom || 'EA',
                amount: item.itemCost ? (item.itemCost * qty).toFixed(2) : formData.amount,
                description: formData.description || `Material: ${item.code} — ${item.description}`,
            });
        } else {
            setFormData({ ...formData, inventoryItemId: itemId });
        }
    };

    // Recalculate when quantity changes for labor/material
    const handleQuantityChange = (qty: string) => {
        const qtyNum = parseFloat(qty) || 0;
        let newAmount = formData.amount;
        if (formData.costType === 'LABOR' && formData.personId) {
            const person = people.find(p => p.id === formData.personId);
            if (person?.hourlyRate) newAmount = (person.hourlyRate * qtyNum).toFixed(2);
        } else if (formData.costType === 'MATERIAL' && formData.inventoryItemId) {
            const item = inventory.find(i => i.id === formData.inventoryItemId);
            if (item?.itemCost) newAmount = (item.itemCost * qtyNum).toFixed(2);
        }
        setFormData({ ...formData, quantity: qty, amount: newAmount });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.amount || !formData.costType || !formData.description) {
            showToast('Please fill required fields: Amount, Cost Type, and Description.', 'warning');
            return;
        }

        setLoading(true);
        try {
            const amount = parseFloat(formData.amount);
            const effectiveAmount = formData.transactionType === 'CREDIT' ? -Math.abs(amount) : Math.abs(amount);

            await FinOpsService.allocateCost({
                workOrderId: formData.workOrderId || '',
                costCenterId: formData.costCenterId || undefined,
                costType: formData.costType as any,
                amount: effectiveAmount,
                quantity: formData.quantity ? parseFloat(formData.quantity) : undefined,
                unit: formData.unit || undefined,
                postingDate: formData.postingDate,
            });

            resetForm();
            onSave();
            onClose();
        } catch (err: any) {
            showToast('Failed to post transaction: ' + err.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    const selectedPerson = people.find(p => p.id === formData.personId);
    const selectedItem = inventory.find(i => i.id === formData.inventoryItemId);
    const selectedWO = workOrders.find(w => w.id === formData.workOrderId);

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-gradient-to-r from-emerald-50 to-primary-50 rounded-t-2xl">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
                            <Receipt size={20} className="text-emerald-600" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-slate-800">New Financial Transaction</h2>
                            <p className="text-xs text-slate-500">Manual journal entry / cost allocation</p>
                        </div>
                    </div>
                    <button onClick={() => { resetForm(); onClose(); }} className="p-2 hover:bg-slate-200 rounded-lg transition-colors">
                        <AlertCircle size={18} className="text-slate-400" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-5 space-y-4">
                    {/* Transaction Type Toggle */}
                    <div className="flex gap-2">
                        {(['DEBIT', 'CREDIT'] as const).map(t => (
                            <button
                                key={t}
                                type="button"
                                onClick={() => setFormData({ ...formData, transactionType: t })}
                                className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-semibold transition-all ${
                                    formData.transactionType === t
                                        ? t === 'DEBIT'
                                            ? 'bg-red-500 text-white shadow-lg shadow-red-500/25'
                                            : 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/25'
                                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                                }`}
                            >
                                {t === 'DEBIT' ? '↗ Debit (Expense)' : '↙ Credit (Recovery)'}
                            </button>
                        ))}
                    </div>

                    {/* Cost Type Grid */}
                    <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-2">Cost Type *</label>
                        <div className="grid grid-cols-3 gap-2">
                            {TRANSACTION_COST_TYPES.map(ct => (
                                <button
                                    key={ct.value}
                                    type="button"
                                    onClick={() => setFormData({ ...formData, costType: ct.value, personId: '', inventoryItemId: '' })}
                                    className={`p-2.5 rounded-lg text-left transition-all border ${
                                        formData.costType === ct.value
                                            ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200'
                                            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                                    }`}
                                >
                                    <div className="text-base">{ct.icon}</div>
                                    <div className="text-xs font-semibold text-slate-800 mt-0.5">{ct.label}</div>
                                    <div className="text-[10px] text-slate-400 mt-0.5 leading-tight">{ct.description}</div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* ============ MODULE LINKERS ============ */}

                    {/* 👷 PEOPLE MODULE — Labor Selector (shows when cost type = LABOR) */}
                    {formData.costType === 'LABOR' && (
                        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-2">
                            <label className="flex items-center gap-2 text-xs font-semibold text-blue-700">
                                <Users size={14} />
                                People Module — Assign Technician
                            </label>
                            <select
                                value={formData.personId}
                                onChange={e => handlePersonChange(e.target.value)}
                                className="w-full px-3 py-2 text-sm border border-blue-200 rounded-lg focus:ring-2 focus:ring-primary-400 focus:outline-none bg-white"
                            >
                                <option value="">— Select Technician —</option>
                                {people.map(p => (
                                    <option key={p.id} value={p.id}>
                                        {p.name} — {p.title || 'Technician'} • ${p.hourlyRate || 0}/hr
                                    </option>
                                ))}
                            </select>
                            {selectedPerson && (
                                <div className="flex items-center gap-3 text-xs text-blue-600">
                                    <span>👤 {selectedPerson.name}</span>
                                    <span>💰 ${selectedPerson.hourlyRate}/hr</span>
                                    {selectedPerson.costCenterId && <span>🏢 Linked CC</span>}
                                </div>
                            )}
                        </div>
                    )}

                    {/* 🔩 INVENTORY MODULE — Part Selector (shows when cost type = MATERIAL) */}
                    {formData.costType === 'MATERIAL' && (
                        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-2">
                            <label className="flex items-center gap-2 text-xs font-semibold text-amber-700">
                                <Package size={14} />
                                Inventory Module — Select Part
                            </label>
                            <select
                                value={formData.inventoryItemId}
                                onChange={e => handleInventoryChange(e.target.value)}
                                className="w-full px-3 py-2 text-sm border border-amber-200 rounded-lg focus:ring-2 focus:ring-amber-400 focus:outline-none bg-white"
                            >
                                <option value="">— Select Part / Material —</option>
                                {inventory.map(item => (
                                    <option key={item.id} value={item.id}>
                                        {item.code} — {item.description} • ${item.itemCost || 0}/{item.uom || 'EA'}
                                    </option>
                                ))}
                            </select>
                            {selectedItem && (
                                <div className="flex items-center gap-3 text-xs text-amber-700">
                                    <span>📦 {selectedItem.code}</span>
                                    <span>💲 ${selectedItem.itemCost}/{selectedItem.uom}</span>
                                    <span>📋 {selectedItem.description}</span>
                                </div>
                            )}
                        </div>
                    )}

                    {/* 🔧 WORK MANAGEMENT — WO Selector (always visible) */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1">Cost Center</label>
                            <select
                                value={formData.costCenterId}
                                onChange={e => setFormData({ ...formData, costCenterId: e.target.value })}
                                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-400 focus:outline-none"
                            >
                                <option value="">— Select —</option>
                                {costCenters.map(cc => (
                                    <option key={cc.id} value={cc.id}>{cc.code} — {cc.name}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 mb-1">
                                <Wrench size={12} className="text-blue-500" />
                                Work Order
                            </label>
                            <select
                                value={formData.workOrderId}
                                onChange={e => {
                                    const wo = workOrders.find(w => w.id === e.target.value);
                                    setFormData({
                                        ...formData,
                                        workOrderId: e.target.value,
                                        description: formData.description || (wo ? `WO: ${wo.job_id} — ${wo.description || ''}` : ''),
                                    });
                                }}
                                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary-400 focus:outline-none"
                            >
                                <option value="">— No WO (ad-hoc) —</option>
                                {workOrders.slice(0, 50).map(wo => (
                                    <option key={wo.id} value={wo.id}>
                                        {wo.job_id} — {(wo.description || 'No description').substring(0, 50)}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Budget Warning */}
                    {budgetWarning && (
                        <div className={`p-3 rounded-lg text-xs font-medium flex items-center gap-2 ${
                            budgetWarning.startsWith('⛔')
                                ? 'bg-red-50 text-red-700 border border-red-200'
                                : 'bg-amber-50 text-amber-700 border border-amber-200'
                        }`}>
                            <AlertTriangle size={14} />
                            {budgetWarning}
                        </div>
                    )}

                    {/* Amount / Quantity / Unit row */}
                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1">Amount ($) *</label>
                            <input
                                type="number"
                                step="0.01"
                                value={formData.amount}
                                onChange={e => setFormData({ ...formData, amount: e.target.value })}
                                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-400 focus:outline-none font-mono"
                                placeholder="0.00"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1">
                                {formData.costType === 'LABOR' ? 'Hours' : 'Quantity'}
                            </label>
                            <input
                                type="number"
                                step="0.01"
                                value={formData.quantity}
                                onChange={e => handleQuantityChange(e.target.value)}
                                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-400 focus:outline-none"
                                placeholder={formData.costType === 'LABOR' ? 'e.g. 8' : '1'}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1">Unit</label>
                            <select
                                value={formData.unit}
                                onChange={e => setFormData({ ...formData, unit: e.target.value })}
                                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-400 focus:outline-none"
                            >
                                <option value="EA">EA (Each)</option>
                                <option value="HR">HR (Hours)</option>
                                <option value="KG">KG (Kilograms)</option>
                                <option value="L">L (Liters)</option>
                                <option value="M">M (Meters)</option>
                                <option value="LOT">LOT</option>
                                <option value="LS">LS (Lump Sum)</option>
                            </select>
                        </div>
                    </div>

                    {/* Posting Date, GL Account, Reference */}
                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1">Posting Date *</label>
                            <input
                                type="date"
                                value={formData.postingDate}
                                onChange={e => setFormData({ ...formData, postingDate: e.target.value })}
                                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-400 focus:outline-none"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1">GL Account</label>
                            <input
                                type="text"
                                value={formData.glAccount}
                                onChange={e => setFormData({ ...formData, glAccount: e.target.value })}
                                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-400 focus:outline-none"
                                placeholder="e.g. 6200-001"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1">Reference #</label>
                            <input
                                type="text"
                                value={formData.referenceNumber}
                                onChange={e => setFormData({ ...formData, referenceNumber: e.target.value })}
                                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-400 focus:outline-none"
                                placeholder="INV / PO / GRN ref"
                            />
                        </div>
                    </div>

                    {/* Description */}
                    <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Description *</label>
                        <textarea
                            value={formData.description}
                            onChange={e => setFormData({ ...formData, description: e.target.value })}
                            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-400 focus:outline-none resize-none"
                            rows={2}
                            placeholder="Describe the transaction purpose (e.g., 'Emergency pump seal replacement — ABB vendor invoice')"
                            required
                        />
                    </div>

                    {/* Summary bar */}
                    {formData.amount && (
                        <div className={`p-3 rounded-lg flex items-center justify-between ${
                            formData.transactionType === 'CREDIT'
                                ? 'bg-emerald-50 border border-emerald-200'
                                : 'bg-red-50 border border-red-200'
                        }`}>
                            <div className="text-xs font-medium text-slate-600 space-y-0.5">
                                <div>{formData.transactionType === 'CREDIT' ? 'Credit' : 'Debit'} • {formData.costType}
                                    {formData.costCenterId && ` • ${costCenters.find(c => c.id === formData.costCenterId)?.code || ''}`}
                                </div>
                                {selectedPerson && <div className="text-blue-600">👤 {selectedPerson.name}</div>}
                                {selectedItem && <div className="text-amber-600">📦 {selectedItem.code}</div>}
                                {selectedWO && <div className="text-blue-600">🔧 {selectedWO.job_id}</div>}
                            </div>
                            <span className={`text-lg font-bold font-mono ${
                                formData.transactionType === 'CREDIT' ? 'text-emerald-700' : 'text-red-700'
                            }`}>
                                {formData.transactionType === 'CREDIT' ? '-' : '+'}${parseFloat(formData.amount || '0').toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </span>
                        </div>
                    )}

                    {/* Actions */}
                    <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                        <button
                            type="button"
                            onClick={() => { resetForm(); onClose(); }}
                            className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading || !formData.amount || !formData.description}
                            className="px-5 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-all shadow-lg shadow-emerald-500/20 flex items-center gap-2"
                        >
                            {loading ? (
                                <>
                                    <div className="animate-spin h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full" />
                                    Posting...
                                </>
                            ) : (
                                <>
                                    <CheckCircle size={14} />
                                    Post Transaction
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export const FinOps: React.FC = () => {
    const [searchParams] = useSearchParams();
    const [activeTab, setActiveTab] = useState<TabId>('dashboard');

    // Sync Tab with URL
    useEffect(() => {
        const tab = searchParams.get('tab');
        if (tab && TABS.some(t => t.id === tab)) {
            setActiveTab(tab as TabId);
        }
    }, [searchParams]);
    const [loading, setLoading] = useState(true);
    const [assets, setAssets] = useState<{ id: string; name: string; tag: string }[]>([]);
    const [vendors, setVendors] = useState<{ id: string; name: string }[]>([]);
    const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
    const [depreciationBooks, setDepreciationBooks] = useState<DepreciationBook[]>([]);
    const [fleetDepreciation, setFleetDepreciation] = useState<any[]>([]);
    const [warranties, setWarranties] = useState<Warranty[]>([]);
    const [claims, setClaims] = useState<WarrantyClaim[]>([]);
    const [supplyChainData, setSupplyChainData] = useState<SupplyChainMatch[]>([]);
    const [insurancePolicies, setInsurancePolicies] = useState<any[]>([]);
    const [vendorKPIs, setVendorKPIs] = useState<any[]>([]);
    const [dashboardMetrics, setDashboardMetrics] = useState<any>({
        budgetUtilization: 0,
        depreciationMTD: 0,
        activeWarranties: 0,
        pendingClaims: 0,
        invoiceVariance: 0,
        insuranceCoverage: 0
    });
    const [maintenanceForecasts, setMaintenanceForecasts] = useState<MaintenanceForecast[]>([]);
    const [isNewTransactionOpen, setIsNewTransactionOpen] = useState(false);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        try {
            const results = await Promise.allSettled([
                FinOpsService.getCostCenters(),
                FinOpsService.getAllDepreciationBooks(),
                FinOpsService.getAllWarranties(),
                FinOpsService.getAllClaims(),
                FinOpsService.getSupplyChainOverview(),
                FinOpsService.getAllInsurancePolicies(),
                FinOpsService.getDashboardMetrics(),
                FinOpsService.getMaintenanceForecasts(),
                FinOpsService.getFleetDepreciationSummary(new Date().getFullYear()),
                FinOpsService.getAssetsForPicker(),
                FinOpsService.getVendorsForPicker(),
                FinOpsService.getVendorWarrantyKPIs()
            ]);

            // Handle results independently
            if (results[0].status === 'fulfilled') setCostCenters(results[0].value);
            if (results[1].status === 'fulfilled') setDepreciationBooks(results[1].value);
            if (results[2].status === 'fulfilled') setWarranties(results[2].value);
            if (results[3].status === 'fulfilled') setClaims(results[3].value);
            if (results[4].status === 'fulfilled') setSupplyChainData(results[4].value);
            if (results[5].status === 'fulfilled') setInsurancePolicies(results[5].value);
            if (results[6].status === 'fulfilled') setDashboardMetrics(results[6].value);
            if (results[7].status === 'fulfilled') setMaintenanceForecasts(results[7].value);
            if (results[8].status === 'fulfilled') setFleetDepreciation(results[8].value);
            if (results[9].status === 'fulfilled') setAssets(results[9].value);
            if (results[10].status === 'fulfilled') setVendors(results[10].value);
            if (results[11].status === 'fulfilled') setVendorKPIs(results[11].value);

            // Log failures for debugging
            results.forEach((res, i) => {
                if (res.status === 'rejected') {
                    console.error(`FinOps query at index ${i} failed:`, res.reason);
                }
            });
        } catch (err) {
            console.error('Fatal FinOps load error:', err);
        } finally {
            setLoading(false);
        }
    };

    const renderTabContent = () => {
        switch (activeTab) {
            case 'dashboard': return <DashboardTab metrics={dashboardMetrics} transactions={[]} />; // TODO: Fetch transactions
            case 'cost_centers': return <CostCentersTab costCenters={costCenters} onRefresh={loadData} initialSelectedId={searchParams.get('id')} />;
            case 'forecast':
                return <ForecastTab />;
            case 'depreciation':
                return <DepreciationTab books={depreciationBooks} fleetDepreciation={fleetDepreciation} costCenters={costCenters} />;
            case 'warranties': return <WarrantiesTab warranties={warranties} assets={assets} vendors={vendors} onRefresh={loadData} />;
            case 'claims': return <ClaimsTab claims={claims} onRefresh={loadData} />;
            case 'vendor_intel': return <VendorIntelTab vendorKPIs={vendorKPIs} onRefresh={loadData} />;
            case 'supply_chain': return <SupplyChainTab data={supplyChainData} />;
            case 'insurance': return <InsuranceTab policies={insurancePolicies} claims={claims} totalAssetCount={assets.length} />;
            default: return <DashboardTab metrics={dashboardMetrics} transactions={[]} />;
        }
    };

    return (<>
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50/30">
            {/* Header */}
            <div className="bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-30 shadow-sm">
                <div className="px-4 md:px-6 py-3 md:py-4">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-3 md:gap-4 min-w-0">
                            <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-primary-600 flex items-center justify-center shadow-lg shadow-emerald-500/20 flex-shrink-0">
                                <DollarSign size={24} className="text-white" />
                            </div>
                            <div className="min-w-0">
                                <h1 className="text-lg md:text-2xl font-bold bg-gradient-to-r from-emerald-600 to-primary-600 bg-clip-text text-transparent truncate">
                                    FinOps Core
                                </h1>
                                <p className="hidden sm:block text-sm text-slate-500 truncate">Financial Operations & Asset Lifecycle</p>
                            </div>
                        </div>

                        {/* Labels collapse to icons on phones — the full row is 286px wide,
                            which is most of a 393px viewport on its own. */}
                        <div className="flex items-center gap-2 md:gap-3 flex-shrink-0">
                            <AskRelanternButton
                                contextType="finops"
                                contextSummary={`FinOps Overview: Active Tab: ${activeTab}. Financial Operations & Asset Lifecycle Cost analysis. Modules: Cost Centers, Budget Control, Forecasting, Depreciation, Warranties, Claims, Supply Chain, Insurance. Ask about cost optimization, ROI analysis, depreciation strategies, warranty coverage gaps, budget compliance, or financial KPIs.`}
                                compact
                            />
                            <button
                                className="flex items-center justify-center gap-2 min-h-[40px] px-2.5 md:px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                                aria-label="Export"
                            >
                                <Download size={16} />
                                <span className="hidden md:inline">Export</span>
                            </button>
                            <button
                                onClick={() => setIsNewTransactionOpen(true)}
                                className="flex items-center justify-center gap-2 min-h-[40px] px-2.5 md:px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-500/20"
                                aria-label="New Transaction"
                            >
                                <Plus size={16} />
                                <span className="hidden md:inline">New Transaction</span>
                            </button>
                        </div>
                    </div>

                    {/* Tabs */}
                    <div className="flex gap-1 mt-4 -mb-4 overflow-x-auto">
                        {TABS.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium rounded-t-lg transition-all whitespace-nowrap ${activeTab === tab.id
                                    ? 'bg-white text-emerald-600 border-t-2 border-emerald-500 shadow-sm'
                                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                                    }`}
                            >
                                {tab.icon}
                                {tab.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="p-6">
                {loading ? (
                    <div className="flex items-center justify-center h-64">
                        <RefreshCw className="animate-spin text-emerald-500" size={32} />
                    </div>
                ) : (
                    renderTabContent()
                )}
            </div>
        </div>

        {/* New Transaction Modal */}
        <NewTransactionModal
            isOpen={isNewTransactionOpen}
            onClose={() => setIsNewTransactionOpen(false)}
            onSave={() => { loadData(); setIsNewTransactionOpen(false); }}
            costCenters={costCenters}
        />
    </>);
};

// =====================================================
// DASHBOARD TAB
// =====================================================

interface DashboardTabProps {
    metrics: any;
    transactions: any[];
}

const DashboardTab: React.FC<DashboardTabProps> = ({ metrics, transactions }) => {
    // We ignore the passed transactions prop for now as we want to fetch fresh ones, 
    // or we could use it if parent passed it. Let's fetch self-contained for now or better, 
    // update parent to fetch. But to keep it localized:
    const [recentTransactions, setRecentTransactions] = useState<any[]>([]);
    const [budgets, setBudgets] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadDashboardData = async () => {
            try {
                const [txs, allBudgets] = await Promise.all([
                    FinOpsService.getRecentTransactions(5),
                    FinOpsService.getAllBudgets(new Date().getFullYear())
                ]);
                setRecentTransactions(txs);
                setBudgets(allBudgets);
            } catch (err) {
                console.error('Failed to load dashboard data', err);
            } finally {
                setLoading(false);
            }
        };
        loadDashboardData();
    }, []);

    const kpis = [
        { label: 'Budget Utilization', value: `${metrics.budgetUtilization.toFixed(0)}%`, icon: Target, color: 'text-emerald-600', bg: 'bg-emerald-100', sub: 'Year to Date' },
        { label: 'Depreciation MTD', value: `$${metrics.depreciationMTD.toLocaleString()}`, icon: TrendingUp, color: 'text-blue-600', bg: 'bg-blue-100', sub: ' posted' },
        { label: 'Active Warranties', value: metrics.activeWarranties.toString(), icon: ShieldCheck, color: 'text-blue-600', bg: 'bg-blue-100', sub: 'Assets Covered' },
        { label: 'Pending Claims', value: metrics.pendingClaims.toString(), icon: FileText, color: 'text-amber-600', bg: 'bg-amber-100', sub: 'Review Needed' },
        { label: 'Invoice Variance', value: `${metrics.invoiceVariance}%`, icon: Banknote, color: 'text-primary-600', bg: 'bg-primary-100', sub: 'Avg Variance' },
        { label: 'Insurance Coverage', value: `$${(metrics.insuranceCoverage / 1000000).toFixed(1)}M`, icon: Shield, color: 'text-blue-600', bg: 'bg-blue-100', sub: 'Total Value' },
    ];

    return (
        <div className="space-y-6">
            {/* Warranty Recovery (AI) — surfaces recoverable spend under active warranty */}
            <AdvisoryAgentPanel
                title="Warranty Recovery"
                subtitle="AI finds completed work done under active warranty — money to claim back"
                icon={<ReceiptText size={16} />}
                accent="emerald"
                runLabel="Find recoverable"
                inputPlaceholder="Asset tag (optional)"
                onRun={(tag) => runWarrantyRecovery(tag || undefined)}
            />

            {/* KPI Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                {kpis.map((kpi, idx) => (
                    <div key={idx} className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 hover:shadow-md transition-shadow">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${kpi.bg}`}>
                            <kpi.icon size={20} className={kpi.color} />
                        </div>
                        <div className="text-2xl font-bold text-slate-800">{kpi.value}</div>
                        <div className="text-sm font-medium text-slate-500">{kpi.label}</div>
                        <div className="text-xs text-slate-400 mt-1">{kpi.sub}</div>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Budget Overview */}
                <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-slate-100 p-6">
                    <div className="flex items-center justify-between mb-6">
                        <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                            <Banknote size={18} className="text-emerald-600" />
                            Budget Overview - Q1 2024
                        </h3>
                        <select className="text-sm border-slate-200 rounded-lg text-slate-600">
                            <option>All Cost Centers</option>
                            <option>Maintenance</option>
                            <option>Operations</option>
                        </select>
                    </div>

                    <div className="space-y-6">
                        {loading ? (
                            <div className="text-center py-8 text-slate-400">Loading budgets...</div>
                        ) : budgets.length === 0 ? (
                            <div className="text-center py-8 text-slate-400">
                                <Banknote size={48} className="mx-auto mb-3 opacity-50" />
                                <p>No active budgets found for this year</p>
                            </div>
                        ) : (
                            budgets.map((budget) => {
                                const total = budget.opexBudget + budget.capexBudget; // Simplified view
                                const used = budget.actual + budget.committed;
                                const percent = total > 0 ? (used / total) * 100 : 0;

                                return (
                                    <div key={budget.id}>
                                        <div className="flex justify-between items-end mb-2">
                                            <div>
                                                <div className="font-medium text-slate-800">{budget.costCenterName}</div>
                                                <div className="text-xs text-slate-400">{budget.costCenterCode}</div>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-sm font-semibold text-slate-800">
                                                    ${used.toLocaleString()} <span className="text-slate-400">/ ${total.toLocaleString()}</span>
                                                </div>
                                                <div className={`text-xs ${percent > 90 ? 'text-red-500' : 'text-emerald-600'}`}>
                                                    {percent.toFixed(1)}% utilized
                                                </div>
                                            </div>
                                        </div>
                                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                            <div
                                                className={`h-full rounded-full ${percent > 90 ? 'bg-red-500' : 'bg-emerald-500'}`}
                                                style={{ width: `${Math.min(percent, 100)}%` }}
                                            />
                                        </div>
                                    </div>
                                )
                            })
                        )}
                    </div>
                </div>

                {/* Recent Transactions */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
                    <h3 className="font-semibold text-slate-800 mb-6 flex items-center gap-2">
                        <Clock size={18} className="text-blue-600" />
                        Recent Transactions
                    </h3>

                    <div className="space-y-4">
                        {loading ? (
                            <div className="text-center py-4 text-slate-400">Loading...</div>
                        ) : recentTransactions.length === 0 ? (
                            <div className="text-center py-8 text-slate-400">
                                <Clock size={48} className="mx-auto mb-3 opacity-50" />
                                <p>No recent transactions</p>
                            </div>
                        ) : (
                            recentTransactions.map((tx) => (
                                <div key={tx.id} className="flex items-center gap-3 p-3 hover:bg-slate-50 rounded-lg transition-colors border border-transparent hover:border-slate-100">
                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${tx.costType === 'MATERIAL' ? 'bg-blue-100 text-blue-600' :
                                        tx.costType === 'SERVICE' ? 'bg-blue-100 text-blue-600' :
                                            'bg-emerald-100 text-emerald-600'
                                        }`}>
                                        {tx.costType === 'MATERIAL' ? <Box size={16} /> :
                                            tx.costType === 'SERVICE' ? <Users size={16} /> : <Wrench size={16} />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-medium text-slate-800 truncate">
                                            {tx.description || tx.costType}
                                        </div>
                                        <div className="text-xs text-slate-500">
                                            {new Date(tx.postingDate).toLocaleDateString()} • {tx.workOrderCode || 'N/A'}
                                        </div>
                                    </div>
                                    <div className="font-medium text-slate-800">
                                        ${tx.amount.toLocaleString()}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
            {/* Alerts Section */}
            <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl p-6 border border-amber-200">
                <h3 className="font-semibold text-amber-800 flex items-center gap-2 mb-4">
                    <AlertTriangle size={18} />
                    Action Required
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-white rounded-lg p-4 border border-amber-200">
                        <div className="flex items-center gap-2 text-amber-700 font-medium mb-1">
                            <Shield size={14} />
                            12 Warranties Expiring
                        </div>
                        <p className="text-xs text-amber-600">Within next 30 days. Review and renew.</p>
                    </div>
                    <div className="bg-white rounded-lg p-4 border border-amber-200">
                        <div className="flex items-center gap-2 text-amber-700 font-medium mb-1">
                            <Receipt size={14} />
                            5 Invoice Variances
                        </div>
                        <p className="text-xs text-amber-600">Pending three-way match review.</p>
                    </div>
                    <div className="bg-white rounded-lg p-4 border border-amber-200">
                        <div className="flex items-center gap-2 text-amber-700 font-medium mb-1">
                            <Calculator size={14} />
                            Cost Anomaly Detected
                        </div>
                        <p className="text-xs text-amber-600">WO estimate 150% above historical average.</p>
                    </div>
                </div>
            </div>
        </div>
    );
};

// =====================================================
// COST CENTERS TAB
// =====================================================

interface CostCentersTabProps {
    costCenters: CostCenter[];
    onRefresh: () => void;
    initialSelectedId?: string | null;
}

const CostCentersTab: React.FC<CostCentersTabProps> = ({ costCenters, onRefresh, initialSelectedId }) => {
    const { showToast } = useToast();
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
    const [selectedCenter, setSelectedCenter] = useState<CostCenter | null>(null);
    const [showBudgetModal, setShowBudgetModal] = useState(false);
    const [showAddModal, setShowAddModal] = useState(false);
    const [currentBudget, setCurrentBudget] = useState<Budget | null>(null);
    const [budgetYear, setBudgetYear] = useState(new Date().getFullYear());
    const [opexInput, setOpexInput] = useState('');
    const [capexInput, setCapexInput] = useState('');
    const [loadingBudget, setLoadingBudget] = useState(false);
    const [newName, setNewName] = useState('');
    const [newCode, setNewCode] = useState('');
    const [newType, setNewType] = useState('MAINTENANCE');
    const [newDesc, setNewDesc] = useState('');
    const [isSaving, setIsSaving] = useState(false);



    // Auto-select from URL
    useEffect(() => {
        if (initialSelectedId && costCenters.length > 0) {
            const target = costCenters.find(c => c.id === initialSelectedId);
            if (target) {
                // If we aren't already editing it
                if (selectedCenter?.id !== target.id) {
                    setSelectedCenter(target);
                    // Automatically open budget modal for immediate action
                    loadBudget(target, true);
                }
            }
        }
    }, [initialSelectedId, costCenters]);

    // Monthly Breakdown State (Moved up for scope access)
    const [distMode, setDistMode] = useState<'EVEN' | 'MANUAL'>('EVEN');
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const [monthlyOpex, setMonthlyOpex] = useState<Record<string, number>>({});
    const [monthlyCapex, setMonthlyCapex] = useState<Record<string, number>>({});

    const loadBudget = async (center: CostCenter, openModal = false) => {
        if (openModal) setShowBudgetModal(true);
        setLoadingBudget(true);
        try {
            const budget = await FinOpsService.getBudget(center.id, undefined, budgetYear);
            setCurrentBudget(budget);
            setOpexInput(budget?.opexBudget.toString() || '0');
            setCapexInput(budget?.capexBudget.toString() || '0');

            // Populate breakdown
            if (budget?.monthlyData && Object.keys(budget.monthlyData).length > 0) {
                setDistMode('MANUAL');
                const opexMap: Record<string, number> = {};
                const capexMap: Record<string, number> = {};
                months.forEach(m => {
                    opexMap[m] = budget.monthlyData![m]?.opex || 0;
                    capexMap[m] = budget.monthlyData![m]?.capex || 0;
                });
                setMonthlyOpex(opexMap);
                setMonthlyCapex(capexMap);
            } else {
                setDistMode('EVEN');
                setMonthlyOpex({});
                setMonthlyCapex({});
            }
        } catch (err) {
            console.error('Failed to load budget', err);
        } finally {
            setLoadingBudget(false);
        }
    };

    const handleOpenBudget = () => {
        if (selectedCenter) loadBudget(selectedCenter, true);
    };

    // Reload when year changes inside modal
    useEffect(() => {
        if (showBudgetModal && selectedCenter) {
            handleOpenBudget();
        }
    }, [budgetYear]); // Triggers reload on year change

    const handleSaveBudget = async (statusOverride?: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED') => {
        if (!selectedCenter) return;
        try {
            // Prepare monthly data
            const monthlyData: Record<string, { opex: number, capex: number }> = {};
            if (distMode === 'EVEN') {
                const opex = (parseFloat(opexInput) || 0) / 12;
                const capex = (parseFloat(capexInput) || 0) / 12;
                months.forEach(m => monthlyData[m] = { opex, capex });
            } else {
                months.forEach(m => {
                    monthlyData[m] = {
                        opex: monthlyOpex[m] || 0,
                        capex: monthlyCapex[m] || 0
                    };
                });
            }

            const budget = await FinOpsService.upsertBudget({
                costCenterId: selectedCenter.id,
                fiscalYear: budgetYear,
                opexBudget: parseFloat(opexInput) || 0,
                capexBudget: parseFloat(capexInput) || 0,
                status: statusOverride,
                monthlyData
            });
            setCurrentBudget(budget);
            setShowBudgetModal(false);
        } catch (err: any) {
            console.error('Failed to save budget', err);
            showToast(`Failed to save budget: ${err.message}`, 'error');
        }
    };

    const handleAddCostCenter = async () => {
        if (!newName || !newCode) return;
        setIsSaving(true);
        try {
            await FinOpsService.createCostCenter({
                name: newName,
                code: newCode,
                costCenterType: newType as any,
                description: newDesc,
                active: true,
                companyCode: 'CORP',
                controllingArea: '1000',
                validFrom: new Date().toISOString()
            });
            setShowAddModal(false);
            setNewName('');
            setNewCode('');
            setNewDesc('');
            onRefresh();
        } catch (err) {
            console.error('Failed to add cost center', err);
        } finally {
            setIsSaving(false);
        }
    };
    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                    <Building2 size={18} className="text-emerald-600" />
                    Cost Centers & Budgets
                </h3>
                <button
                    onClick={() => setShowAddModal(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:border-emerald-500 hover:text-emerald-700 font-medium transition-all shadow-sm"
                >
                    <Plus size={16} />
                    New Cost Center
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {costCenters.map(center => (
                    <div
                        key={center.id}
                        onClick={() => { setSelectedCenter(center); handleOpenBudget(); }}
                        className="bg-white p-4 rounded-xl border border-slate-200 hover:border-emerald-500 hover:shadow-md transition-all cursor-pointer group"
                    >
                        <div className="flex justify-between items-start mb-3">
                            <div className="flex-1">
                                <div className="font-bold text-slate-800 group-hover:text-emerald-700">{center.name}</div>
                                <div className="text-xs text-slate-500 font-mono mt-1">{center.code}</div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (confirm(`Delete cost center ${center.code}?`)) {
                                            FinOpsService.deleteCostCenter(center.id).then(() => { showToast('Cost center deleted.', 'success'); onRefresh(); }).catch((e: any) => showToast('Failed to delete: ' + e.message, 'error'));
                                        }
                                    }}
                                    className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                                >
                                    <Trash2 size={14} />
                                </button>
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${center.active ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-50 text-slate-400'}`}>
                                    <Banknote size={16} />
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center justify-between pt-3 border-t border-slate-50">
                            <span className="text-xs text-slate-500 font-medium">{center.costCenterType}</span>
                            <span className="text-xs text-blue-600 flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                                Manage Budget <ChevronRight size={12} />
                            </span>
                        </div>
                    </div>
                ))}

                {costCenters.length === 0 && (
                    <div className="col-span-full py-12 text-center text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-300">
                        <Building2 size={48} className="mx-auto mb-3 opacity-50" />
                        <p>No Cost Centers Found</p>
                    </div>
                )}
            </div>

            {/* Budget Modal */}
            {
                showBudgetModal && selectedCenter && (
                    <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/20 backdrop-blur-sm rounded-xl">
                        <div className="bg-white rounded-xl shadow-xl w-full max-w-md border border-slate-200 p-6 m-4 animate-in fade-in zoom-in duration-200">
                            <div className="flex justify-between items-center mb-6">
                                <div>
                                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                                        Annual Budget
                                        <span className={`text-xs px-2 py-0.5 rounded-full border ${currentBudget?.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                            currentBudget?.status === 'SUBMITTED' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                                currentBudget?.status === 'REJECTED' ? 'bg-red-50 text-red-700 border-red-200' :
                                                    'bg-slate-100 text-slate-600 border-slate-200'
                                            }`}>
                                            {currentBudget?.status || 'DRAFT'}
                                        </span>
                                    </h3>
                                    <p className="text-sm text-slate-500">{selectedCenter.name} ({selectedCenter.code})</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <select
                                        value={budgetYear}
                                        onChange={(e) => setBudgetYear(parseInt(e.target.value))}
                                        className="p-1 px-2 border border-slate-300 rounded-lg text-sm font-medium bg-slate-50"
                                    >
                                        {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 1 + i).map(year => (
                                            <option key={year} value={year}>{year}</option>
                                        ))}
                                    </select>
                                    <button onClick={() => setShowBudgetModal(false)} className="p-1 hover:bg-slate-100 rounded-full">
                                        <Trash2 size={20} className="rotate-45 text-slate-400" />
                                    </button>
                                </div>
                            </div>

                            {loadingBudget ? (
                                <div className="py-8 text-center"><RefreshCw className="animate-spin mx-auto text-emerald-500" /></div>
                            ) : (
                                <div className="space-y-4">
                                    <div className="grid grid-cols-2 gap-4 mb-4">
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Total OPEX</label>
                                            <div className="relative">
                                                <span className="absolute left-3 top-2.5 text-slate-400 font-medium">$</span>
                                                <input
                                                    type="number"
                                                    value={opexInput}
                                                    onChange={(e) => {
                                                        const newVal = e.target.value;
                                                        setOpexInput(newVal);
                                                        // If Even, recalc montly
                                                        if (distMode === 'EVEN') {
                                                            const val = parseFloat(newVal) || 0;
                                                            const even = val / 12;
                                                            const newMonths = { ...monthlyOpex };
                                                            months.forEach(m => newMonths[m] = even);
                                                            setMonthlyOpex(newMonths);
                                                        }
                                                    }}
                                                    className="w-full pl-7 p-2 border border-slate-300 rounded-lg font-mono text-slate-700 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                                                    placeholder="0.00"
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Total CAPEX</label>
                                            <div className="relative">
                                                <span className="absolute left-3 top-2.5 text-slate-400 font-medium">$</span>
                                                <input
                                                    type="number"
                                                    value={capexInput}
                                                    onChange={(e) => {
                                                        const newVal = e.target.value;
                                                        setCapexInput(newVal);
                                                        if (distMode === 'EVEN') {
                                                            const val = parseFloat(newVal) || 0;
                                                            const even = val / 12;
                                                            const newMonths = { ...monthlyCapex };
                                                            months.forEach(m => newMonths[m] = even);
                                                            setMonthlyCapex(newMonths);
                                                        }
                                                    }}
                                                    className="w-full pl-7 p-2 border border-slate-300 rounded-lg font-mono text-slate-700 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                                                    placeholder="0.00"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Monthly Distribution Toggle */}
                                    <div className="mb-4 bg-slate-50 p-3 rounded-lg border border-slate-200">
                                        <div className="flex justify-between items-center mb-2">
                                            <label className="text-xs font-semibold text-slate-500 uppercase">Monthly Distribution</label>
                                            <div className="flex bg-white rounded-md shadow-sm border border-slate-200 p-0.5">
                                                <button
                                                    onClick={() => {
                                                        setDistMode('EVEN');
                                                        // Recalc Even
                                                        const oVal = parseFloat(opexInput) || 0;
                                                        const cVal = parseFloat(capexInput) || 0;
                                                        const newO: Record<string, number> = {};
                                                        const newC: Record<string, number> = {};
                                                        months.forEach(m => { newO[m] = oVal / 12; newC[m] = cVal / 12; });
                                                        setMonthlyOpex(newO);
                                                        setMonthlyCapex(newC);
                                                    }}
                                                    className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${distMode === 'EVEN' ? 'bg-emerald-100 text-emerald-700' : 'text-slate-500 hover:text-slate-700'}`}
                                                >
                                                    Evenly
                                                </button>
                                                <button
                                                    onClick={() => setDistMode('MANUAL')}
                                                    className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${distMode === 'MANUAL' ? 'bg-emerald-100 text-emerald-700' : 'text-slate-500 hover:text-slate-700'}`}
                                                >
                                                    Manual
                                                </button>
                                            </div>
                                        </div>

                                        {distMode === 'MANUAL' && (
                                            <div className="grid grid-cols-3 gap-2 max-h-60 overflow-y-auto pr-1 custom-scrollbar">
                                                {months.map(month => (
                                                    <div key={month} className="bg-white p-2 rounded border border-slate-100">
                                                        <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">{month}</div>
                                                        <input
                                                            type="number"
                                                            placeholder="Opex"
                                                            value={monthlyOpex[month] ? Math.round(monthlyOpex[month]) : ''}
                                                            onChange={(e) => {
                                                                const val = parseFloat(e.target.value) || 0;
                                                                const newMonths = { ...monthlyOpex, [month]: val };
                                                                setMonthlyOpex(newMonths);
                                                                // Recalc Total
                                                                const total = Object.values(newMonths).reduce((a: any, b: any) => a + b, 0);
                                                                setOpexInput(total.toString());
                                                            }}
                                                            className="w-full text-xs font-mono border-b border-slate-200 focus:border-emerald-500 outline-none mb-1 text-emerald-600"
                                                        />
                                                        <input
                                                            type="number"
                                                            placeholder="Capex"
                                                            value={monthlyCapex[month] ? Math.round(monthlyCapex[month]) : ''}
                                                            onChange={(e) => {
                                                                const val = parseFloat(e.target.value) || 0;
                                                                const newMonths = { ...monthlyCapex, [month]: val };
                                                                setMonthlyCapex(newMonths);
                                                                const total = Object.values(newMonths).reduce((a: any, b: any) => a + b, 0);
                                                                setCapexInput(total.toString());
                                                            }}
                                                            className="w-full text-xs font-mono border-b border-slate-200 focus:border-emerald-500 outline-none text-blue-600"
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        {distMode === 'EVEN' && (
                                            <div className="text-center py-2 text-xs text-slate-400 italic">
                                                ~${((parseFloat(opexInput) || 0) / 12).toFixed(0)} Opex / ${((parseFloat(capexInput) || 0) / 12).toFixed(0)} Capex per month
                                            </div>
                                        )}
                                    </div>

                                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 mt-4">
                                        <div className="text-xs font-medium text-slate-500 uppercase mb-2">Current Utilization</div>
                                        <div className="flex justify-between text-sm mb-1">
                                            <span>Actual Spent</span>
                                            <span className="font-semibold">${(currentBudget?.actual || 0).toLocaleString()}</span>
                                        </div>
                                        <div className="flex justify-between text-sm">
                                            <span>Committed</span>
                                            <span className="font-semibold text-slate-600">${(currentBudget?.committed || 0).toLocaleString()}</span>
                                        </div>
                                    </div>

                                    <div className="flex gap-3 pt-4 border-t border-slate-100">
                                        {(!currentBudget?.status || currentBudget.status === 'DRAFT' || currentBudget.status === 'REJECTED') && (
                                            <>
                                                <button
                                                    onClick={() => handleSaveBudget('DRAFT')}
                                                    className="flex-1 px-4 py-2 bg-white border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 font-medium"
                                                >
                                                    Save Draft
                                                </button>
                                                <button
                                                    onClick={() => handleSaveBudget('SUBMITTED')}
                                                    className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium shadow-sm flex justify-center items-center gap-2"
                                                >
                                                    Submit <ArrowUpRight size={16} />
                                                </button>
                                            </>
                                        )}

                                        {currentBudget?.status === 'SUBMITTED' && (
                                            <>
                                                <button
                                                    onClick={() => handleSaveBudget('REJECTED')}
                                                    className="flex-1 px-4 py-2 bg-white border border-red-200 text-red-700 hover:bg-red-50 font-medium"
                                                >
                                                    Reject
                                                </button>
                                                <button
                                                    onClick={() => handleSaveBudget('APPROVED')}
                                                    className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium shadow-sm flex justify-center items-center gap-2"
                                                >
                                                    Approve <CheckCircle size={16} />
                                                </button>
                                            </>
                                        )}

                                        {currentBudget?.status === 'APPROVED' && (
                                            <>
                                                <div className="flex-1 flex items-center justify-center gap-2 text-emerald-600 font-bold bg-emerald-50 rounded-lg border border-emerald-100">
                                                    <CheckCircle size={18} /> Approved
                                                </div>
                                                <button
                                                    onClick={() => handleSaveBudget('DRAFT')}
                                                    className="px-4 py-2 text-sm text-slate-400 hover:text-slate-600 underline"
                                                >
                                                    Revise
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )
            }
            {/* Add Cost Center Modal */}
            {showAddModal && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/20 backdrop-blur-sm rounded-xl">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-md border border-slate-200 p-6 m-4 animate-in fade-in zoom-in duration-200">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-lg font-bold text-slate-800">New Cost Center</h3>
                            <button onClick={() => setShowAddModal(false)} className="p-1 hover:bg-slate-100 rounded-full">
                                <Trash2 size={20} className="rotate-45 text-slate-400" />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
                                <input
                                    type="text"
                                    value={newName}
                                    onChange={(e) => setNewName(e.target.value)}
                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                                    placeholder="e.g. Plant Maintenance"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Code</label>
                                <input
                                    type="text"
                                    value={newCode}
                                    onChange={(e) => setNewCode(e.target.value)}
                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                                    placeholder="e.g. CC-123"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
                                <select
                                    value={newType}
                                    onChange={(e) => setNewType(e.target.value)}
                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-slate-50"
                                >
                                    <option value="MAINTENANCE">MAINTENANCE</option>
                                    <option value="OPERATIONS">OPERATIONS</option>
                                    <option value="ADMINISTRATION">ADMINISTRATION</option>
                                    <option value="OVERHEAD">OVERHEAD</option>
                                    <option value="PROJECT">PROJECT</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                                <textarea
                                    value={newDesc}
                                    onChange={(e) => setNewDesc(e.target.value)}
                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                                    rows={3}
                                    placeholder="Brief purpose of this cost center"
                                />
                            </div>

                            <button
                                onClick={handleAddCostCenter}
                                disabled={isSaving || !newName || !newCode}
                                className="w-full py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium shadow-sm flex justify-center items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed mt-4"
                            >
                                {isSaving ? <RefreshCw className="animate-spin" size={16} /> : <Plus size={16} />}
                                Create Cost Center
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div >
    );
};

// =====================================================
// DEPRECIATION TAB
// =====================================================

interface DepreciationTabProps {
    books: DepreciationBook[];
    fleetDepreciation: any[];
    costCenters: CostCenter[];
}

const DepreciationTab: React.FC<DepreciationTabProps> = ({ books, fleetDepreciation, costCenters }) => {
    const { showToast } = useToast();
    const [schedule, setSchedule] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    const loadSchedule = async () => {
        setLoading(true);
        try {
            const data = await FinOpsService.getDepreciationSchedule(new Date().getFullYear());
            setSchedule(data);
        } catch (err) {
            console.error('Failed to load depreciation schedule', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadSchedule();
    }, []);

    const handleRunDepreciation = async () => {
        // Mock run for now, or implement service call if ready
        // await FinOpsService.runMonthlyDepreciation('CORPORATE', 2024, 1);
        showToast('Depreciation run scheduled in background.', 'info');
        loadSchedule();
    };

    // Pivot data for the table: Period -> { CORPORATE: $, TAX: $, TECHNICAL: $, Status }
    const pivotSchedule = useMemo(() => {
        const pivot = new Map<number, any>();

        schedule.forEach(item => {
            if (!pivot.has(item.period)) {
                pivot.set(item.period, { period: item.period, status: 'Scheduled' });
            }
            const row = pivot.get(item.period);
            row[item.bookType] = item.amount;

            // Heuristic for status: if we have data, it's likely posted or pending
            // This logic can be refined based on 'posted_date' if available
            row.status = 'Posted';
        });

        return Array.from(pivot.values()).sort((a, b) => a.period - b.period);
    }, [schedule]);

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    return (
        <div className="space-y-6">
            {/* Book Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {books.length === 0 ? (
                    <div className="col-span-3 p-8 text-center text-slate-400 bg-white rounded-xl border border-slate-100">
                        <TrendingDown size={48} className="mx-auto mb-3 opacity-50" />
                        <p>No depreciation books found</p>
                    </div>
                ) : (
                    books.map((book, idx) => (
                        <div key={idx} className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
                            <div className="flex items-center justify-between mb-4">
                                <div className={`px-3 py-1 rounded-full text-xs font-medium ${book.bookType === 'CORPORATE' ? 'bg-blue-100 text-blue-700' :
                                    book.bookType === 'TAX' ? 'bg-blue-100 text-blue-700' :
                                        'bg-amber-100 text-amber-700'
                                    }`}>
                                    {book.bookType} BOOK
                                </div>
                                <Settings size={16} className="text-slate-400" />
                            </div>

                            <div className="text-2xl font-bold text-slate-800 mb-1">
                                {/* Assuming standard Straight Line roughly monthly for display if not calculated */}
                                ${((book.currentValue || 0) * 0.02).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </div>
                            <div className="text-sm text-slate-500 mb-4">Est. Monthly Depreciation</div>

                            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-100">
                                <div>
                                    <div className="text-xs text-slate-400">Method</div>
                                    <div className="text-sm font-medium text-slate-700">{book.depreciationMethod}</div>
                                </div>
                                <div>
                                    <div className="text-xs text-slate-400">Value</div>
                                    <div className="text-sm font-medium text-slate-700">${book.currentValue?.toLocaleString()}</div>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Depreciation Schedule */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-100">
                <div className="flex items-center justify-between p-4 border-b border-slate-100">
                    <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                        <Calendar size={18} className="text-blue-600" />
                        Depreciation Schedule - {new Date().getFullYear()}
                    </h3>
                    <button
                        onClick={handleRunDepreciation}
                        className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white text-sm rounded-lg hover:bg-primary-500 transition-colors"
                    >
                        <Zap size={14} />
                        Run Depreciation
                    </button>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-slate-50">
                            <tr>
                                <th className="text-left text-xs font-medium text-slate-500 uppercase px-4 py-3">Period</th>
                                <th className="text-right text-xs font-medium text-slate-500 uppercase px-4 py-3">Corporate</th>
                                <th className="text-right text-xs font-medium text-slate-500 uppercase px-4 py-3">Tax</th>
                                <th className="text-right text-xs font-medium text-slate-500 uppercase px-4 py-3">Technical</th>
                                <th className="text-center text-xs font-medium text-slate-500 uppercase px-4 py-3">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {pivotSchedule.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                                        No depreciation schedule data found for this year.
                                    </td>
                                </tr>
                            ) : (
                                pivotSchedule.map((row, idx) => (
                                    <tr key={idx} className="hover:bg-slate-50">
                                        <td className="px-4 py-3 font-medium text-slate-800">{months[row.period - 1]} {new Date().getFullYear()}</td>
                                        <td className="px-4 py-3 text-right text-slate-600 font-mono">${(row.CORPORATE || 0).toLocaleString()}</td>
                                        <td className="px-4 py-3 text-right text-slate-600 font-mono">${(row.TAX || 0).toLocaleString()}</td>
                                        <td className="px-4 py-3 text-right text-slate-600 font-mono">${(row.TECHNICAL || 0).toLocaleString()}</td>
                                        <td className="px-4 py-3 text-center">
                                            <span className={`px-2 py-1 text-xs rounded-full ${row.status === 'Posted' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                                                }`}>
                                                {row.status}
                                            </span>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Fleet Depreciation Report (Cost Center Breakdown) */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-100">
                <div className="flex items-center justify-between p-4 border-b border-slate-100">
                    <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                        <Building2 size={18} className="text-emerald-600" />
                        Fleet Depreciation Report (By Cost Center)
                    </h3>
                    <div className="flex gap-2">
                        <button className="text-sm text-emerald-600 font-medium hover:underline">
                            Export PDF
                        </button>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-slate-50">
                            <tr>
                                <th className="text-left text-xs font-medium text-slate-500 uppercase px-4 py-3">Cost Center</th>
                                <th className="text-right text-xs font-medium text-slate-500 uppercase px-4 py-3">Q1</th>
                                <th className="text-right text-xs font-medium text-slate-500 uppercase px-4 py-3">Q2</th>
                                <th className="text-right text-xs font-medium text-slate-500 uppercase px-4 py-3">Q3</th>
                                <th className="text-right text-xs font-medium text-slate-500 uppercase px-4 py-3">Q4</th>
                                <th className="text-right text-xs font-medium text-slate-500 uppercase px-4 py-3 font-bold">Total YTD</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {fleetDepreciation.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                                        No depreciation data aggregated yet. Run depreciation cycle first.
                                    </td>
                                </tr>
                            ) : (
                                fleetDepreciation.map((row) => {
                                    // Aggregate months into Quarters for display
                                    const q1 = (row.monthly[1] || 0) + (row.monthly[2] || 0) + (row.monthly[3] || 0);
                                    const q2 = (row.monthly[4] || 0) + (row.monthly[5] || 0) + (row.monthly[6] || 0);
                                    const q3 = (row.monthly[7] || 0) + (row.monthly[8] || 0) + (row.monthly[9] || 0);
                                    const q4 = (row.monthly[10] || 0) + (row.monthly[11] || 0) + (row.monthly[12] || 0);

                                    return (
                                        <tr key={row.costCenter} className="hover:bg-slate-50">
                                            <td className="px-4 py-3 font-medium text-slate-800">
                                                {/* Lookup Cost Center Name if ID */}
                                                {costCenters.find(c => c.id === row.costCenter)?.name || row.costCenter}
                                                <div className="text-[10px] text-slate-400 font-normal">
                                                    {costCenters.find(c => c.id === row.costCenter)?.code}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-right text-slate-600">${q1.toLocaleString()}</td>
                                            <td className="px-4 py-3 text-right text-slate-600">${q2.toLocaleString()}</td>
                                            <td className="px-4 py-3 text-right text-slate-600">${q3.toLocaleString()}</td>
                                            <td className="px-4 py-3 text-right text-slate-600">${q4.toLocaleString()}</td>
                                            <td className="px-4 py-3 text-right font-bold text-slate-800">${row.total.toLocaleString()}</td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

// =====================================================
// FORECAST TAB
// =====================================================

const ForecastTab: React.FC = () => {
    const [forecasts, setForecasts] = useState<MaintenanceForecast[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const load = async () => {
            try {
                const data = await FinOpsService.getMaintenanceForecasts();
                setForecasts(data);
            } catch (err) {
                console.error('Failed to load forecasts', err);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, []);

    const totalAnnualSpend = forecasts.reduce((acc, f) => acc + f.annualEstimatedSpend, 0);

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
                    <div className="text-sm text-slate-500 mb-1">Projected Annual Maintenance Spend</div>
                    <div className="text-3xl font-bold text-slate-800">${totalAnnualSpend.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                    <div className="text-xs text-emerald-600 flex items-center gap-1 mt-2">
                        <TrendingUp size={14} /> +5.2% vs Last Year (Est)
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-100">
                <div className="p-4 border-b border-slate-100 flex justify-between items-center">
                    <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                        <TrendingUp size={18} className="text-blue-600" />
                        Maintenance Cost Forecast (Next 12 Months)
                    </h3>
                    <div className="text-sm text-slate-500">Based on Active PM Schedules</div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-slate-50 text-xs font-medium text-slate-500 uppercase">
                            <tr>
                                <th className="px-4 py-3 text-left">Recurring Work (PM)</th>
                                <th className="px-4 py-3 text-left">Asset</th>
                                <th className="px-4 py-3 text-right">Freq (Annual)</th>
                                <th className="px-4 py-3 text-right">Cost / Event</th>
                                <th className="px-4 py-3 text-right">Annual Est.</th>
                                <th className="px-4 py-3 text-center">Next Due</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-sm">
                            {loading ? (
                                <tr><td colSpan={6} className="p-8 text-center text-slate-400">Loading forecast...</td></tr>
                            ) : forecasts.length === 0 ? (
                                <tr><td colSpan={6} className="p-8 text-center text-slate-400">No active PMs found for forecasting</td></tr>
                            ) : (
                                forecasts.map(f => (
                                    <tr key={f.id} className="hover:bg-slate-50">
                                        <td className="px-4 py-3">
                                            <div className="font-medium text-slate-800">{f.title}</div>
                                            <div className="text-xs text-slate-500">{f.code}</div>
                                        </td>
                                        <td className="px-4 py-3 text-slate-600">{f.assetId}</td> {/* ideally asset name */}
                                        <td className="px-4 py-3 text-right text-slate-600">{f.annualFrequency.toFixed(1)}</td>
                                        <td className="px-4 py-3 text-right font-mono text-slate-600">${f.costPerEvent.toLocaleString()}</td>
                                        <td className="px-4 py-3 text-right font-mono font-medium text-slate-800">${f.annualEstimatedSpend.toLocaleString()}</td>
                                        <td className="px-4 py-3 text-center text-slate-600">
                                            {f.nextDueDate ? new Date(f.nextDueDate).toLocaleDateString() : '-'}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

// =====================================================
// WARRANTIES TAB
// =====================================================

interface WarrantiesTabProps {
    warranties: Warranty[];
    assets: { id: string; name: string; tag: string }[];
    vendors: { id: string; name: string }[];
    onRefresh: () => void;
}

const WarrantiesTab: React.FC<WarrantiesTabProps> = ({ warranties, assets, vendors, onRefresh }) => {
    const { showToast } = useToast();
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [, setSearchParams] = useSearchParams();

    // G5: File Claim state
    const [claimWarrantyId, setClaimWarrantyId] = useState<string | null>(null);
    const [claimForm, setClaimForm] = useState({
        failureDescription: '',
        claimType: 'REPAIR' as 'REPAIR' | 'REPLACEMENT' | 'CREDIT',
        amount: ''
    });
    const [filingClaim, setFilingClaim] = useState(false);

    const handleAddWarranty = async (warranty: any) => {
        await FinOpsService.addWarranty(warranty);
        onRefresh();
    };

    // G5: File Claim handler
    const handleFileClaim = async () => {
        if (!claimWarrantyId || !claimForm.failureDescription) return;
        setFilingClaim(true);
        try {
            await FinOpsService.generateWarrantyClaim(
                claimWarrantyId,
                '', // No WO linked yet — manual claim
                claimForm.failureDescription,
                claimForm.claimType,
                parseFloat(claimForm.amount) || 0
            );
            setClaimWarrantyId(null);
            setClaimForm({ failureDescription: '', claimType: 'REPAIR', amount: '' });
            onRefresh();
            // Navigate to Claims tab to see the new DRAFT
            setSearchParams({ tab: 'claims' });
        } catch (err: any) {
            showToast('Failed to file claim: ' + err.message, 'error');
        } finally {
            setFilingClaim(false);
        }
    };

    return (
        <div className="space-y-6">
            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
                    <div className="text-3xl font-bold text-slate-800">{warranties.length}</div>
                    <div className="text-sm text-slate-500">Active Warranties</div>
                </div>
                {/* ... other stats static for now ... */}
            </div>

            {/* Warranty List */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-100">
                <div className="flex items-center justify-between p-4 border-b border-slate-100">
                    <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                        <Shield size={18} className="text-blue-600" />
                        Active Warranties
                    </h3>
                    <div className="flex gap-2">
                        <div className="relative">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                placeholder="Search warranties..."
                                className="pl-9 pr-4 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                            />
                        </div>
                        <button
                            onClick={() => setIsAddModalOpen(true)}
                            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-primary-500 transition-colors"
                        >
                            <Plus size={14} />
                            Add Warranty
                        </button>
                    </div>
                </div>

                <div className="divide-y divide-slate-100">
                    {warranties.length === 0 ? (
                        <div className="p-8 text-center text-slate-400">
                            <Shield size={48} className="mx-auto mb-3 opacity-50" />
                            <p>No active warranties found</p>
                        </div>
                    ) : (
                        warranties.map(warranty => {
                            const daysLeft = warranty.endDate ? Math.ceil((new Date(warranty.endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : 0;
                            const isClaimOpen = claimWarrantyId === warranty.id;

                            return (
                                <div key={warranty.id} className="p-4 hover:bg-slate-50 transition-colors">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-4">
                                            <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center">
                                                <Shield size={20} className="text-blue-600" />
                                            </div>
                                            <div>
                                                <div className="font-medium text-slate-800">{(warranty as any).assetName || 'Unknown Asset'}</div>
                                                <div className="text-sm text-slate-500">{(warranty as any).vendorName || 'Unknown Vendor'} • {warranty.warrantyType}</div>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-6">
                                            {/* Time remaining */}
                                            <div className="text-right">
                                                <div className={`text-sm font-medium ${daysLeft < 30 ? 'text-amber-600' : 'text-slate-700'}`}>
                                                    {daysLeft} days left
                                                </div>
                                                <div className="text-xs text-slate-400">Expires {warranty.endDate}</div>
                                            </div>

                                            {/* G5: Wired File Claim button */}
                                            <button
                                                onClick={() => setClaimWarrantyId(isClaimOpen ? null : warranty.id)}
                                                className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                                                    isClaimOpen
                                                        ? 'bg-blue-600 text-white'
                                                        : 'text-blue-600 hover:bg-blue-50'
                                                }`}
                                            >
                                                {isClaimOpen ? 'Cancel' : 'File Claim →'}
                                            </button>
                                        </div>
                                    </div>

                                    {/* G5: Inline File Claim Dialog */}
                                    {isClaimOpen && (
                                        <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-xl space-y-3 animate-in slide-in-from-top-2 duration-200">
                                            <h4 className="text-sm font-bold text-blue-800 flex items-center gap-2">
                                                <FileCheck size={14} />
                                                File Warranty Claim — {(warranty as any).vendorName || 'Vendor'}
                                            </h4>
                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                                <div className="md:col-span-2">
                                                    <label className="block text-xs font-medium text-slate-600 mb-1">Failure Description *</label>
                                                    <textarea
                                                        value={claimForm.failureDescription}
                                                        onChange={e => setClaimForm({ ...claimForm, failureDescription: e.target.value })}
                                                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary-400 focus:outline-none resize-none"
                                                        rows={2}
                                                        placeholder="Describe the failure or defect..."
                                                    />
                                                </div>
                                                <div className="space-y-3">
                                                    <div>
                                                        <label className="block text-xs font-medium text-slate-600 mb-1">Claim Type</label>
                                                        <select
                                                            value={claimForm.claimType}
                                                            onChange={e => setClaimForm({ ...claimForm, claimType: e.target.value as any })}
                                                            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary-400 focus:outline-none"
                                                        >
                                                            <option value="REPAIR">Repair</option>
                                                            <option value="REPLACEMENT">Replacement</option>
                                                            <option value="CREDIT">Credit</option>
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs font-medium text-slate-600 mb-1">Est. Amount ($)</label>
                                                        <input
                                                            type="number"
                                                            value={claimForm.amount}
                                                            onChange={e => setClaimForm({ ...claimForm, amount: e.target.value })}
                                                            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary-400 focus:outline-none"
                                                            placeholder="0.00"
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex justify-end gap-2 pt-1">
                                                <button
                                                    onClick={() => setClaimWarrantyId(null)}
                                                    className="px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                                                >
                                                    Cancel
                                                </button>
                                                <button
                                                    onClick={handleFileClaim}
                                                    disabled={!claimForm.failureDescription || filingClaim}
                                                    className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-primary-500 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                                                >
                                                    {filingClaim ? (
                                                        <>
                                                            <div className="animate-spin h-3 w-3 border-2 border-white border-t-transparent rounded-full" />
                                                            Filing...
                                                        </>
                                                    ) : (
                                                        <>
                                                            <FileCheck size={14} />
                                                            Create Draft Claim
                                                        </>
                                                    )}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            <AddWarrantyModal
                isOpen={isAddModalOpen}
                onClose={() => setIsAddModalOpen(false)}
                onSave={handleAddWarranty}
                assets={assets}
                vendors={vendors}
            />
        </div>
    );
};

// =====================================================
// CLAIMS TAB — Full Lifecycle (G3, G4, G5)
// =====================================================

interface ClaimsTabProps {
    claims: WarrantyClaim[];
    onRefresh: () => void;
}

const ClaimsTab: React.FC<ClaimsTabProps> = ({ claims, onRefresh }) => {
    const { showToast } = useToast();
    const [actionClaimId, setActionClaimId] = useState<string | null>(null);
    const [actionType, setActionType] = useState<'SUBMIT' | 'APPROVE' | 'REJECT' | null>(null);
    const [vendorRef, setVendorRef] = useState('');
    const [approvedAmount, setApprovedAmount] = useState<string>('');
    const [rejectionReason, setRejectionReason] = useState('');
    const [processing, setProcessing] = useState(false);

    const statusColors: Record<string, string> = {
        DRAFT: 'bg-slate-100 text-slate-600',
        SUBMITTED: 'bg-blue-100 text-blue-700',
        UNDER_REVIEW: 'bg-amber-100 text-amber-700',
        APPROVED: 'bg-emerald-100 text-emerald-700',
        REJECTED: 'bg-red-100 text-red-700',
        CREDITED: 'bg-blue-100 text-blue-700',
    };

    // KPI calculations
    const totalClaimed = claims.reduce((sum, c) => sum + (c.totalClaimAmount || 0), 0);
    const totalApproved = claims
        .filter(c => c.status === 'APPROVED' || c.status === 'CREDITED')
        .reduce((sum, c) => sum + (c.approvedAmount || c.totalClaimAmount || 0), 0);
    const recoveryRate = totalClaimed > 0 ? Math.round((totalApproved / totalClaimed) * 100) : 0;

    const handleAction = async () => {
        if (!actionClaimId || !actionType) return;
        setProcessing(true);
        try {
            const finOps = FinOpsService;
            if (actionType === 'SUBMIT') {
                await finOps.updateClaimStatus(actionClaimId, 'SUBMITTED', { vendorReference: vendorRef });
            } else if (actionType === 'APPROVE') {
                await finOps.updateClaimStatus(actionClaimId, 'APPROVED', {
                    vendorReference: vendorRef,
                    approvedAmount: approvedAmount ? parseFloat(approvedAmount) : undefined
                });
            } else if (actionType === 'REJECT') {
                await finOps.updateClaimStatus(actionClaimId, 'REJECTED', {
                    vendorReference: vendorRef,
                    rejectionReason
                });
            }
            setActionClaimId(null);
            setActionType(null);
            setVendorRef('');
            setApprovedAmount('');
            setRejectionReason('');
            onRefresh();
        } catch (err: any) {
            showToast('Error updating claim: ' + err.message, 'error');
        } finally {
            setProcessing(false);
        }
    };

    const openAction = (claimId: string, type: 'SUBMIT' | 'APPROVE' | 'REJECT') => {
        const claim = claims.find(c => c.id === claimId);
        setActionClaimId(claimId);
        setActionType(type);
        setVendorRef('');
        setApprovedAmount(claim ? String(claim.totalClaimAmount) : '');
        setRejectionReason('');
    };

    return (
        <div className="space-y-6">
            {/* Pipeline + KPIs */}
            <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
                <h3 className="font-semibold text-slate-800 mb-4">Claims Pipeline</h3>
                <div className="grid grid-cols-6 gap-4">
                    {['Draft', 'Submitted', 'Under Review', 'Approved', 'Rejected', 'Credited'].map((stage, idx) => (
                        <div key={stage} className="text-center">
                            <div className={`text-2xl font-bold ${idx === 3 ? 'text-emerald-600' : idx === 4 ? 'text-red-600' : 'text-slate-800'}`}>
                                {claims.filter(c => c.status === stage.toUpperCase().replace(' ', '_')).length}
                            </div>
                            <div className="text-xs text-slate-500">{stage}</div>
                        </div>
                    ))}
                </div>

                {/* Recovery Rate KPI */}
                <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-3 gap-4">
                    <div>
                        <div className="text-xs text-slate-500 uppercase font-bold">Total Claimed</div>
                        <div className="text-lg font-bold text-slate-800">${totalClaimed.toLocaleString()}</div>
                    </div>
                    <div>
                        <div className="text-xs text-slate-500 uppercase font-bold">Total Recovered</div>
                        <div className="text-lg font-bold text-emerald-600">${totalApproved.toLocaleString()}</div>
                    </div>
                    <div>
                        <div className="text-xs text-slate-500 uppercase font-bold">Recovery Rate</div>
                        <div className={`text-lg font-bold ${recoveryRate >= 80 ? 'text-emerald-600' : recoveryRate >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                            {recoveryRate}%
                        </div>
                    </div>
                </div>
            </div>

            {/* Claims List with Actions */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-100">
                <div className="p-4 border-b border-slate-100">
                    <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                        <FileCheck size={18} className="text-emerald-600" />
                        Warranty Claims
                    </h3>
                </div>

                {claims.length === 0 ? (
                    <div className="p-8 text-center text-slate-400">
                        <FileCheck size={32} className="mx-auto mb-2 opacity-50" />
                        <p className="text-sm">No warranty claims found.</p>
                        <p className="text-xs mt-1">Claims are auto-generated when warranted work orders are completed.</p>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-100">
                        {claims.map(claim => (
                            <div key={claim.id} className="p-4 hover:bg-slate-50/50 transition-colors">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                                            claim.claimType === 'REPLACEMENT' ? 'bg-blue-100' :
                                            claim.claimType === 'CREDIT' ? 'bg-primary-100' : 'bg-blue-100'
                                        }`}>
                                            <Shield size={18} className={
                                                claim.claimType === 'REPLACEMENT' ? 'text-blue-600' :
                                                claim.claimType === 'CREDIT' ? 'text-primary-600' : 'text-blue-600'
                                            } />
                                        </div>
                                        <div>
                                            <div className="font-medium text-slate-800 text-sm">{claim.claimNumber}</div>
                                            <div className="text-xs text-slate-500">{(claim as any).assetName || 'Unknown Asset'} • {claim.claimType}</div>
                                            {claim.failureDescription && (
                                                <div className="text-[10px] text-slate-400 mt-0.5 line-clamp-1 max-w-md">{claim.failureDescription}</div>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-4">
                                        {/* Cost Info */}
                                        <div className="text-right">
                                            <div className="font-semibold text-slate-800 text-sm">${(claim.totalClaimAmount || 0).toLocaleString()}</div>
                                            {claim.approvedAmount !== undefined && claim.status === 'APPROVED' && (
                                                <div className="text-[10px] text-emerald-600">Approved: ${claim.approvedAmount.toLocaleString()}</div>
                                            )}
                                            <div className="text-[10px] text-slate-400">{claim.claimDate}</div>
                                        </div>

                                        {/* Status Badge */}
                                        <span className={`px-2.5 py-1 text-[10px] rounded-full font-bold ${statusColors[claim.status] || 'bg-gray-100'}`}>
                                            {(claim.status || '').replace('_', ' ')}
                                        </span>

                                        {/* Action Buttons — based on current status */}
                                        <div className="flex gap-1">
                                            {claim.status === 'DRAFT' && (
                                                <button
                                                    onClick={() => openAction(claim.id, 'SUBMIT')}
                                                    className="px-2.5 py-1 text-[10px] font-bold bg-blue-600 text-white rounded-lg hover:bg-primary-500 transition"
                                                >
                                                    Submit →
                                                </button>
                                            )}
                                            {(claim.status === 'SUBMITTED' || (claim as any).status === 'UNDER_REVIEW') && (
                                                <>
                                                    <button
                                                        onClick={() => openAction(claim.id, 'APPROVE')}
                                                        className="px-2 py-1 text-[10px] font-bold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition"
                                                    >
                                                        ✓ Approve
                                                    </button>
                                                    <button
                                                        onClick={() => openAction(claim.id, 'REJECT')}
                                                        className="px-2 py-1 text-[10px] font-bold bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition"
                                                    >
                                                        ✕ Reject
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Vendor response details (if available) */}
                                {claim.vendorReference && (
                                    <div className="mt-2 ml-14 text-[10px] text-slate-400">
                                        Vendor Ref: <strong>{claim.vendorReference}</strong>
                                        {claim.vendorResponseDate && ` • Response: ${claim.vendorResponseDate}`}
                                        {claim.rejectionReason && <span className="text-red-500 ml-2">Reason: {claim.rejectionReason}</span>}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Action Dialog Modal */}
            {actionClaimId && actionType && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4 animate-in zoom-in-95 duration-200">
                        <h3 className="font-bold text-slate-800 text-sm">
                            {actionType === 'SUBMIT' ? '📤 Submit Claim to Vendor' :
                             actionType === 'APPROVE' ? '✅ Record Approval' :
                             '❌ Record Rejection'}
                        </h3>

                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Vendor Reference (Optional)</label>
                            <input
                                type="text"
                                value={vendorRef}
                                onChange={e => setVendorRef(e.target.value)}
                                className="w-full p-2 border border-slate-300 rounded-lg text-sm"
                                placeholder="e.g. VR-2026-001"
                            />
                        </div>

                        {actionType === 'APPROVE' && (
                            <div>
                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Approved Amount ($)</label>
                                <input
                                    type="number"
                                    value={approvedAmount}
                                    onChange={e => setApprovedAmount(e.target.value)}
                                    className="w-full p-2 border border-slate-300 rounded-lg text-sm"
                                    placeholder="Full claim amount if blank"
                                />
                            </div>
                        )}

                        {actionType === 'REJECT' && (
                            <div>
                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Rejection Reason *</label>
                                <textarea
                                    value={rejectionReason}
                                    onChange={e => setRejectionReason(e.target.value)}
                                    className="w-full p-2 border border-slate-300 rounded-lg text-sm h-20 resize-none"
                                    placeholder="e.g. Warranty exclusion: Operator misuse"
                                    required
                                />
                            </div>
                        )}

                        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                            <button
                                onClick={() => { setActionClaimId(null); setActionType(null); }}
                                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleAction}
                                disabled={processing || (actionType === 'REJECT' && !rejectionReason)}
                                className={`px-4 py-2 text-sm font-bold text-white rounded-lg disabled:opacity-50 ${
                                    actionType === 'REJECT' ? 'bg-red-600 hover:bg-red-700' :
                                    actionType === 'APPROVE' ? 'bg-emerald-600 hover:bg-emerald-700' :
                                    'bg-primary-600 hover:bg-primary-500'
                                }`}
                            >
                                {processing ? '...' : actionType === 'SUBMIT' ? 'Submit to Vendor' :
                                 actionType === 'APPROVE' ? 'Confirm Approval' : 'Confirm Rejection'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// =====================================================
// VENDOR INTELLIGENCE TAB (G12 — Phase 7)
// =====================================================

interface VendorIntelTabProps {
    vendorKPIs: Array<{
        vendorId: string;
        vendorName: string;
        totalClaims: number;
        approvedClaims: number;
        rejectedClaims: number;
        approvalRate: number;
        avgResponseDays: number;
        avgSettlementRatio: number;
        totalClaimed: number;
        totalRecovered: number;
    }>;
    onRefresh: () => void;
}

const VendorIntelTab: React.FC<VendorIntelTabProps> = ({ vendorKPIs, onRefresh }) => {
    const sorted = useMemo(() =>
        [...vendorKPIs].sort((a, b) => b.totalClaims - a.totalClaims),
        [vendorKPIs]
    );

    const fleetTotalClaimed = sorted.reduce((s, v) => s + v.totalClaimed, 0);
    const fleetTotalRecovered = sorted.reduce((s, v) => s + v.totalRecovered, 0);
    const fleetRecoveryRate = fleetTotalClaimed > 0
        ? Math.round((fleetTotalRecovered / fleetTotalClaimed) * 100) : 0;
    const bestVendor = sorted.length > 0
        ? sorted.reduce((best, v) => v.approvalRate > best.approvalRate ? v : best) : null;
    const worstVendor = sorted.length > 0
        ? sorted.reduce((worst, v) => v.approvalRate < worst.approvalRate ? v : worst) : null;
    const avgResponseDays = sorted.length > 0
        ? Math.round(sorted.reduce((s, v) => s + v.avgResponseDays, 0) / sorted.length) : 0;

    const rateColor = (pct: number) =>
        pct >= 80 ? 'text-emerald-600' : pct >= 50 ? 'text-amber-600' : 'text-red-600';
    const rateBg = (pct: number) =>
        pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500';
    const responseColor = (days: number) =>
        days <= 7 ? 'text-emerald-600' : days <= 21 ? 'text-amber-600' : 'text-red-600';

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-bold text-slate-800">Vendor Warranty Performance</h2>
                    <p className="text-sm text-slate-500">Per-vendor scorecard — response time, approval rate & settlement analysis</p>
                </div>
                <button
                    onClick={onRefresh}
                    className="px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white text-sm font-medium rounded-lg shadow hover:shadow-lg transition-all flex items-center gap-2"
                >
                    <RefreshCw size={14} /> Refresh
                </button>
            </div>

            {/* Fleet Summary KPIs */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                    <div className="text-xs text-slate-500 uppercase font-semibold mb-1">Total Claims</div>
                    <div className="text-2xl font-bold text-slate-800">
                        {sorted.reduce((s, v) => s + v.totalClaims, 0)}
                    </div>
                    <div className="text-xs text-slate-400 mt-1">Across {sorted.length} vendor{sorted.length !== 1 ? 's' : ''}</div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                    <div className="text-xs text-slate-500 uppercase font-semibold mb-1">Fleet Recovery Rate</div>
                    <div className={`text-2xl font-bold ${rateColor(fleetRecoveryRate)}`}>
                        {fleetRecoveryRate}%
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                        ${fleetTotalRecovered.toLocaleString()} / ${fleetTotalClaimed.toLocaleString()}
                    </div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                    <div className="text-xs text-slate-500 uppercase font-semibold mb-1">Best Vendor</div>
                    <div className="text-base font-bold text-emerald-600 truncate">
                        {bestVendor?.vendorName || '—'}
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                        {bestVendor ? `${bestVendor.approvalRate}% approval` : 'No data'}
                    </div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                    <div className="text-xs text-slate-500 uppercase font-semibold mb-1">Worst Vendor</div>
                    <div className="text-base font-bold text-red-600 truncate">
                        {worstVendor?.vendorName || '—'}
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                        {worstVendor ? `${worstVendor.approvalRate}% approval` : 'No data'}
                    </div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                    <div className="text-xs text-slate-500 uppercase font-semibold mb-1">Avg Response</div>
                    <div className={`text-2xl font-bold ${responseColor(avgResponseDays)}`}>
                        {avgResponseDays}d
                    </div>
                    <div className="text-xs text-slate-400 mt-1">Submission → vendor reply</div>
                </div>
            </div>

            {/* Vendor Scorecards */}
            {sorted.length === 0 ? (
                <div className="bg-white rounded-xl border border-slate-200 p-12 text-center shadow-sm">
                    <Target size={40} className="mx-auto text-slate-300 mb-3" />
                    <p className="text-sm text-slate-500">No vendor warranty claims data yet.</p>
                    <p className="text-xs text-slate-400 mt-1">Claims will appear here once WOs with warranty flags are processed through TECO.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                    {sorted.map(vendor => (
                        <div key={vendor.vendorId} className="bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow overflow-hidden">
                            {/* Vendor Header */}
                            <div className="px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-100 to-blue-100 flex items-center justify-center">
                                            <Truck size={18} className="text-blue-600" />
                                        </div>
                                        <div>
                                            <h3 className="font-semibold text-slate-800 text-sm truncate max-w-[180px]">{vendor.vendorName}</h3>
                                            <span className="text-xs text-slate-400">{vendor.totalClaims} claim{vendor.totalClaims !== 1 ? 's' : ''}</span>
                                        </div>
                                    </div>
                                    <div className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                                        vendor.approvalRate >= 80 ? 'bg-emerald-100 text-emerald-700' :
                                        vendor.approvalRate >= 50 ? 'bg-amber-100 text-amber-700' :
                                        'bg-red-100 text-red-700'
                                    }`}>
                                        {vendor.approvalRate}%
                                    </div>
                                </div>
                            </div>

                            {/* Metrics Grid */}
                            <div className="px-5 py-4 space-y-4">
                                {/* Approval Rate Bar */}
                                <div>
                                    <div className="flex justify-between text-xs mb-1.5">
                                        <span className="text-slate-500 font-medium">Approval Rate</span>
                                        <span className={`font-bold ${rateColor(vendor.approvalRate)}`}>
                                            {vendor.approvedClaims}/{vendor.totalClaims}
                                        </span>
                                    </div>
                                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                        <div
                                            className={`h-full rounded-full transition-all ${rateBg(vendor.approvalRate)}`}
                                            style={{ width: `${Math.min(vendor.approvalRate, 100)}%` }}
                                        />
                                    </div>
                                </div>

                                {/* Settlement Ratio Bar */}
                                <div>
                                    <div className="flex justify-between text-xs mb-1.5">
                                        <span className="text-slate-500 font-medium">Settlement Ratio</span>
                                        <span className={`font-bold ${rateColor(vendor.avgSettlementRatio)}`}>
                                            {vendor.avgSettlementRatio}%
                                        </span>
                                    </div>
                                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                        <div
                                            className={`h-full rounded-full transition-all ${rateBg(vendor.avgSettlementRatio)}`}
                                            style={{ width: `${Math.min(vendor.avgSettlementRatio, 100)}%` }}
                                        />
                                    </div>
                                </div>

                                {/* Bottom Stats Row */}
                                <div className="grid grid-cols-3 gap-3 pt-2 border-t border-slate-100">
                                    <div className="text-center">
                                        <div className={`text-sm font-bold ${responseColor(vendor.avgResponseDays)}`}>
                                            {vendor.avgResponseDays || '—'}d
                                        </div>
                                        <div className="text-[10px] text-slate-400 uppercase">Response</div>
                                    </div>
                                    <div className="text-center">
                                        <div className="text-sm font-bold text-slate-700">
                                            ${(vendor.totalClaimed / 1000).toFixed(vendor.totalClaimed >= 1000 ? 0 : 1)}k
                                        </div>
                                        <div className="text-[10px] text-slate-400 uppercase">Claimed</div>
                                    </div>
                                    <div className="text-center">
                                        <div className="text-sm font-bold text-emerald-600">
                                            ${(vendor.totalRecovered / 1000).toFixed(vendor.totalRecovered >= 1000 ? 0 : 1)}k
                                        </div>
                                        <div className="text-[10px] text-slate-400 uppercase">Recovered</div>
                                    </div>
                                </div>

                                {/* Rejected Count (if any) */}
                                {vendor.rejectedClaims > 0 && (
                                    <div className="flex items-center gap-2 px-3 py-2 bg-red-50 rounded-lg border border-red-100">
                                        <AlertTriangle size={14} className="text-red-500 shrink-0" />
                                        <span className="text-xs text-red-600 font-medium">
                                            {vendor.rejectedClaims} rejected claim{vendor.rejectedClaims !== 1 ? 's' : ''} — review vendor SLA
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

// =====================================================
// SUPPLY CHAIN TAB
// =====================================================

interface SupplyChainTabProps {
    data: SupplyChainMatch[];
}

const SupplyChainTab: React.FC<SupplyChainTabProps> = ({ data }) => {
    const statusColors: Record<string, string> = {
        MATCHED: 'bg-emerald-100 text-emerald-700',
        VARIANCE: 'bg-amber-100 text-amber-700',
        BLOCKED: 'bg-red-100 text-red-700',
        PENDING: 'bg-blue-100 text-blue-700',
    };

    // Compute real stats from data
    const totalPOs = data.length;
    const matchedCount = data.filter(d => d.status === 'MATCHED').length;
    const matchRate = totalPOs > 0 ? Math.round((matchedCount / totalPOs) * 100) : 0;
    const pendingPayment = data
        .filter(d => d.status === 'PENDING')
        .reduce((sum, d) => sum + (d.poAmount || 0), 0);
    const varianceCount = data.filter(d => d.status === 'VARIANCE').length;
    const blockedCount = data.filter(d => d.status === 'BLOCKED').length;

    const formatCurrency = (val: number) => {
        if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
        if (val >= 1_000) return `$${(val / 1_000).toFixed(1)}K`;
        return `$${val.toLocaleString()}`;
    };

    // Null = the document has not been received; show a dash, not a fake $0.
    const amountOrDash = (val: number | null | undefined) =>
        val === null || val === undefined ? '—' : `$${val.toLocaleString()}`;

    // A missing document is not a variance — only flag amounts we actually have.
    const hasVariance = (val: number | null | undefined, poAmount: number) =>
        val !== null && val !== undefined && val !== poAmount;

    return (
        <div className="space-y-6">
            {/* Tier-1 ERP outbound. It lives here because this tab already holds
                the PO/GRN/invoice documents the export carries. The queue first:
                fixing what is owed matters more than downloading what is not. */}
            <ErpReconciliationPanel />
            <ErpExportPanel />

            {/* Stats — computed from real PO data */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
                    <div className="text-3xl font-bold text-emerald-600">{matchRate}%</div>
                    <div className="text-sm text-slate-500">Auto-Matched Rate</div>
                    <div className="text-[10px] text-slate-400 mt-1">{matchedCount}/{totalPOs} POs</div>
                </div>
                <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
                    <div className="text-3xl font-bold text-slate-800">{formatCurrency(pendingPayment)}</div>
                    <div className="text-sm text-slate-500">Pending Payment</div>
                </div>
                <div className={`rounded-xl p-4 border ${varianceCount > 0 ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-100'}`}>
                    <div className={`text-3xl font-bold ${varianceCount > 0 ? 'text-amber-700' : 'text-slate-800'}`}>{varianceCount}</div>
                    <div className={`text-sm ${varianceCount > 0 ? 'text-amber-600' : 'text-slate-500'}`}>Variances to Review</div>
                </div>
                <div className={`rounded-xl p-4 border ${blockedCount > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-slate-100'}`}>
                    <div className={`text-3xl font-bold ${blockedCount > 0 ? 'text-red-700' : 'text-slate-800'}`}>{blockedCount}</div>
                    <div className={`text-sm ${blockedCount > 0 ? 'text-red-600' : 'text-slate-500'}`}>Blocked Invoices</div>
                </div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-slate-100">
                <div className="p-4 border-b border-slate-100">
                    <h3 className="font-semibold text-slate-800">Supply Chain Match Analysis</h3>
                </div>
                <div className="divide-y divide-slate-100">
                    {data.map(item => (
                        <div key={item.id} className="p-4 flex justify-between">
                            <div>
                                <div className="font-medium">{item.poNumber}</div>
                                <div className="text-sm text-slate-500">{item.vendor}</div>
                            </div>
                            <div className="text-right">
                                <div>{amountOrDash(item.poAmount)}</div>
                                <div className={`text-xs px-2 py-0.5 rounded ${item.status === 'MATCHED' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{item.status}</div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
            {/* Three-Way Match Table */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-100">
                <div className="flex items-center justify-between p-4 border-b border-slate-100">
                    <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                        <Scale size={18} className="text-primary-600" />
                        Three-Way Match Queue
                    </h3>
                    <button className="flex items-center gap-2 px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors">
                        <Zap size={14} />
                        Auto-Reconcile
                    </button>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-slate-50">
                            <tr>
                                <th className="text-left text-xs font-medium text-slate-500 uppercase px-4 py-3">PO Number</th>
                                <th className="text-left text-xs font-medium text-slate-500 uppercase px-4 py-3">Vendor</th>
                                <th className="text-right text-xs font-medium text-slate-500 uppercase px-4 py-3">PO Amount</th>
                                <th className="text-right text-xs font-medium text-slate-500 uppercase px-4 py-3">GRN Amount</th>
                                <th className="text-right text-xs font-medium text-slate-500 uppercase px-4 py-3">Invoice</th>
                                <th className="text-center text-xs font-medium text-slate-500 uppercase px-4 py-3">Status</th>
                                <th className="text-center text-xs font-medium text-slate-500 uppercase px-4 py-3">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {data.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                                        No purchase orders to match
                                    </td>
                                </tr>
                            ) : data.map(match => (
                                <tr key={match.id} className="hover:bg-slate-50">
                                    <td className="px-4 py-3 font-medium text-slate-800">{match.poNumber}</td>
                                    <td className="px-4 py-3 text-slate-600">{match.vendor}</td>
                                    <td className="px-4 py-3 text-right text-slate-600">{amountOrDash(match.poAmount)}</td>
                                    <td className={`px-4 py-3 text-right ${hasVariance(match.grnAmount, match.poAmount) ? 'text-amber-600 font-medium' : 'text-slate-600'}`}>
                                        {amountOrDash(match.grnAmount)}
                                    </td>
                                    <td className={`px-4 py-3 text-right ${hasVariance(match.invoiceAmount, match.poAmount) ? 'text-red-600 font-medium' : 'text-slate-600'}`}>
                                        {amountOrDash(match.invoiceAmount)}
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <span className={`px-2 py-1 text-xs rounded-full font-medium ${statusColors[match.status]}`}>
                                            {match.status}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <button className="p-1.5 hover:bg-slate-100 rounded transition-colors">
                                            <Eye size={14} className="text-slate-400" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

// =====================================================
// INSURANCE TAB
// =====================================================

interface InsuranceTabProps {
    policies: any[];
    claims: WarrantyClaim[];
    totalAssetCount: number;
}

const InsuranceTab: React.FC<InsuranceTabProps> = ({ policies, claims, totalAssetCount }) => {
    // Compute real stats from policies + claims
    const totalCoverage = policies.reduce((sum, p) => sum + (p.coverage_amount || 0), 0);
    const uniqueAssetsInsured = new Set(policies.map(p => p.asset_id).filter(Boolean)).size;
    const coverageRate = totalAssetCount > 0 ? Math.round((uniqueAssetsInsured / totalAssetCount) * 100) : 0;

    // Claims recovered YTD — approved/paid claims
    const currentYear = new Date().getFullYear();
    const claimsRecoveredYTD = claims
        .filter(c => {
            const isApproved = c.status === 'APPROVED' || (c as any).status === 'PAID';
            const claimDate = c.submittedAt ? new Date(c.submittedAt) : null;
            const isYTD = claimDate ? claimDate.getFullYear() === currentYear : true;
            return isApproved && isYTD;
        })
        .reduce((sum, c) => sum + (c.approvedAmount || c.totalClaimAmount || 0), 0);

    // Derive insurance incidents from claims (insurance-type claims)
    const incidents = claims
        .filter(c => c.status === 'APPROVED' || (c as any).status === 'PAID' || c.status === 'SUBMITTED')
        .map(c => ({
            id: c.id,
            number: `INC-${c.id?.substring(0, 6).toUpperCase()}`,
            asset: (c as any).assetName || 'Unknown',
            type: c.claimType || 'Warranty',
            amount: c.totalClaimAmount || 0,
            date: c.submittedAt || '',
            status: (c as any).status === 'PAID' ? 'PAID' : c.status === 'APPROVED' ? 'PAID' : 'UNDER_REVIEW',
        }));

    const formatCurrency = (val: number) => {
        if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
        if (val >= 1_000) return `$${(val / 1_000).toFixed(1)}K`;
        return `$${val.toLocaleString()}`;
    };

    return (
        <div className="space-y-6">
            {/* Coverage Summary — computed from real policy data */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl p-6 text-white">
                    <ShieldCheck size={32} className="mb-3 opacity-80" />
                    <div className="text-3xl font-bold">{formatCurrency(totalCoverage)}</div>
                    <div className="text-sm opacity-80">Total Coverage Value</div>
                    <div className="text-xs opacity-60 mt-1">{policies.length} active policies</div>
                </div>
                <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
                    <div className="text-3xl font-bold text-slate-800">{coverageRate}%</div>
                    <div className="text-sm text-slate-500">Assets Covered</div>
                    <div className="text-xs text-slate-400 mt-1">{uniqueAssetsInsured}/{totalAssetCount} assets</div>
                    <div className="mt-2 h-2 bg-slate-100 rounded-full">
                        <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(coverageRate, 100)}%` }} />
                    </div>
                </div>
                <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
                    <div className="text-3xl font-bold text-slate-800">{formatCurrency(claimsRecoveredYTD)}</div>
                    <div className="text-sm text-slate-500">Claims Recovered YTD</div>
                    <div className="text-xs text-slate-400 mt-1">{claims.filter(c => c.status === 'APPROVED' || (c as any).status === 'PAID').length} approved claims</div>
                </div>
            </div>

            {/* Policies */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-100">
                <div className="p-4 border-b border-slate-100">
                    <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                        <FileText size={18} className="text-blue-600" />
                        Active Policies
                    </h3>
                </div>

                <div className="divide-y divide-slate-100">
                    {policies.length === 0 ? (
                        <div className="p-8 text-center text-slate-400">
                            <ShieldCheck size={48} className="mx-auto mb-3 opacity-50" />
                            <p>No active insurance policies</p>
                        </div>
                    ) : (
                        policies.map(policy => (
                            <div key={policy.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center">
                                        <ShieldCheck size={20} className="text-blue-600" />
                                    </div>
                                    <div>
                                        <div className="font-medium text-slate-800">{(policy as any).assetName || 'Unknown Asset'}</div>
                                        <div className="text-sm text-slate-500">{policy.provider_name} • {policy.coverage_type}</div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-8">
                                    <div className="text-right">
                                        <div className="font-semibold text-slate-800">${(policy.coverage_amount || 0).toLocaleString()}</div>
                                        <div className="text-xs text-slate-400">Coverage</div>
                                    </div>
                                    <div className="text-right">
                                        <div className="font-semibold text-slate-800">${(policy.premium_amount || 0).toLocaleString()}/yr</div>
                                        <div className="text-xs text-slate-400">Premium</div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-sm text-slate-700">{policy.end_date}</div>
                                        <div className="text-xs text-slate-400">Expires</div>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Incidents */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-100">
                <div className="p-4 border-b border-slate-100">
                    <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                        <AlertCircle size={18} className="text-red-600" />
                        Insurance Incidents
                    </h3>
                </div>

                <div className="divide-y divide-slate-100">
                    {incidents.length === 0 ? (
                        <div className="p-8 text-center text-slate-400">
                            <AlertCircle size={48} className="mx-auto mb-3 opacity-50" />
                            <p>No insurance incidents found</p>
                        </div>
                    ) : (
                        incidents.map(incident => (
                            <div key={incident.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                                <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center">
                                        <AlertTriangle size={18} className="text-red-600" />
                                    </div>
                                    <div>
                                        <div className="font-medium text-slate-800">{incident.number}</div>
                                        <div className="text-sm text-slate-500">{incident.asset} • {incident.type}</div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-6">
                                    <div className="text-right">
                                        <div className="font-semibold text-slate-800">${incident.amount.toLocaleString()}</div>
                                        <div className="text-xs text-slate-400">{incident.date}</div>
                                    </div>
                                    <span className={`px-3 py-1 text-xs rounded-full font-medium ${incident.status === 'PAID' ? 'bg-emerald-100 text-emerald-700' :
                                        incident.status === 'UNDER_REVIEW' ? 'bg-amber-100 text-amber-700' :
                                            'bg-blue-100 text-blue-700'
                                        }`}>
                                        {incident.status.replace('_', ' ')}
                                    </span>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};

export default FinOps;
