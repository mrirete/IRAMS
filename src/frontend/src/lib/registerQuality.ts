/**
 * registerQuality — deterministic asset-register hygiene scoring
 * (Specialist Phase A2, docs/Specialist-150k-Replacement-Plan.md §5).
 *
 * The register is the foundation every other analysis stands on, and it is
 * the first thing a human reliability engineer audits on arrival. These
 * checks are the ISO 14224-flavoured basics, computed from data the
 * assessment already loads — no LLM anywhere.
 *
 * Design constraints that shaped the metrics:
 *  - `criticality` is a NOT NULL enum and the import wizard defaults blanks
 *    to 'C', so "missing criticality" cannot be counted directly. We measure
 *    the SPREAD instead: a register where one class holds ~everything has
 *    not been risk-ranked, it has been defaulted.
 *  - `tag` is UNIQUE at the DB, so exact duplicates cannot exist. The real
 *    failure mode is normalized collisions ("P-101" vs "P101" vs "p 101")
 *    that split one physical asset's history across rows.
 */

export interface RegisterAssetRow {
    id: string;
    tag: string;
    parent_id: string | null;
    criticality: string | null;
    manufacturer: string | null;
    model: string | null;
}

export interface RegisterQuality {
    assetCount: number;
    /** % of assets that sit under a parent (structured hierarchy vs flat dump). */
    structuredPct: number;
    /** % of assets outside the single most common criticality class. */
    criticalitySpreadPct: number;
    /** The dominant criticality class and its share — names the default dump. */
    dominantCriticality: { value: string; pct: number } | null;
    /** % of assets carrying both manufacturer and model. */
    nameplatePct: number;
    /** Assets whose normalized tag collides with another asset's. */
    tagCollisionCount: number;
    /** Example collision groups (normalized key → tags), max 5, for display. */
    tagCollisionExamples: string[][];
    /** % of the last-12-months WOs that resolve to a known asset. */
    woLinkedPct: number;
    /** 12-mo WOs that reference no asset or an unknown asset id. */
    woUnlinkedCount: number;
    /** Composite 0–100 — equal-weighted mean of the five component scores. */
    healthPct: number;
}

const normalizeTag = (tag: string): string => tag.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Spread score: full credit once ≥40% of assets sit outside the dominant
 * class. A legitimately C-heavy plant still clears that bar; a defaulted
 * import (100% one class) scores zero.
 */
const spreadScore = (spreadPct: number): number => Math.min(100, Math.round(spreadPct * 2.5));

export function computeRegisterQuality(
    assets: RegisterAssetRow[],
    wos12: { asset_id: string | null }[],
    knownAssetIds?: Set<string>,
): RegisterQuality {
    const n = assets.length;
    const ids = knownAssetIds ?? new Set(assets.map((a) => a.id));

    const structured = assets.filter((a) => a.parent_id != null).length;
    const structuredPct = n ? Math.round((structured / n) * 100) : 0;

    // Criticality spread — count classes (null bucketed as its own class so a
    // drifted schema still measures honestly).
    const critCounts = new Map<string, number>();
    for (const a of assets) {
        const k = a.criticality ?? '(none)';
        critCounts.set(k, (critCounts.get(k) ?? 0) + 1);
    }
    let dominantCriticality: RegisterQuality['dominantCriticality'] = null;
    for (const [value, count] of critCounts) {
        const pct = Math.round((count / (n || 1)) * 100);
        if (!dominantCriticality || pct > dominantCriticality.pct) dominantCriticality = { value, pct };
    }
    const criticalitySpreadPct = n && dominantCriticality ? 100 - dominantCriticality.pct : 0;

    const nameplate = assets.filter((a) => (a.manufacturer ?? '').trim() && (a.model ?? '').trim()).length;
    const nameplatePct = n ? Math.round((nameplate / n) * 100) : 0;

    // Normalized tag collisions
    const byNorm = new Map<string, string[]>();
    for (const a of assets) {
        const k = normalizeTag(a.tag ?? '');
        if (!k) continue;
        const arr = byNorm.get(k) ?? [];
        arr.push(a.tag);
        byNorm.set(k, arr);
    }
    const collisionGroups = [...byNorm.values()].filter((tags) => tags.length > 1);
    const tagCollisionCount = collisionGroups.reduce((s, g) => s + g.length - 1, 0);
    const tagCollisionExamples = collisionGroups.slice(0, 5);

    const woN = wos12.length;
    const linked = wos12.filter((w) => w.asset_id != null && ids.has(w.asset_id)).length;
    const woLinkedPct = woN ? Math.round((linked / woN) * 100) : 100;
    const woUnlinkedCount = woN - linked;

    const collisionFreePct = n ? Math.round(((n - tagCollisionCount) / n) * 100) : 100;
    const components = [structuredPct, spreadScore(criticalitySpreadPct), nameplatePct, collisionFreePct, woLinkedPct];
    const healthPct = n ? Math.round(components.reduce((s, c) => s + c, 0) / components.length) : 0;

    return {
        assetCount: n,
        structuredPct,
        criticalitySpreadPct,
        dominantCriticality,
        nameplatePct,
        tagCollisionCount,
        tagCollisionExamples,
        woLinkedPct,
        woUnlinkedCount,
        healthPct,
    };
}
