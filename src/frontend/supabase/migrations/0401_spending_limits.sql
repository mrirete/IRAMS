-- ============================================================================
-- 0401 — Approval limits mean something
--
-- Every role template carries a spending limit (Supervisor 5 000, Manager
-- 25 000 …) and Admin lets you edit one per person. Nothing read them: not
-- purchasing, not work orders, not the database (the matrix mirror skipped
-- the number on purpose — "enforced in application logic" — and no
-- application logic existed). 2026-10-03.
--
-- Delegation of authority, by value:
--   • a work order whose PLANNED cost is above the caller's work-order limit
--     cannot be released (→ Scheduled / In progress) until someone whose limit
--     covers it approves the cost. Emergency orders are exempt — they start
--     now and are reviewed afterwards. Administrators are exempt.
--   • a purchase order above the caller's purchasing limit cannot be
--     authorised by them.
--
-- Parts: A limits table (generated seed) · B caller_spending_limit ·
-- C work-order cost release · D purchase-order limit · E notification rule.
-- ============================================================================

BEGIN;

-- ── A. The limits, where the database can read them ─────────────────────────
CREATE TABLE IF NOT EXISTS public.role_spending_limits (
    role           text    NOT NULL,
    module         text    NOT NULL,
    spending_limit numeric NOT NULL CHECK (spending_limit >= 0),
    PRIMARY KEY (role, module)
);
ALTER TABLE public.role_spending_limits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS role_spending_limits_read ON public.role_spending_limits;
CREATE POLICY role_spending_limits_read ON public.role_spending_limits
    FOR SELECT TO authenticated USING (true);
COMMENT ON TABLE public.role_spending_limits IS
    '0401: mirror of ROLE_PERMISSION_TEMPLATES[role][module].spendingLimit (only limits > 0). Generated — edit the template and run npm run gen:role-permissions. Read by caller_spending_limit().';

