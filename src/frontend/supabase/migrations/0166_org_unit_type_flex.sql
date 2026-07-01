-- ============================================================================
-- Migration: 0166_org_unit_type_flex
-- UAT F-011 root cause — organization_units.type was pinned to a fixed CHECK:
--   CHECK (type IN ('DIVISION', 'GROUP', 'TEAM'))
-- but the org level model is CONFIGURABLE (SITE/PLANT, DIVISION, DEPARTMENT,
-- SECTION/UNIT, TEAM, ...). Creating a DEPARTMENT (or any type outside those three)
-- failed the constraint, so addOrgUnit threw and "+ Department" silently added
-- nothing — the reviewer's "can't add sibling departments" across two cycles.
--
-- Fix: drop the fixed CHECK so the type is governed by the configurable org level
-- model (mirrors assets.hierarchy_level -> TEXT in 0163). ADDITIVE & NON-BREAKING:
-- existing DIVISION/GROUP/TEAM rows are unaffected; the one-to-many parent_id model
-- already supports unlimited siblings.
-- ============================================================================

ALTER TABLE organization_units
  DROP CONSTRAINT IF EXISTS organization_units_type_check;

-- If the constraint has a non-default name, find it with:
--   SELECT conname FROM pg_constraint
--   WHERE conrelid = 'organization_units'::regclass AND contype = 'c';
-- then: ALTER TABLE organization_units DROP CONSTRAINT <conname>;

-- Rollback (only if all rows are DIVISION/GROUP/TEAM):
--   ALTER TABLE organization_units
--     ADD CONSTRAINT organization_units_type_check CHECK (type IN ('DIVISION','GROUP','TEAM'));
