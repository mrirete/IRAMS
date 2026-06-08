-- ═══════════════════════════════════════════════════════════════════
-- Migration: Seed Role-Based Permissions into reference_codes
-- ═══════════════════════════════════════════════════════════════════
-- Seeds the `properties.permissions` JSONB for each CONTACT_TYPE role
-- in the reference_codes table. This is the SINGLE SOURCE OF TRUTH
-- for the AuthContext runtime permission resolver AND the Admin panel
-- Effective Permission Matrix.
--
-- Permission Tiers (SAP Activity Code aligned):
--   SYS_ADMIN        → Full access to all modules
--   RELIABILITY_ENG  → Full core + Condition Data + Analytics (read)
--   PLANNER          → Full core + Scheduling + Purchasing
--   SUPERVISOR       → Full core (no delete/authorize on premium)
--   TECHNICIAN       → Basic core (view/create/edit only)
--   REQUESTER        → Requests + Dashboard only
-- ═══════════════════════════════════════════════════════════════════

-- SYS_ADMIN: Unrestricted access to all modules
UPDATE reference_codes
SET properties = COALESCE(properties, '{}'::jsonb) || jsonb_build_object('permissions', jsonb_build_object(
    'dashboard', '{"view":true,"create":true,"edit":true,"delete":true,"approve":true,"authorize":true,"assign":true,"viewCosts":true,"spendingLimit":1000000}'::jsonb,
    'assets', '{"view":true,"create":true,"edit":true,"delete":true,"approve":true,"authorize":true,"assign":true,"viewCosts":true,"spendingLimit":1000000}'::jsonb,
    'requests', '{"view":true,"create":true,"edit":true,"delete":true,"approve":true,"authorize":true,"assign":true,"viewCosts":true,"spendingLimit":1000000}'::jsonb,
    'workOrders', '{"view":true,"create":true,"edit":true,"delete":true,"approve":true,"authorize":true,"assign":true,"viewCosts":true,"spendingLimit":1000000}'::jsonb,
    'pm', '{"view":true,"create":true,"edit":true,"delete":true,"approve":true,"authorize":true,"assign":true,"viewCosts":true,"spendingLimit":1000000}'::jsonb,
    'scheduling', '{"view":true,"create":true,"edit":true,"delete":true,"approve":true,"authorize":true,"assign":true,"viewCosts":true,"spendingLimit":1000000}'::jsonb,
    'inventory', '{"view":true,"create":true,"edit":true,"delete":true,"approve":true,"authorize":true,"assign":true,"viewCosts":true,"spendingLimit":1000000}'::jsonb,
    'purchasing', '{"view":true,"create":true,"edit":true,"delete":true,"approve":true,"authorize":true,"assign":true,"viewCosts":true,"spendingLimit":1000000}'::jsonb,
    'readings', '{"view":true,"create":true,"edit":true,"delete":true,"approve":true,"authorize":true,"assign":true,"viewCosts":true,"spendingLimit":1000000}'::jsonb,
    'analytics', '{"view":true,"create":true,"edit":true,"delete":true,"approve":true,"authorize":true,"assign":true,"viewCosts":true,"spendingLimit":1000000}'::jsonb,
    'contacts', '{"view":true,"create":true,"edit":true,"delete":true,"approve":true,"authorize":true,"assign":true,"viewCosts":true,"spendingLimit":1000000}'::jsonb,
    'vendors', '{"view":true,"create":true,"edit":true,"delete":true,"approve":true,"authorize":true,"assign":true,"viewCosts":true,"spendingLimit":1000000}'::jsonb,
    'finops', '{"view":true,"create":true,"edit":true,"delete":true,"approve":true,"authorize":true,"assign":true,"viewCosts":true,"spendingLimit":1000000}'::jsonb,
    'taskLibrary', '{"view":true,"create":true,"edit":true,"delete":true,"approve":true,"authorize":true,"assign":true,"viewCosts":true,"spendingLimit":1000000}'::jsonb,
    'safety', '{"view":true,"create":true,"edit":true,"delete":true,"approve":true,"authorize":true,"assign":true,"viewCosts":true,"spendingLimit":1000000}'::jsonb,
    'moc', '{"view":true,"create":true,"edit":true,"delete":true,"approve":true,"authorize":true,"assign":true,"viewCosts":true,"spendingLimit":1000000}'::jsonb,
    'notifications', '{"view":true,"create":true,"edit":true,"delete":true,"approve":true,"authorize":true,"assign":true,"viewCosts":true,"spendingLimit":1000000}'::jsonb,
    'admin', '{"view":true,"create":true,"edit":true,"delete":true,"approve":true,"authorize":true,"assign":true,"viewCosts":true,"spendingLimit":1000000}'::jsonb
))
WHERE category = 'CONTACT_TYPE' AND code = 'SYS_ADMIN';

