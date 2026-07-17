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
 * alone. NOTE: redundancy (parallel trains) is NOT modeled here — a true
 * series/parallel roll-up needs the RBD in Reliability Modelling.
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

const STRUCTURAL = new Set(['SYSTEM', 'UNIT', 'SITE', 'PLANT']);
const CRIT_WEIGHT: Record<string, number> = { A: 3, B: 2, C: 1, D: 1, E: 1 };

export function rollupHierarchy(
    assets: RollupInput[],
    healthById: Map<string, number>,
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
    for (const { asset, children } of acc.values()) {
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
            monitored: children.length,
            worst,
            offenders,
        });
    }

    // Worst systems first — that's what an operator scans for.
    return nodes.sort((a, b) => a.health - b.health);
}
