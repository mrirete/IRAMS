/**
 * The fleet is equipment (ISO 14224 level 6). A monitored part — a bearing,
 * a seal, a turbine stage with its own twin — folds under its machine instead
 * of standing beside it as a peer, so K-601 appears once, not four times.
 *
 * A part whose machine has no twin of its own still shows, on its own card,
 * labelled as a part: it must not vanish because nobody snapshotted its parent.
 */
import type { FleetAssetHealth } from '../../types/intelligence';

export interface FleetGroup {
    /** The card: a machine, or a part with no monitored machine. */
    head: FleetAssetHealth;
    /** Monitored parts under this machine, weakest first. */
    parts: FleetAssetHealth[];
    /** The weakest part when it is worse than the machine's own score. */
    weakestPart: FleetAssetHealth | null;
    /** True when the head is itself a part shown on its own (parent not monitored). */
    orphanPart: boolean;
}

export const isPart = (a: FleetAssetHealth) => a.level === 'component';

export function groupFleet(rows: FleetAssetHealth[]): FleetGroup[] {
    const byId = new Map(rows.map(r => [r.asset_id, r]));
    const partsOf = new Map<string, FleetAssetHealth[]>();
    const heads: FleetAssetHealth[] = [];
    const orphans: FleetAssetHealth[] = [];
    for (const r of rows) {
        if (isPart(r) && r.parent_id && byId.has(r.parent_id)) {
            const list = partsOf.get(r.parent_id) ?? [];
            list.push(r);
            partsOf.set(r.parent_id, list);
        } else if (isPart(r)) {
            orphans.push(r);
        } else {
            heads.push(r);
        }
    }
    const group = (head: FleetAssetHealth, orphanPart: boolean): FleetGroup => {
        const parts = (partsOf.get(head.asset_id) ?? []).sort((a, b) => a.health_index - b.health_index);
        const weakest = parts[0] ?? null;
        return { head, parts, weakestPart: weakest && weakest.health_index < head.health_index ? weakest : null, orphanPart };
    };
    return [...heads.map(h => group(h, false)), ...orphans.map(o => group(o, true))];
}

/** Does a group match a search? On the machine, or on any of its parts. */
export function groupMatches(g: FleetGroup, q: string): boolean {
    const hit = (a: FleetAssetHealth) =>
        a.asset_name.toLowerCase().includes(q) || a.unit.toLowerCase().includes(q) || (a.tag || '').toLowerCase().includes(q);
    return hit(g.head) || g.parts.some(hit);
}

/** Parts of a group that match a search — auto-expanded so the hit is visible. */
export function matchingParts(g: FleetGroup, q: string): FleetAssetHealth[] {
    if (!q) return [];
    return g.parts.filter(a => a.asset_name.toLowerCase().includes(q) || (a.tag || '').toLowerCase().includes(q));
}
