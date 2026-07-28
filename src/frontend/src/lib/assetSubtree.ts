/**
 * assetSubtree — resolve "this system/area" into a concrete asset set.
 *
 * The register is a recursive hierarchy (assets.parent_id); a study scope is
 * a root node plus every descendant. BFS over a children index, cycle-safe
 * (imported registers have contained loops before). Pure and tested.
 */

export interface SubtreeAssetRow {
    id: string;
    parent_id: string | null;
}

export function collectSubtree(assets: SubtreeAssetRow[], rootId: string): Set<string> {
    const children = new Map<string, string[]>();
    for (const a of assets) {
        if (!a.parent_id) continue;
        (children.get(a.parent_id) ?? children.set(a.parent_id, []).get(a.parent_id)!).push(a.id);
    }
    const out = new Set<string>([rootId]);
    const queue = [rootId];
    while (queue.length) {
        const cur = queue.pop()!;
        for (const c of children.get(cur) ?? []) {
            if (out.has(c)) continue; // cycle guard
            out.add(c);
            queue.push(c);
        }
    }
    return out;
}

/** ids of assets that have at least one child — the sensible scope roots. */
export function parentIds(assets: SubtreeAssetRow[]): Set<string> {
    const out = new Set<string>();
    for (const a of assets) if (a.parent_id) out.add(a.parent_id);
    return out;
}