-- RELIABILITY_ENG: Full core access + Condition Data + Analytics (view) + Safety (view)
-- No access: FinOps, Admin, Notifications config, MoC
UPDATE reference_codes
SET properties = COALESCE(properties, '{}'::jsonb) || jsonb_build_object('permissions', jsonb_build_object(
    'dashboard', '{"view":true,"create":true,"edit":true,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'assets', '{"view":true,"create":true,"edit":true,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'requests', '{"view":true,"create":true,"edit":true,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":5000}'::jsonb,
    'workOrders', '{"view":true,"create":true,"edit":true,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'pm', '{"view":true,"create":true,"edit":true,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'scheduling', '{"view":true,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'inventory', '{"view":true,"create":true,"edit":true,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'purchasing', '{"view":true,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'readings', '{"view":true,"create":true,"edit":true,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'analytics', '{"view":true,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'contacts', '{"view":true,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'vendors', '{"view":true,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'finops', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'taskLibrary', '{"view":true,"create":true,"edit":true,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'safety', '{"view":true,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'moc', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'notifications', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'admin', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb
))
WHERE category = 'CONTACT_TYPE' AND code = 'RELIABILITY_ENG';

-- PLANNER: Full core + Scheduling + Purchasing + Vendors
UPDATE reference_codes
SET properties = COALESCE(properties, '{}'::jsonb) || jsonb_build_object('permissions', jsonb_build_object(
    'dashboard', '{"view":true,"create":true,"edit":true,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":true,"spendingLimit":0}'::jsonb,
    'assets', '{"view":true,"create":true,"edit":true,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":true,"spendingLimit":0}'::jsonb,
    'requests', '{"view":true,"create":true,"edit":true,"delete":false,"approve":true,"authorize":false,"assign":true,"viewCosts":true,"spendingLimit":10000}'::jsonb,
    'workOrders', '{"view":true,"create":true,"edit":true,"delete":false,"approve":true,"authorize":false,"assign":true,"viewCosts":true,"spendingLimit":10000}'::jsonb,
    'pm', '{"view":true,"create":true,"edit":true,"delete":false,"approve":true,"authorize":false,"assign":true,"viewCosts":true,"spendingLimit":0}'::jsonb,
    'scheduling', '{"view":true,"create":true,"edit":true,"delete":false,"approve":true,"authorize":false,"assign":true,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'inventory', '{"view":true,"create":true,"edit":true,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":true,"spendingLimit":0}'::jsonb,
    'purchasing', '{"view":true,"create":true,"edit":true,"delete":false,"approve":true,"authorize":false,"assign":false,"viewCosts":true,"spendingLimit":25000}'::jsonb,
    'readings', '{"view":true,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'analytics', '{"view":true,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":true,"spendingLimit":0}'::jsonb,
    'contacts', '{"view":true,"create":true,"edit":true,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'vendors', '{"view":true,"create":true,"edit":true,"delete":false,"approve":true,"authorize":false,"assign":false,"viewCosts":true,"spendingLimit":0}'::jsonb,
    'finops', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'taskLibrary', '{"view":true,"create":true,"edit":true,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'safety', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'moc', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'notifications', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'admin', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb
))
WHERE category = 'CONTACT_TYPE' AND code = 'PLANNER';

-- SUPERVISOR: Full core + approve/assign on work + scheduling
UPDATE reference_codes
SET properties = COALESCE(properties, '{}'::jsonb) || jsonb_build_object('permissions', jsonb_build_object(
    'dashboard', '{"view":true,"create":true,"edit":true,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'assets', '{"view":true,"create":true,"edit":true,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'requests', '{"view":true,"create":true,"edit":true,"delete":false,"approve":true,"authorize":false,"assign":true,"viewCosts":false,"spendingLimit":5000}'::jsonb,
    'workOrders', '{"view":true,"create":true,"edit":true,"delete":false,"approve":true,"authorize":false,"assign":true,"viewCosts":false,"spendingLimit":5000}'::jsonb,
    'pm', '{"view":true,"create":true,"edit":true,"delete":false,"approve":true,"authorize":false,"assign":true,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'scheduling', '{"view":true,"create":true,"edit":true,"delete":false,"approve":true,"authorize":false,"assign":true,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'inventory', '{"view":true,"create":true,"edit":true,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'purchasing', '{"view":true,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'readings', '{"view":true,"create":true,"edit":true,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'analytics', '{"view":true,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'contacts', '{"view":true,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'vendors', '{"view":true,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'finops', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'taskLibrary', '{"view":true,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'safety', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'moc', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'notifications', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'admin', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb
))
WHERE category = 'CONTACT_TYPE' AND code = 'SUPERVISOR';

-- TECHNICIAN: View + Create + Edit on core work modules only
UPDATE reference_codes
SET properties = COALESCE(properties, '{}'::jsonb) || jsonb_build_object('permissions', jsonb_build_object(
    'dashboard', '{"view":true,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'assets', '{"view":true,"create":false,"edit":true,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'requests', '{"view":true,"create":true,"edit":true,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'workOrders', '{"view":true,"create":false,"edit":true,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'pm', '{"view":true,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'scheduling', '{"view":true,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'inventory', '{"view":true,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'purchasing', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'readings', '{"view":true,"create":true,"edit":true,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'analytics', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'contacts', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'vendors', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'finops', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'taskLibrary', '{"view":true,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'safety', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'moc', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'notifications', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'admin', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb
))
WHERE category = 'CONTACT_TYPE' AND code = 'TECHNICIAN';

-- REQUESTER: Requests + Dashboard only (lowest tier)
UPDATE reference_codes
SET properties = COALESCE(properties, '{}'::jsonb) || jsonb_build_object('permissions', jsonb_build_object(
    'dashboard', '{"view":true,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'assets', '{"view":true,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'requests', '{"view":true,"create":true,"edit":true,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'workOrders', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'pm', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'scheduling', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'inventory', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'purchasing', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'readings', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'analytics', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'contacts', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'vendors', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'finops', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'taskLibrary', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'safety', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'moc', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'notifications', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'admin', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb
))
WHERE category = 'CONTACT_TYPE' AND code = 'REQUESTER';

-- INTERNAL: View only on basic modules
UPDATE reference_codes
SET properties = COALESCE(properties, '{}'::jsonb) || jsonb_build_object('permissions', jsonb_build_object(
    'dashboard', '{"view":true,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'assets', '{"view":true,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'requests', '{"view":true,"create":true,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'workOrders', '{"view":true,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'pm', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'scheduling', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'inventory', '{"view":true,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'purchasing', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'readings', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'analytics', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'contacts', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'vendors', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'finops', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'taskLibrary', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'safety', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'moc', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'notifications', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb,
    'admin', '{"view":false,"create":false,"edit":false,"delete":false,"approve":false,"authorize":false,"assign":false,"viewCosts":false,"spendingLimit":0}'::jsonb
))
WHERE category = 'CONTACT_TYPE' AND code = 'INTERNAL';