-- ── BEGIN GENERATED SEED (scripts/gen-role-permissions.mjs) ──
-- 829 permitted (role, module, action) triples. Do not hand-edit.
DELETE FROM public.role_permissions;
INSERT INTO public.role_permissions (role, module, action) VALUES
    ('ASSET_MANAGER', 'analytics', 'view'),
    ('ASSET_MANAGER', 'analytics', 'viewCosts'),
    ('ASSET_MANAGER', 'assets', 'view'),
    ('ASSET_MANAGER', 'assets', 'create'),
    ('ASSET_MANAGER', 'assets', 'edit'),
    ('ASSET_MANAGER', 'assets', 'approve'),
    ('ASSET_MANAGER', 'assets', 'viewCosts'),
    ('ASSET_MANAGER', 'audits', 'view'),
    ('ASSET_MANAGER', 'audits', 'create'),
    ('ASSET_MANAGER', 'audits', 'edit'),
    ('ASSET_MANAGER', 'audits', 'approve'),
    ('ASSET_MANAGER', 'audits', 'viewCosts'),
    ('ASSET_MANAGER', 'contacts', 'view'),
    ('ASSET_MANAGER', 'dashboard', 'view'),
    ('ASSET_MANAGER', 'dashboard', 'create'),
    ('ASSET_MANAGER', 'dashboard', 'edit'),
    ('ASSET_MANAGER', 'dashboard', 'viewCosts'),
    ('ASSET_MANAGER', 'finops', 'view'),
    ('ASSET_MANAGER', 'finops', 'create'),
    ('ASSET_MANAGER', 'finops', 'edit'),
    ('ASSET_MANAGER', 'finops', 'viewCosts'),
    ('ASSET_MANAGER', 'integrity', 'view'),
    ('ASSET_MANAGER', 'integrity', 'viewCosts'),
    ('ASSET_MANAGER', 'inventory', 'view'),
    ('ASSET_MANAGER', 'inventory', 'viewCosts'),
    ('ASSET_MANAGER', 'moc', 'view'),
    ('ASSET_MANAGER', 'moc', 'create'),
    ('ASSET_MANAGER', 'moc', 'edit'),
    ('ASSET_MANAGER', 'moc', 'approve'),
    ('ASSET_MANAGER', 'moc', 'authorize'),
    ('ASSET_MANAGER', 'notifications', 'view'),
    ('ASSET_MANAGER', 'notifications', 'create'),
    ('ASSET_MANAGER', 'notifications', 'edit'),
    ('ASSET_MANAGER', 'pm', 'view'),
    ('ASSET_MANAGER', 'pm', 'create'),
    ('ASSET_MANAGER', 'pm', 'edit'),
    ('ASSET_MANAGER', 'pm', 'approve'),
    ('ASSET_MANAGER', 'pm', 'viewCosts'),
    ('ASSET_MANAGER', 'purchasing', 'view'),
    ('ASSET_MANAGER', 'purchasing', 'approve'),
    ('ASSET_MANAGER', 'purchasing', 'viewCosts'),
    ('ASSET_MANAGER', 'readings', 'view'),
    ('ASSET_MANAGER', 'reliability', 'view'),
    ('ASSET_MANAGER', 'reliability', 'viewCosts'),
    ('ASSET_MANAGER', 'requests', 'view'),
    ('ASSET_MANAGER', 'requests', 'create'),
    ('ASSET_MANAGER', 'requests', 'edit'),
    ('ASSET_MANAGER', 'requests', 'approve'),
    ('ASSET_MANAGER', 'requests', 'authorize'),
    ('ASSET_MANAGER', 'requests', 'authorizeOwn'),
    ('ASSET_MANAGER', 'requests', 'viewCosts'),
    ('ASSET_MANAGER', 'requests', 'assign'),
    ('ASSET_MANAGER', 'safety', 'view'),
    ('ASSET_MANAGER', 'scheduling', 'view'),
    ('ASSET_MANAGER', 'sustain', 'view'),
    ('ASSET_MANAGER', 'taskLibrary', 'view'),
    ('ASSET_MANAGER', 'vendors', 'view'),
    ('ASSET_MANAGER', 'vendors', 'viewCosts'),
    ('ASSET_MANAGER', 'workOrders', 'view'),
    ('ASSET_MANAGER', 'workOrders', 'create'),
    ('ASSET_MANAGER', 'workOrders', 'edit'),
    ('ASSET_MANAGER', 'workOrders', 'approve'),
    ('ASSET_MANAGER', 'workOrders', 'viewCosts'),
    ('EXECUTIVE', 'analytics', 'view'),
    ('EXECUTIVE', 'analytics', 'viewCosts'),
    ('EXECUTIVE', 'assets', 'view'),
    ('EXECUTIVE', 'assets', 'viewCosts'),
    ('EXECUTIVE', 'audits', 'view'),
    ('EXECUTIVE', 'audits', 'approve'),
    ('EXECUTIVE', 'audits', 'viewCosts'),
    ('EXECUTIVE', 'contacts', 'view'),
    ('EXECUTIVE', 'dashboard', 'view'),
    ('EXECUTIVE', 'dashboard', 'viewCosts'),
    ('EXECUTIVE', 'finops', 'view'),
    ('EXECUTIVE', 'finops', 'viewCosts'),
    ('EXECUTIVE', 'integrity', 'view'),
    ('EXECUTIVE', 'inventory', 'view'),
    ('EXECUTIVE', 'inventory', 'viewCosts'),
    ('EXECUTIVE', 'moc', 'view'),
    ('EXECUTIVE', 'moc', 'approve'),
    ('EXECUTIVE', 'moc', 'authorize'),
    ('EXECUTIVE', 'notifications', 'view'),
    ('EXECUTIVE', 'pm', 'view'),
    ('EXECUTIVE', 'pm', 'viewCosts'),
    ('EXECUTIVE', 'purchasing', 'view'),
    ('EXECUTIVE', 'purchasing', 'approve'),
    ('EXECUTIVE', 'purchasing', 'authorize'),
    ('EXECUTIVE', 'purchasing', 'viewCosts'),
    ('EXECUTIVE', 'readings', 'view'),
    ('EXECUTIVE', 'reliability', 'view'),
    ('EXECUTIVE', 'requests', 'view'),
    ('EXECUTIVE', 'requests', 'approve'),
    ('EXECUTIVE', 'requests', 'viewCosts'),
    ('EXECUTIVE', 'safety', 'view'),
    ('EXECUTIVE', 'scheduling', 'view'),
    ('EXECUTIVE', 'sustain', 'view'),
    ('EXECUTIVE', 'taskLibrary', 'view'),
    ('EXECUTIVE', 'vendors', 'view'),
    ('EXECUTIVE', 'vendors', 'viewCosts'),
    ('EXECUTIVE', 'workOrders', 'view'),
    ('EXECUTIVE', 'workOrders', 'approve'),
    ('EXECUTIVE', 'workOrders', 'authorize'),
    ('EXECUTIVE', 'workOrders', 'viewCosts'),
    ('FINANCE', 'analytics', 'view'),
    ('FINANCE', 'analytics', 'viewCosts'),
    ('FINANCE', 'assets', 'view'),
    ('FINANCE', 'audits', 'view'),
    ('FINANCE', 'contacts', 'view'),
    ('FINANCE', 'dashboard', 'view'),
    ('FINANCE', 'dashboard', 'viewCosts'),
    ('FINANCE', 'finops', 'view'),
    ('FINANCE', 'finops', 'create'),
    ('FINANCE', 'finops', 'edit'),
    ('FINANCE', 'finops', 'approve'),
    ('FINANCE', 'finops', 'authorize'),
    ('FINANCE', 'finops', 'viewCosts'),
    ('FINANCE', 'finops', 'assign'),
    ('FINANCE', 'inventory', 'view'),
    ('FINANCE', 'inventory', 'viewCosts'),
    ('FINANCE', 'moc', 'view'),
    ('FINANCE', 'notifications', 'view'),
    ('FINANCE', 'notifications', 'create'),
    ('FINANCE', 'notifications', 'edit'),
    ('FINANCE', 'pm', 'view'),
    ('FINANCE', 'purchasing', 'view'),
    ('FINANCE', 'purchasing', 'approve'),
    ('FINANCE', 'purchasing', 'authorize'),
    ('FINANCE', 'purchasing', 'viewCosts'),
    ('FINANCE', 'readings', 'view'),
    ('FINANCE', 'reliability', 'view'),
    ('FINANCE', 'requests', 'view'),
    ('FINANCE', 'requests', 'create'),
    ('FINANCE', 'safety', 'view'),
    ('FINANCE', 'scheduling', 'view'),
    ('FINANCE', 'taskLibrary', 'view'),
    ('FINANCE', 'vendors', 'view'),
    ('FINANCE', 'vendors', 'viewCosts'),
    ('FINANCE', 'workOrders', 'view'),
    ('FINANCE', 'workOrders', 'viewCosts'),
    ('INTERNAL', 'assets', 'view'),
    ('INTERNAL', 'audits', 'view'),
    ('INTERNAL', 'dashboard', 'view'),
    ('INTERNAL', 'inventory', 'view'),
    ('INTERNAL', 'notifications', 'view'),
    ('INTERNAL', 'reliability', 'view'),
    ('INTERNAL', 'requests', 'view'),
    ('INTERNAL', 'requests', 'create'),
    ('INTERNAL', 'workOrders', 'view'),
    ('MANAGER', 'analytics', 'view'),
    ('MANAGER', 'analytics', 'viewCosts'),
    ('MANAGER', 'assets', 'view'),
    ('MANAGER', 'assets', 'create'),
    ('MANAGER', 'assets', 'edit'),
    ('MANAGER', 'assets', 'viewCosts'),
    ('MANAGER', 'audits', 'view'),
    ('MANAGER', 'audits', 'create'),
    ('MANAGER', 'audits', 'edit'),
    ('MANAGER', 'audits', 'approve'),
    ('MANAGER', 'audits', 'viewCosts'),
    ('MANAGER', 'contacts', 'view'),
    ('MANAGER', 'contacts', 'create'),
    ('MANAGER', 'contacts', 'edit'),
    ('MANAGER', 'dashboard', 'view'),
    ('MANAGER', 'dashboard', 'create'),
    ('MANAGER', 'dashboard', 'edit'),
    ('MANAGER', 'dashboard', 'viewCosts'),
    ('MANAGER', 'finops', 'view'),
    ('MANAGER', 'integrity', 'view'),
    ('MANAGER', 'inventory', 'view'),
    ('MANAGER', 'inventory', 'create'),
    ('MANAGER', 'inventory', 'edit'),
    ('MANAGER', 'inventory', 'viewCosts'),
    ('MANAGER', 'moc', 'view'),
    ('MANAGER', 'moc', 'create'),
    ('MANAGER', 'moc', 'edit'),
    ('MANAGER', 'moc', 'approve'),
    ('MANAGER', 'notifications', 'view'),
    ('MANAGER', 'notifications', 'create'),
    ('MANAGER', 'notifications', 'edit'),
    ('MANAGER', 'pm', 'view'),
    ('MANAGER', 'pm', 'create'),
    ('MANAGER', 'pm', 'edit'),
    ('MANAGER', 'pm', 'approve'),
    ('MANAGER', 'pm', 'viewCosts'),
    ('MANAGER', 'pm', 'assign'),
    ('MANAGER', 'purchasing', 'view'),
    ('MANAGER', 'purchasing', 'create'),
    ('MANAGER', 'purchasing', 'edit'),
    ('MANAGER', 'purchasing', 'approve'),
    ('MANAGER', 'purchasing', 'viewCosts'),
    ('MANAGER', 'readings', 'view'),
    ('MANAGER', 'readings', 'create'),
    ('MANAGER', 'readings', 'edit'),
    ('MANAGER', 'reliability', 'view'),
    ('MANAGER', 'requests', 'view'),
    ('MANAGER', 'requests', 'create'),
    ('MANAGER', 'requests', 'edit'),
    ('MANAGER', 'requests', 'approve'),
    ('MANAGER', 'requests', 'authorize'),
    ('MANAGER', 'requests', 'authorizeOwn'),
    ('MANAGER', 'requests', 'viewCosts'),
    ('MANAGER', 'requests', 'assign'),
    ('MANAGER', 'safety', 'view'),
    ('MANAGER', 'scheduling', 'view'),
    ('MANAGER', 'scheduling', 'create'),
    ('MANAGER', 'scheduling', 'edit'),
    ('MANAGER', 'scheduling', 'approve'),
    ('MANAGER', 'scheduling', 'assign'),
    ('MANAGER', 'sustain', 'view'),
    ('MANAGER', 'taskLibrary', 'view'),
    ('MANAGER', 'taskLibrary', 'create'),
    ('MANAGER', 'taskLibrary', 'edit'),
    ('MANAGER', 'vendors', 'view'),
    ('MANAGER', 'vendors', 'create'),
    ('MANAGER', 'vendors', 'edit'),
    ('MANAGER', 'vendors', 'approve'),
    ('MANAGER', 'vendors', 'viewCosts'),
    ('MANAGER', 'workOrders', 'view'),
    ('MANAGER', 'workOrders', 'create'),
    ('MANAGER', 'workOrders', 'edit'),
    ('MANAGER', 'workOrders', 'approve'),
    ('MANAGER', 'workOrders', 'viewCosts'),
    ('MANAGER', 'workOrders', 'assign'),
    ('PLANNER', 'analytics', 'view'),
    ('PLANNER', 'analytics', 'viewCosts'),
    ('PLANNER', 'assets', 'view'),
    ('PLANNER', 'assets', 'create'),
    ('PLANNER', 'assets', 'edit'),
    ('PLANNER', 'assets', 'viewCosts'),
    ('PLANNER', 'audits', 'view'),
    ('PLANNER', 'contacts', 'view'),
    ('PLANNER', 'contacts', 'create'),
    ('PLANNER', 'contacts', 'edit'),
    ('PLANNER', 'dashboard', 'view'),
    ('PLANNER', 'dashboard', 'create'),
    ('PLANNER', 'dashboard', 'edit'),
    ('PLANNER', 'dashboard', 'viewCosts'),
    ('PLANNER', 'inventory', 'view'),
    ('PLANNER', 'inventory', 'create'),
    ('PLANNER', 'inventory', 'edit'),
    ('PLANNER', 'inventory', 'viewCosts'),
    ('PLANNER', 'notifications', 'view'),
    ('PLANNER', 'notifications', 'create'),
    ('PLANNER', 'notifications', 'edit'),
    ('PLANNER', 'pm', 'view'),
    ('PLANNER', 'pm', 'create'),
    ('PLANNER', 'pm', 'edit'),
    ('PLANNER', 'pm', 'approve'),
    ('PLANNER', 'pm', 'viewCosts'),
    ('PLANNER', 'pm', 'assign'),
    ('PLANNER', 'purchasing', 'view'),
    ('PLANNER', 'purchasing', 'create'),
    ('PLANNER', 'purchasing', 'edit'),
    ('PLANNER', 'purchasing', 'approve'),
    ('PLANNER', 'purchasing', 'viewCosts'),
    ('PLANNER', 'readings', 'view'),
    ('PLANNER', 'reliability', 'view'),
    ('PLANNER', 'requests', 'view'),
    ('PLANNER', 'requests', 'create'),
    ('PLANNER', 'requests', 'edit'),
    ('PLANNER', 'requests', 'approve'),
    ('PLANNER', 'requests', 'viewCosts'),
    ('PLANNER', 'requests', 'assign'),
    ('PLANNER', 'safety', 'view'),
    ('PLANNER', 'safety', 'create'),
    ('PLANNER', 'safety', 'edit'),
    ('PLANNER', 'scheduling', 'view'),
    ('PLANNER', 'scheduling', 'create'),
    ('PLANNER', 'scheduling', 'edit'),
    ('PLANNER', 'scheduling', 'approve'),
    ('PLANNER', 'scheduling', 'assign'),
    ('PLANNER', 'taskLibrary', 'view'),
    ('PLANNER', 'taskLibrary', 'create'),
    ('PLANNER', 'taskLibrary', 'edit'),
    ('PLANNER', 'vendors', 'view'),
    ('PLANNER', 'vendors', 'create'),
    ('PLANNER', 'vendors', 'edit'),
    ('PLANNER', 'vendors', 'approve'),
    ('PLANNER', 'vendors', 'viewCosts'),
    ('PLANNER', 'workOrders', 'view'),
    ('PLANNER', 'workOrders', 'create'),
    ('PLANNER', 'workOrders', 'edit'),
    ('PLANNER', 'workOrders', 'approve'),
    ('PLANNER', 'workOrders', 'viewCosts'),
    ('PLANNER', 'workOrders', 'assign'),
    ('RELIABILITY_ENG', 'analytics', 'view'),
    ('RELIABILITY_ENG', 'analytics', 'viewCosts'),
    ('RELIABILITY_ENG', 'assets', 'view'),
    ('RELIABILITY_ENG', 'assets', 'create'),
    ('RELIABILITY_ENG', 'assets', 'edit'),
    ('RELIABILITY_ENG', 'assets', 'viewCosts'),
    ('RELIABILITY_ENG', 'audits', 'view'),
    ('RELIABILITY_ENG', 'audits', 'create'),
    ('RELIABILITY_ENG', 'audits', 'edit'),
    ('RELIABILITY_ENG', 'audits', 'delete'),
    ('RELIABILITY_ENG', 'audits', 'approve'),
    ('RELIABILITY_ENG', 'audits', 'authorize'),
    ('RELIABILITY_ENG', 'audits', 'viewCosts'),
    ('RELIABILITY_ENG', 'audits', 'assign'),
    ('RELIABILITY_ENG', 'contacts', 'view'),
    ('RELIABILITY_ENG', 'dashboard', 'view'),
    ('RELIABILITY_ENG', 'dashboard', 'create'),
    ('RELIABILITY_ENG', 'dashboard', 'edit'),
    ('RELIABILITY_ENG', 'dashboard', 'viewCosts'),
    ('RELIABILITY_ENG', 'integrity', 'view'),
    ('RELIABILITY_ENG', 'integrity', 'create'),
    ('RELIABILITY_ENG', 'integrity', 'edit'),
    ('RELIABILITY_ENG', 'integrity', 'delete'),
    ('RELIABILITY_ENG', 'integrity', 'approve'),
    ('RELIABILITY_ENG', 'integrity', 'authorize'),
    ('RELIABILITY_ENG', 'integrity', 'viewCosts'),
    ('RELIABILITY_ENG', 'integrity', 'assign'),
    ('RELIABILITY_ENG', 'inventory', 'view'),
    ('RELIABILITY_ENG', 'inventory', 'viewCosts'),
    ('RELIABILITY_ENG', 'notifications', 'view'),
    ('RELIABILITY_ENG', 'notifications', 'create'),
    ('RELIABILITY_ENG', 'notifications', 'edit'),
    ('RELIABILITY_ENG', 'pm', 'view'),
    ('RELIABILITY_ENG', 'pm', 'create'),
    ('RELIABILITY_ENG', 'pm', 'edit'),
    ('RELIABILITY_ENG', 'pm', 'viewCosts'),
    ('RELIABILITY_ENG', 'purchasing', 'view'),
    ('RELIABILITY_ENG', 'readings', 'view'),
    ('RELIABILITY_ENG', 'readings', 'create'),
    ('RELIABILITY_ENG', 'readings', 'edit'),
    ('RELIABILITY_ENG', 'reliability', 'view'),
    ('RELIABILITY_ENG', 'reliability', 'create'),
    ('RELIABILITY_ENG', 'reliability', 'edit'),
    ('RELIABILITY_ENG', 'reliability', 'delete'),
    ('RELIABILITY_ENG', 'reliability', 'approve'),
    ('RELIABILITY_ENG', 'reliability', 'authorize'),
    ('RELIABILITY_ENG', 'reliability', 'viewCosts'),
    ('RELIABILITY_ENG', 'reliability', 'assign'),
    ('RELIABILITY_ENG', 'requests', 'view'),
    ('RELIABILITY_ENG', 'requests', 'create'),
    ('RELIABILITY_ENG', 'requests', 'edit'),
    ('RELIABILITY_ENG', 'safety', 'view'),
    ('RELIABILITY_ENG', 'scheduling', 'view'),
    ('RELIABILITY_ENG', 'taskLibrary', 'view'),
    ('RELIABILITY_ENG', 'taskLibrary', 'create'),
    ('RELIABILITY_ENG', 'taskLibrary', 'edit'),
    ('RELIABILITY_ENG', 'vendors', 'view'),
    ('RELIABILITY_ENG', 'workOrders', 'view'),
    ('RELIABILITY_ENG', 'workOrders', 'create'),
    ('RELIABILITY_ENG', 'workOrders', 'edit'),
    ('RELIABILITY_ENG', 'workOrders', 'viewCosts'),
    ('REQUESTER', 'assets', 'view'),
    ('REQUESTER', 'audits', 'view'),
    ('REQUESTER', 'dashboard', 'view'),
    ('REQUESTER', 'notifications', 'view'),
    ('REQUESTER', 'reliability', 'view'),
    ('REQUESTER', 'requests', 'view'),
    ('REQUESTER', 'requests', 'create'),
    ('REQUESTER', 'requests', 'edit'),
    ('STOREKEEPER', 'analytics', 'view'),
    ('STOREKEEPER', 'assets', 'view'),
    ('STOREKEEPER', 'contacts', 'view'),
    ('STOREKEEPER', 'dashboard', 'view'),
    ('STOREKEEPER', 'dashboard', 'create'),
    ('STOREKEEPER', 'dashboard', 'edit'),
    ('STOREKEEPER', 'inventory', 'view'),
    ('STOREKEEPER', 'inventory', 'create'),
    ('STOREKEEPER', 'inventory', 'edit'),
    ('STOREKEEPER', 'inventory', 'delete'),
    ('STOREKEEPER', 'inventory', 'viewCosts'),
    ('STOREKEEPER', 'inventory', 'assign'),
    ('STOREKEEPER', 'notifications', 'view'),
    ('STOREKEEPER', 'notifications', 'create'),
    ('STOREKEEPER', 'notifications', 'edit'),
    ('STOREKEEPER', 'pm', 'view'),
    ('STOREKEEPER', 'purchasing', 'view'),
    ('STOREKEEPER', 'purchasing', 'create'),
    ('STOREKEEPER', 'purchasing', 'edit'),
    ('STOREKEEPER', 'purchasing', 'viewCosts'),
    ('STOREKEEPER', 'reliability', 'view'),
    ('STOREKEEPER', 'requests', 'view'),
    ('STOREKEEPER', 'requests', 'create'),
    ('STOREKEEPER', 'requests', 'edit'),
    ('STOREKEEPER', 'scheduling', 'view'),
    ('STOREKEEPER', 'vendors', 'view'),
    ('STOREKEEPER', 'vendors', 'create'),
    ('STOREKEEPER', 'vendors', 'edit'),
    ('STOREKEEPER', 'vendors', 'viewCosts'),
    ('STOREKEEPER', 'workOrders', 'view'),
    ('SUPERVISOR', 'analytics', 'view'),
    ('SUPERVISOR', 'assets', 'view'),
    ('SUPERVISOR', 'assets', 'create'),
    ('SUPERVISOR', 'assets', 'edit'),
    ('SUPERVISOR', 'audits', 'view'),
    ('SUPERVISOR', 'contacts', 'view'),
    ('SUPERVISOR', 'dashboard', 'view'),
    ('SUPERVISOR', 'dashboard', 'create'),
    ('SUPERVISOR', 'dashboard', 'edit'),
    ('SUPERVISOR', 'inventory', 'view'),
    ('SUPERVISOR', 'inventory', 'create'),
    ('SUPERVISOR', 'inventory', 'edit'),
    ('SUPERVISOR', 'notifications', 'view'),
    ('SUPERVISOR', 'notifications', 'create'),
    ('SUPERVISOR', 'notifications', 'edit'),
    ('SUPERVISOR', 'pm', 'view'),
    ('SUPERVISOR', 'pm', 'create'),
    ('SUPERVISOR', 'pm', 'edit'),
    ('SUPERVISOR', 'pm', 'approve'),
    ('SUPERVISOR', 'pm', 'assign'),
    ('SUPERVISOR', 'purchasing', 'view'),
    ('SUPERVISOR', 'readings', 'view'),
    ('SUPERVISOR', 'readings', 'create'),
    ('SUPERVISOR', 'readings', 'edit'),
    ('SUPERVISOR', 'reliability', 'view'),
    ('SUPERVISOR', 'requests', 'view'),
    ('SUPERVISOR', 'requests', 'create'),
    ('SUPERVISOR', 'requests', 'edit'),
    ('SUPERVISOR', 'requests', 'approve'),
    ('SUPERVISOR', 'requests', 'authorize'),
    ('SUPERVISOR', 'requests', 'authorizeOwn'),
    ('SUPERVISOR', 'requests', 'assign'),
    ('SUPERVISOR', 'safety', 'view'),
    ('SUPERVISOR', 'safety', 'create'),
    ('SUPERVISOR', 'safety', 'edit'),
    ('SUPERVISOR', 'safety', 'approve'),
    ('SUPERVISOR', 'scheduling', 'view'),
    ('SUPERVISOR', 'scheduling', 'create'),
    ('SUPERVISOR', 'scheduling', 'edit'),
    ('SUPERVISOR', 'scheduling', 'approve'),
    ('SUPERVISOR', 'scheduling', 'assign'),
    ('SUPERVISOR', 'taskLibrary', 'view'),
    ('SUPERVISOR', 'vendors', 'view'),
    ('SUPERVISOR', 'workOrders', 'view'),
    ('SUPERVISOR', 'workOrders', 'create'),
    ('SUPERVISOR', 'workOrders', 'edit'),
    ('SUPERVISOR', 'workOrders', 'approve'),
    ('SUPERVISOR', 'workOrders', 'assign'),
    ('SUPER_ADMIN', 'activityLog', 'view'),
    ('SUPER_ADMIN', 'activityLog', 'create'),
    ('SUPER_ADMIN', 'activityLog', 'edit'),
    ('SUPER_ADMIN', 'activityLog', 'delete'),
    ('SUPER_ADMIN', 'activityLog', 'approve'),
    ('SUPER_ADMIN', 'activityLog', 'authorize'),
    ('SUPER_ADMIN', 'activityLog', 'viewCosts'),
    ('SUPER_ADMIN', 'activityLog', 'assign'),
    ('SUPER_ADMIN', 'admin', 'view'),
    ('SUPER_ADMIN', 'admin', 'create'),
    ('SUPER_ADMIN', 'admin', 'edit'),
    ('SUPER_ADMIN', 'admin', 'delete'),
    ('SUPER_ADMIN', 'admin', 'approve'),
    ('SUPER_ADMIN', 'admin', 'authorize'),
    ('SUPER_ADMIN', 'admin', 'viewCosts'),
    ('SUPER_ADMIN', 'admin', 'assign'),
    ('SUPER_ADMIN', 'analytics', 'view'),
    ('SUPER_ADMIN', 'analytics', 'create'),
    ('SUPER_ADMIN', 'analytics', 'edit'),
    ('SUPER_ADMIN', 'analytics', 'delete'),
    ('SUPER_ADMIN', 'analytics', 'approve'),
    ('SUPER_ADMIN', 'analytics', 'authorize'),
    ('SUPER_ADMIN', 'analytics', 'viewCosts'),
    ('SUPER_ADMIN', 'analytics', 'assign'),
    ('SUPER_ADMIN', 'assets', 'view'),
    ('SUPER_ADMIN', 'assets', 'create'),
    ('SUPER_ADMIN', 'assets', 'edit'),
    ('SUPER_ADMIN', 'assets', 'delete'),
    ('SUPER_ADMIN', 'assets', 'approve'),
    ('SUPER_ADMIN', 'assets', 'authorize'),
    ('SUPER_ADMIN', 'assets', 'viewCosts'),
    ('SUPER_ADMIN', 'assets', 'assign'),
    ('SUPER_ADMIN', 'audits', 'view'),
    ('SUPER_ADMIN', 'audits', 'create'),
    ('SUPER_ADMIN', 'audits', 'edit'),
    ('SUPER_ADMIN', 'audits', 'delete'),
    ('SUPER_ADMIN', 'audits', 'approve'),
    ('SUPER_ADMIN', 'audits', 'authorize'),
    ('SUPER_ADMIN', 'audits', 'viewCosts'),
    ('SUPER_ADMIN', 'audits', 'assign'),
    ('SUPER_ADMIN', 'contacts', 'view'),
    ('SUPER_ADMIN', 'contacts', 'create'),
    ('SUPER_ADMIN', 'contacts', 'edit'),
    ('SUPER_ADMIN', 'contacts', 'delete'),
    ('SUPER_ADMIN', 'contacts', 'approve'),
    ('SUPER_ADMIN', 'contacts', 'authorize'),
    ('SUPER_ADMIN', 'contacts', 'viewCosts'),
    ('SUPER_ADMIN', 'contacts', 'assign'),
    ('SUPER_ADMIN', 'dashboard', 'view'),
    ('SUPER_ADMIN', 'dashboard', 'create'),
    ('SUPER_ADMIN', 'dashboard', 'edit'),
    ('SUPER_ADMIN', 'dashboard', 'delete'),
    ('SUPER_ADMIN', 'dashboard', 'approve'),
    ('SUPER_ADMIN', 'dashboard', 'authorize'),
    ('SUPER_ADMIN', 'dashboard', 'viewCosts'),
    ('SUPER_ADMIN', 'dashboard', 'assign'),
    ('SUPER_ADMIN', 'finops', 'view'),
    ('SUPER_ADMIN', 'finops', 'create'),
    ('SUPER_ADMIN', 'finops', 'edit'),
    ('SUPER_ADMIN', 'finops', 'delete'),
    ('SUPER_ADMIN', 'finops', 'approve'),
    ('SUPER_ADMIN', 'finops', 'authorize'),
    ('SUPER_ADMIN', 'finops', 'viewCosts'),
    ('SUPER_ADMIN', 'finops', 'assign'),
    ('SUPER_ADMIN', 'integrity', 'view'),
    ('SUPER_ADMIN', 'integrity', 'create'),
    ('SUPER_ADMIN', 'integrity', 'edit'),
    ('SUPER_ADMIN', 'integrity', 'delete'),
    ('SUPER_ADMIN', 'integrity', 'approve'),
    ('SUPER_ADMIN', 'integrity', 'authorize'),
    ('SUPER_ADMIN', 'integrity', 'viewCosts'),
    ('SUPER_ADMIN', 'integrity', 'assign'),
    ('SUPER_ADMIN', 'inventory', 'view'),
    ('SUPER_ADMIN', 'inventory', 'create'),
    ('SUPER_ADMIN', 'inventory', 'edit'),
    ('SUPER_ADMIN', 'inventory', 'delete'),
    ('SUPER_ADMIN', 'inventory', 'approve'),
    ('SUPER_ADMIN', 'inventory', 'authorize'),
    ('SUPER_ADMIN', 'inventory', 'viewCosts'),
    ('SUPER_ADMIN', 'inventory', 'assign'),
    ('SUPER_ADMIN', 'moc', 'view'),
    ('SUPER_ADMIN', 'moc', 'create'),
    ('SUPER_ADMIN', 'moc', 'edit'),
    ('SUPER_ADMIN', 'moc', 'delete'),
    ('SUPER_ADMIN', 'moc', 'approve'),
    ('SUPER_ADMIN', 'moc', 'authorize'),
    ('SUPER_ADMIN', 'moc', 'viewCosts'),
    ('SUPER_ADMIN', 'moc', 'assign'),
    ('SUPER_ADMIN', 'notifications', 'view'),
    ('SUPER_ADMIN', 'notifications', 'create'),
    ('SUPER_ADMIN', 'notifications', 'edit'),
    ('SUPER_ADMIN', 'notifications', 'delete'),
    ('SUPER_ADMIN', 'notifications', 'approve'),
    ('SUPER_ADMIN', 'notifications', 'authorize'),
    ('SUPER_ADMIN', 'notifications', 'viewCosts'),
    ('SUPER_ADMIN', 'notifications', 'assign'),
    ('SUPER_ADMIN', 'pm', 'view'),
    ('SUPER_ADMIN', 'pm', 'create'),
    ('SUPER_ADMIN', 'pm', 'edit'),
    ('SUPER_ADMIN', 'pm', 'delete'),
    ('SUPER_ADMIN', 'pm', 'approve'),
    ('SUPER_ADMIN', 'pm', 'authorize'),
    ('SUPER_ADMIN', 'pm', 'viewCosts'),
    ('SUPER_ADMIN', 'pm', 'assign'),
    ('SUPER_ADMIN', 'purchasing', 'view'),
    ('SUPER_ADMIN', 'purchasing', 'create'),
    ('SUPER_ADMIN', 'purchasing', 'edit'),
    ('SUPER_ADMIN', 'purchasing', 'delete'),
    ('SUPER_ADMIN', 'purchasing', 'approve'),
    ('SUPER_ADMIN', 'purchasing', 'authorize'),
    ('SUPER_ADMIN', 'purchasing', 'viewCosts'),
    ('SUPER_ADMIN', 'purchasing', 'assign'),
    ('SUPER_ADMIN', 'readings', 'view'),
    ('SUPER_ADMIN', 'readings', 'create'),
    ('SUPER_ADMIN', 'readings', 'edit'),
    ('SUPER_ADMIN', 'readings', 'delete'),
    ('SUPER_ADMIN', 'readings', 'approve'),
    ('SUPER_ADMIN', 'readings', 'authorize'),
    ('SUPER_ADMIN', 'readings', 'viewCosts'),
    ('SUPER_ADMIN', 'readings', 'assign'),
    ('SUPER_ADMIN', 'reliability', 'view'),
    ('SUPER_ADMIN', 'reliability', 'create'),
    ('SUPER_ADMIN', 'reliability', 'edit'),
    ('SUPER_ADMIN', 'reliability', 'delete'),
    ('SUPER_ADMIN', 'reliability', 'approve'),
    ('SUPER_ADMIN', 'reliability', 'authorize'),
    ('SUPER_ADMIN', 'reliability', 'viewCosts'),
    ('SUPER_ADMIN', 'reliability', 'assign'),
    ('SUPER_ADMIN', 'requests', 'view'),
    ('SUPER_ADMIN', 'requests', 'create'),
    ('SUPER_ADMIN', 'requests', 'edit'),
    ('SUPER_ADMIN', 'requests', 'delete'),
    ('SUPER_ADMIN', 'requests', 'approve'),
    ('SUPER_ADMIN', 'requests', 'authorize'),
    ('SUPER_ADMIN', 'requests', 'viewCosts'),
    ('SUPER_ADMIN', 'requests', 'assign'),
    ('SUPER_ADMIN', 'safety', 'view'),
    ('SUPER_ADMIN', 'safety', 'create'),
    ('SUPER_ADMIN', 'safety', 'edit'),
    ('SUPER_ADMIN', 'safety', 'delete'),
    ('SUPER_ADMIN', 'safety', 'approve'),
    ('SUPER_ADMIN', 'safety', 'authorize'),
    ('SUPER_ADMIN', 'safety', 'viewCosts'),
    ('SUPER_ADMIN', 'safety', 'assign'),
    ('SUPER_ADMIN', 'scheduling', 'view'),
    ('SUPER_ADMIN', 'scheduling', 'create'),
    ('SUPER_ADMIN', 'scheduling', 'edit'),
    ('SUPER_ADMIN', 'scheduling', 'delete'),
    ('SUPER_ADMIN', 'scheduling', 'approve'),
    ('SUPER_ADMIN', 'scheduling', 'authorize'),
    ('SUPER_ADMIN', 'scheduling', 'viewCosts'),
    ('SUPER_ADMIN', 'scheduling', 'assign'),
    ('SUPER_ADMIN', 'sustain', 'view'),
    ('SUPER_ADMIN', 'sustain', 'create'),
    ('SUPER_ADMIN', 'sustain', 'edit'),
    ('SUPER_ADMIN', 'sustain', 'delete'),
    ('SUPER_ADMIN', 'sustain', 'approve'),
    ('SUPER_ADMIN', 'sustain', 'authorize'),
    ('SUPER_ADMIN', 'sustain', 'viewCosts'),
    ('SUPER_ADMIN', 'sustain', 'assign'),
    ('SUPER_ADMIN', 'taskLibrary', 'view'),
    ('SUPER_ADMIN', 'taskLibrary', 'create'),
    ('SUPER_ADMIN', 'taskLibrary', 'edit'),
    ('SUPER_ADMIN', 'taskLibrary', 'delete'),
    ('SUPER_ADMIN', 'taskLibrary', 'approve'),
    ('SUPER_ADMIN', 'taskLibrary', 'authorize'),
    ('SUPER_ADMIN', 'taskLibrary', 'viewCosts'),
    ('SUPER_ADMIN', 'taskLibrary', 'assign'),
    ('SUPER_ADMIN', 'vendors', 'view'),
    ('SUPER_ADMIN', 'vendors', 'create'),
    ('SUPER_ADMIN', 'vendors', 'edit'),
    ('SUPER_ADMIN', 'vendors', 'delete'),
    ('SUPER_ADMIN', 'vendors', 'approve'),
    ('SUPER_ADMIN', 'vendors', 'authorize'),
    ('SUPER_ADMIN', 'vendors', 'viewCosts'),
    ('SUPER_ADMIN', 'vendors', 'assign'),
    ('SUPER_ADMIN', 'workOrders', 'view'),
    ('SUPER_ADMIN', 'workOrders', 'create'),
    ('SUPER_ADMIN', 'workOrders', 'edit'),
    ('SUPER_ADMIN', 'workOrders', 'delete'),
    ('SUPER_ADMIN', 'workOrders', 'approve'),
    ('SUPER_ADMIN', 'workOrders', 'authorize'),
    ('SUPER_ADMIN', 'workOrders', 'viewCosts'),
    ('SUPER_ADMIN', 'workOrders', 'assign'),
    ('SYS_ADMIN', 'admin', 'view'),
    ('SYS_ADMIN', 'admin', 'create'),
    ('SYS_ADMIN', 'admin', 'edit'),
    ('SYS_ADMIN', 'admin', 'delete'),
    ('SYS_ADMIN', 'admin', 'approve'),
    ('SYS_ADMIN', 'admin', 'authorize'),
    ('SYS_ADMIN', 'admin', 'viewCosts'),
    ('SYS_ADMIN', 'admin', 'assign'),
    ('SYS_ADMIN', 'analytics', 'view'),
    ('SYS_ADMIN', 'analytics', 'create'),
    ('SYS_ADMIN', 'analytics', 'edit'),
    ('SYS_ADMIN', 'analytics', 'delete'),
    ('SYS_ADMIN', 'analytics', 'approve'),
    ('SYS_ADMIN', 'analytics', 'authorize'),
    ('SYS_ADMIN', 'analytics', 'viewCosts'),
    ('SYS_ADMIN', 'analytics', 'assign'),
    ('SYS_ADMIN', 'assets', 'view'),
    ('SYS_ADMIN', 'assets', 'create'),
    ('SYS_ADMIN', 'assets', 'edit'),
    ('SYS_ADMIN', 'assets', 'delete'),
    ('SYS_ADMIN', 'assets', 'approve'),
    ('SYS_ADMIN', 'assets', 'authorize'),
    ('SYS_ADMIN', 'assets', 'viewCosts'),
    ('SYS_ADMIN', 'assets', 'assign'),
    ('SYS_ADMIN', 'audits', 'view'),
    ('SYS_ADMIN', 'audits', 'create'),
    ('SYS_ADMIN', 'audits', 'edit'),
    ('SYS_ADMIN', 'audits', 'delete'),
    ('SYS_ADMIN', 'audits', 'approve'),
    ('SYS_ADMIN', 'audits', 'authorize'),
    ('SYS_ADMIN', 'audits', 'viewCosts'),
    ('SYS_ADMIN', 'audits', 'assign'),
    ('SYS_ADMIN', 'contacts', 'view'),
    ('SYS_ADMIN', 'contacts', 'create'),
    ('SYS_ADMIN', 'contacts', 'edit'),
    ('SYS_ADMIN', 'contacts', 'delete'),
    ('SYS_ADMIN', 'contacts', 'approve'),
    ('SYS_ADMIN', 'contacts', 'authorize'),
    ('SYS_ADMIN', 'contacts', 'viewCosts'),
    ('SYS_ADMIN', 'contacts', 'assign'),
    ('SYS_ADMIN', 'dashboard', 'view'),
    ('SYS_ADMIN', 'dashboard', 'create'),
    ('SYS_ADMIN', 'dashboard', 'edit'),
    ('SYS_ADMIN', 'dashboard', 'delete'),
    ('SYS_ADMIN', 'dashboard', 'approve'),
    ('SYS_ADMIN', 'dashboard', 'authorize'),
    ('SYS_ADMIN', 'dashboard', 'viewCosts'),
    ('SYS_ADMIN', 'dashboard', 'assign'),
    ('SYS_ADMIN', 'finops', 'view'),
    ('SYS_ADMIN', 'finops', 'create'),
    ('SYS_ADMIN', 'finops', 'edit'),
    ('SYS_ADMIN', 'finops', 'delete'),
    ('SYS_ADMIN', 'finops', 'approve'),
    ('SYS_ADMIN', 'finops', 'authorize'),
    ('SYS_ADMIN', 'finops', 'viewCosts'),
    ('SYS_ADMIN', 'finops', 'assign'),
    ('SYS_ADMIN', 'integrity', 'view'),
    ('SYS_ADMIN', 'integrity', 'create'),
    ('SYS_ADMIN', 'integrity', 'edit'),
    ('SYS_ADMIN', 'integrity', 'delete'),
    ('SYS_ADMIN', 'integrity', 'approve'),
    ('SYS_ADMIN', 'integrity', 'authorize'),
    ('SYS_ADMIN', 'integrity', 'viewCosts'),
    ('SYS_ADMIN', 'integrity', 'assign'),
    ('SYS_ADMIN', 'inventory', 'view'),
    ('SYS_ADMIN', 'inventory', 'create'),
    ('SYS_ADMIN', 'inventory', 'edit'),
    ('SYS_ADMIN', 'inventory', 'delete'),
    ('SYS_ADMIN', 'inventory', 'approve'),
    ('SYS_ADMIN', 'inventory', 'authorize'),
    ('SYS_ADMIN', 'inventory', 'viewCosts'),
    ('SYS_ADMIN', 'inventory', 'assign'),
    ('SYS_ADMIN', 'moc', 'view'),
    ('SYS_ADMIN', 'moc', 'create'),
    ('SYS_ADMIN', 'moc', 'edit'),
    ('SYS_ADMIN', 'moc', 'delete'),
    ('SYS_ADMIN', 'moc', 'approve'),
    ('SYS_ADMIN', 'moc', 'authorize'),
    ('SYS_ADMIN', 'moc', 'viewCosts'),
    ('SYS_ADMIN', 'moc', 'assign'),
    ('SYS_ADMIN', 'notifications', 'view'),
    ('SYS_ADMIN', 'notifications', 'create'),
    ('SYS_ADMIN', 'notifications', 'edit'),
    ('SYS_ADMIN', 'notifications', 'delete'),
    ('SYS_ADMIN', 'notifications', 'approve'),
    ('SYS_ADMIN', 'notifications', 'authorize'),
    ('SYS_ADMIN', 'notifications', 'viewCosts'),
    ('SYS_ADMIN', 'notifications', 'assign'),
    ('SYS_ADMIN', 'pm', 'view'),
    ('SYS_ADMIN', 'pm', 'create'),
    ('SYS_ADMIN', 'pm', 'edit'),
    ('SYS_ADMIN', 'pm', 'delete'),
    ('SYS_ADMIN', 'pm', 'approve'),
    ('SYS_ADMIN', 'pm', 'authorize'),
    ('SYS_ADMIN', 'pm', 'viewCosts'),
    ('SYS_ADMIN', 'pm', 'assign'),
    ('SYS_ADMIN', 'purchasing', 'view'),
    ('SYS_ADMIN', 'purchasing', 'create'),
    ('SYS_ADMIN', 'purchasing', 'edit'),
    ('SYS_ADMIN', 'purchasing', 'delete'),
    ('SYS_ADMIN', 'purchasing', 'approve'),
    ('SYS_ADMIN', 'purchasing', 'authorize'),
    ('SYS_ADMIN', 'purchasing', 'viewCosts'),
    ('SYS_ADMIN', 'purchasing', 'assign'),
    ('SYS_ADMIN', 'readings', 'view'),
    ('SYS_ADMIN', 'readings', 'create'),
    ('SYS_ADMIN', 'readings', 'edit'),
    ('SYS_ADMIN', 'readings', 'delete'),
    ('SYS_ADMIN', 'readings', 'approve'),
    ('SYS_ADMIN', 'readings', 'authorize'),
    ('SYS_ADMIN', 'readings', 'viewCosts'),
    ('SYS_ADMIN', 'readings', 'assign'),
    ('SYS_ADMIN', 'reliability', 'view'),
    ('SYS_ADMIN', 'reliability', 'create'),
    ('SYS_ADMIN', 'reliability', 'edit'),
    ('SYS_ADMIN', 'reliability', 'delete'),
    ('SYS_ADMIN', 'reliability', 'approve'),
    ('SYS_ADMIN', 'reliability', 'authorize'),
    ('SYS_ADMIN', 'reliability', 'viewCosts'),
    ('SYS_ADMIN', 'reliability', 'assign'),
    ('SYS_ADMIN', 'requests', 'view'),
    ('SYS_ADMIN', 'requests', 'create'),
    ('SYS_ADMIN', 'requests', 'edit'),
    ('SYS_ADMIN', 'requests', 'delete'),
    ('SYS_ADMIN', 'requests', 'approve'),
    ('SYS_ADMIN', 'requests', 'authorize'),
    ('SYS_ADMIN', 'requests', 'viewCosts'),
    ('SYS_ADMIN', 'requests', 'assign'),
    ('SYS_ADMIN', 'safety', 'view'),
    ('SYS_ADMIN', 'safety', 'create'),
    ('SYS_ADMIN', 'safety', 'edit'),
    ('SYS_ADMIN', 'safety', 'delete'),
    ('SYS_ADMIN', 'safety', 'approve'),
    ('SYS_ADMIN', 'safety', 'authorize'),
    ('SYS_ADMIN', 'safety', 'viewCosts'),
    ('SYS_ADMIN', 'safety', 'assign'),
    ('SYS_ADMIN', 'scheduling', 'view'),
    ('SYS_ADMIN', 'scheduling', 'create'),
    ('SYS_ADMIN', 'scheduling', 'edit'),
    ('SYS_ADMIN', 'scheduling', 'delete'),
    ('SYS_ADMIN', 'scheduling', 'approve'),
    ('SYS_ADMIN', 'scheduling', 'authorize'),
    ('SYS_ADMIN', 'scheduling', 'viewCosts'),
    ('SYS_ADMIN', 'scheduling', 'assign'),
    ('SYS_ADMIN', 'sustain', 'view'),
    ('SYS_ADMIN', 'sustain', 'create'),
    ('SYS_ADMIN', 'sustain', 'edit'),
    ('SYS_ADMIN', 'sustain', 'delete'),
    ('SYS_ADMIN', 'sustain', 'approve'),
    ('SYS_ADMIN', 'sustain', 'authorize'),
    ('SYS_ADMIN', 'sustain', 'viewCosts'),
    ('SYS_ADMIN', 'sustain', 'assign'),
    ('SYS_ADMIN', 'taskLibrary', 'view'),
    ('SYS_ADMIN', 'taskLibrary', 'create'),
    ('SYS_ADMIN', 'taskLibrary', 'edit'),
    ('SYS_ADMIN', 'taskLibrary', 'delete'),
    ('SYS_ADMIN', 'taskLibrary', 'approve'),
    ('SYS_ADMIN', 'taskLibrary', 'authorize'),
    ('SYS_ADMIN', 'taskLibrary', 'viewCosts'),
    ('SYS_ADMIN', 'taskLibrary', 'assign'),
    ('SYS_ADMIN', 'vendors', 'view'),
    ('SYS_ADMIN', 'vendors', 'create'),
    ('SYS_ADMIN', 'vendors', 'edit'),
    ('SYS_ADMIN', 'vendors', 'delete'),
    ('SYS_ADMIN', 'vendors', 'approve'),
    ('SYS_ADMIN', 'vendors', 'authorize'),
    ('SYS_ADMIN', 'vendors', 'viewCosts'),
    ('SYS_ADMIN', 'vendors', 'assign'),
    ('SYS_ADMIN', 'workOrders', 'view'),
    ('SYS_ADMIN', 'workOrders', 'create'),
    ('SYS_ADMIN', 'workOrders', 'edit'),
    ('SYS_ADMIN', 'workOrders', 'delete'),
    ('SYS_ADMIN', 'workOrders', 'approve'),
    ('SYS_ADMIN', 'workOrders', 'authorize'),
    ('SYS_ADMIN', 'workOrders', 'viewCosts'),
    ('SYS_ADMIN', 'workOrders', 'assign'),
    ('TECHNICIAN', 'assets', 'view'),
    ('TECHNICIAN', 'assets', 'edit'),
    ('TECHNICIAN', 'audits', 'view'),
    ('TECHNICIAN', 'contacts', 'view'),
    ('TECHNICIAN', 'dashboard', 'view'),
    ('TECHNICIAN', 'inventory', 'view'),
    ('TECHNICIAN', 'notifications', 'view'),
    ('TECHNICIAN', 'notifications', 'create'),
    ('TECHNICIAN', 'notifications', 'edit'),
    ('TECHNICIAN', 'pm', 'view'),
    ('TECHNICIAN', 'readings', 'view'),
    ('TECHNICIAN', 'readings', 'create'),
    ('TECHNICIAN', 'readings', 'edit'),
    ('TECHNICIAN', 'reliability', 'view'),
    ('TECHNICIAN', 'requests', 'view'),
    ('TECHNICIAN', 'requests', 'create'),
    ('TECHNICIAN', 'requests', 'edit'),
    ('TECHNICIAN', 'safety', 'view'),
    ('TECHNICIAN', 'safety', 'create'),
    ('TECHNICIAN', 'scheduling', 'view'),
    ('TECHNICIAN', 'taskLibrary', 'view'),
    ('TECHNICIAN', 'workOrders', 'view'),
    ('TECHNICIAN', 'workOrders', 'edit'),
    ('__default__', 'assets', 'view'),
    ('__default__', 'audits', 'view'),
    ('__default__', 'contacts', 'view'),
    ('__default__', 'dashboard', 'view'),
    ('__default__', 'inventory', 'view'),
    ('__default__', 'notifications', 'view'),
    ('__default__', 'pm', 'view'),
    ('__default__', 'purchasing', 'view'),
    ('__default__', 'requests', 'view'),
    ('__default__', 'requests', 'create'),
    ('__default__', 'scheduling', 'view'),
    ('__default__', 'taskLibrary', 'view'),
    ('__default__', 'vendors', 'view'),
    ('__default__', 'workOrders', 'view');
