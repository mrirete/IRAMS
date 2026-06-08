// ═══════════════════════════════════════════════════════════════════════
//  Inventory & BOM Types — ISO 55000 / SMRP Pillar 4
//  All monetary values in USD ($)
// ═══════════════════════════════════════════════════════════════════════

import type { CriticalityRank } from './assets';

// ── Enums / Literals ────────────────────────────────────────────────

/** Pareto inventory classification */
export type ABCClass = 'A' | 'B' | 'C';

/** Inventory category */
export type InventoryCategory = 'spare_part' | 'consumable' | 'rotable' | 'capital_spare' | 'safety_stock';

/** Current stock status */
export type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock' | 'on_order' | 'discontinued';

/** Unit of measure */
export type UnitOfMeasure = 'each' | 'meter' | 'liter' | 'kg' | 'set' | 'pair' | 'box' | 'roll';

/** Material movement type */
export type TransactionType = 'receipt' | 'issue' | 'return' | 'adjustment' | 'transfer' | 'cycle_count';


// ── Core Records ────────────────────────────────────────────────────

/** A single stockable inventory item / spare part */
export interface InventoryItem {
    id: string;
    part_number: string;
    description: string;
    category: InventoryCategory;
    abc_class: ABCClass;
    storeroom_id: string;
    storeroom_name: string;
    qty_on_hand: number;
    min_qty: number;
    max_qty: number;
    reorder_point: number;
    unit_cost_usd: number;          // USD
    unit_of_measure: UnitOfMeasure;
    lead_time_days: number;
    linked_asset_ids: string[];
    criticality_flag: boolean;
    supplier_name: string | null;
    supplier_part_number: string | null;
    stock_status: StockStatus;
    annual_usage_qty: number;
    ordering_cost_usd: number;      // USD
    holding_cost_pct: number;
}

/** BOM entry — links a spare part to a parent asset */
export interface BOMEntry {
    id: string;
    asset_id: string;
    item_id: string;
    part_number: string;
    description: string;
    qty_required: number;
    criticality_flag: boolean;
    replacement_interval_days: number | null;
    unit_cost_usd: number;          // USD
}

/** Physical storeroom / warehouse */
export interface Storeroom {
    id: string;
    name: string;
    site: string;
    manager: string | null;
    item_count: number;
    total_value_usd: number;        // USD
}

/** Immutable transaction ledger entry */
export interface InventoryTransaction {
    id: string;
    item_id: string;
    storeroom_id: string;
    txn_type: TransactionType;
    qty: number;
    unit_cost_usd: number;          // USD
    total_cost_usd: number;         // USD
    reference: string | null;       // WO number or PO number
    performed_by: string;
    timestamp: string;
}

/** Cycle count variance record */
export interface CycleCountEntry {
    id: string;
    item_id: string;
    storeroom_id: string;
    expected_qty: number;
    actual_qty: number;
    variance: number;
    variance_pct: number;
    resolution: string;
    counted_by: string;
    counted_at: string;
}


// ── Dashboard KPIs ──────────────────────────────────────────────────

/** Aggregated inventory dashboard metrics */
export interface InventorySummary {
    total_items: number;
    total_value_usd: number;       // USD
    in_stock_count: number;
    low_stock_count: number;
    out_of_stock_count: number;
    on_order_count: number;
    abc_a_count: number;
    abc_b_count: number;
    abc_c_count: number;
    fill_rate_pct: number;          // % of demand filled from stock
    pending_orders: number;
}


// ── Label Maps ──────────────────────────────────────────────────────

export const CATEGORY_LABELS: Record<InventoryCategory, string> = {
    spare_part: 'Spare Part',
    consumable: 'Consumable',
    rotable: 'Rotable',
    capital_spare: 'Capital Spare',
    safety_stock: 'Safety Stock',
};

export const STOCK_STATUS_LABELS: Record<StockStatus, string> = {
    in_stock: 'In Stock',
    low_stock: 'Low Stock',
    out_of_stock: 'Out of Stock',
    on_order: 'On Order',
    discontinued: 'Discontinued',
};

export const UOM_LABELS: Record<UnitOfMeasure, string> = {
    each: 'Each',
    meter: 'Meter',
    liter: 'Liter',
    kg: 'Kilogram',
    set: 'Set',
    pair: 'Pair',
    box: 'Box',
    roll: 'Roll',
};

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
    receipt: 'Receipt',
    issue: 'Issue',
    return: 'Return',
    adjustment: 'Adjustment',
    transfer: 'Transfer',
    cycle_count: 'Cycle Count',
};

export const ABC_CLASS_LABELS: Record<ABCClass, string> = {
    A: 'A — Critical',
    B: 'B — Important',
    C: 'C — Standard',
};
