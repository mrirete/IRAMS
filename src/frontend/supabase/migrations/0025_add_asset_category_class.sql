-- Add asset_category and asset_class columns to assets table
-- These columns store dictionary codes for Asset Category and Asset Class

ALTER TABLE assets ADD COLUMN IF NOT EXISTS asset_category TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS asset_class TEXT;

-- Add comments for documentation
COMMENT ON COLUMN assets.asset_category IS 'Dictionary code reference to ASSET_CATEGORY type (e.g., ROTATING, STATIC)';
COMMENT ON COLUMN assets.asset_class IS 'Dictionary code reference to ASSET_CLASS type (e.g., PUMP, COMPRESSOR)';
