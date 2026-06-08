-- Relax constraints to support Hybrid Mock/Real usage
-- Change IDs to Text and Drop Foreign Keys to allow referencing Mock IDs (e.g. 'a1', 'u1')

-- 1. IDs
ALTER TABLE recurring_work ALTER COLUMN id TYPE text;
ALTER TABLE recurring_work ALTER COLUMN id DROP DEFAULT; -- Client provides ID

-- 2. Asset ID
ALTER TABLE recurring_work ALTER COLUMN asset_id TYPE text;
ALTER TABLE recurring_work DROP CONSTRAINT IF EXISTS recurring_work_asset_id_fkey;

-- 3. Created By
ALTER TABLE recurring_work ALTER COLUMN created_by TYPE text;
ALTER TABLE recurring_work DROP CONSTRAINT IF EXISTS recurring_work_created_by_fkey;

-- 4. Work Order Table (If exists, ensures compatibility if we generate WOs)
-- Check if work_orders exists and relax it too if needed, but for now focus on recurring_work
