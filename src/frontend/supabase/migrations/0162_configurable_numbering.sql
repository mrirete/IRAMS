-- ============================================================================
-- Migration: 0162_configurable_numbering
-- SAP NRIV-style configurable number ranges for auto-generated identifiers.
--
-- Separates Functional Location numbering from Equipment numbering, and makes the
-- prefix, zero-padding and starting number user-configurable per object class.
-- Also a toggle for whether records left untagged get an auto-generated number.
--
-- Replaces the hardcoded 'FL-'/'EQ-' + 6-digit logic from 0157 with a config the
-- Admin "Hierarchy / Numbering" screen edits. Existing numbers are preserved; the
-- starting counters are seeded ABOVE the current maximum to avoid collisions.
-- ============================================================================

-- 1. Singleton config row.
CREATE TABLE IF NOT EXISTS numbering_config (
  id                   INT PRIMARY KEY DEFAULT 1,
  floc_prefix          TEXT    NOT NULL DEFAULT 'FL-',
  floc_pad             INT     NOT NULL DEFAULT 6,
  floc_next            BIGINT  NOT NULL DEFAULT 1,
  equip_prefix         TEXT    NOT NULL DEFAULT 'EQ-',
  equip_pad            INT     NOT NULL DEFAULT 6,
  equip_next           BIGINT  NOT NULL DEFAULT 1,
  auto_number_untagged BOOLEAN NOT NULL DEFAULT true,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT numbering_config_singleton CHECK (id = 1)
);

ALTER TABLE numbering_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_numbering_config" ON numbering_config;
CREATE POLICY "auth_all_numbering_config"
  ON numbering_config FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 2. Seed the singleton, starting counters above existing max to avoid collisions.
INSERT INTO numbering_config (id, floc_prefix, floc_pad, floc_next, equip_prefix, equip_pad, equip_next, auto_number_untagged)
VALUES (
  1, 'FL-', 6,
  COALESCE((SELECT max((substring(tag from '([0-9]+)$'))::bigint) FROM assets WHERE tag ~ '^FL-[0-9]+$'), 0) + 1,
  'EQ-', 6,
  COALESCE((SELECT max((substring(equipment_number from '([0-9]+)$'))::bigint) FROM assets WHERE equipment_number ~ '^EQ-[0-9]+$'), 0) + 1,
  true
)
ON CONFLICT (id) DO NOTHING;

-- 3. Config-driven trigger: gate EQ numbers to Equipment, auto-fill blank tags by class.
CREATE OR REPLACE FUNCTION generate_equipment_number()
RETURNS TRIGGER AS $$
DECLARE
  cfg numbering_config%ROWTYPE;
  n   BIGINT;
BEGIN
  SELECT * INTO cfg FROM numbering_config WHERE id = 1 FOR UPDATE;

  -- Internal Equipment Number — Equipment-class objects only (F-004).
  IF NEW.equipment_number IS NULL AND NEW.hierarchy_level IN ('EQUIPMENT', 'COMPONENT') THEN
    n := COALESCE(cfg.equip_next, 1);
    NEW.equipment_number := COALESCE(cfg.equip_prefix, 'EQ-') || LPAD(n::text, COALESCE(cfg.equip_pad, 6), '0');
    UPDATE numbering_config SET equip_next = n + 1, updated_at = now() WHERE id = 1;
  END IF;

  -- Blank Tag ID → auto-number from the correct range (if enabled).
  IF (NEW.tag IS NULL OR btrim(NEW.tag) = '') AND COALESCE(cfg.auto_number_untagged, true) THEN
    IF NEW.hierarchy_level IN ('EQUIPMENT', 'COMPONENT') THEN
      NEW.tag := COALESCE(NEW.equipment_number,
                          COALESCE(cfg.equip_prefix, 'EQ-') || LPAD(COALESCE(cfg.equip_next, 1)::text, COALESCE(cfg.equip_pad, 6), '0'));
    ELSE
      n := COALESCE(cfg.floc_next, 1);
      NEW.tag := COALESCE(cfg.floc_prefix, 'FL-') || LPAD(n::text, COALESCE(cfg.floc_pad, 6), '0');
      UPDATE numbering_config SET floc_next = n + 1, updated_at = now() WHERE id = 1;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- (existing BEFORE INSERT trigger 'auto_equipment_number' already calls this function)

-- ── Rollback (manual) ───────────────────────────────────────────────────────
--   DROP TABLE IF EXISTS numbering_config;
--   -- and restore the 0157 version of generate_equipment_number().
