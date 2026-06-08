import { useState, useMemo, useCallback } from 'react';
import type {
    InventoryItem, BOMEntry, Storeroom, InventoryTransaction,
    InventorySummary, InventoryCategory, ABCClass, StockStatus,
    TransactionType,
} from '../types/inventory';

// ═══════════════════════════════════════════════════════════════════════
//  MOCK DATA — Oil & Gas Spare Parts (All prices in USD)
// ═══════════════════════════════════════════════════════════════════════

const d = (daysOff: number) => new Date(Date.now() + daysOff * 86400000).toISOString();

const MOCK_STOREROOMS: Storeroom[] = [
    { id: 'str-01', name: 'Main Warehouse — Site Alpha', site: 'Site Alpha', manager: 'R. Martinez', item_count: 0, total_value_usd: 0 },
    { id: 'str-02', name: 'Satellite Crib — Compressor Hall', site: 'Site Alpha', manager: 'T. Okonkwo', item_count: 0, total_value_usd: 0 },
];

const MOCK_ITEMS: InventoryItem[] = [
    {
        id: 'inv-001', part_number: 'BRG-6205-2RS', description: 'DE Ball Bearing 6205-2RS',
        category: 'spare_part', abc_class: 'A', storeroom_id: 'str-01', storeroom_name: 'Main Warehouse — Site Alpha',
        qty_on_hand: 12, min_qty: 4, max_qty: 24, reorder_point: 6,
        unit_cost_usd: 85.00, unit_of_measure: 'each', lead_time_days: 14,
        linked_asset_ids: ['ast-p100', 'ast-p102'], criticality_flag: true,
        supplier_name: 'SKF Industrial', supplier_part_number: 'SKF-6205-2RSH',
        stock_status: 'in_stock', annual_usage_qty: 48, ordering_cost_usd: 30, holding_cost_pct: 0.25,
    },
    {
        id: 'inv-002', part_number: 'SEAL-TC-65', description: 'Mechanical Seal — Type TC 65mm',
        category: 'spare_part', abc_class: 'A', storeroom_id: 'str-01', storeroom_name: 'Main Warehouse — Site Alpha',
        qty_on_hand: 3, min_qty: 2, max_qty: 8, reorder_point: 2,
        unit_cost_usd: 1250.00, unit_of_measure: 'each', lead_time_days: 42,
        linked_asset_ids: ['ast-p100'], criticality_flag: true,
        supplier_name: 'John Crane', supplier_part_number: 'JC-TC65-SS316',
        stock_status: 'in_stock', annual_usage_qty: 6, ordering_cost_usd: 50, holding_cost_pct: 0.20,
    },
    {
        id: 'inv-003', part_number: 'GSKT-RF-150-4', description: 'Spiral Wound Gasket RF 4" 150#',
        category: 'consumable', abc_class: 'B', storeroom_id: 'str-01', storeroom_name: 'Main Warehouse — Site Alpha',
        qty_on_hand: 45, min_qty: 10, max_qty: 100, reorder_point: 15,
        unit_cost_usd: 32.50, unit_of_measure: 'each', lead_time_days: 7,
        linked_asset_ids: [], criticality_flag: false,
        supplier_name: 'Flexitallic', supplier_part_number: 'FLX-SWG-4-150',
        stock_status: 'in_stock', annual_usage_qty: 120, ordering_cost_usd: 20, holding_cost_pct: 0.25,
    },
    {
        id: 'inv-004', part_number: 'FLT-COALESCE-6', description: 'Fuel Gas Coalescing Filter 6"',
        category: 'spare_part', abc_class: 'B', storeroom_id: 'str-01', storeroom_name: 'Main Warehouse — Site Alpha',
        qty_on_hand: 8, min_qty: 2, max_qty: 16, reorder_point: 4,
        unit_cost_usd: 420.00, unit_of_measure: 'each', lead_time_days: 21,
        linked_asset_ids: ['ast-gt301'], criticality_flag: false,
        supplier_name: 'Pall Corporation', supplier_part_number: 'PALL-CC3LGA7H13',
        stock_status: 'in_stock', annual_usage_qty: 12, ordering_cost_usd: 35, holding_cost_pct: 0.25,
    },
    {
        id: 'inv-005', part_number: 'IMP-SS316-8', description: 'Pump Impeller SS316 — 8" Open',
        category: 'capital_spare', abc_class: 'A', storeroom_id: 'str-01', storeroom_name: 'Main Warehouse — Site Alpha',
        qty_on_hand: 1, min_qty: 1, max_qty: 2, reorder_point: 1,
        unit_cost_usd: 8750.00, unit_of_measure: 'each', lead_time_days: 90,
        linked_asset_ids: ['ast-p100'], criticality_flag: true,
        supplier_name: 'Sulzer Pumps', supplier_part_number: 'SLZ-IMP-8-316L',
        stock_status: 'low_stock', annual_usage_qty: 1, ordering_cost_usd: 75, holding_cost_pct: 0.15,
    },
    {
        id: 'inv-006', part_number: 'LUBE-TURBO-T68', description: 'Turbine Oil ISO VG 68 (20L Pail)',
        category: 'consumable', abc_class: 'B', storeroom_id: 'str-02', storeroom_name: 'Satellite Crib — Compressor Hall',
        qty_on_hand: 6, min_qty: 2, max_qty: 12, reorder_point: 3,
        unit_cost_usd: 189.00, unit_of_measure: 'each', lead_time_days: 5,
        linked_asset_ids: ['ast-gt301', 'ast-comp200'], criticality_flag: false,
        supplier_name: 'Shell Lubricants', supplier_part_number: 'SHELL-TURBO-T68',
        stock_status: 'in_stock', annual_usage_qty: 24, ordering_cost_usd: 25, holding_cost_pct: 0.30,
    },
    {
        id: 'inv-007', part_number: 'VLV-CV-3-SS', description: 'Control Valve Trim Kit 3" SS',
        category: 'spare_part', abc_class: 'A', storeroom_id: 'str-01', storeroom_name: 'Main Warehouse — Site Alpha',
        qty_on_hand: 2, min_qty: 1, max_qty: 4, reorder_point: 1,
        unit_cost_usd: 3200.00, unit_of_measure: 'set', lead_time_days: 56,
        linked_asset_ids: ['ast-comp200'], criticality_flag: true,
        supplier_name: 'Emerson Fisher', supplier_part_number: 'EMR-TRIM-3-316',
        stock_status: 'in_stock', annual_usage_qty: 2, ordering_cost_usd: 60, holding_cost_pct: 0.20,
    },
    {
        id: 'inv-008', part_number: 'COUP-FLEX-42', description: 'Flexible Coupling Element Size 42',
        category: 'rotable', abc_class: 'B', storeroom_id: 'str-02', storeroom_name: 'Satellite Crib — Compressor Hall',
        qty_on_hand: 3, min_qty: 1, max_qty: 6, reorder_point: 2,
        unit_cost_usd: 680.00, unit_of_measure: 'each', lead_time_days: 18,
        linked_asset_ids: ['ast-p100', 'ast-comp200'], criticality_flag: false,
        supplier_name: 'Rexnord', supplier_part_number: 'RXN-OMEGA-42',
        stock_status: 'in_stock', annual_usage_qty: 4, ordering_cost_usd: 30, holding_cost_pct: 0.25,
    },
    {
        id: 'inv-009', part_number: 'V-BLT-SPB-2360', description: 'V-Belt SPB 2360',
        category: 'consumable', abc_class: 'C', storeroom_id: 'str-02', storeroom_name: 'Satellite Crib — Compressor Hall',
        qty_on_hand: 10, min_qty: 4, max_qty: 20, reorder_point: 6,
        unit_cost_usd: 42.00, unit_of_measure: 'each', lead_time_days: 7,
        linked_asset_ids: ['ast-comp200'], criticality_flag: false,
        supplier_name: 'Gates Industrial', supplier_part_number: 'GTS-SPB2360',
        stock_status: 'in_stock', annual_usage_qty: 16, ordering_cost_usd: 15, holding_cost_pct: 0.25,
    },
    {
        id: 'inv-010', part_number: 'INSTR-PT-4-20', description: 'Pressure Transmitter 4-20mA 0-500 psi',
        category: 'spare_part', abc_class: 'A', storeroom_id: 'str-01', storeroom_name: 'Main Warehouse — Site Alpha',
        qty_on_hand: 4, min_qty: 2, max_qty: 8, reorder_point: 2,
        unit_cost_usd: 2100.00, unit_of_measure: 'each', lead_time_days: 28,
        linked_asset_ids: ['ast-gt301'], criticality_flag: true,
        supplier_name: 'Rosemount', supplier_part_number: 'RSM-3051CG-500P',
        stock_status: 'in_stock', annual_usage_qty: 4, ordering_cost_usd: 45, holding_cost_pct: 0.20,
    },
    {
        id: 'inv-011', part_number: 'THRM-CPL-K-12', description: 'Thermocouple Type K 12" SS Sheath',
        category: 'spare_part', abc_class: 'C', storeroom_id: 'str-01', storeroom_name: 'Main Warehouse — Site Alpha',
        qty_on_hand: 15, min_qty: 5, max_qty: 30, reorder_point: 8,
        unit_cost_usd: 65.00, unit_of_measure: 'each', lead_time_days: 10,
        linked_asset_ids: ['ast-gt301'], criticality_flag: false,
        supplier_name: 'Omega Engineering', supplier_part_number: 'OMG-TC-K-12-SS',
        stock_status: 'in_stock', annual_usage_qty: 20, ordering_cost_usd: 20, holding_cost_pct: 0.25,
    },
    {
        id: 'inv-012', part_number: 'VANE-COMP-STG1', description: 'Compressor Vane — Stage 1 (Inconel 718)',
        category: 'capital_spare', abc_class: 'A', storeroom_id: 'str-01', storeroom_name: 'Main Warehouse — Site Alpha',
        qty_on_hand: 0, min_qty: 1, max_qty: 2, reorder_point: 1,
        unit_cost_usd: 14500.00, unit_of_measure: 'each', lead_time_days: 120,
        linked_asset_ids: ['ast-comp200'], criticality_flag: true,
        supplier_name: 'Siemens Energy', supplier_part_number: 'SE-VANE-STG1-IN718',
        stock_status: 'out_of_stock', annual_usage_qty: 0.5, ordering_cost_usd: 100, holding_cost_pct: 0.10,
    },
    {
        id: 'inv-013', part_number: 'PPE-FACESHIELD', description: 'Face Shield — Chemical Splash',
        category: 'safety_stock', abc_class: 'C', storeroom_id: 'str-02', storeroom_name: 'Satellite Crib — Compressor Hall',
        qty_on_hand: 20, min_qty: 10, max_qty: 50, reorder_point: 15,
        unit_cost_usd: 18.50, unit_of_measure: 'each', lead_time_days: 5,
        linked_asset_ids: [], criticality_flag: false,
        supplier_name: 'Honeywell Safety', supplier_part_number: 'HW-FS-CHEM-01',
        stock_status: 'in_stock', annual_usage_qty: 60, ordering_cost_usd: 15, holding_cost_pct: 0.25,
    },
    {
        id: 'inv-014', part_number: 'ORING-VITON-210', description: 'O-Ring Viton 210 (Bulk 50 pack)',
        category: 'consumable', abc_class: 'C', storeroom_id: 'str-01', storeroom_name: 'Main Warehouse — Site Alpha',
        qty_on_hand: 200, min_qty: 50, max_qty: 500, reorder_point: 80,
        unit_cost_usd: 3.25, unit_of_measure: 'each', lead_time_days: 7,
        linked_asset_ids: ['ast-p100', 'ast-p102'], criticality_flag: false,
        supplier_name: 'Parker Hannifin', supplier_part_number: 'PKR-AS568-210-V',
        stock_status: 'in_stock', annual_usage_qty: 300, ordering_cost_usd: 15, holding_cost_pct: 0.25,
    },
    {
        id: 'inv-015', part_number: 'IGN-PLUG-GT', description: 'Gas Turbine Igniter Plug',
        category: 'spare_part', abc_class: 'A', storeroom_id: 'str-01', storeroom_name: 'Main Warehouse — Site Alpha',
        qty_on_hand: 2, min_qty: 2, max_qty: 6, reorder_point: 2,
        unit_cost_usd: 4200.00, unit_of_measure: 'each', lead_time_days: 60,
        linked_asset_ids: ['ast-gt301'], criticality_flag: true,
        supplier_name: 'GE Vernova', supplier_part_number: 'GEV-IGN-7FA-02',
        stock_status: 'low_stock', annual_usage_qty: 2, ordering_cost_usd: 60, holding_cost_pct: 0.15,
    },
];

