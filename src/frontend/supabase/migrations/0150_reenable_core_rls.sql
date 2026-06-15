-- ═══════════════════════════════════════════════════════════════════════
-- 0150: Re-enable Row-Level Security on Core EAM Tables
-- ═══════════════════════════════════════════════════════════════════════
-- Migration 0091 disabled RLS for development. This migration re-enables
-- it with simple "authenticated users can do everything" policies.
--
-- Phase 1: All authenticated users get full CRUD on all core tables.
--          This matches the pattern used by ptw_permits (migration 0051).
-- Phase 2: (Post-launch) Add site-scoped policies using organization_unit_id
--          for multi-site data isolation. Application-side filtering is
--          already implemented in DatabaseService.filterAssetsBySiteScope().
--
-- Re-enable before production deployment.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Helper function to idempotently enable RLS + create policies ──────
-- We wrap in DO blocks to handle "policy already exists" gracefully.

-- ═══════════════════════════════════════════════════════════════════════
-- PART 1: Re-enable RLS on all core tables
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE work_orders            ENABLE ROW LEVEL SECURITY;
ALTER TABLE wo_failure_data        ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_requests       ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs             ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'recurring_work') THEN
        EXECUTE 'ALTER TABLE recurring_work ENABLE ROW LEVEL SECURITY';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'job_tasks') THEN
        EXECUTE 'ALTER TABLE job_tasks ENABLE ROW LEVEL SECURITY';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'contacts') THEN
        EXECUTE 'ALTER TABLE contacts ENABLE ROW LEVEL SECURITY';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'purchase_orders') THEN
        EXECUTE 'ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'po_lines') THEN
        EXECUTE 'ALTER TABLE po_lines ENABLE ROW LEVEL SECURITY';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'work_order_labor') THEN
        EXECUTE 'ALTER TABLE work_order_labor ENABLE ROW LEVEL SECURITY';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'work_order_parts') THEN
        EXECUTE 'ALTER TABLE work_order_parts ENABLE ROW LEVEL SECURITY';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'jsa_assessments') THEN
        EXECUTE 'ALTER TABLE jsa_assessments ENABLE ROW LEVEL SECURITY';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'jsa_hazards') THEN
        EXECUTE 'ALTER TABLE jsa_hazards ENABLE ROW LEVEL SECURITY';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'inventory_stock') THEN
        EXECUTE 'ALTER TABLE inventory_stock ENABLE ROW LEVEL SECURITY';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'inventory_locations') THEN
        EXECUTE 'ALTER TABLE inventory_locations ENABLE ROW LEVEL SECURITY';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'notification_rules') THEN
        EXECUTE 'ALTER TABLE notification_rules ENABLE ROW LEVEL SECURITY';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'notification_channels') THEN
        EXECUTE 'ALTER TABLE notification_channels ENABLE ROW LEVEL SECURITY';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'notification_events') THEN
        EXECUTE 'ALTER TABLE notification_events ENABLE ROW LEVEL SECURITY';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'journal_entries') THEN
        EXECUTE 'ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'entity_files') THEN
        EXECUTE 'ALTER TABLE entity_files ENABLE ROW LEVEL SECURITY';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'vendors') THEN
        EXECUTE 'ALTER TABLE vendors ENABLE ROW LEVEL SECURITY';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'manufacturer_models') THEN
        EXECUTE 'ALTER TABLE manufacturer_models ENABLE ROW LEVEL SECURITY';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'qualifications') THEN
        EXECUTE 'ALTER TABLE qualifications ENABLE ROW LEVEL SECURITY';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'organization_units') THEN
        EXECUTE 'ALTER TABLE organization_units ENABLE ROW LEVEL SECURITY';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'organization_unit_members') THEN
        EXECUTE 'ALTER TABLE organization_unit_members ENABLE ROW LEVEL SECURITY';
    END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════════════
-- PART 2: Create "authenticated" policies (Phase 1 — open CRUD for
--         any logged-in user). Idempotent: DROP IF EXISTS first.
-- ═══════════════════════════════════════════════════════════════════════

-- Macro: For each table, create SELECT/INSERT/UPDATE/DELETE policies
-- allowing any authenticated user full access.

