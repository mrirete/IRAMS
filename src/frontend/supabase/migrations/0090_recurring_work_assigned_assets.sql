-- 0090: Add assigned_assets JSONB column to recurring_work
-- This stores the full per-asset data (lastCompletedDate, lastReadingValue)
-- needed for PM compliance and next-due-date calculations.
-- The existing asset_id column is kept for backward compatibility (primary asset).

ALTER TABLE recurring_work
ADD COLUMN IF NOT EXISTS assigned_assets jsonb DEFAULT '[]'::jsonb;

-- Seed assigned_assets from existing asset_id values so current records carry over
UPDATE recurring_work
SET assigned_assets = jsonb_build_array(
    jsonb_build_object(
        'assetId', asset_id::text,
        'lastCompletedDate', COALESCE(last_generated_date::text, ''),
        'lastReadingValue', 0
    )
)
WHERE asset_id IS NOT NULL
  AND (assigned_assets IS NULL OR assigned_assets = '[]'::jsonb);
 