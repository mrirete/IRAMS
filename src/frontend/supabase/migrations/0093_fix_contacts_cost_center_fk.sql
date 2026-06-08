-- ============================================================
-- Fix contacts table: drop invalid cost_center_id FK
--
-- The contacts.cost_center_id column has a FK to cost_centers table,
-- but cost centers in this system are stored as dictionary entries
-- (type='COST_CENTER' in the dictionaries table), not in a separate
-- cost_centers table. This causes FK violations when creating contacts.
--
-- Fix: Drop the FK constraint so cost_center_id can store the
-- dictionary entry ID without FK validation.
-- ============================================================

-- Drop the FK constraint
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_cost_center_id_fkey;

-- Ensure the column exists (it may have been added conditionally)
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS cost_center_id UUID;