const MOCK_BOM: BOMEntry[] = [
    { id: 'bom-001', asset_id: 'ast-p101', item_id: 'inv-001', part_number: 'BRG-6205-2RS', description: 'DE Ball Bearing 6205-2RS', qty_required: 2, criticality_flag: true, replacement_interval_days: 365, unit_cost_usd: 85.00 },
    { id: 'bom-002', asset_id: 'ast-p101', item_id: 'inv-002', part_number: 'SEAL-TC-65', description: 'Mechanical Seal — Type TC 65mm', qty_required: 1, criticality_flag: true, replacement_interval_days: 730, unit_cost_usd: 1250.00 },
    { id: 'bom-003', asset_id: 'ast-p101', item_id: 'inv-005', part_number: 'IMP-SS316-8', description: 'Pump Impeller SS316 — 8" Open', qty_required: 1, criticality_flag: true, replacement_interval_days: 1460, unit_cost_usd: 8750.00 },
    { id: 'bom-004', asset_id: 'ast-p101', item_id: 'inv-008', part_number: 'COUP-FLEX-42', description: 'Flexible Coupling Element Size 42', qty_required: 1, criticality_flag: false, replacement_interval_days: 730, unit_cost_usd: 680.00 },
    { id: 'bom-005', asset_id: 'ast-p101', item_id: 'inv-014', part_number: 'ORING-VITON-210', description: 'O-Ring Viton 210', qty_required: 8, criticality_flag: false, replacement_interval_days: 365, unit_cost_usd: 3.25 },
    { id: 'bom-006', asset_id: 'ast-gt301', item_id: 'inv-004', part_number: 'FLT-COALESCE-6', description: 'Fuel Gas Coalescing Filter 6"', qty_required: 2, criticality_flag: false, replacement_interval_days: 180, unit_cost_usd: 420.00 },
    { id: 'bom-007', asset_id: 'ast-gt301', item_id: 'inv-010', part_number: 'INSTR-PT-4-20', description: 'Pressure Transmitter 4-20mA', qty_required: 3, criticality_flag: true, replacement_interval_days: null, unit_cost_usd: 2100.00 },
    { id: 'bom-008', asset_id: 'ast-gt301', item_id: 'inv-011', part_number: 'THRM-CPL-K-12', description: 'Thermocouple Type K 12"', qty_required: 6, criticality_flag: false, replacement_interval_days: 365, unit_cost_usd: 65.00 },
    { id: 'bom-009', asset_id: 'ast-gt301', item_id: 'inv-015', part_number: 'IGN-PLUG-GT', description: 'Gas Turbine Igniter Plug', qty_required: 2, criticality_flag: true, replacement_interval_days: 1095, unit_cost_usd: 4200.00 },
    { id: 'bom-010', asset_id: 'ast-k601', item_id: 'inv-007', part_number: 'VLV-CV-3-SS', description: 'Control Valve Trim Kit 3" SS', qty_required: 1, criticality_flag: true, replacement_interval_days: null, unit_cost_usd: 3200.00 },
    { id: 'bom-011', asset_id: 'ast-k601', item_id: 'inv-012', part_number: 'VANE-COMP-STG1', description: 'Compressor Vane — Stage 1', qty_required: 4, criticality_flag: true, replacement_interval_days: 2190, unit_cost_usd: 14500.00 },
    { id: 'bom-012', asset_id: 'ast-k601', item_id: 'inv-009', part_number: 'V-BLT-SPB-2360', description: 'V-Belt SPB 2360', qty_required: 3, criticality_flag: false, replacement_interval_days: 365, unit_cost_usd: 42.00 },
    { id: 'bom-013', asset_id: 'ast-k601', item_id: 'inv-006', part_number: 'LUBE-TURBO-T68', description: 'Turbine Oil ISO VG 68 (20L Pail)', qty_required: 2, criticality_flag: false, replacement_interval_days: 180, unit_cost_usd: 189.00 },
    { id: 'bom-014', asset_id: 'ast-p102', item_id: 'inv-001', part_number: 'BRG-6205-2RS', description: 'DE Ball Bearing 6205-2RS', qty_required: 2, criticality_flag: true, replacement_interval_days: 365, unit_cost_usd: 85.00 },
    { id: 'bom-015', asset_id: 'ast-p102', item_id: 'inv-014', part_number: 'ORING-VITON-210', description: 'O-Ring Viton 210', qty_required: 6, criticality_flag: false, replacement_interval_days: 365, unit_cost_usd: 3.25 },
    { id: 'bom-016', asset_id: 'ast-gt301', item_id: 'inv-006', part_number: 'LUBE-TURBO-T68', description: 'Turbine Oil ISO VG 68 (20L Pail)', qty_required: 4, criticality_flag: false, replacement_interval_days: 90, unit_cost_usd: 189.00 },
];

