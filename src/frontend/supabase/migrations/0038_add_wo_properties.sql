-- Migration: Add properties JSONB column to work_orders
-- Date: 2026-02-06
-- Purpose: Store flexible flags like enforceJobCostCenter without schema rigidity

ALTER TABLE work_orders
ADD COLUMN IF NOT EXISTS properties JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN work_orders.properties IS 'Flexible properties (e.g. enforceJobCostCenter)';
