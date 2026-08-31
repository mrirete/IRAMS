/**
 * ═══════════════════════════════════════════════════════════════════
 * Role Permission Templates — Single Source of Truth
 * ═══════════════════════════════════════════════════════════════════
 * 
 * Hardcoded role-based permission templates aligned with:
 *   - ISO 55000 Asset Management Framework
 *   - SAP Activity Codes (01-Create, 02-Change, 03-Display, 06-Delete)
 *   - NIST Cybersecurity Framework (least-privilege, fail-closed)
 * 
 * These templates are the AUTHORITATIVE source for permission resolution.
 * DB-stored permissions in reference_codes.properties.permissions are
 * used only for custom/dynamic roles not defined here.
 * 
 * User-level overrides (from users.permission_overrides) are merged
 * on top of these baselines at runtime.
 * ═══════════════════════════════════════════════════════════════════
 */

import { ModulePermissions } from '../types';

// ═══ Permission Tier Primitives ═══

export const FULL_ACCESS: ModulePermissions = {
    view: true, create: true, edit: true, delete: true,
    approve: true, authorize: true, viewCosts: true, assign: true,
    spendingLimit: 1000000
};

export const BASIC_ACCESS: ModulePermissions = {
    view: true, create: true, edit: true, delete: false,
    approve: false, authorize: false, viewCosts: false, assign: false,
    spendingLimit: 0
};

export const VIEW_ONLY_PERM: ModulePermissions = {
    view: true, create: false, edit: false, delete: false,
    approve: false, authorize: false, viewCosts: false, assign: false,
    spendingLimit: 0
};

export const NO_ACCESS_PERM: ModulePermissions = {
    view: false, create: false, edit: false, delete: false,
    approve: false, authorize: false, viewCosts: false, assign: false,
    spendingLimit: 0
};

// ═══ Role Permission Templates (Authoritative Baselines) ═══
//
// `reliability` is VIEW_ONLY for every role rather than NO_ACCESS for some.
// The AI Reliability Specialist is the product's front door and a technician is
// expected to reach it from work management, so open-by-default is the intended
// posture. Withdrawing it is a per-user override in Admin → Access Control,
// which now actually reaches the routes (see config/modulePermissions).
//
// `integrity` and `sustain` keep their stated NO_ACCESS values. Those were
// always the policy; until the router honoured the matrix they simply were not
// enforced, so roles could open pages the matrix already said they could not.

