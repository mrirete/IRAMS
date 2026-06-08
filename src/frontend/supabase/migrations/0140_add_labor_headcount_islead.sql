-- 0140_add_labor_headcount_islead.sql
-- ============================================================
-- Add headcount and is_lead columns to work_order_labor
-- These fields support Craft Requirements planning:
--   headcount: How many people of this role are needed (default 1)
--   is_lead:   Designates the lead craft accountable for task sign-off
-- ============================================================

ALTER TABLE work_order_labor
  ADD COLUMN IF NOT EXISTS headcount INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_lead   BOOLEAN NOT NULL DEFAULT FALSE;

-- Add a comment for documentation
COMMENT ON COLUMN work_order_labor.headcount IS 'Number of people required for this craft role (ISO 14224 resource planning)';
COMMENT ON COLUMN work_order_labor.is_lead   IS 'Lead craft designation — accountable for task quality and sign-off';