const MOCK_TRANSACTIONS: InventoryTransaction[] = [
    { id: 'txn-001', item_id: 'inv-001', storeroom_id: 'str-01', txn_type: 'receipt', qty: 10, unit_cost_usd: 85.00, total_cost_usd: 850.00, reference: 'PO-2024-0341', performed_by: 'R. Martinez', timestamp: d(-30) },
    { id: 'txn-002', item_id: 'inv-001', storeroom_id: 'str-01', txn_type: 'issue', qty: -2, unit_cost_usd: 85.00, total_cost_usd: 170.00, reference: 'WO-2024-1001', performed_by: 'J. Smith', timestamp: d(-15) },
    { id: 'txn-003', item_id: 'inv-002', storeroom_id: 'str-01', txn_type: 'issue', qty: -1, unit_cost_usd: 1250.00, total_cost_usd: 1250.00, reference: 'WO-2024-1003', performed_by: 'A. Johnson', timestamp: d(-6) },
    { id: 'txn-004', item_id: 'inv-006', storeroom_id: 'str-02', txn_type: 'receipt', qty: 4, unit_cost_usd: 189.00, total_cost_usd: 756.00, reference: 'PO-2024-0387', performed_by: 'T. Okonkwo', timestamp: d(-10) },
    { id: 'txn-005', item_id: 'inv-003', storeroom_id: 'str-01', txn_type: 'issue', qty: -6, unit_cost_usd: 32.50, total_cost_usd: 195.00, reference: 'WO-2024-1005', performed_by: 'M. Patel', timestamp: d(-3) },
    { id: 'txn-006', item_id: 'inv-012', storeroom_id: 'str-01', txn_type: 'adjustment', qty: 0, unit_cost_usd: 14500.00, total_cost_usd: 0, reference: 'CC-2024-12', performed_by: 'R. Martinez', timestamp: d(-1) },
    { id: 'txn-007', item_id: 'inv-014', storeroom_id: 'str-01', txn_type: 'receipt', qty: 100, unit_cost_usd: 3.25, total_cost_usd: 325.00, reference: 'PO-2024-0402', performed_by: 'R. Martinez', timestamp: d(-5) },
    { id: 'txn-008', item_id: 'inv-009', storeroom_id: 'str-02', txn_type: 'return', qty: 1, unit_cost_usd: 42.00, total_cost_usd: 42.00, reference: 'WO-2024-1004', performed_by: 'K. Lee', timestamp: d(-2) },
];