export const ROLE_PERMISSION_TEMPLATES: Record<string, Record<string, ModulePermissions>> = {

    // ────────────────────────────────────────────────────────
    // SUPER_ADMIN: Platform Owner — Unrestricted + Oversight
    // The ONLY role that can view the Admin Activity Log,
    // promote users to SYS_ADMIN, and approve admin MoC.
    // Per NIST 800-53 AC-6: Separation of Duties for admins.
    // ────────────────────────────────────────────────────────
    SUPER_ADMIN: {
        dashboard: FULL_ACCESS, assets: FULL_ACCESS, requests: FULL_ACCESS,
        workOrders: FULL_ACCESS, inventory: FULL_ACCESS, readings: FULL_ACCESS,
        analytics: FULL_ACCESS, admin: FULL_ACCESS, contacts: FULL_ACCESS,
        vendors: FULL_ACCESS, pm: FULL_ACCESS, purchasing: FULL_ACCESS,
        scheduling: FULL_ACCESS, taskLibrary: FULL_ACCESS, finops: FULL_ACCESS,
        safety: FULL_ACCESS, moc: FULL_ACCESS, notifications: FULL_ACCESS,
        reliability: FULL_ACCESS, integrity: FULL_ACCESS, sustain: FULL_ACCESS,
        audits: FULL_ACCESS,
        activityLog: FULL_ACCESS, // ← Exclusive: Admin Activity Log oversight
    },

    // ────────────────────────────────────────────────────────
    // SYS_ADMIN: Unrestricted operational access to ALL modules
    // CANNOT view Admin Activity Log or promote to SYS_ADMIN/SUPER_ADMIN
    // ────────────────────────────────────────────────────────
    SYS_ADMIN: {
        dashboard: FULL_ACCESS, assets: FULL_ACCESS, requests: FULL_ACCESS,
        workOrders: FULL_ACCESS, inventory: FULL_ACCESS, readings: FULL_ACCESS,
        analytics: FULL_ACCESS, admin: FULL_ACCESS, contacts: FULL_ACCESS,
        vendors: FULL_ACCESS, pm: FULL_ACCESS, purchasing: FULL_ACCESS,
        scheduling: FULL_ACCESS, taskLibrary: FULL_ACCESS, finops: FULL_ACCESS,
        safety: FULL_ACCESS, moc: FULL_ACCESS, notifications: FULL_ACCESS,
        reliability: FULL_ACCESS, integrity: FULL_ACCESS, sustain: FULL_ACCESS,
        audits: FULL_ACCESS,
        activityLog: NO_ACCESS_PERM, // ← Blocked: Only SUPER_ADMIN can view
    },

    // ────────────────────────────────────────────────────────
    // PLANNER: Full core + Scheduling + Purchasing + Vendors
    // Cost visibility enabled for financial planning
    // ────────────────────────────────────────────────────────
    PLANNER: {
        dashboard: { ...BASIC_ACCESS, viewCosts: true },
        assets: { ...BASIC_ACCESS, viewCosts: true },
        requests: { ...BASIC_ACCESS, approve: true, assign: true, viewCosts: true, spendingLimit: 10000 },
        workOrders: { ...BASIC_ACCESS, approve: true, assign: true, viewCosts: true, spendingLimit: 10000 },
        pm: { ...BASIC_ACCESS, approve: true, assign: true, viewCosts: true },
        scheduling: { ...BASIC_ACCESS, approve: true, assign: true },
        inventory: { ...BASIC_ACCESS, viewCosts: true },
        purchasing: { ...BASIC_ACCESS, approve: true, viewCosts: true, spendingLimit: 25000 },
        readings: VIEW_ONLY_PERM,
        analytics: { ...VIEW_ONLY_PERM, viewCosts: true },
        contacts: BASIC_ACCESS,
        vendors: { ...BASIC_ACCESS, approve: true, viewCosts: true },
        taskLibrary: BASIC_ACCESS,
        // Premium — Blocked
        finops: NO_ACCESS_PERM, safety: NO_ACCESS_PERM,
        moc: NO_ACCESS_PERM, notifications: BASIC_ACCESS, admin: NO_ACCESS_PERM,
        reliability: VIEW_ONLY_PERM, integrity: NO_ACCESS_PERM, sustain: NO_ACCESS_PERM,
        audits: VIEW_ONLY_PERM, activityLog: NO_ACCESS_PERM,
    },

    // ────────────────────────────────────────────────────────
    // RELIABILITY_ENG: Core + Condition Data + Analytics + Safety (view)
    // Focused on reliability analysis, failure coding, RCA
    // ────────────────────────────────────────────────────────
    // viewCosts: reliability engineering IS a money job — cost-ranked bad
    // actors, DE savings, Monte Carlo cost inputs, spares economics. The role
    // was blind to all of them (RF-01 matrix bug); SAP shops give REs cost
    // display as a matter of course. Spending authority stays where it was.
    RELIABILITY_ENG: {
        dashboard: { ...BASIC_ACCESS, viewCosts: true },
        assets: { ...BASIC_ACCESS, viewCosts: true },
        requests: { ...BASIC_ACCESS, spendingLimit: 5000 },
        workOrders: { ...BASIC_ACCESS, viewCosts: true },
        pm: { ...BASIC_ACCESS, viewCosts: true },
        scheduling: VIEW_ONLY_PERM,
        inventory: { ...VIEW_ONLY_PERM, viewCosts: true }, // Reliability views inventory; Planner/Storekeeper manages it (SAP MM separation)
        purchasing: VIEW_ONLY_PERM,
        readings: BASIC_ACCESS,
        analytics: { ...VIEW_ONLY_PERM, viewCosts: true },
        contacts: VIEW_ONLY_PERM,
        vendors: VIEW_ONLY_PERM,
        taskLibrary: BASIC_ACCESS,
        safety: VIEW_ONLY_PERM,
        notifications: BASIC_ACCESS, // Core system feature — all roles need notification access
        // Premium suites — Reliability Eng gets view into these tiers
        finops: NO_ACCESS_PERM, moc: NO_ACCESS_PERM,
        admin: NO_ACCESS_PERM,
        reliability: FULL_ACCESS, integrity: FULL_ACCESS, sustain: NO_ACCESS_PERM,
        activityLog: NO_ACCESS_PERM,
        audits: FULL_ACCESS,
    },

    // ────────────────────────────────────────────────────────
    // SUPERVISOR: Core + approve/assign on work modules
    // Can approve work, assign technicians, manage schedules
    // ────────────────────────────────────────────────────────
    SUPERVISOR: {
        dashboard: BASIC_ACCESS,
        assets: BASIC_ACCESS,
        requests: { ...BASIC_ACCESS, approve: true, assign: true, spendingLimit: 5000 },
        workOrders: { ...BASIC_ACCESS, approve: true, assign: true, spendingLimit: 5000 },
        pm: { ...BASIC_ACCESS, approve: true, assign: true },
        scheduling: { ...BASIC_ACCESS, approve: true, assign: true },
        inventory: BASIC_ACCESS,
        purchasing: VIEW_ONLY_PERM,
        readings: BASIC_ACCESS,
        analytics: VIEW_ONLY_PERM,
        contacts: VIEW_ONLY_PERM,
        vendors: VIEW_ONLY_PERM,
        taskLibrary: VIEW_ONLY_PERM,
        // safety is VIEW_ONLY, not NO_ACCESS (RF-01): supervisors review their
        // crew's JSAs and own the LOTO discipline — the same matrix-error class
        // already corrected for TECHNICIAN. Blocking the reviewer while the
        // performer can see the assessment was policy drift, not policy.
        finops: NO_ACCESS_PERM, safety: VIEW_ONLY_PERM,
        moc: NO_ACCESS_PERM, notifications: BASIC_ACCESS, admin: NO_ACCESS_PERM,
        reliability: VIEW_ONLY_PERM, integrity: NO_ACCESS_PERM, sustain: NO_ACCESS_PERM,
        audits: VIEW_ONLY_PERM, activityLog: NO_ACCESS_PERM,
    },

    // ────────────────────────────────────────────────────────
    // MANAGER: Operational authority — approve work, view costs,
    // manage team assignments, full audit access
    // ────────────────────────────────────────────────────────
    MANAGER: {
        dashboard: { ...BASIC_ACCESS, viewCosts: true },
        assets: { ...BASIC_ACCESS, viewCosts: true },
        requests: { ...BASIC_ACCESS, approve: true, assign: true, viewCosts: true, spendingLimit: 25000 },
        workOrders: { ...BASIC_ACCESS, approve: true, assign: true, viewCosts: true, spendingLimit: 25000 },
        pm: { ...BASIC_ACCESS, approve: true, assign: true, viewCosts: true },
        scheduling: { ...BASIC_ACCESS, approve: true, assign: true },
        inventory: { ...BASIC_ACCESS, viewCosts: true },
        purchasing: { ...BASIC_ACCESS, approve: true, viewCosts: true, spendingLimit: 50000 },
        readings: BASIC_ACCESS,
        analytics: { ...VIEW_ONLY_PERM, viewCosts: true },
        contacts: BASIC_ACCESS,
        vendors: { ...BASIC_ACCESS, approve: true, viewCosts: true },
        taskLibrary: BASIC_ACCESS,
        safety: VIEW_ONLY_PERM,
        moc: { ...BASIC_ACCESS, approve: true },
        notifications: BASIC_ACCESS,
        audits: { ...BASIC_ACCESS, approve: true, viewCosts: true },
        // Premium — Blocked
        finops: VIEW_ONLY_PERM, admin: NO_ACCESS_PERM,
        reliability: VIEW_ONLY_PERM, integrity: VIEW_ONLY_PERM, sustain: VIEW_ONLY_PERM,
        activityLog: NO_ACCESS_PERM,
    },

    // ────────────────────────────────────────────────────────
    // ASSET_MANAGER: Portfolio stewardship (ISO 55000/55001) —
    // MANAGER-grade cost/approval authority PLUS the strategy
    // surfaces the persona is measured against: reliability &
    // integrity visibility with costs, audits (§9.2), MoC (§8.2),
    // FinOps lifecycle economics. RF-01: this persona previously
    // had no home in the matrix.
    // ────────────────────────────────────────────────────────
    ASSET_MANAGER: {
        dashboard: { ...BASIC_ACCESS, viewCosts: true },
        assets: { ...BASIC_ACCESS, approve: true, viewCosts: true },
        requests: { ...BASIC_ACCESS, approve: true, assign: true, viewCosts: true, spendingLimit: 25000 },
        workOrders: { ...BASIC_ACCESS, approve: true, viewCosts: true, spendingLimit: 25000 },
        pm: { ...BASIC_ACCESS, approve: true, viewCosts: true },
        scheduling: VIEW_ONLY_PERM,
        inventory: { ...VIEW_ONLY_PERM, viewCosts: true },
        purchasing: { ...VIEW_ONLY_PERM, approve: true, viewCosts: true, spendingLimit: 50000 },
        readings: VIEW_ONLY_PERM,
        analytics: { ...VIEW_ONLY_PERM, viewCosts: true },
        contacts: VIEW_ONLY_PERM,
        vendors: { ...VIEW_ONLY_PERM, viewCosts: true },
        taskLibrary: VIEW_ONLY_PERM,
        safety: VIEW_ONLY_PERM,
        moc: { ...BASIC_ACCESS, approve: true, authorize: true },
        notifications: BASIC_ACCESS,
        audits: { ...BASIC_ACCESS, approve: true, viewCosts: true },
        finops: { ...BASIC_ACCESS, viewCosts: true },
        admin: NO_ACCESS_PERM,
        reliability: { ...VIEW_ONLY_PERM, viewCosts: true },
        integrity: { ...VIEW_ONLY_PERM, viewCosts: true },
        sustain: VIEW_ONLY_PERM,
        activityLog: NO_ACCESS_PERM,
    },

    // ────────────────────────────────────────────────────────
    // EXECUTIVE: Strategic oversight — view all modules,
    // approve high-value items, full cost visibility
    // ────────────────────────────────────────────────────────
    EXECUTIVE: {
        dashboard: { ...VIEW_ONLY_PERM, viewCosts: true },
        assets: { ...VIEW_ONLY_PERM, viewCosts: true },
        requests: { ...VIEW_ONLY_PERM, approve: true, viewCosts: true, spendingLimit: 100000 },
        workOrders: { ...VIEW_ONLY_PERM, approve: true, authorize: true, viewCosts: true, spendingLimit: 100000 },
        pm: { ...VIEW_ONLY_PERM, viewCosts: true },
        scheduling: VIEW_ONLY_PERM,
        inventory: { ...VIEW_ONLY_PERM, viewCosts: true },
        purchasing: { ...VIEW_ONLY_PERM, approve: true, authorize: true, viewCosts: true, spendingLimit: 250000 },
        readings: VIEW_ONLY_PERM,
        analytics: { ...VIEW_ONLY_PERM, viewCosts: true },
        contacts: VIEW_ONLY_PERM,
        vendors: { ...VIEW_ONLY_PERM, viewCosts: true },
        taskLibrary: VIEW_ONLY_PERM,
        safety: VIEW_ONLY_PERM,
        moc: { ...VIEW_ONLY_PERM, approve: true, authorize: true },
        notifications: VIEW_ONLY_PERM,
        audits: { ...VIEW_ONLY_PERM, approve: true, viewCosts: true },
        finops: { ...VIEW_ONLY_PERM, viewCosts: true },
        admin: NO_ACCESS_PERM,
        reliability: VIEW_ONLY_PERM, integrity: VIEW_ONLY_PERM, sustain: VIEW_ONLY_PERM,
        activityLog: NO_ACCESS_PERM,
    },

    // ────────────────────────────────────────────────────────
    // TECHNICIAN: Work execution focus
    // View + Create requests, Edit WOs (complete tasks)
    // ────────────────────────────────────────────────────────
    TECHNICIAN: {
        dashboard: VIEW_ONLY_PERM,
        assets: { ...VIEW_ONLY_PERM, edit: true },
        requests: BASIC_ACCESS,
        workOrders: { ...VIEW_ONLY_PERM, edit: true },
        pm: VIEW_ONLY_PERM,
        scheduling: VIEW_ONLY_PERM,
        inventory: VIEW_ONLY_PERM,
        readings: BASIC_ACCESS,
        taskLibrary: VIEW_ONLY_PERM,
        // Blocked
        purchasing: NO_ACCESS_PERM, analytics: NO_ACCESS_PERM,
        contacts: NO_ACCESS_PERM, vendors: NO_ACCESS_PERM,
        // safety is VIEW_ONLY, not NO_ACCESS: a technician completes the JSA on
        // their own job and performs the lockout/tagout. Withholding it was a
        // matrix error, not a policy — JSATab, WorkOrders and RecurringWork all
        // read jsa_assessments from surfaces technicians live on.
        finops: NO_ACCESS_PERM, safety: VIEW_ONLY_PERM,
        moc: NO_ACCESS_PERM, notifications: BASIC_ACCESS, admin: NO_ACCESS_PERM,
        reliability: VIEW_ONLY_PERM, integrity: NO_ACCESS_PERM, sustain: NO_ACCESS_PERM,
        audits: VIEW_ONLY_PERM, activityLog: NO_ACCESS_PERM,
    },

    // ────────────────────────────────────────────────────────
    // REQUESTER: Minimal access — Dashboard + Requests only
    // End users who submit maintenance requests
    // ────────────────────────────────────────────────────────
    REQUESTER: {
        dashboard: VIEW_ONLY_PERM,
        assets: VIEW_ONLY_PERM,
        requests: BASIC_ACCESS,
        // Everything else blocked
        workOrders: NO_ACCESS_PERM, pm: NO_ACCESS_PERM, scheduling: NO_ACCESS_PERM,
        inventory: NO_ACCESS_PERM, purchasing: NO_ACCESS_PERM, readings: NO_ACCESS_PERM,
        analytics: NO_ACCESS_PERM, contacts: NO_ACCESS_PERM, vendors: NO_ACCESS_PERM,
        finops: NO_ACCESS_PERM, taskLibrary: NO_ACCESS_PERM, safety: NO_ACCESS_PERM,
        moc: NO_ACCESS_PERM, notifications: VIEW_ONLY_PERM, admin: NO_ACCESS_PERM,
        reliability: VIEW_ONLY_PERM, integrity: NO_ACCESS_PERM, sustain: NO_ACCESS_PERM,
        audits: VIEW_ONLY_PERM, activityLog: NO_ACCESS_PERM,
    },

    // ────────────────────────────────────────────────────────
    // INTERNAL: View-only on basic work modules
    // Company staff with view access for transparency
    // ────────────────────────────────────────────────────────
    INTERNAL: {
        dashboard: VIEW_ONLY_PERM,
        assets: VIEW_ONLY_PERM,
        requests: { ...VIEW_ONLY_PERM, create: true },
        workOrders: VIEW_ONLY_PERM,
        inventory: VIEW_ONLY_PERM,
        // Blocked
        pm: NO_ACCESS_PERM, scheduling: NO_ACCESS_PERM, purchasing: NO_ACCESS_PERM,
        readings: NO_ACCESS_PERM, analytics: NO_ACCESS_PERM, contacts: NO_ACCESS_PERM,
        vendors: NO_ACCESS_PERM, finops: NO_ACCESS_PERM, taskLibrary: NO_ACCESS_PERM,
        safety: NO_ACCESS_PERM, moc: NO_ACCESS_PERM, notifications: VIEW_ONLY_PERM,
        admin: NO_ACCESS_PERM,
        reliability: VIEW_ONLY_PERM, integrity: NO_ACCESS_PERM, sustain: NO_ACCESS_PERM,
        audits: VIEW_ONLY_PERM, activityLog: NO_ACCESS_PERM,
    },
};

// Fallback for unknown/new roles (fail-closed per NIST/ISO 55000)
export const BASE_PACKAGE_DEFAULTS: Record<string, ModulePermissions> = {
    dashboard: BASIC_ACCESS, assets: BASIC_ACCESS, requests: BASIC_ACCESS,
    workOrders: BASIC_ACCESS, inventory: VIEW_ONLY_PERM, contacts: VIEW_ONLY_PERM,
    pm: BASIC_ACCESS, scheduling: BASIC_ACCESS, purchasing: VIEW_ONLY_PERM,
    vendors: VIEW_ONLY_PERM, taskLibrary: VIEW_ONLY_PERM,
    // Premium — Restricted by default
    finops: NO_ACCESS_PERM, analytics: NO_ACCESS_PERM, readings: NO_ACCESS_PERM,
    safety: NO_ACCESS_PERM, moc: NO_ACCESS_PERM,
    notifications: VIEW_ONLY_PERM, admin: NO_ACCESS_PERM,
    reliability: NO_ACCESS_PERM, integrity: NO_ACCESS_PERM, sustain: NO_ACCESS_PERM,
    audits: VIEW_ONLY_PERM, activityLog: NO_ACCESS_PERM,
};
