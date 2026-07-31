/**
 * modulePermissions — the bridge between the LICENCE layer and the RBAC layer.
 *
 * Two independent gates guard the premium suites:
 *
 *   ModuleGate      "has this deployment licensed the module?"  → LicenseContext
 *   PermissionGate  "is this USER allowed to view it?"          → role matrix + per-user overrides
 *
 * They answer different questions and neither substitutes for the other. Until
 * this map existed, most premium routes carried ModuleGate alone, so the role
 * matrix — the thing an admin actually edits — governed the sidebar but not the
 * routes. The nav item disappeared while the URL stayed wide open, and a
 * per-user override an admin had deliberately set could not reach the page it
 * was set for.
 *
 * This is the ONE mapping. The router and the sidebar both read it, so a route
 * cannot drift from the nav that points at it.
 */
import type { ModuleId } from './moduleRegistry';
import type { ModuleName } from '../eam/types';

/**
 * Licence module → the RBAC permission key that governs it.
 *
 * A module absent from this map has no role-level gate: it is licence-only.
 * That is the correct answer for `core` (never gated) but a mistake for
 * anything premium, so `handoffContract.test.ts` asserts every `Gated` route in
 * App.tsx resolves to a key here.
 */
export const MODULE_ID_TO_PERM_KEY: Partial<Record<ModuleId, ModuleName>> = {
    // The Specialist and the reliability loop are one product to the user and
    // share one permission key, so granting "reliability" grants the whole
    // journey rather than half of it.
    specialist: 'reliability',
    predict: 'reliability',
    vision: 'reliability',
    intelligence: 'reliability',

    comply: 'integrity',
    safety: 'safety',
    audits: 'audits',
    sustain: 'sustain',
};

/** The RBAC key guarding a licence module, or null when it is licence-only. */
export function permKeyForModule(moduleId: ModuleId): ModuleName | null {
    return MODULE_ID_TO_PERM_KEY[moduleId] ?? null;
}