-- 67 approval limits (role, module, amount). Do not hand-edit.
DELETE FROM public.role_spending_limits;
INSERT INTO public.role_spending_limits (role, module, spending_limit) VALUES
    ('ASSET_MANAGER', 'purchasing', 50000),
    ('ASSET_MANAGER', 'requests', 25000),
    ('ASSET_MANAGER', 'workOrders', 25000),
    ('EXECUTIVE', 'purchasing', 250000),
    ('EXECUTIVE', 'requests', 100000),
    ('EXECUTIVE', 'workOrders', 100000),
    ('FINANCE', 'finops', 1000000),
    ('FINANCE', 'purchasing', 50000),
    ('MANAGER', 'purchasing', 50000),
    ('MANAGER', 'requests', 25000),
    ('MANAGER', 'workOrders', 25000),
    ('PLANNER', 'purchasing', 25000),
    ('PLANNER', 'requests', 10000),
    ('PLANNER', 'workOrders', 10000),
    ('RELIABILITY_ENG', 'audits', 1000000),
    ('RELIABILITY_ENG', 'integrity', 1000000),
    ('RELIABILITY_ENG', 'reliability', 1000000),
    ('RELIABILITY_ENG', 'requests', 5000),
    ('STOREKEEPER', 'inventory', 5000),
    ('STOREKEEPER', 'purchasing', 5000),
    ('SUPERVISOR', 'requests', 5000),
    ('SUPERVISOR', 'workOrders', 5000),
    ('SUPER_ADMIN', 'activityLog', 1000000),
    ('SUPER_ADMIN', 'admin', 1000000),
    ('SUPER_ADMIN', 'analytics', 1000000),
    ('SUPER_ADMIN', 'assets', 1000000),
    ('SUPER_ADMIN', 'audits', 1000000),
    ('SUPER_ADMIN', 'contacts', 1000000),
    ('SUPER_ADMIN', 'dashboard', 1000000),
    ('SUPER_ADMIN', 'finops', 1000000),
    ('SUPER_ADMIN', 'integrity', 1000000),
    ('SUPER_ADMIN', 'inventory', 1000000),
    ('SUPER_ADMIN', 'moc', 1000000),
    ('SUPER_ADMIN', 'notifications', 1000000),
    ('SUPER_ADMIN', 'pm', 1000000),
    ('SUPER_ADMIN', 'purchasing', 1000000),
    ('SUPER_ADMIN', 'readings', 1000000),
    ('SUPER_ADMIN', 'reliability', 1000000),
    ('SUPER_ADMIN', 'requests', 1000000),
    ('SUPER_ADMIN', 'safety', 1000000),
    ('SUPER_ADMIN', 'scheduling', 1000000),
    ('SUPER_ADMIN', 'sustain', 1000000),
    ('SUPER_ADMIN', 'taskLibrary', 1000000),
    ('SUPER_ADMIN', 'vendors', 1000000),
    ('SUPER_ADMIN', 'workOrders', 1000000),
    ('SYS_ADMIN', 'admin', 1000000),
    ('SYS_ADMIN', 'analytics', 1000000),
    ('SYS_ADMIN', 'assets', 1000000),
    ('SYS_ADMIN', 'audits', 1000000),
    ('SYS_ADMIN', 'contacts', 1000000),
    ('SYS_ADMIN', 'dashboard', 1000000),
    ('SYS_ADMIN', 'finops', 1000000),
    ('SYS_ADMIN', 'integrity', 1000000),
    ('SYS_ADMIN', 'inventory', 1000000),
    ('SYS_ADMIN', 'moc', 1000000),
    ('SYS_ADMIN', 'notifications', 1000000),
    ('SYS_ADMIN', 'pm', 1000000),
    ('SYS_ADMIN', 'purchasing', 1000000),
    ('SYS_ADMIN', 'readings', 1000000),
    ('SYS_ADMIN', 'reliability', 1000000),
    ('SYS_ADMIN', 'requests', 1000000),
    ('SYS_ADMIN', 'safety', 1000000),
    ('SYS_ADMIN', 'scheduling', 1000000),
    ('SYS_ADMIN', 'sustain', 1000000),
    ('SYS_ADMIN', 'taskLibrary', 1000000),
    ('SYS_ADMIN', 'vendors', 1000000),
    ('SYS_ADMIN', 'workOrders', 1000000);
