-- ============================================================================
-- Migration: 0163_hierarchy_level_text
-- Make the asset hierarchy fully data-driven so the Admin "Hierarchy Configuration"
-- screen can ADD new levels without a DDL change per level.
--
-- assets.hierarchy_level is currently the fixed enum `hierarchy_level`
-- (SITE|AREA|UNIT|SYSTEM|SUBSYSTEM|EQUIPMENT|COMPONENT). Converting it to TEXT lets
-- any configured level code be stored. Existing values are preserved, and the
-- numbering trigger (which compares ... IN ('EQUIPMENT','COMPONENT')) is unaffected.
--
-- ADDITIVE & NON-BREAKING. The enum type is left defined (unused by this column).
-- ============================================================================

ALTER TABLE assets
  ALTER COLUMN hierarchy_level TYPE text USING hierarchy_level::text;

-- Rollback (manual, only if no out-of-enum values exist):
--   ALTER TABLE assets ALTER COLUMN hierarchy_level TYPE hierarchy_level USING hierarchy_level::hierarchy_level;
