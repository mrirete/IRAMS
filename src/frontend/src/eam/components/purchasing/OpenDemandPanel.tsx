import React, { useEffect, useState } from 'react';
import { Loader2, PackageSearch, Plus, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { InventoryItem, PurchaseOrder, PurchaseOrderItem } from '../../types';
import { fmtMoney } from '../../lib/money';

/**
 * "Needed for open work" — inventory items whose planned reservations on open
 * work orders (inventory_items.stock_reserved, trigger-maintained since 0201)
 * exceed what is on hand. A buyer raising an order could not see this before:
 * the planner reserved the part, stores had none, and the PO page showed only
 * the catalogue.
 *
 * On-hand comes from the mapped item (sum of inventory_stock rows, which is
 * what the Inventory page shows); the stock_on_hand column is the fallback for
 * items with no stock rows.
 */
export interface OpenDemandRow {
    item: InventoryItem;
    reserved: number;
    onHand: number;
    shortfall: number;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export async function fetchOpenDemand(inventoryItems: InventoryItem[]): Promise<OpenDemandRow[]> {
    if (inventoryItems.length === 0) return [];
    const { data, error } = await supabase
        .from('inventory_items')
        .select('id, stock_reserved, stock_on_hand')
        .gt('stock_reserved', 0);
    if (error) {
        console.warn('[po] open-demand read failed (0201 applied?):', error.message);
        return [];
    }
    const byId = new Map(inventoryItems.map(i => [i.id, i]));
    const rows: OpenDemandRow[] = [];
    for (const r of data || []) {
        const item = byId.get(r.id);
        if (!item) continue;
        const reserved = Number(r.stock_reserved) || 0;
        const onHand = (item.stockLocations?.length ?? 0) > 0
            ? Number(item.totalQtyOnHand) || 0
            : Number(r.stock_on_hand) || 0;
        const shortfall = round3(reserved - onHand);
        if (shortfall > 0) rows.push({ item, reserved, onHand, shortfall });
    }
    // Biggest value gap first — that is the one the buyer should see.
    return rows.sort((a, b) => b.shortfall * (b.item.itemCost || 0) - a.shortfall * (a.item.itemCost || 0));
}

/** A MATERIAL line for the shortfall at the catalogue cost. */
export function demandToLine(row: OpenDemandRow, jobId?: string): PurchaseOrderItem {
    const unitCost = Number(row.item.itemCost) || 0;
    return {
        id: crypto.randomUUID(),
        inventoryId: row.item.id,
        description: row.item.description || row.item.code,
        uom: row.item.uom || 'EA',
        qtyOrdered: row.shortfall,
        qtyReceivedTotal: 0,
        unitCost,
        taxAmount: 0,
        lineTotal: Math.round(row.shortfall * unitCost * 100) / 100,
        jobId: jobId || undefined,
        invoiceMatched: false,
    };
}

export const OpenDemandPanel: React.FC<{
    inventoryItems: InventoryItem[];
    po: PurchaseOrder;
    canEdit: boolean;
    onAddLine: (line: PurchaseOrderItem) => Promise<unknown> | void;
    onClose?: () => void;
}> = ({ inventoryItems, po, canEdit, onAddLine, onClose }) => {
    const [rows, setRows] = useState<OpenDemandRow[] | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);

    useEffect(() => {
        let live = true;
        fetchOpenDemand(inventoryItems).then(r => { if (live) setRows(r); }).catch(() => { if (live) setRows([]); });
        return () => { live = false; };
    }, [inventoryItems]);

    const add = async (row: OpenDemandRow) => {
        setBusyId(row.item.id);
        try { await onAddLine(demandToLine(row)); } finally { setBusyId(null); }
    };

    return (
        <div className="bg-amber-50/60 border border-amber-200 rounded-lg overflow-hidden">
            <div className="px-3 py-2 flex items-center justify-between gap-2 border-b border-amber-200/70">
                <div className="flex items-center gap-2 min-w-0">
                    <PackageSearch size={14} className="text-amber-700 flex-shrink-0" />
                    <span className="text-xs font-bold text-amber-900 uppercase tracking-wide">Needed for open work</span>
                    {rows && <span className="text-[11px] text-amber-800/80">{rows.length === 0 ? 'nothing short' : `${rows.length} item${rows.length === 1 ? '' : 's'} reserved beyond stock on hand`}</span>}
                </div>
                {onClose && (
                    <button onClick={onClose} className="p-1 text-amber-700 hover:text-amber-900" aria-label="Hide" title="Hide">
                        <X size={14} />
                    </button>
                )}
            </div>
            {rows === null ? (
                <div className="px-3 py-3 text-xs text-amber-800 flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Checking reservations…</div>
            ) : rows.length === 0 ? (
                <div className="px-3 py-3 text-xs text-amber-800">Every part planned on an open work order is covered by stock on hand.</div>
            ) : (
                <ul className="divide-y divide-amber-200/60">
                    {rows.map(row => {
                        const onOrder = po.items.some(i => i.inventoryId === row.item.id);
                        return (
                            <li key={row.item.id} className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                                <div className="min-w-0 flex-1 basis-40">
                                    <div className="text-sm text-slate-900 truncate">
                                        <span className="font-mono text-[11px] text-slate-500 mr-1.5">{row.item.code}</span>{row.item.description}
                                    </div>
                                    <div className="text-[11px] text-slate-500 tabular-nums">
                                        reserved {row.reserved} · on hand {row.onHand} · {row.item.uom || 'EA'}
                                    </div>
                                </div>
                                <div className="text-right tabular-nums">
                                    <div className="text-sm font-bold text-amber-900">short {row.shortfall}</div>
                                    <div className="text-[11px] text-slate-500">@ {fmtMoney(row.item.itemCost || 0, po.currency)}</div>
                                </div>
                                {onOrder ? (
                                    <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">On this order</span>
                                ) : (
                                    <button
                                        onClick={() => void add(row)}
                                        disabled={!canEdit || busyId !== null}
                                        title={canEdit ? `Add ${row.shortfall} ${row.item.uom || 'EA'} at catalogue cost` : 'purchasing.edit required'}
                                        className="inline-flex items-center gap-1 px-2 py-1 text-xs font-bold rounded bg-primary-600 text-white hover:bg-primary-500 disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        {busyId === row.item.id ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Add line
                                    </button>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
};
