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

export interface LowStockItem { itemId: string; code: string; description: string; onHand: number; minLevel: number }

export interface GoodsIssueResult {
    issuedParts: number;
    issuedQty: number;
    alreadyIssued: number;
    shortfalls: { description: string; short: number }[];
    /** Items at or below their reorder point after this issue (0311) — the caller raises STOCK_LOW / STOCK_OUT. */
    lowStock: LowStockItem[];
}

export async function issueWorkOrderParts(woId: string, actor: string): Promise<GoodsIssueResult> {
    const result: GoodsIssueResult = { issuedParts: 0, issuedQty: 0, alreadyIssued: 0, shortfalls: [], lowStock: [] };

    // Preferred path (0311): ONE database transaction — stock, ledger and part
    // rows move together or not at all. The client steps below stay as the
    // fallback for a project that has not applied 0311 yet.
    const { data: rpcData, error: rpcErr } = await supabase.rpc('ers_issue_work_order_parts', { p_wo_id: woId });
    if (!rpcErr && rpcData && typeof rpcData === 'object') {
        const d = rpcData as any;
        result.issuedParts = Number(d.issued_parts) || 0;
        result.issuedQty = Number(d.issued_qty) || 0;
        result.alreadyIssued = Number(d.already_issued) || 0;
        result.shortfalls = Array.isArray(d.shortfalls) ? d.shortfalls.map((s: any) => ({ description: String(s.description || 'part'), short: Number(s.short) || 0 })) : [];
        result.lowStock = Array.isArray(d.low_stock) ? d.low_stock.map((l: any) => ({ itemId: String(l.item_id), code: String(l.code || ''), description: String(l.description || ''), onHand: Number(l.on_hand) || 0, minLevel: Number(l.min_level) || 0 })) : [];
        await settleAfterIssue(woId, actor, result);
        return result;
    }
    if (rpcErr && !/ers_issue_work_order_parts|does not exist|Could not find/i.test(rpcErr.message)) {
        // The function exists and refused (RLS, lock, data) — surface it rather than double-issue client-side.
        throw rpcErr;
    }

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
                    // IN-3 (0245): a goods issue to an order is a 261. The order
                    // link is what makes it one — without wo_id the same movement
                    // is a 201 to a cost center and settles nowhere.
                    movement_type: '261',
                    wo_id: woId,
                    location_id: t.locationId,
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

        // Fallback path: reorder-point check on this item (on-hand across locations).
        try {
            const [{ data: item }, { data: levels }] = await Promise.all([
                supabase.from('inventory_items').select('id, code, description, min_level').eq('id', part.item_id).maybeSingle(),
                supabase.from('inventory_stock').select('quantity').eq('item_id', part.item_id),
            ]);
            const onHand = (levels || []).reduce((s: number, r: any) => s + (Number(r.quantity) || 0), 0);
            if (item && Number(item.min_level) > 0 && onHand <= Number(item.min_level)) {
                result.lowStock.push({ itemId: item.id, code: item.code || '', description: item.description || '', onHand, minLevel: Number(item.min_level) });
            }
        } catch { /* advisory */ }
    }

    await settleAfterIssue(woId, actor, result);
    return result;
}

async function settleAfterIssue(woId: string, actor: string, result: GoodsIssueResult): Promise<void> {
    if (result.issuedParts <= 0) return;
    console.log(`[GoodsIssue] WO ${woId}: issued ${result.issuedParts} part line(s) (${result.issuedQty} qty) by ${actor};` +
        (result.shortfalls.length ? ` shortfalls: ${result.shortfalls.map(s => `${s.description} -${s.short}`).join(', ')}` : ' no shortfalls'));

    // Material only becomes actual cost once it is issued (0245), and the
    // settlement trigger fired on the status change a moment BEFORE these
    // rows flipped — so it saw no material. Re-settle now that they have.
    // Called by RPC rather than through FinOpsService to keep lib/ free of
    // a dependency on services/. A delta posting, so this cannot double up,
    // and ers_settlement_run() would catch it anyway if this call is lost.
    const { error: settleErr } = await supabase.rpc('ers_settle_work_order', { p_wo_id: woId });
    if (settleErr) {
        console.warn('[GoodsIssue] material settlement deferred to the next run:', settleErr.message);
    }
}
