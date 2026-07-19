/**
 * Hierarchy health roll-up & roll-down (Phase 4).
 *
 * Roll-UP: aggregate monitored equipment health onto their SYSTEM / UNIT /
 * SITE ancestors so structural levels get meaningful twins — without ever
 * owning sensors themselves (points live on maintainable items only).
 *
 * Formula: criticality-weighted average, penalized toward the weakest link:
 *     rolled = weightedAvg − (weightedAvg − worst) / 2
 * A system is dragged toward its worst monitored child, but not defined by it
 * alone.
 *
 * Redundancy (RBD-aware): when Reliability Modelling has an RBD whose
 * parallel/standby group links ≥2 of a node's children, those children are
 * collapsed into ONE combined entry before the weakest-link math:
 *     combined = 100 × (1 − Π(1 − hᵢ/100))
 * so a degraded pump with a healthy standby twin no longer drags the system
 * like a series element would.
 *
 * Roll-DOWN: each node lists its top offending children by criticality-
 * weighted health deficit, so a degraded system points at the responsible
 * equipment instead of just being red.
 */

export interface RollupInput {
    id: string;
    name: string;
    parentId?: string | null;
    hierarchyLevel?: string | null;
    criticality?: string | null;
}

export interface RollupOffender {
    id: string;
    name: string;
    health: number;
    criticality: string;
}

export interface RollupNode {
    id: string;
    name: string;
    /** SYSTEM | UNIT | SITE | PLANT */
    level: string;
    health: number;
    monitored: number;
    worst: RollupOffender | null;
    /** top contributors to the deficit, worst-first (max 3) */
    offenders: RollupOffender[];
}

/** A redundant set from an RBD: parallel/standby-grouped blocks linked to register assets. */
export interface RedundancyGroup {
    /** asset ids of the redundant members (≥2) */
    memberAssetIds: string[];
    /** display label, e.g. "Cooling (Redundant)" */
    label: string;
}

/**
 * Extract redundancy groups from saved RBD models (ers_rbd_models rows).
 * Only parallel / standby / k-of-n groups with ≥2 asset-LINKED blocks count —
 * unlinked blocks can't be matched to monitored equipment.
 */
export function redundancyGroupsFromRbdModels(
    models: { blocks: unknown[]; groups: unknown[] }[],
): RedundancyGroup[] {
    const out: RedundancyGroup[] = [];
    for (const m of models || []) {
        const blocks = (m.blocks || []) as { id: string; assetId?: string }[];
        const byBlockId = new Map(blocks.map(b => [b.id, b]));
        for (const g of (m.groups || []) as { type?: string; label?: string; blocks?: string[] }[]) {
            if (!g?.type || g.type === 'series') continue;
            const memberAssetIds = (g.blocks || [])
                .map(id => byBlockId.get(id)?.assetId)
                .filter((v): v is string => !!v);
            if (memberAssetIds.length >= 2) {
                out.push({ memberAssetIds, label: g.label || 'Redundant group' });
            }
        }
    }
    return out;
}

const STRUCTURAL = new Set(['SYSTEM', 'UNIT', 'SITE', 'PLANT']);
const CRIT_WEIGHT: Record<string, number> = { A: 3, B: 2, C: 1, D: 1, E: 1 };

/** Parallel combination of member healths (availability algebra on health/100). */
const parallelHealth = (healths: number[]): number => {
    const unavail = healths.reduce((p, h) => p * (1 - Math.min(100, Math.max(0, h)) / 100), 1);
    return Math.round((1 - unavail) * 1000) / 10;
};

/**
 * Collapse children that form an RBD redundancy group into one combined entry
 * (parallel health, highest member criticality) so downstream weakest-link
 * math respects redundancy. Children not covered by a group pass through.
 */
function applyRedundancy(children: RollupOffender[], groups: RedundancyGroup[]): RollupOffender[] {
    if (groups.length === 0) return children;
    const byId = new Map(children.map(c => [c.id, c]));
    const consumed = new Set<string>();
    const combined: RollupOffender[] = [];

    for (const g of groups) {
        const members = g.memberAssetIds
            .filter(id => byId.has(id) && !consumed.has(id))
            .map(id => byId.get(id)!);
        if (members.length < 2) continue;   // group not (fully enough) inside this node
        members.forEach(mbr => consumed.add(mbr.id));
        const crit = members.map(mbr => mbr.criticality).sort()[0] || 'C'; // 'A' < 'B' < 'C'
        combined.push({
            id: `rbd-${members.map(mbr => mbr.id).join('+')}`,
            name: `${g.label}: ${members.map(mbr => mbr.name).join(' ∥ ')}`,
            health: parallelHealth(members.map(mbr => mbr.health)),
            criticality: crit,
        });
    }
    if (combined.length === 0) return children;
    return [...children.filter(c => !consumed.has(c.id)), ...combined];
}

export function rollupHierarchy(
    assets: RollupInput[],
    healthById: Map<string, number>,
    redundancyGroups: RedundancyGroup[] = [],
): RollupNode[] {
    const byId = new Map(assets.map(a => [a.id, a]));
    // ancestor id → monitored descendants
    const acc = new Map<string, { asset: RollupInput; children: RollupOffender[] }>();

    for (const a of assets) {
        const h = healthById.get(a.id);
        if (h == null || !Number.isFinite(h)) continue;
        const entry: RollupOffender = { id: a.id, name: a.name, health: h, criticality: (a.criticality || 'C').toString() };
        // Walk the parent chain, attributing this equipment to each structural ancestor.
        let cur = a.parentId ? byId.get(a.parentId) : undefined;
        let hops = 0;
        while (cur && hops < 12) {
            if (STRUCTURAL.has((cur.hierarchyLevel || '').toUpperCase())) {
                const slot = acc.get(cur.id) ?? { asset: cur, children: [] };
                slot.children.push(entry);
                acc.set(cur.id, slot);
            }
            cur = cur.parentId ? byId.get(cur.parentId) : undefined;
            hops++;
        }
    }

    const nodes: RollupNode[] = [];
    for (const { asset, children: rawChildren } of acc.values()) {
        // RBD redundancy: parallel/standby siblings collapse into one entry first.
        const children = applyRedundancy(rawChildren, redundancyGroups);
        const wsum = children.reduce((s, c) => s + (CRIT_WEIGHT[c.criticality] ?? 1), 0);
        const weightedAvg = children.reduce((s, c) => s + c.health * (CRIT_WEIGHT[c.criticality] ?? 1), 0) / (wsum || 1);
        const worst = children.reduce((m, c) => (m == null || c.health < m.health ? c : m), null as RollupOffender | null);
        const rolled = worst ? weightedAvg - (weightedAvg - worst.health) / 2 : weightedAvg;
        const offenders = [...children]
            .sort((x, y) => (100 - y.health) * (CRIT_WEIGHT[y.criticality] ?? 1) - (100 - x.health) * (CRIT_WEIGHT[x.criticality] ?? 1))
            .slice(0, 3);
        nodes.push({
            id: asset.id,
            name: asset.name,
            level: (asset.hierarchyLevel || '').toUpperCase(),
            health: Math.round(rolled * 10) / 10,
            monitored: rawChildren.length,
            worst,
            offenders,
        });
    }

    // Worst systems first — that's what an operator scans for.
    return nodes.sort((a, b) => a.health - b.health);
}
