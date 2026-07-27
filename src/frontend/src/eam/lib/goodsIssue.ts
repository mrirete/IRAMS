import { supabase } from './supabase';
import { mustWrite } from './supabaseWrite';

/**
 * Goods issue on work-order completion (B2).
 *
 * Planned parts (`work_order_parts.is_planned = true`) are consumed when the
 * WO reaches TECO: stock decrements per location (largest holding first),
 * an ISSUE transaction is written per movement, and the part row flips to
 * issued (`is_planned = false`, `date_used` stamped). The 0201 trigger sees
 * both the row update and the WO status change, so the reservation releases
 * and on-hand reflects reality at the same moment.
 *
 * Shortfalls don't block: the parts were physically used, so we consume what
 * the stock records hold, floor at zero, and report the gap for stores to
 * reconcile — never silently invent negative stock.
 */

export interface IssueAllocation {
    /** (location stock row id, qty to take) pairs */
    takes: { stockRowId: string; locationId: string; take: number; newQty: number }[];
    shortfall: number;
}

interface StockRow { id: string; location_id: string; quantity: number }

/** Allocate an issue quantity across stock locations, largest holding first. Pure. */
export function allocateIssue(qtyNeeded: number, locations: StockRow[]): IssueAllocation {
    let remaining = qtyNeeded;
    const takes: IssueAllocation['takes'] = [];
    const sorted = [...locations].sort((a, b) => (Number(b.quantity) || 0) - (Number(a.quantity) || 0));
    for (const loc of sorted) {
        if (remaining <= 0) break;
        const held = Number(loc.quantity) || 0;
        if (held <= 0) continue;
        const take = Math.min(remaining, held);
        takes.push({ stockRowId: loc.id, locationId: loc.location_id, take, newQty: held - take });
        remaining -= take;
    }
    return { takes, shortfall: Math.max(0, remaining) };
}

export interface GoodsIssueResult {
    issuedParts: number;
    issuedQty: number;
    alreadyIssued: number;
    shortfalls: { description: string; short: number }[];
}

export async function issueWorkOrderParts(woId: string, actor: string): Promise<GoodsIssueResult> {
    const result: GoodsIssueResult = { issuedParts: 0, issuedQty: 0, alreadyIssued: 0, shortfalls: [] };

    const { data: parts, error } = await supabase
        .from('work_order_parts')
        .select('id, item_id, quantity, unit_cost, is_planned, inventory_items(description)')
        .eq('wo_id', woId);
    if (error) throw error;

    for (const part of parts || []) {
        const qty = Number(part.quantity) || 0;
        if (part.is_planned === false) { result.alreadyIssued++; continue; } // idempotent re-entry
        if (!part.item_id || qty <= 0) continue;

        const description = (part as any).inventory_items?.description || 'part';

        const { data: stock } = await supabase
            .from('inventory_stock')
            .select('id, location_id, quantity')
            .eq('item_id', part.item_id);
        const { takes, shortfall } = allocateIssue(qty, stock || []);

        for (const t of takes) {
            const { error: updErr } = await supabase
                .from('inventory_stock')
                .update({ quantity: t.newQty, updated_at: new Date().toISOString() })
                .eq('id', t.stockRowId);
            if (updErr) throw updErr;

            // The stock level has already moved. If the ledger entry does not
            // land, on-hand quantity and the transaction history disagree and
            // nothing reveals which is right — so this must not fail quietly.
            await mustWrite(
                supabase.from('inventory_transactions').insert({
                    item_id: part.item_id,
                    transaction_type: 'ISSUE',
                    quantity: t.take,
                    cost_at_time: Number(part.unit_cost) || 0,
                    timestamp: new Date().toISOString(),
                }),
                `Issue transaction for item ${part.item_id}`,
            );
        }

        // The part was used either way — mark it issued so cost and history
        // reflect consumption; the 0201 trigger drops its reservation.
        const { error: markErr } = await supabase
            .from('work_order_parts')
            .update({ is_planned: false, date_used: new Date().toISOString().split('T')[0] })
            .eq('id', part.id);
        if (markErr) throw markErr;

        result.issuedParts++;
        result.issuedQty += qty;
        if (shortfall > 0) result.shortfalls.push({ description, short: shortfall });
    }

    if (result.issuedParts > 0) {
        console.log(`[GoodsIssue] WO ${woId}: issued ${result.issuedParts} part line(s) (${result.issuedQty} qty) by ${actor};` +
            (result.shortfalls.length ? ` shortfalls: ${result.shortfalls.map(s => `${s.description} -${s.short}`).join(', ')}` : ' no shortfalls'));
    }
    return result;
}
