import { supabase } from './supabase';

/**
 * Available-to-Promise helpers (0201).
 *
 * inventory_items.stock_reserved is materialized by DB triggers from planned
 * parts on open work orders; ATP = on-hand − reserved. Fetch is tolerant of a
 * pre-0201 database (returns an empty map, callers fall back to on-hand).
 */

/** ATP never goes below zero for display/eventing purposes. */
export function availableQty(onHand: number, reserved: number): number {
    return Math.max(0, (onHand || 0) - (reserved || 0));
}

/** stock_reserved per item id; empty map pre-0201 or on error. */
export async function fetchReservedByItem(itemIds: string[]): Promise<Record<string, number>> {
    if (itemIds.length === 0) return {};
    try {
        const { data, error } = await supabase
            .from('inventory_items')
            .select('id, stock_reserved')
            .in('id', itemIds);
        if (error) {
            console.warn('[atp] stock_reserved fetch failed (0201 applied?):', error.message);
            return {};
        }
        const map: Record<string, number> = {};
        for (const row of data || []) map[row.id] = parseFloat(row.stock_reserved) || 0;
        return map;
    } catch {
        return {};
    }
}