-- ── END GENERATED SEED ──

-- ── B. The caller's limit for a module ──────────────────────────────────────
-- Same identity resolution and precedence as caller_can (0241): a per-user
-- override wins, else the role's template, else nothing (0). Administrators
-- are unlimited.
CREATE OR REPLACE FUNCTION public.caller_spending_limit(p_module text)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    WITH me AS (
        SELECT u.roles ->> 0 AS role,
               coalesce(u.permission_overrides, '{}'::jsonb) AS overrides
        FROM public.users u
        WHERE (
                lower(coalesce(u.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
             OR lower(coalesce(u.username, '')) = lower(split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1))
              )
          AND coalesce(u.status, 'active') = 'active'
        LIMIT 1
    )
    SELECT CASE
        WHEN public.is_admin() THEN 1e15
        WHEN ((SELECT overrides FROM me) -> p_module ->> 'spendingLimit') ~ '^[0-9]+(\.[0-9]+)?$'
            THEN ((SELECT overrides FROM me) -> p_module ->> 'spendingLimit')::numeric
        ELSE coalesce((
            SELECT l.spending_limit FROM public.role_spending_limits l
             WHERE l.role = coalesce((SELECT role FROM me), '__default__') AND l.module = p_module), 0)
    END;
$$;
REVOKE ALL ON FUNCTION public.caller_spending_limit(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.caller_spending_limit(text) TO authenticated;

-- ── C. Work-order cost release ──────────────────────────────────────────────
ALTER TABLE public.work_orders
    ADD COLUMN IF NOT EXISTS cost_approved_amount       numeric(14,2),
    ADD COLUMN IF NOT EXISTS cost_approved_by           uuid,
    ADD COLUMN IF NOT EXISTS cost_approved_at           timestamptz,
    ADD COLUMN IF NOT EXISTS cost_release_requested_by  uuid,
    ADD COLUMN IF NOT EXISTS cost_release_requested_at  timestamptz;
COMMENT ON COLUMN public.work_orders.cost_approved_amount IS
    '0401: planned cost approved for release by cost_approved_by. The order may be scheduled by anyone while its planned cost stays at or under this.';

-- Planned cost on the planner''s basis (sem_wo_planned_lines, 0341): craft
-- lines × headcount × rate + planned parts. Internal: costs are not for every role.
CREATE OR REPLACE FUNCTION public.ers_wo_planned_cost(p_wo uuid)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT coalesce(sum(amount), 0) FROM public.sem_wo_planned_lines WHERE work_order_id = p_wo;
$$;
REVOKE ALL ON FUNCTION public.ers_wo_planned_cost(uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enforce_wo_cost_release()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    old_s  text := upper(coalesce(OLD.status::text, ''));
    new_s  text := upper(coalesce(NEW.status::text, ''));
    v_cost numeric;
BEGIN
    IF public.session_is_internal() THEN RETURN NEW; END IF;

    -- The approval stamp is written here, never taken from the client.
    IF NEW.cost_approved_at IS NOT NULL AND NEW.cost_approved_at IS DISTINCT FROM OLD.cost_approved_at THEN
        v_cost := public.ers_wo_planned_cost(NEW.id);
        IF NOT public.is_admin()
           AND (NOT public.caller_can('workOrders', 'approve') OR public.caller_spending_limit('workOrders') < v_cost) THEN
            RAISE EXCEPTION 'LIMIT_EXCEEDED: the planned cost of % is above your approval limit. It needs someone with a higher limit.', OLD.wo_number
                USING ERRCODE = 'insufficient_privilege';
        END IF;
        NEW.cost_approved_at     := now();
        NEW.cost_approved_by     := public.caller_user_id();
        NEW.cost_approved_amount := v_cost;
    ELSE
        NEW.cost_approved_at     := OLD.cost_approved_at;
        NEW.cost_approved_by     := OLD.cost_approved_by;
        NEW.cost_approved_amount := OLD.cost_approved_amount;
    END IF;

    -- Release: leaving planning for the schedule or the job site.
    IF old_s IN ('OPEN', 'PLAN') AND new_s IN ('SCHED', 'WIP')
       AND upper(coalesce(NEW.priority_code, '')) NOT IN ('EMERGENCY', 'P1', 'CRITICAL')
       AND NOT public.is_admin() THEN
        v_cost := public.ers_wo_planned_cost(NEW.id);
        IF v_cost > public.caller_spending_limit('workOrders')
           AND v_cost > coalesce(NEW.cost_approved_amount, 0) THEN
            RAISE EXCEPTION 'RELEASE_REQUIRED: the planned cost of % is above your release limit. Request a cost release on the order, then schedule it once it is approved.', OLD.wo_number
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_wo_cost_release ON public.work_orders;
CREATE TRIGGER trg_enforce_wo_cost_release
    BEFORE UPDATE ON public.work_orders
    FOR EACH ROW EXECUTE FUNCTION public.enforce_wo_cost_release();

-- What the order page needs to show the right thing to the right person.
-- Amounts are returned only to callers who may see costs.
CREATE OR REPLACE FUNCTION public.ers_wo_release_state(p_wo uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    w        public.work_orders%ROWTYPE;
    v_cost   numeric;
    v_limit  numeric;
    v_open   boolean;
    v_costs  boolean;
BEGIN
    SELECT * INTO w FROM public.work_orders WHERE id = p_wo;
    IF NOT FOUND OR w.company_id IS DISTINCT FROM public.caller_company() THEN RETURN NULL; END IF;
    v_cost  := public.ers_wo_planned_cost(p_wo);
    v_limit := public.caller_spending_limit('workOrders');
    v_open  := upper(w.status::text) IN ('OPEN', 'PLAN')
               AND upper(coalesce(w.priority_code, '')) NOT IN ('EMERGENCY', 'P1', 'CRITICAL');
    v_costs := public.caller_can('workOrders', 'viewCosts') OR public.is_admin();
    RETURN jsonb_build_object(
        'needs_release', v_open AND v_cost > v_limit AND v_cost > coalesce(w.cost_approved_amount, 0),
        'awaiting_approval', v_open AND w.cost_release_requested_at IS NOT NULL AND v_cost > coalesce(w.cost_approved_amount, 0),
        'can_approve', (public.caller_can('workOrders', 'approve') OR public.is_admin()) AND v_limit >= v_cost,
        'requested_at', w.cost_release_requested_at,
        'requested_by', (SELECT coalesce(u.username, u.email) FROM public.users u WHERE u.id = w.cost_release_requested_by),
        'approved_at', w.cost_approved_at,
        'approved_by', (SELECT coalesce(u.username, u.email) FROM public.users u WHERE u.id = w.cost_approved_by),
        'planned_cost', CASE WHEN v_costs THEN v_cost END,
        'my_limit', CASE WHEN v_costs THEN least(v_limit, 999999999) END,
        'approved_amount', CASE WHEN v_costs THEN w.cost_approved_amount END
    );
END $$;
REVOKE ALL ON FUNCTION public.ers_wo_release_state(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ers_wo_release_state(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.ers_request_wo_cost_release(p_wo uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT (public.caller_can('workOrders', 'edit') OR public.is_admin()) THEN
        RAISE EXCEPTION 'Not authorized: workOrders.edit is required to request a cost release';
    END IF;
    UPDATE public.work_orders
       SET cost_release_requested_at = now(), cost_release_requested_by = public.caller_user_id()
     WHERE id = p_wo AND company_id = public.caller_company();
    IF NOT FOUND THEN RAISE EXCEPTION 'work order % not found', p_wo; END IF;
    RETURN public.ers_wo_release_state(p_wo);
END $$;
REVOKE ALL ON FUNCTION public.ers_request_wo_cost_release(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ers_request_wo_cost_release(uuid) TO authenticated;

-- The trigger above does the checking and the stamping; this only asks for it,
-- so an approver without edit rights on orders (a manager above the line) can
-- still approve.
CREATE OR REPLACE FUNCTION public.ers_approve_wo_cost(p_wo uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE public.work_orders SET cost_approved_at = clock_timestamp()
     WHERE id = p_wo AND company_id = public.caller_company();
    IF NOT FOUND THEN RAISE EXCEPTION 'work order % not found', p_wo; END IF;
    RETURN public.ers_wo_release_state(p_wo);
END $$;
REVOKE ALL ON FUNCTION public.ers_approve_wo_cost(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ers_approve_wo_cost(uuid) TO authenticated;

-- ── D. Purchase orders: the authoriser's limit ──────────────────────────────
-- 0371's function, plus one check after the segregation-of-duties refusal.
CREATE OR REPLACE FUNCTION public.ers_authorize_purchase_order(p_po uuid, p_override_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_check jsonb;
    v_user  text;
    v_email text;
    v_po    public.purchase_orders%ROWTYPE;
    v_total numeric;
    v_limit numeric;
BEGIN
    IF NOT public.caller_can('purchasing', 'approve') THEN
        RAISE EXCEPTION 'Not authorized: purchasing.approve is required to authorise a purchase order';
    END IF;
    SELECT * INTO v_po FROM public.purchase_orders WHERE id = p_po;
    IF NOT FOUND THEN RAISE EXCEPTION 'purchase order % not found', p_po; END IF;
    IF v_po.company_id IS DISTINCT FROM public.caller_company() THEN
        RAISE EXCEPTION 'purchase order % is not in your company', p_po;
    END IF;
    IF v_po.status IN ('COMPLETED', 'CANCELLED') THEN
        RAISE EXCEPTION 'purchase order % is %, it cannot be authorised', v_po.po_code, v_po.status;
    END IF;

    -- 0371: nothing to buy, or nobody to charge, is not an order yet.
    IF NOT EXISTS (SELECT 1 FROM public.purchase_order_lines l WHERE l.po_id = p_po) THEN
        RAISE EXCEPTION 'NO_LINES: purchase order % has no lines — add what is being bought before authorising', v_po.po_code
            USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.ers_po_cost_centers(p_po)) THEN
        RAISE EXCEPTION 'NO_RECEIVER: purchase order % has no cost centre — choose one on the order, or link its lines to a work order that has a receiver', v_po.po_code
            USING ERRCODE = 'check_violation';
    END IF;

    -- 0371: segregation of duties — the person who raised the order does not
    -- authorise it (administrators excepted). created_by is free text on this
    -- table: a user id, a username or an e-mail, so all three are compared.
    SELECT COALESCE(u.username, u.email, auth.uid()::text), u.email INTO v_user, v_email
      FROM public.users u WHERE u.id = auth.uid();
    IF NOT public.is_admin() AND NULLIF(trim(coalesce(v_po.created_by, '')), '') IS NOT NULL
       AND lower(trim(v_po.created_by)) IN (lower(coalesce(auth.uid()::text, '')), lower(coalesce(v_user, '')), lower(coalesce(v_email, ''))) THEN
        RAISE EXCEPTION 'SOD: the person who raised purchase order % cannot also authorise it — ask another approver', v_po.po_code
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- 0401: delegation of authority — the order's value against the
    -- authoriser's purchasing limit (role template, or their own override).
    SELECT coalesce(sum(l.line_total), 0) INTO v_total FROM public.purchase_order_lines l WHERE l.po_id = p_po;
    v_limit := public.caller_spending_limit('purchasing');
    IF v_total > v_limit THEN
        RAISE EXCEPTION 'LIMIT_EXCEEDED: purchase order % totals %, above your approval limit of % — ask an approver with a higher limit', v_po.po_code, v_total, v_limit
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    v_check := public.ers_po_budget_check(p_po);
    IF (v_check->>'blocked')::boolean THEN
        RAISE EXCEPTION 'BUDGET_BLOCKED: a hard budget block applies — raise the budget or remove the block before authorising' USING DETAIL = v_check::text;
    END IF;
    IF (v_check->>'requires_override')::boolean AND NULLIF(trim(COALESCE(p_override_reason, '')), '') IS NULL THEN
        RAISE EXCEPTION 'BUDGET_EXCEEDED: this order takes a cost centre over budget — an override reason is required' USING DETAIL = v_check::text;
    END IF;

    UPDATE public.purchase_orders
       SET authorized_by_id = COALESCE(v_user, authorized_by_id),
           authorized_at = now(),
           budget_check = v_check,
           budget_override_reason = CASE WHEN (v_check->>'requires_override')::boolean THEN trim(p_override_reason) ELSE NULL END,
           status = CASE WHEN status = 'DRAFT' THEN 'OPEN' ELSE status END,
           updated_at = now()
     WHERE id = p_po;
    RETURN v_check || jsonb_build_object('authorized_by', v_user, 'authorized_at', now());
END $$;
REVOKE ALL ON FUNCTION public.ers_authorize_purchase_order(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ers_authorize_purchase_order(uuid, text) TO authenticated;

-- ── E. The approver is told ─────────────────────────────────────────────────
INSERT INTO public.notification_rules
    (name, description, module, event_trigger, is_active, severity, filters, recipients, channels,
     escalation_timeout_minutes, escalation_recipient_role, action_required, company_id)
SELECT 'WO Cost Release Requested',
       'A work order''s planned cost is above the planner''s limit and is waiting for your approval before it can be scheduled',
       'workOrders', 'WO_RELEASE_REQUESTED', true, 'WARNING', '[]'::jsonb,
       '[{"type":"ROLE","targetId":"MANAGER"}]'::jsonb, '["IN_APP"]'::jsonb, 480, 'SUPER_ADMIN', true, c.id
  FROM public.companies c
 WHERE c.active
   AND NOT EXISTS (SELECT 1 FROM public.notification_rules n WHERE n.company_id = c.id AND n.name = 'WO Cost Release Requested');

INSERT INTO public.product_seed_rows (id, table_name)
SELECT n.id, 'notification_rules'
  FROM public.notification_rules n
 WHERE n.company_id = (SELECT id FROM public.companies WHERE active ORDER BY created_at LIMIT 1)
   AND n.name = 'WO Cost Release Requested'
   AND NOT EXISTS (SELECT 1 FROM public.product_seed_rows s WHERE s.id = n.id);

COMMIT;

-- VERIFY (after apply):
--   SELECT role, module, spending_limit FROM role_spending_limits WHERE module IN ('workOrders','purchasing') ORDER BY module, spending_limit;
--   SELECT tgname FROM pg_trigger WHERE tgname = 'trg_enforce_wo_cost_release';
--   SELECT has_function_privilege('authenticated', 'public.ers_wo_planned_cost(uuid)', 'EXECUTE');   -- false