// ═══════════════════════════════════════════════════════════════════════
//  COMPUTED HELPERS
// ═══════════════════════════════════════════════════════════════════════

function computeStoreroomStats(items: InventoryItem[], storerooms: Storeroom[]): Storeroom[] {
    return storerooms.map(sr => {
        const srItems = items.filter(i => i.storeroom_id === sr.id);
        return {
            ...sr,
            item_count: srItems.length,
            total_value_usd: srItems.reduce((sum, i) => sum + i.qty_on_hand * i.unit_cost_usd, 0),
        };
    });
}

function computeSummary(items: InventoryItem[]): InventorySummary {
    const total_value = items.reduce((s, i) => s + i.qty_on_hand * i.unit_cost_usd, 0);
    const in_stock = items.filter(i => i.stock_status === 'in_stock').length;
    const low_stock = items.filter(i => i.stock_status === 'low_stock').length;
    const out_of_stock = items.filter(i => i.stock_status === 'out_of_stock').length;
    const on_order = items.filter(i => i.stock_status === 'on_order').length;
    const abc_a = items.filter(i => i.abc_class === 'A').length;
    const abc_b = items.filter(i => i.abc_class === 'B').length;
    const abc_c = items.filter(i => i.abc_class === 'C').length;
    // Fill rate: % of items above reorder point
    const above = items.filter(i => i.qty_on_hand > i.reorder_point).length;
    const fill_rate = items.length > 0 ? Math.round((above / items.length) * 100) : 0;

    return {
        total_items: items.length,
        total_value_usd: Math.round(total_value * 100) / 100,
        in_stock_count: in_stock,
        low_stock_count: low_stock,
        out_of_stock_count: out_of_stock,
        on_order_count: on_order,
        abc_a_count: abc_a,
        abc_b_count: abc_b,
        abc_c_count: abc_c,
        fill_rate_pct: fill_rate,
        pending_orders: on_order,
    };
}


