-- ============================================================================
-- Migration: 0121_add_equipment_number
-- Purpose:   Add Internal Equipment Number (IEN) to assets table
--            SAP PM Equipment Number parity — auto-generated, unique per
--            physical asset installation.
--
-- Concept:
--   tag               = Functional Location (stays with position forever)
--   equipment_number   = Internal Equipment Number (unique per physical asset)
--   equipment_generation = Generation counter (increments on replacement)
-- ============================================================================

-- 1. Create the sequence for equipment numbers
CREATE SEQUENCE IF NOT EXISTS equipment_number_seq START WITH 1 INCREMENT BY 1;

-- 2. Add columns to assets table
ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS equipment_number TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS equipment_generation INTEGER NOT NULL DEFAULT 1;

-- 3. Trigger function: auto-populate equipment_number on INSERT
CREATE OR REPLACE FUNCTION generate_equipment_number()
RETURNS TRIGGER AS $$
BEGIN
  -- Only generate if not explicitly provided (allows manual override if needed)
  IF NEW.equipment_number IS NULL THEN
    NEW.equipment_number := 'EQ-' || LPAD(nextval('equipment_number_seq')::TEXT, 6, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists (idempotent)
DROP TRIGGER IF EXISTS auto_equipment_number ON assets;

CREATE TRIGGER auto_equipment_number
  BEFORE INSERT ON assets
  FOR EACH ROW
  EXECUTE FUNCTION generate_equipment_number();

-- 4. Backfill existing assets that don't have an equipment number
-- Use a CTE to assign sequential numbers to existing assets ordered by creation date
DO $$
DECLARE
  r RECORD;
  next_num TEXT;
BEGIN
  FOR r IN
    SELECT id FROM assets
    WHERE equipment_number IS NULL
    ORDER BY created_at ASC
  LOOP
    next_num := 'EQ-' || LPAD(nextval('equipment_number_seq')::TEXT, 6, '0');
    UPDATE assets SET equipment_number = next_num WHERE id = r.id;
  END LOOP;
END $$;
