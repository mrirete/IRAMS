/**
 * registerReconcile — a drawing's tags against the register that exists.
 *
 * WHY THIS EXISTS
 * A customer bringing 300 drawings and an SAP register is, for once, paying
 * attention to whether the two agree. Registers routinely miss a third of
 * the instruments and carry equipment that was removed years ago. The
 * extractor (pidTagExtract) already knows what the drawing says; this is the
 * diff against what the register says, in the three buckets a reviewer acts
 * on:
 *
 *   matched       — on the drawing AND in the register (link the drawing)
 *   newTags       — on the drawing, NOT in the register (propose — existing flow)
 *   registerOnly  — in the register under the same system, NOT on the drawing
 *                   (removed? renamed? on another sheet? — a list to check,
 *                   never an auto-delete)
 *
 * Pure: two lists in, three lists out. Tag matching is normalised the way the
 * extractor normalises variants, so 'P-101A' and 'P101A' agree.
 */
import type { ExtractedTag } from './pidTagExtract';

export interface RegisterAsset {
    id: string;
    tag: string;
    name?: string | null;
    parentId?: string | null;
    hierarchyLevel?: string | null;
}

export interface ReconcileResult {
    matched: { tag: ExtractedTag; asset: RegisterAsset }[];
    newTags: ExtractedTag[];
    /** Only populated when the system exists in the register — see `systemAsset`. */
    registerOnly: RegisterAsset[];
    /** The register row for the drawing's system tag, if any. */
    systemAsset: RegisterAsset | null;
}

const norm = (s: unknown): string => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export function reconcileWithRegister(
    extracted: ExtractedTag[],
    register: RegisterAsset[],
    opts: { systemTag?: string | null } = {},
): ReconcileResult {
    const byNorm = new Map<string, RegisterAsset>();
    for (const a of register ?? []) {
        const k = norm(a.tag);
        if (k && !byNorm.has(k)) byNorm.set(k, a);
    }

    const matched: ReconcileResult['matched'] = [];
    const newTags: ExtractedTag[] = [];
    const seenAssetIds = new Set<string>();
    for (const t of extracted ?? []) {
        const keys = [t.tag, ...(t.variants ?? [])].map(norm).filter(Boolean);
        const hit = keys.map((k) => byNorm.get(k)).find(Boolean);
        if (hit) { matched.push({ tag: t, asset: hit }); seenAssetIds.add(hit.id); }
        else newTags.push(t);
    }

    const sysKey = norm(opts.systemTag);
    const systemAsset = sysKey ? byNorm.get(sysKey) ?? null : null;
    let registerOnly: RegisterAsset[] = [];
    if (systemAsset) {
        // Direct children of the system that the drawing did not mention.
        registerOnly = (register ?? []).filter((a) => a.parentId === systemAsset.id && !seenAssetIds.has(a.id));
    }

    return { matched, newTags, registerOnly, systemAsset };
}