// ═══════════════════════════════════════════════════════════════════════
//  FILTER / SORT
// ═══════════════════════════════════════════════════════════════════════

export interface InventoryFilters {
    search: string;
    category: InventoryCategory | 'all';
    abc_class: ABCClass | 'all';
    storeroom: string | 'all';          // storeroom id
    stock_status: StockStatus | 'all';
}

export type InventorySortField = 'part_number' | 'description' | 'qty_on_hand' | 'unit_cost_usd' | 'abc_class' | 'stock_status';
export type SortDir = 'asc' | 'desc';

const DEFAULT_FILTERS: InventoryFilters = {
    search: '', category: 'all', abc_class: 'all', storeroom: 'all', stock_status: 'all',
};

// ═══════════════════════════════════════════════════════════════════════
//  HOOK
// ═══════════════════════════════════════════════════════════════════════

export function useInventory() {
    const [items, setItems] = useState<InventoryItem[]>(MOCK_ITEMS);
    const [bomEntries] = useState<BOMEntry[]>(MOCK_BOM);
    const [transactions, setTransactions] = useState<InventoryTransaction[]>(MOCK_TRANSACTIONS);
    const [filters, setFilters] = useState<InventoryFilters>(DEFAULT_FILTERS);
    const [sortField, setSortField] = useState<InventorySortField>('part_number');
    const [sortDir, setSortDir] = useState<SortDir>('asc');

    // ── Derived ──────────────────────────────────────────────
    const storerooms = useMemo(() => computeStoreroomStats(items, MOCK_STOREROOMS), [items]);
    const summary = useMemo(() => computeSummary(items), [items]);

    const filteredItems = useMemo(() => {
        let list = [...items];
        const { search, category, abc_class, storeroom, stock_status } = filters;

        if (search) {
            const q = search.toLowerCase();
            list = list.filter(i =>
                i.part_number.toLowerCase().includes(q) ||
                i.description.toLowerCase().includes(q) ||
                (i.supplier_name ?? '').toLowerCase().includes(q)
            );
        }
        if (category !== 'all') list = list.filter(i => i.category === category);
        if (abc_class !== 'all') list = list.filter(i => i.abc_class === abc_class);
        if (storeroom !== 'all') list = list.filter(i => i.storeroom_id === storeroom);
        if (stock_status !== 'all') list = list.filter(i => i.stock_status === stock_status);

        // Sort
        list.sort((a, b) => {
            const aVal = a[sortField];
            const bVal = b[sortField];
            if (typeof aVal === 'string' && typeof bVal === 'string') {
                return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
            }
            return sortDir === 'asc' ? (Number(aVal) - Number(bVal)) : (Number(bVal) - Number(aVal));
        });

        return list;
    }, [items, filters, sortField, sortDir]);

    // BOM for a specific asset
    const getBOMForAsset = useCallback((assetId: string) => {
        return bomEntries.filter(b => b.asset_id === assetId);
    }, [bomEntries]);

    // Where-used: assets that use a given item
    const getWhereUsed = useCallback((itemId: string) => {
        return bomEntries.filter(b => b.item_id === itemId);
    }, [bomEntries]);

    // Transactions for a specific item
    const getTransactions = useCallback((itemId: string) => {
        return transactions.filter(t => t.item_id === itemId);
    }, [transactions]);

    // Reorder alerts
    const reorderAlerts = useMemo(() =>
        items.filter(i => i.qty_on_hand <= i.reorder_point)
        , [items]);

    // ── Mutations ────────────────────────────────────────────

    const addItem = useCallback((item: InventoryItem) => {
        setItems(prev => [...prev, item]);
    }, []);

    const updateItem = useCallback((id: string, patch: Partial<InventoryItem>) => {
        setItems(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i));
    }, []);

    const deleteItem = useCallback((id: string) => {
        setItems(prev => prev.filter(i => i.id !== id));
    }, []);

    // ── Stock Transactions ───────────────────────────────────

    const issueStock = useCallback((itemId: string, qty: number, woNumber: string, performedBy: string) => {
        setItems(prev => prev.map(i => {
            if (i.id !== itemId) return i;
            const newQty = Math.max(0, i.qty_on_hand - qty);
            let status: StockStatus = 'in_stock';
            if (newQty === 0) status = 'out_of_stock';
            else if (newQty <= i.reorder_point) status = 'low_stock';
            return { ...i, qty_on_hand: newQty, stock_status: status };
        }));
        const item = items.find(i => i.id === itemId);
        if (item) {
            const txn: InventoryTransaction = {
                id: `txn-${Date.now()}`, item_id: itemId, storeroom_id: item.storeroom_id,
                txn_type: 'issue', qty: -qty, unit_cost_usd: item.unit_cost_usd,
                total_cost_usd: qty * item.unit_cost_usd, reference: woNumber,
                performed_by: performedBy, timestamp: new Date().toISOString(),
            };
            setTransactions(prev => [txn, ...prev]);
        }
    }, [items]);

    const receiveStock = useCallback((itemId: string, qty: number, poNumber: string, performedBy: string) => {
        setItems(prev => prev.map(i => {
            if (i.id !== itemId) return i;
            const newQty = i.qty_on_hand + qty;
            let status: StockStatus = 'in_stock';
            if (newQty <= i.reorder_point) status = 'low_stock';
            return { ...i, qty_on_hand: newQty, stock_status: status };
        }));
        const item = items.find(i => i.id === itemId);
        if (item) {
            const txn: InventoryTransaction = {
                id: `txn-${Date.now()}`, item_id: itemId, storeroom_id: item.storeroom_id,
                txn_type: 'receipt', qty, unit_cost_usd: item.unit_cost_usd,
                total_cost_usd: qty * item.unit_cost_usd, reference: poNumber,
                performed_by: performedBy, timestamp: new Date().toISOString(),
            };
            setTransactions(prev => [txn, ...prev]);
        }
    }, [items]);

    const returnStock = useCallback((itemId: string, qty: number, woNumber: string, performedBy: string) => {
        setItems(prev => prev.map(i => {
            if (i.id !== itemId) return i;
            const newQty = i.qty_on_hand + qty;
            let status: StockStatus = 'in_stock';
            if (newQty <= i.reorder_point) status = 'low_stock';
            return { ...i, qty_on_hand: newQty, stock_status: status };
        }));
        const item = items.find(i => i.id === itemId);
        if (item) {
            const txn: InventoryTransaction = {
                id: `txn-${Date.now()}`, item_id: itemId, storeroom_id: item.storeroom_id,
                txn_type: 'return', qty, unit_cost_usd: item.unit_cost_usd,
                total_cost_usd: qty * item.unit_cost_usd, reference: woNumber,
                performed_by: performedBy, timestamp: new Date().toISOString(),
            };
            setTransactions(prev => [txn, ...prev]);
        }
    }, [items]);

    // ── Sort handler ─────────────────────────────────────────
    const handleSort = useCallback((field: InventorySortField) => {
        setSortDir(prev => (sortField === field ? (prev === 'asc' ? 'desc' : 'asc') : 'asc'));
        setSortField(field);
    }, [sortField]);

    return {
        // Data
        items, filteredItems, bomEntries, transactions, storerooms, summary,
        reorderAlerts,
        // Lookups
        getBOMForAsset, getWhereUsed, getTransactions,
        // Filters & Sort
        filters, setFilters, sortField, sortDir, handleSort,
        // Mutations
        addItem, updateItem, deleteItem,
        issueStock, receiveStock, returnStock,
    };
}
