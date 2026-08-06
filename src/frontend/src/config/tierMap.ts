/**
 * tierMap — which module FAMILIES each pricing tier includes.
 * ═══════════════════════════════════════════════════════════
 * THE PRODUCT KNOB. The pricing page sells tiers; this file is where a tier
 * becomes a set of modules. Edit the arrays, nothing else — every module in
 * moduleRegistry declares its family (`tier:` there means family, an older
 * naming), and the ceiling is computed from that declaration, so a new module
 * lands in the right tiers automatically.
 *
 * The server truth is `companies.tier` (0278): set at provisioning, pinned
 * against in-app change by a trigger, and readable only on the caller's own
 * company row. LicenseContext clamps the module set to this ceiling — the
 * localStorage toggles can hide licensed modules, never exceed the licence.
 *
 * Honest scope: this is a UX/commercial boundary. Data access is enforced by
 * RLS and caller_can() regardless of what the sidebar shows.
 */
import { MODULE_REGISTRY } from './moduleRegistry';
import type { ModuleId, ModuleTier } from './moduleRegistry';

export type PricingTier = 'starter' | 'professional' | 'enterprise';

/** DEFAULT mapping — a product decision, deliberately easy to change. */
export const TIER_FAMILIES: Record<PricingTier, ModuleTier[] | 'all'> = {
    starter: ['core', 'financial'],
    professional: ['core', 'financial', 'reliability', 'intelligence'],
    enterprise: 'all',
};

/** The module ids a tier licences. Unknown tier → everything (fail open on
 *  UX; the data boundary does not depend on this). */
export function moduleCeiling(tier: string | null | undefined): Set<ModuleId> | null {
    const families = TIER_FAMILIES[(tier ?? '') as PricingTier];
    if (!families || families === 'all') return null;   // null = no clamp
    const fam = new Set(families);
    return new Set(MODULE_REGISTRY.filter(m => fam.has(m.tier)).map(m => m.id));
}
