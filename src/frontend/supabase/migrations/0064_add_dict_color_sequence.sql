-- Add color_code and sort_order columns to reference_codes
ALTER TABLE reference_codes ADD COLUMN IF NOT EXISTS color_code TEXT;
ALTER TABLE reference_codes ADD COLUMN IF NOT EXISTS sort_order INTEGER;

-- Seed default P1-P5 priority colors (DB column is 'category')
UPDATE reference_codes SET color_code = '#EF4444', sort_order = 1 WHERE category = 'PRIORITY' AND code = 'P1';
UPDATE reference_codes SET color_code = '#F97316', sort_order = 2 WHERE category = 'PRIORITY' AND code = 'P2';
UPDATE reference_codes SET color_code = '#F59E0B', sort_order = 3 WHERE category = 'PRIORITY' AND code = 'P3';
UPDATE reference_codes SET color_code = '#3B82F6', sort_order = 4 WHERE category = 'PRIORITY' AND code = 'P4';
UPDATE reference_codes SET color_code = '#64748B', sort_order = 5 WHERE category = 'PRIORITY' AND code = 'P5';

-- Backward compat: migrate existing HIGH/MEDIUM/LOW
UPDATE reference_codes SET color_code = '#EF4444', sort_order = 1 WHERE category = 'PRIORITY' AND code = 'HIGH' AND color_code IS NULL;
UPDATE reference_codes SET color_code = '#F59E0B', sort_order = 3 WHERE category = 'PRIORITY' AND code = 'MEDIUM' AND color_code IS NULL;
UPDATE reference_codes SET color_code = '#64748B', sort_order = 5 WHERE category = 'PRIORITY' AND code = 'LOW' AND color_code IS NULL;

COMMENT ON COLUMN reference_codes.color_code IS 'Hex color for UI display (e.g. #EF4444). Used primarily by PRIORITY type.';
COMMENT ON COLUMN reference_codes.sort_order IS 'Display/ranking order. For PRIORITY: lower = higher criticality.';
