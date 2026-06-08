-- ============================================================
-- Disable RLS on core EAM tables for development
-- AND add missing columns from unapplied migrations
--
-- The sb_publishable_ key format does not map to the 'anon' or
-- 'authenticated' Postgres roles, so all policy-based filtering
-- returns 0 rows / blocks all writes.
--
-- This specifically fixes:
--   - Work Order creation from PM Generator (insert blocked by RLS + missing column)
--   - Service Request creation
--   - Inventory transactions
--   - WO failure data writes (TECO gate)
--
-- Re-enable RLS with proper policies before production deployment.
-- ============================================================

-- ═══════════════════════════════════════════
-- PART 1: Disable RLS on core EAM tables
-- ═══════════════════════════════════════════

ALTER TABLE work_orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE wo_failure_data DISABLE ROW LEVEL SECURITY;
ALTER TABLE service_requests DISABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE dictionaries DISABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs DISABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'recurring_work') THEN
        EXECUTE 'ALTER TABLE recurring_work DISABLE ROW LEVEL SECURITY';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'job_tasks') THEN
        EXECUTE 'ALTER TABLE job_tasks DISABLE ROW LEVEL SECURITY';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'contacts') THEN
        EXECUTE 'ALTER TABLE contacts DISABLE ROW LEVEL SECURITY';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'purchase_orders') THEN
        EXECUTE 'ALTER TABLE purchase_orders DISABLE ROW LEVEL SECURITY';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'po_lines') THEN
        EXECUTE 'ALTER TABLE po_lines DISABLE ROW LEVEL SECURITY';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'wo_labor') THEN
        EXECUTE 'ALTER TABLE wo_labor DISABLE ROW LEVEL SECURITY';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'wo_materials') THEN
        EXECUTE 'ALTER TABLE wo_materials DISABLE ROW LEVEL SECURITY';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'wo_jsa') THEN
        EXECUTE 'ALTER TABLE wo_jsa DISABLE ROW LEVEL SECURITY';
    END IF;
END $$;

-- ═══════════════════════════════════════════
-- PART 2: Add missing columns from migration 0065
-- (recurring_work_id FK on work_orders + templates on recurring_work)
-- ═══════════════════════════════════════════

-- Add recurring_work_id column to work_orders for PM traceability
ALTER TABLE work_orders
ADD COLUMN IF NOT EXISTS recurring_work_id TEXT;

CREATE INDEX IF NOT EXISTS idx_work_orders_recurring_work_id ON work_orders(recurring_work_id);
COMMENT ON COLUMN work_orders.recurring_work_id IS 'Source PM/recurring job that generated this WO';

-- Add templates JSONB column to recurring_work for task/labor/material templates
ALTER TABLE recurring_work
ADD COLUMN IF NOT EXISTS templates JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN recurring_work.templates IS 'Template data (tasks, labor, materials, JSA) copied to generated WOs';
