/**
 * sparesExposure — critical-asset spares risk (Phase B4).
 *
 * Deterministic and consumption-grounded: an item CONSUMED on an A/B asset
 * in the last 12 months whose stock now sits at zero (or below min level)
 * is exposure — the failure that needed it once can need it again tomorrow.
 * work_order_parts.item_id is TEXT (legacy) and inventory item ids are
 * UUIDs, so joins compare as strings and unmatched items are still reported
 * as "consumed, stock unknown" rather than silently dropped.
 */

export interface PartUseRow {
    wo_id: string;
    item_id: string | null;
    description: string | null;
    quantity_act: number | null;
    date_used: string | null;
}

export interface StockRow {
    item_id: string;
    quantity: number | null;
    min_level: number | null;
}

export interface SparesInputs {
    /** wo id → asset id (already scoped/filtered upstream). */
    woAsset: Map<string, string>;
    /** asset id → { tag, criticality } */
    assets: Map<string, { tag: string; criticality: string | null }>;
    parts: PartUseRow[];
    stock: StockRow[];
    nowMs: number;
}

export interface SpareExposure {
    itemId: string | null;
    label: string;
    consumedQty12mo: number;
    uses: number;
    onHand: number | null;   // null = item not found in stock (unknown)
    minLevel: number | null;
    assets: string[];        // tags, critical only
    severity: 'stockout' | 'below_min' | 'unknown_stock';
}

export interface SparesReview {
    exposures: SpareExposure[];
    criticalPartsTracked: number;
    stockRowsSeen: number;
}

const DAY_MS = 86_400_000;

export function computeSparesExposure(inp: SparesInputs): SparesReview {
    const cutoff = inp.nowMs - 365 * DAY_MS;
    const onHandByItem = new Map<string, { qty: number; min: number | null }>();
    for (const s of inp.stock) {
        const cur = onHandByItem.get(String(s.item_id)) ?? { qty: 0, min: null };
        cur.qty += Number(s.quantity) || 0;
        if (s.min_level != null) cur.min = Math.max(cur.min ?? 0, Number(s.min_level));
        onHandByItem.set(String(s.item_id), cur);
    }

    // Consumption on CRITICAL assets, last 12 months, grouped per item.
    const byItem = new Map<string, { label: string; qty: number; uses: number; tags: Set<string> }>();
    for (const p of inp.parts) {
        const qty = Number(p.quantity_act) || 0;
        if (qty <= 0) continue;
        if (p.date_used && new Date(p.date_used).getTime() < cutoff) continue;
        const assetId = inp.woAsset.get(p.wo_id);
        const asset = assetId ? inp.assets.get(assetId) : undefined;
        if (!asset || !['A', 'B'].includes((asset.criticality ?? '').toUpperCase())) continue;
        const key = p.item_id ? String(p.item_id) : `desc:${(p.description ?? 'unnamed part').toLowerCase()}`;
        const cur = byItem.get(key) ?? { label: p.description || String(p.item_id ?? 'unnamed part'), qty: 0, uses: 0, tags: new Set<string>() };
        cur.qty += qty; cur.uses += 1; cur.tags.add(asset.tag);
        byItem.set(key, cur);
    }

    const exposures: SpareExposure[] = [];
    for (const [key, v] of byItem) {
        const itemId = key.startsWith('desc:') ? null : key;
        const stock = itemId ? onHandByItem.get(itemId) : undefined;
        let severity: SpareExposure['severity'] | null = null;
        if (!stock) severity = 'unknown_stock';
        else if (stock.qty <= 0) severity = 'stockout';
        else if (stock.min != null && stock.qty < stock.min) severity = 'below_min';
        if (!severity) continue; // held adequately — not an exposure
        exposures.push({
            itemId, label: v.label,
            consumedQty12mo: Math.round(v.qty * 10) / 10,
            uses: v.uses,
            onHand: stock ? stock.qty : null,
            minLevel: stock?.min ?? null,
            assets: [...v.tags].sort(),
            severity,
        });
    }
    const rank: Record<SpareExposure['severity'], number> = { stockout: 0, below_min: 1, unknown_stock: 2 };
    exposures.sort((a, b) => rank[a.severity] - rank[b.severity] || b.consumedQty12mo - a.consumedQty12mo);

    return { exposures, criticalPartsTracked: byItem.size, stockRowsSeen: inp.stock.length };
}
