-- ============================================================================
-- Migration: 0156_floc_equipment_object_model
-- Phase 0 of the UAT Asset Register closeout — ADDITIVE & NON-BREAKING.
--
-- UAT F-010 (Option A — separate Equipment object): the Functional Location is
-- the position; Equipment is a distinct maintainable item INSTALLED at a FLOC and
-- transferable between FLOCs while keeping its own history. SAP parity: TPLNR vs
-- EQUNR with an installation relationship.
--
-- This migration only ADDS structure. It rewrites NO existing data.
--   • EQ-number trigger gating (F-004) and the FLOC number range (F-009) are
--     Phase 1 and ship separately, AFTER the read-only audit
--     (supabase/audits/asset_register_numbering_audit.sql) is reviewed.
-- ============================================================================

-- 1. Extend the hierarchy taxonomy to the ISO 14224 six-level seed (additive).
--    Existing enum: SITE, UNIT, SYSTEM, EQUIPMENT, COMPONENT. Add AREA + SUBSYSTEM.
--    (ADD VALUE is additive; we never use the new literals in this migration, so
--     it is safe to run in a single transaction.)
ALTER TYPE hierarchy_level ADD VALUE IF NOT EXISTS 'AREA';
ALTER TYPE hierarchy_level ADD VALUE IF NOT EXISTS 'SUBSYSTEM';

-- 2. Equipment's CURRENT functional-location position (SAP install point).
--    Nullable: only Equipment-class objects populate it; FLOCs leave it NULL.
ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS functional_location_id UUID REFERENCES assets(id);

COMMENT ON COLUMN assets.functional_location_id IS
  'For Equipment objects: the FLOC where this item is currently installed (SAP install point). NULL for Functional Locations.';

-- 3. Install / dismantle / transfer move-log.
--    The open row (removed_at IS NULL) is the current installation; closed rows
--    are history, so equipment reliability/cost history survives relocation.
CREATE TABLE IF NOT EXISTS equipment_installations (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id           UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  functional_location_id UUID REFERENCES assets(id),
  installed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at             TIMESTAMPTZ,
  reason                 TEXT,
  created_by             UUID,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_equip_install_equipment ON equipment_installations(equipment_id);
CREATE INDEX IF NOT EXISTS idx_equip_install_floc      ON equipment_installations(functional_location_id);

COMMENT ON TABLE equipment_installations IS
  'Equipment install/dismantle/transfer history (UAT F-010 Option A). Open row (removed_at IS NULL) = current installation.';

-- 4. Row Level Security — match the project convention (0150/0155): RLS ON with a
--    permissive policy for authenticated users. (Enabling RLS WITHOUT a policy
--    would deny-all and lock the table from the app.) Idempotent.
ALTER TABLE equipment_installations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_equipment_installations" ON equipment_installations;
CREATE POLICY "auth_all_equipment_installations"
  ON equipment_installations FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Rollback (manual):
--   DROP TABLE IF EXISTS equipment_installations;
--   ALTER TABLE assets DROP COLUMN IF EXISTS functional_location_id;
--   -- enum values cannot be dropped; AREA/SUBSYSTEM are harmless if unused.