-- Helper: Create 4 policies on a table (idempotent via DO block)
CREATE OR REPLACE FUNCTION _create_auth_policies(tbl TEXT)
RETURNS VOID AS $$
BEGIN
    -- Drop existing policies first to avoid conflicts
    EXECUTE format('DROP POLICY IF EXISTS "auth_select_%s" ON %I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "auth_insert_%s" ON %I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "auth_update_%s" ON %I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "auth_delete_%s" ON %I', tbl, tbl);

    -- Create new policies
    EXECUTE format(
        'CREATE POLICY "auth_select_%s" ON %I FOR SELECT TO authenticated USING (true)',
        tbl, tbl
    );
    EXECUTE format(
        'CREATE POLICY "auth_insert_%s" ON %I FOR INSERT TO authenticated WITH CHECK (true)',
        tbl, tbl
    );
    EXECUTE format(
        'CREATE POLICY "auth_update_%s" ON %I FOR UPDATE TO authenticated USING (true)',
        tbl, tbl
    );
    EXECUTE format(
        'CREATE POLICY "auth_delete_%s" ON %I FOR DELETE TO authenticated USING (true)',
        tbl, tbl
    );
END;
$$ LANGUAGE plpgsql;

-- Apply to all core EAM tables
SELECT _create_auth_policies('work_orders');
SELECT _create_auth_policies('wo_failure_data');
SELECT _create_auth_policies('service_requests');
SELECT _create_auth_policies('inventory_items');
SELECT _create_auth_policies('inventory_transactions');
SELECT _create_auth_policies('users');
SELECT _create_auth_policies('audit_logs');

-- Conditional tables (might not exist in all environments)
DO $$ BEGIN
    PERFORM _create_auth_policies('recurring_work')        WHERE EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'recurring_work');
    PERFORM _create_auth_policies('job_tasks')             WHERE EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'job_tasks');
    PERFORM _create_auth_policies('contacts')              WHERE EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'contacts');
    PERFORM _create_auth_policies('purchase_orders')       WHERE EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'purchase_orders');
    PERFORM _create_auth_policies('po_lines')              WHERE EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'po_lines');
    PERFORM _create_auth_policies('work_order_labor')      WHERE EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'work_order_labor');
    PERFORM _create_auth_policies('work_order_parts')      WHERE EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'work_order_parts');
    PERFORM _create_auth_policies('jsa_assessments')       WHERE EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'jsa_assessments');
    PERFORM _create_auth_policies('jsa_hazards')           WHERE EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'jsa_hazards');
    PERFORM _create_auth_policies('inventory_stock')       WHERE EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'inventory_stock');
    PERFORM _create_auth_policies('inventory_locations')   WHERE EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'inventory_locations');
    PERFORM _create_auth_policies('notification_rules')    WHERE EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'notification_rules');
    PERFORM _create_auth_policies('notification_channels') WHERE EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'notification_channels');
    PERFORM _create_auth_policies('notification_events')   WHERE EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'notification_events');
    PERFORM _create_auth_policies('journal_entries')       WHERE EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'journal_entries');
    PERFORM _create_auth_policies('entity_files')          WHERE EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'entity_files');
    PERFORM _create_auth_policies('vendors')               WHERE EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'vendors');
    PERFORM _create_auth_policies('manufacturer_models')   WHERE EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'manufacturer_models');
    PERFORM _create_auth_policies('qualifications')        WHERE EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'qualifications');
    PERFORM _create_auth_policies('organization_units')    WHERE EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'organization_units');
    PERFORM _create_auth_policies('organization_unit_members') WHERE EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'organization_unit_members');
END $$;

-- Cleanup helper function
DROP FUNCTION IF EXISTS _create_auth_policies(TEXT);


-- ═══════════════════════════════════════════════════════════════════════
-- PART 3: Special policies for sensitive tables
-- ═══════════════════════════════════════════════════════════════════════

-- audit_logs: Everyone can read, only system can write (append-only)
-- The generic policy above allows all. Override for INSERT to be more restrictive.
-- For now, keep it open since the frontend writes audit entries directly.
-- TODO Phase 2: Move audit writes to backend/Edge Function for immutability.

-- users: Admin-only write access would be ideal, but the frontend manages
-- users directly via Supabase. Keep open for now, restrict in Phase 2.


COMMENT ON POLICY "auth_select_work_orders" ON work_orders IS
    'Phase 1 RLS: All authenticated users can read work orders. Phase 2 will add site-scope filtering.';
