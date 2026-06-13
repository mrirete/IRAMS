import React, { useState } from 'react';
import {
    Package, Plus, Search, ArrowUpDown, X, XCircle,
    DollarSign, AlertTriangle, TrendingUp, ShoppingCart,
    Layers, Archive, ArrowDownToLine, ArrowUpFromLine,
    ChevronDown, ChevronUp, Pencil, Trash2,
} from 'lucide-react';
import { useInventory } from '../hooks/useInventory';
import type {
    InventoryItem, InventoryTransaction, BOMEntry,
    InventoryCategory, ABCClass, StockStatus, TransactionType,
} from '../types/inventory';
import {
    CATEGORY_LABELS, STOCK_STATUS_LABELS, ABC_CLASS_LABELS,
    TRANSACTION_TYPE_LABELS, UOM_LABELS,
} from '../types/inventory';
import type { InventorySortField } from '../hooks/useInventory';
import { ItemFormModal } from '../components/inventory/ItemFormModal';

// ═══════════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════════

const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ═══════════════════════════════════════════════════════════════════════
//  PAGE COMPONENT
// ═══════════════════════════════════════════════════════════════════════

export const InventoryPage: React.FC = () => {
    const {
        filteredItems, storerooms, summary, reorderAlerts,
        filters, setFilters, sortField, sortDir, handleSort,
        getTransactions, getWhereUsed,
        issueStock, receiveStock,
        addItem, updateItem, deleteItem,
    } = useInventory();

    const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
    const [showIssueModal, setShowIssueModal] = useState(false);
    const [showReceiveModal, setShowReceiveModal] = useState(false);
    const [issueTarget, setIssueTarget] = useState<InventoryItem | null>(null);
    const [receiveTarget, setReceiveTarget] = useState<InventoryItem | null>(null);
    const [showItemFormModal, setShowItemFormModal] = useState(false);
    const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);

    return (
        <div className="space-y-6 pb-20">
            {/* 1. Page Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Inventory & Materials</h1>
                    <p className="text-slate-500 text-sm mt-1">
                        Spare parts, consumables & materials — SMRP Pillar 4
                    </p>
                </div>
                <div className="flex space-x-3">
                    <button
                        onClick={() => { setShowIssueModal(true); setIssueTarget(null); }}
                        className="btn-secondary"
                    >
                        <ArrowUpFromLine size={16} className="mr-2" />
                        Issue Stock
                    </button>
                    <button
                        onClick={() => { setShowReceiveModal(true); setReceiveTarget(null); }}
                        className="btn-secondary"
                    >
                        <ArrowDownToLine size={16} className="mr-2" />
                        Receive Stock
                    </button>
                    <button onClick={() => setShowItemFormModal(true)} className="btn-primary">
                        <Plus size={18} className="mr-2" />
                        Register Item
                    </button>
                </div>
            </div>

            {/* 2. KPI Row */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
                <KpiCard label="Total Items" value={summary.total_items} icon={Package} />
                <KpiCard label="Total Value" value={fmt(summary.total_value_usd)} icon={DollarSign} small />
                <KpiCard label="In Stock" value={summary.in_stock_count} icon={Archive} color="text-green-400" bg="bg-green-500/10" />
                <KpiCard label="Low Stock" value={summary.low_stock_count} icon={AlertTriangle} color="text-yellow-400" bg="bg-yellow-500/10" />
                <KpiCard label="Out of Stock" value={summary.out_of_stock_count} icon={XCircle} color="text-red-400" bg="bg-red-500/10" />
                <KpiCard label="ABC-A Items" value={summary.abc_a_count} icon={Layers} color="text-blue-400" bg="bg-blue-500/10" />
                <KpiCard label="Fill Rate" value={`${summary.fill_rate_pct}%`} icon={TrendingUp} color="text-accent-cyan" bg="bg-accent-cyan/10" />
                <KpiCard label="Pending Orders" value={summary.pending_orders} icon={ShoppingCart} />
            </div>

            {/* 3. Reorder Alerts */}
            {reorderAlerts.length > 0 && (
                <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-lg p-4 flex items-start space-x-3">
                    <AlertTriangle size={20} className="text-yellow-400 mt-0.5 shrink-0" />
                    <div>
                        <h3 className="text-sm font-semibold text-yellow-300 mb-1">Reorder Alerts</h3>
                        <p className="text-xs text-slate-500">
                            {reorderAlerts.length} item(s) at or below reorder point:{' '}
                            {reorderAlerts.map(a => a.part_number).join(', ')}
                        </p>
                    </div>
                </div>
            )}

            {/* 4. Search & Filter Bar */}
            <div className="flex flex-wrap gap-3 items-center">
                <div className="relative flex-1 min-w-[200px]">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Search parts, descriptions, suppliers…"
                        className="input-field pl-10 py-2.5 w-full text-sm"
                        value={filters.search}
                        onChange={e => setFilters({ ...filters, search: e.target.value })}
                    />
                </div>
                <select className="input-field py-2.5 text-sm min-w-[140px]" value={filters.category} onChange={e => setFilters({ ...filters, category: e.target.value as any })}>
                    <option value="all">All Categories</option>
                    {(Object.entries(CATEGORY_LABELS)).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
                </select>
                <select className="input-field py-2.5 text-sm min-w-[120px]" value={filters.abc_class} onChange={e => setFilters({ ...filters, abc_class: e.target.value as any })}>
                    <option value="all">All ABC</option>
                    {(Object.entries(ABC_CLASS_LABELS)).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
                </select>
                <select className="input-field py-2.5 text-sm min-w-[170px]" value={filters.storeroom} onChange={e => setFilters({ ...filters, storeroom: e.target.value as any })}>
                    <option value="all">All Storerooms</option>
                    {storerooms.map(s => (<option key={s.id} value={s.id}>{s.name}</option>))}
                </select>
                <select className="input-field py-2.5 text-sm min-w-[130px]" value={filters.stock_status} onChange={e => setFilters({ ...filters, stock_status: e.target.value as any })}>
                    <option value="all">All Status</option>
                    {(Object.entries(STOCK_STATUS_LABELS)).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
                </select>
            </div>

            {/* 5. Master Table */}
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <InventoryTable
                    items={filteredItems}
                    sortField={sortField}
                    sortDir={sortDir}
                    onSort={handleSort}
                    onRowClick={setSelectedItem}
                />
            </div>

            {/* 6. Detail Slide-Out */}
            {selectedItem && (
                <ItemDetailPanel
                    item={selectedItem}
                    transactions={getTransactions(selectedItem.id)}
                    whereUsed={getWhereUsed(selectedItem.id)}
                    onClose={() => setSelectedItem(null)}
                    onIssue={() => { setIssueTarget(selectedItem); setShowIssueModal(true); }}
                    onReceive={() => { setReceiveTarget(selectedItem); setShowReceiveModal(true); }}
                    onEdit={() => { setEditingItem(selectedItem); setSelectedItem(null); }}
                    onDelete={() => { deleteItem(selectedItem.id); setSelectedItem(null); }}
                />
            )}

            {/* 7. Modals */}
            {showIssueModal && (
                <StockActionModal
                    title="Issue Stock"
                    items={filteredItems}
                    preselectedItem={issueTarget}
                    onClose={() => setShowIssueModal(false)}
                    onSubmit={(itemId, qty, ref, by) => { issueStock(itemId, qty, ref, by); setShowIssueModal(false); }}
                    refLabel="WO Number"
                />
            )}
            {showReceiveModal && (
                <StockActionModal
                    title="Receive Stock"
                    items={filteredItems}
                    preselectedItem={receiveTarget}
                    onClose={() => setShowReceiveModal(false)}
                    onSubmit={(itemId, qty, ref, by) => { receiveStock(itemId, qty, ref, by); setShowReceiveModal(false); }}
                    refLabel="PO Number"
                />
            )}

            {/* Item Create/Edit Modal */}
            {showItemFormModal && (
                <ItemFormModal
                    mode="create"
                    onClose={() => setShowItemFormModal(false)}
                    onSave={(item) => { addItem(item); setShowItemFormModal(false); }}
                />
            )}
            {editingItem && (
                <ItemFormModal
                    mode="edit"
                    item={editingItem}
                    onClose={() => setEditingItem(null)}
                    onSave={() => { }}
                    onUpdate={(id, patch) => { updateItem(id, patch); setEditingItem(null); }}
                />
            )}
        </div>
    );
};


// ═══════════════════════════════════════════════════════════════════════
//  KPI CARD
// ═══════════════════════════════════════════════════════════════════════

function KpiCard({ label, value, icon: Icon, color = 'text-accent-blue', bg = 'bg-accent-blue/10', small }: any) {
    return (
        <div className="bg-white border border-slate-200 rounded-lg p-4 flex items-center shadow-sm">
            <div className={`p-2.5 rounded-md ${bg} ${color} mr-3 shrink-0`}>
                <Icon size={18} />
            </div>
            <div className="min-w-0">
                <p className="text-slate-400 text-[10px] uppercase tracking-wider font-semibold mb-0.5 truncate">{label}</p>
                <h3 className={`font-bold text-brand-50 tracking-tight truncate ${small ? 'text-sm font-mono' : 'text-lg'}`}>{value}</h3>
            </div>
        </div>
    );
}


// ═══════════════════════════════════════════════════════════════════════
//  MASTER TABLE
// ═══════════════════════════════════════════════════════════════════════

function SortHeader({ label, field, activeField, dir, onSort }: { label: string; field: InventorySortField; activeField: string; dir: string; onSort: (f: InventorySortField) => void }) {
    const active = field === activeField;
    return (
        <th
            className="px-4 py-3.5 font-semibold tracking-wider cursor-pointer select-none hover:text-brand-200 transition-colors"
            onClick={() => onSort(field)}
        >
            <span className="inline-flex items-center space-x-1">
                <span>{label}</span>
                {active ? (dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : <ArrowUpDown size={10} className="opacity-30" />}
            </span>
        </th>
    );
}

function InventoryTable({ items, sortField, sortDir, onSort, onRowClick }: {
    items: InventoryItem[]; sortField: string; sortDir: string;
    onSort: (f: InventorySortField) => void; onRowClick: (i: InventoryItem) => void;
}) {
    if (items.length === 0) return <div className="p-8 text-center text-slate-400">No items match your filters.</div>;
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
                <thead className="text-xs text-slate-500 uppercase bg-brand-800/50 border-b border-slate-200">
                    <tr>
                        <SortHeader label="Part No." field="part_number" activeField={sortField} dir={sortDir} onSort={onSort} />
                        <SortHeader label="Description" field="description" activeField={sortField} dir={sortDir} onSort={onSort} />
                        <th className="px-4 py-3.5 font-semibold tracking-wider">Category</th>
                        <th className="px-4 py-3.5 font-semibold tracking-wider">Storeroom</th>
                        <SortHeader label="Qty" field="qty_on_hand" activeField={sortField} dir={sortDir} onSort={onSort} />
                        <th className="px-4 py-3.5 font-semibold tracking-wider">Min / Max</th>
                        <th className="px-4 py-3.5 font-semibold tracking-wider">ROP</th>
                        <SortHeader label="Unit Cost" field="unit_cost_usd" activeField={sortField} dir={sortDir} onSort={onSort} />
                        <SortHeader label="ABC" field="abc_class" activeField={sortField} dir={sortDir} onSort={onSort} />
                        <SortHeader label="Status" field="stock_status" activeField={sortField} dir={sortDir} onSort={onSort} />
                    </tr>
                </thead>
                <tbody className="divide-y divide-brand-700/50">
                    {items.map(item => (
                        <tr key={item.id} onClick={() => onRowClick(item)} className="hover:bg-slate-100/30 cursor-pointer transition-colors group">
                            <td className="px-4 py-3 font-mono text-slate-800 group-hover:text-accent-cyan text-xs">{item.part_number}</td>
                            <td className="px-4 py-3 text-slate-800 truncate max-w-[220px]">{item.description}</td>
                            <td className="px-4 py-3"><CategoryBadge cat={item.category} /></td>
                            <td className="px-4 py-3 text-slate-500 text-xs truncate max-w-[140px]">{item.storeroom_name}</td>
                            <td className="px-4 py-3 text-slate-800 font-mono font-medium">{item.qty_on_hand}</td>
                            <td className="px-4 py-3 text-slate-500 font-mono text-xs">{item.min_qty} / {item.max_qty}</td>
                            <td className="px-4 py-3 text-slate-500 font-mono text-xs">{item.reorder_point}</td>
                            <td className="px-4 py-3 text-slate-800 font-mono text-xs">{fmt(item.unit_cost_usd)}</td>
                            <td className="px-4 py-3"><ABCBadge cls={item.abc_class} /></td>
                            <td className="px-4 py-3"><StockBadge status={item.stock_status} /></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}


// ═══════════════════════════════════════════════════════════════════════
//  BADGES
// ═══════════════════════════════════════════════════════════════════════

function ABCBadge({ cls }: { cls: ABCClass }) {
    const map: Record<ABCClass, string> = {
        A: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
        B: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
        C: 'text-slate-500 bg-slate-100 border-slate-300',
    };
    return <span className={`px-2 py-0.5 text-xs font-bold rounded border ${map[cls]}`}>{cls}</span>;
}

function StockBadge({ status }: { status: StockStatus }) {
    const map: Record<StockStatus, string> = {
        in_stock: 'text-green-400',
        low_stock: 'text-yellow-400',
        out_of_stock: 'text-red-400',
        on_order: 'text-blue-400',
        discontinued: 'text-slate-400',
    };
    return (
        <span className={`flex items-center space-x-1.5 text-xs font-medium uppercase tracking-wider ${map[status]}`}>
            <span className="w-1.5 h-1.5 rounded-full bg-current" />
            <span>{STOCK_STATUS_LABELS[status]}</span>
        </span>
    );
}

function CategoryBadge({ cat }: { cat: InventoryCategory }) {
    const map: Record<InventoryCategory, string> = {
        spare_part: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
        consumable: 'bg-green-500/10 text-green-400 border-green-500/20',
        rotable: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
        capital_spare: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
        safety_stock: 'bg-red-500/10 text-red-400 border-red-500/20',
    };
    return <span className={`px-2 py-0.5 text-[10px] font-semibold rounded border ${map[cat]}`}>{CATEGORY_LABELS[cat]}</span>;
}


// ═══════════════════════════════════════════════════════════════════════
//  DETAIL SLIDE-OUT
// ═══════════════════════════════════════════════════════════════════════

function ItemDetailPanel({ item, transactions, whereUsed, onClose, onIssue, onReceive, onEdit, onDelete }: {
    item: InventoryItem;
    transactions: InventoryTransaction[];
    whereUsed: BOMEntry[];
    onClose: () => void;
    onIssue: () => void;
    onReceive: () => void;
    onEdit: () => void;
    onDelete: () => void;
}) {
    const [tab, setTab] = useState<'overview' | 'transactions' | 'where_used' | 'forecast'>('overview');

    // Governance Rule 5: Items linked to closed-WO transactions cannot be deleted (only deactivated)
    const hasClosedWOTxn = transactions.some(t => t.txn_type === 'issue' && t.reference?.startsWith('WO-'));

    const tabs: { key: typeof tab; label: string }[] = [
        { key: 'overview', label: 'Overview' },
        { key: 'transactions', label: `Transactions (${transactions.length})` },
        { key: 'where_used', label: `Where Used (${whereUsed.length})` },
        { key: 'forecast', label: 'Forecast' },
    ];

    return (
        <div className="fixed inset-y-0 right-0 w-full md:w-[650px] bg-brand-800 shadow-2xl border-l border-slate-200 z-50 flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-slate-200/50 bg-brand-800/80 backdrop-blur-md">
                <div>
                    <div className="flex items-center space-x-3 mb-1">
                        <CategoryBadge cat={item.category} />
                        <ABCBadge cls={item.abc_class} />
                        <h2 className="text-lg font-bold text-brand-50 font-mono tracking-tight">{item.part_number}</h2>
                    </div>
                    <p className="text-slate-500 text-sm truncate max-w-[450px]">{item.description}</p>
                </div>
                <div className="flex items-center gap-2">
                    {!hasClosedWOTxn && (
                        <button onClick={onDelete} className="p-2 text-red-400 hover:text-red-300 rounded-md hover:bg-red-500/10 transition-colors" title="Delete Item">
                            <Trash2 size={18} />
                        </button>
                    )}
                    <button onClick={onEdit} className="p-2 text-slate-500 hover:text-accent-cyan rounded-md hover:bg-slate-100/50 transition-colors" title="Edit Item">
                        <Pencil size={18} />
                    </button>
                    <button onClick={onClose} className="p-2 text-slate-500 hover:text-white rounded-md hover:bg-slate-100/50 transition-colors">
                        <X size={20} />
                    </button>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-slate-200 px-6">
                {tabs.map(t => (
                    <button
                        key={t.key}
                        onClick={() => setTab(t.key)}
                        className={`px-4 py-3 text-xs font-semibold uppercase tracking-wider transition-colors border-b-2 ${tab === t.key ? 'border-accent-cyan text-accent-cyan' : 'border-transparent text-slate-400 hover:text-slate-800'}`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {tab === 'overview' && <OverviewTab item={item} />}
                {tab === 'transactions' && <TransactionsTab txns={transactions} />}
                {tab === 'where_used' && <WhereUsedTab entries={whereUsed} />}
                {tab === 'forecast' && <ForecastTab item={item} />}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-200 bg-brand-800 flex space-x-3">
                <button onClick={onIssue} className="btn-secondary flex-1">
                    <ArrowUpFromLine size={15} className="mr-2" /> Issue
                </button>
                <button onClick={onReceive} className="btn-primary flex-1">
                    <ArrowDownToLine size={15} className="mr-2" /> Receive
                </button>
            </div>
        </div>
    );
}


// ── Detail Tabs ─────────────────────────────────────────────────

function OverviewTab({ item }: { item: InventoryItem }) {
    return (
        <div className="space-y-6">
            {/* Stock Summary */}
            <div className="grid grid-cols-4 gap-3">
                <MiniStat label="On Hand" value={item.qty_on_hand} />
                <MiniStat label="Min / Max" value={`${item.min_qty} / ${item.max_qty}`} />
                <MiniStat label="Reorder Pt" value={item.reorder_point} />
                <MiniStat label="Lead Time" value={`${item.lead_time_days}d`} />
            </div>

            {/* Cost & Supplier */}
            <div className="grid grid-cols-2 gap-6 bg-slate-50 p-5 rounded-lg border border-slate-200/30">
                <div>
                    <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Unit Cost (USD)</p>
                    <p className="text-slate-800 font-mono font-semibold text-lg">{fmt(item.unit_cost_usd)}</p>
                </div>
                <div>
                    <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Total Value (USD)</p>
                    <p className="text-slate-800 font-mono font-semibold text-lg">{fmt(item.qty_on_hand * item.unit_cost_usd)}</p>
                </div>
                <div>
                    <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Supplier</p>
                    <p className="text-slate-800 text-sm">{item.supplier_name || '—'}</p>
                </div>
                <div>
                    <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Supplier P/N</p>
                    <p className="text-slate-800 font-mono text-xs">{item.supplier_part_number || '—'}</p>
                </div>
                <div>
                    <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">UOM</p>
                    <p className="text-slate-800 text-sm capitalize">{UOM_LABELS[item.unit_of_measure]}</p>
                </div>
                <div>
                    <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Criticality</p>
                    {item.criticality_flag ? (
                        <span className="text-red-400 text-sm font-semibold flex items-center"><AlertTriangle size={14} className="mr-1" /> Safety-Critical</span>
                    ) : (
                        <span className="text-slate-500 text-sm">Standard</span>
                    )}
                </div>
            </div>

            {/* Linked Assets */}
            {item.linked_asset_ids.length > 0 && (
                <div>
                    <h4 className="text-xs text-slate-400 uppercase tracking-wider mb-2 font-semibold">Linked Assets</h4>
                    <div className="flex flex-wrap gap-2">
                        {item.linked_asset_ids.map(id => (
                            <span key={id} className="px-2.5 py-1 bg-slate-100 rounded text-xs font-mono text-brand-200">{id}</span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function TransactionsTab({ txns }: { txns: InventoryTransaction[] }) {
    if (txns.length === 0) return <p className="text-slate-400 text-center py-8">No transactions recorded.</p>;
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
                <thead className="text-[10px] text-slate-500 uppercase border-b border-slate-200">
                    <tr>
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2">Type</th>
                        <th className="px-3 py-2 text-right">Qty</th>
                        <th className="px-3 py-2 text-right">Cost</th>
                        <th className="px-3 py-2">Reference</th>
                        <th className="px-3 py-2">Performed By</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-brand-700/50">
                    {txns.map(t => (
                        <tr key={t.id} className="hover:bg-slate-100/20">
                            <td className="px-3 py-2 text-brand-300">{new Date(t.timestamp).toLocaleDateString()}</td>
                            <td className="px-3 py-2"><TxnTypeBadge type={t.txn_type} /></td>
                            <td className={`px-3 py-2 text-right font-mono font-medium ${t.qty < 0 ? 'text-red-400' : 'text-green-400'}`}>{t.qty > 0 ? '+' : ''}{t.qty}</td>
                            <td className="px-3 py-2 text-right font-mono text-brand-300">{fmt(t.total_cost_usd)}</td>
                            <td className="px-3 py-2 font-mono text-slate-500">{t.reference || '—'}</td>
                            <td className="px-3 py-2 text-slate-500">{t.performed_by}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function WhereUsedTab({ entries }: { entries: BOMEntry[] }) {
    if (entries.length === 0) return <p className="text-slate-400 text-center py-8">Not referenced in any BOM.</p>;
    return (
        <div className="space-y-3">
            {entries.map(e => (
                <div key={e.id} className="bg-slate-50 border border-slate-200/30 rounded-lg p-4 flex items-center justify-between">
                    <div>
                        <p className="text-slate-800 font-mono text-sm font-medium">{e.asset_id}</p>
                        <p className="text-slate-500 text-xs mt-0.5">
                            Qty required: <span className="font-mono text-brand-200">{e.qty_required}</span>
                            {e.replacement_interval_days && (
                                <> • Replace every <span className="font-mono text-brand-200">{e.replacement_interval_days}d</span></>
                            )}
                        </p>
                    </div>
                    <div className="text-right">
                        {e.criticality_flag && (
                            <span className="text-red-400 text-[10px] uppercase font-semibold flex items-center"><AlertTriangle size={12} className="mr-1" /> Critical</span>
                        )}
                        <p className="text-slate-500 text-xs font-mono mt-1">{fmt(e.unit_cost_usd)} × {e.qty_required}</p>
                    </div>
                </div>
            ))}
        </div>
    );
}

function ForecastTab({ item }: { item: InventoryItem }) {
    // Simple forecast visualization based on annual usage
    const monthlyUsage = item.annual_usage_qty / 12;
    const monthsRunway = monthlyUsage > 0 ? Math.round((item.qty_on_hand / monthlyUsage) * 10) / 10 : Infinity;
    const stockoutRisk = monthsRunway <= 1 ? 'HIGH' : monthsRunway <= 3 ? 'MEDIUM' : 'LOW';
    const riskColor = { HIGH: 'text-red-400', MEDIUM: 'text-yellow-400', LOW: 'text-green-400' }[stockoutRisk];

    // Build 6-month forecast bars
    const months = Array.from({ length: 6 }, (_, i) => {
        const projected = Math.max(0, item.qty_on_hand - monthlyUsage * (i + 1));
        return { month: i + 1, qty: Math.round(projected) };
    });
    const maxQty = Math.max(item.qty_on_hand, item.max_qty, 1);

    return (
        <div className="space-y-6">
            {/* Summary */}
            <div className="grid grid-cols-3 gap-3">
                <MiniStat label="Monthly Usage" value={Math.round(monthlyUsage * 10) / 10} />
                <MiniStat label="Months Runway" value={monthsRunway === Infinity ? '∞' : `${monthsRunway}mo`} />
                <div className="bg-slate-50 border border-slate-200/30 rounded-lg p-3 text-center">
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">Stockout Risk</p>
                    <p className={`text-sm font-bold ${riskColor}`}>{stockoutRisk}</p>
                </div>
            </div>

            {/* Bar Chart */}
            <div>
                <h4 className="text-xs text-slate-400 uppercase tracking-wider mb-3 font-semibold">6-Month Projected Depletion</h4>
                <div className="space-y-2">
                    {/* Current */}
                    <div className="flex items-center space-x-3">
                        <span className="text-[10px] text-slate-500 w-12 text-right">Now</span>
                        <div className="flex-1 h-5 bg-slate-50 rounded overflow-hidden">
                            <div
                                className="h-full bg-gradient-to-r from-accent-blue to-accent-cyan rounded transition-all"
                                style={{ width: `${Math.min(100, (item.qty_on_hand / maxQty) * 100)}%` }}
                            />
                        </div>
                        <span className="text-xs font-mono text-brand-200 w-10 text-right">{item.qty_on_hand}</span>
                    </div>
                    {months.map(m => {
                        const pct = Math.min(100, (m.qty / maxQty) * 100);
                        const barColor = m.qty <= item.reorder_point ? 'from-red-500 to-red-400' : m.qty <= item.min_qty ? 'from-yellow-500 to-yellow-400' : 'from-accent-blue to-accent-cyan';
                        return (
                            <div key={m.month} className="flex items-center space-x-3">
                                <span className="text-[10px] text-slate-500 w-12 text-right">+{m.month}mo</span>
                                <div className="flex-1 h-5 bg-slate-50 rounded overflow-hidden">
                                    <div className={`h-full bg-gradient-to-r ${barColor} rounded transition-all`} style={{ width: `${pct}%` }} />
                                </div>
                                <span className="text-xs font-mono text-brand-200 w-10 text-right">{m.qty}</span>
                            </div>
                        );
                    })}
                    {/* Reorder point line reminder */}
                    <p className="text-[10px] text-slate-400 mt-1">
                        <span className="inline-block w-2 h-2 bg-red-500 rounded-full mr-1" />
                        Reorder Point = {item.reorder_point}
                    </p>
                </div>
            </div>
        </div>
    );
}


// ── Shared Atoms ─────────────────────────────────────────────────

function MiniStat({ label, value }: { label: string; value: string | number }) {
    return (
        <div className="bg-slate-50 border border-slate-200/30 rounded-lg p-3 text-center">
            <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">{label}</p>
            <p className="text-sm font-bold text-slate-800 font-mono">{value}</p>
        </div>
    );
}

function TxnTypeBadge({ type }: { type: TransactionType }) {
    const map: Record<TransactionType, string> = {
        receipt: 'text-green-400', issue: 'text-red-400', return: 'text-blue-400',
        adjustment: 'text-yellow-400', transfer: 'text-blue-400', cycle_count: 'text-brand-300',
    };
    return <span className={`text-[10px] uppercase font-semibold tracking-wider ${map[type]}`}>{TRANSACTION_TYPE_LABELS[type]}</span>;
}


// ═══════════════════════════════════════════════════════════════════════
//  STOCK ACTION MODAL
// ═══════════════════════════════════════════════════════════════════════

function StockActionModal({ title, items, preselectedItem, onClose, onSubmit, refLabel }: {
    title: string;
    items: InventoryItem[];
    preselectedItem: InventoryItem | null;
    onClose: () => void;
    onSubmit: (itemId: string, qty: number, ref: string, by: string) => void;
    refLabel: string;
}) {
    const [itemId, setItemId] = useState(preselectedItem?.id ?? '');
    const [qty, setQty] = useState(1);
    const [ref, setRef] = useState('');
    const [by, setBy] = useState('');

    const selectedItem = items.find(i => i.id === itemId);

    return (
        <div className="fixed inset-0 bg-brand-950/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
            <div className="bg-white border border-slate-200/50 rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
                <div className="px-6 py-5 border-b border-slate-200/50 flex justify-between items-center">
                    <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
                    <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={20} /></button>
                </div>
                <div className="p-6 space-y-5">
                    <div>
                        <label className="block text-sm font-medium text-brand-300 mb-1.5">Part</label>
                        <select className="input-field py-2.5 w-full text-sm font-mono" value={itemId} onChange={e => setItemId(e.target.value)}>
                            <option value="">Select Part…</option>
                            {items.map(i => <option key={i.id} value={i.id}>{i.part_number} — {i.description}</option>)}
                        </select>
                    </div>
                    {selectedItem && (
                        <div className="bg-slate-50 border border-slate-200/30 p-3 rounded text-xs space-y-1">
                            <p className="text-slate-500">On Hand: <span className="font-mono text-slate-800">{selectedItem.qty_on_hand}</span></p>
                            <p className="text-slate-500">Unit Cost: <span className="font-mono text-slate-800">{fmt(selectedItem.unit_cost_usd)}</span></p>
                        </div>
                    )}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-brand-300 mb-1.5">Quantity</label>
                            <input type="number" min={1} className="input-field py-2.5 w-full text-center" value={qty} onChange={e => setQty(parseInt(e.target.value) || 1)} />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-brand-300 mb-1.5">Total (USD)</label>
                            <p className="input-field py-2.5 w-full text-center bg-slate-50 font-mono text-brand-200">
                                {selectedItem ? fmt(qty * selectedItem.unit_cost_usd) : '—'}
                            </p>
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-brand-300 mb-1.5">{refLabel}</label>
                        <input type="text" className="input-field py-2.5 w-full text-sm font-mono" value={ref} onChange={e => setRef(e.target.value)} placeholder={`e.g. ${refLabel === 'WO Number' ? 'WO-2024-XXXX' : 'PO-2024-XXXX'}`} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-brand-300 mb-1.5">Performed By</label>
                        <input type="text" className="input-field py-2.5 w-full text-sm" value={by} onChange={e => setBy(e.target.value)} placeholder="Full name" />
                    </div>
                </div>
                <div className="p-6 border-t border-slate-200 bg-slate-50 flex justify-end space-x-3">
                    <button onClick={onClose} className="btn-secondary">Cancel</button>
                    <button
                        onClick={() => onSubmit(itemId, qty, ref, by)}
                        disabled={!itemId || qty < 1 || !ref || !by}
                        className="btn-primary disabled:opacity-50"
                    >
                        Confirm {title}
                    </button>
                </div>
            </div>
        </div>
    );
}
