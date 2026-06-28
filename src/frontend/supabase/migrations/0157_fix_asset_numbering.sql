-- ============================================================================
-- Migration: 0157_fix_asset_numbering
-- Phase 1 of the UAT Asset Register closeout — numbering correction.
--
-- Closes:
--   F-004  EQ numbers must NOT be issued to Functional Locations.
--   F-009  Separate FLOC (FL-) vs Equipment (EQ-) number ranges; blank Tag ID
--          auto-generates from the correct range (server-side / NRIV parity).
--
-- Audit basis (asset_register_numbering_audit.sql, run before this migration):
--   58 assets · 24 FLOC · 34 Equipment
--   24 FLOC rows wrongly carry an EQ number  ← reconciled in step 3
--    0 equipment rows missing a number
--
-- Posture: ADDITIVE & REVERSIBLE. The 24 corrupted values are STAMPED into
-- properties.legacy_equipment_number before being cleared (freeze-and-reconcile),
-- so the change is auditable and undoable.
-- ============================================================================

-- 1. Functional-location number range (Equipment range already exists: equipment_number_seq).
CREATE SEQUENCE IF NOT EXISTS floc_number_seq START WITH 1 INCREMENT BY 1;

-- 2. Replace the trigger function: level-gate the EQ number AND auto-fill a blank Tag ID.
--    • Equipment/Component → internal EQ number (and a blank tag mirrors it).
--    • Functional Locations → never get an EQ number; a blank tag draws from FL-.
CREATE OR REPLACE FUNCTION generate_equipment_number()
RETURNS TRIGGER AS $$
BEGIN
  -- F-004: only Equipment-class objects receive an internal Equipment Number.
  IF NEW.equipment_number IS NULL
     AND NEW.hierarchy_level IN ('EQUIPMENT', 'COMPONENT') THEN
    NEW.equipment_number := 'EQ-' || LPAD(nextval('equipment_number_seq')::TEXT, 6, '0');
  END IF;

  -- F-009: a blank Tag ID auto-generates from the correct range.
  IF NEW.tag IS NULL OR btrim(NEW.tag) = '' THEN
    IF NEW.hierarchy_level IN ('EQUIPMENT', 'COMPONENT') THEN
      -- equipment tag mirrors its internal number
      NEW.tag := COALESCE(NEW.equipment_number,
                          'EQ-' || LPAD(nextval('equipment_number_seq')::TEXT, 6, '0'));
    ELSE
      NEW.tag := 'FL-' || LPAD(nextval('floc_number_seq')::TEXT, 6, '0');
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- (the existing BEFORE INSERT trigger 'auto_equipment_number' already calls this function)

-- 3. Reconcile existing data — clear the 24 FLOC rows wrongly carrying EQ numbers,
--    stamping the prior value for auditability/reversibility. Equipment rows untouched.
UPDATE assets
SET properties = jsonb_set(
      COALESCE(properties, '{}'::jsonb),
      '{legacy_equipment_number}',
      to_jsonb(equipment_number)
    ),
    equipment_number = NULL
WHERE hierarchy_level NOT IN ('EQUIPMENT', 'COMPONENT')
  AND equipment_number IS NOT NULL;

-- ── Verify (should return 0 after this migration) ───────────────────────────
-- SELECT count(*) AS floc_still_carrying_eq
-- FROM assets
-- WHERE hierarchy_level NOT IN ('EQUIPMENT','COMPONENT') AND equipment_number IS NOT NULL;

-- ── Rollback (manual) ───────────────────────────────────────────────────────
--   -- restore the cleared FLOC numbers:
--   UPDATE assets
--   SET equipment_number = properties->>'legacy_equipment_number',
--       properties = properties - 'legacy_equipment_number'
--   WHERE properties ? 'legacy_equipment_number';
--   -- restore the old ungated trigger function from 0121 if required.
