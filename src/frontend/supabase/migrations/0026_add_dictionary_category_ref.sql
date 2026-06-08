-- Add category_ref column to dictionaries table for classification hierarchy
-- ASSET_TYPE entries will reference ASSET_CATEGORY codes
-- ASSET_CLASS entries will reference ASSET_TYPE codes

ALTER TABLE dictionaries ADD COLUMN IF NOT EXISTS category_ref TEXT;

COMMENT ON COLUMN dictionaries.category_ref IS 'Reference to parent dictionary code (ASSET_TYPE→CATEGORY, ASSET_CLASS→TYPE)';
