-- ============================================================================
-- Migration: 0167_numbering_trigger_guard
-- Hardening (gap found in testing): the config-driven numbering trigger (0162)
-- reads the numbering_config singleton with SELECT ... INTO. If that row is ever
-- absent (config table not seeded, or row deleted), cfg is NULL, the COALESCE
-- defaults still generate a number, but `UPDATE numbering_config ... WHERE id=1`
-- matches 0 rows — so the counter never advances and the SECOND insert collides on
-- the equipment_number UNIQUE. Fix: self-heal by seeding the row if missing.
-- ============================================================================

CREATE OR REPLACE FUNCTION generate_equipment_number()
RETURNS TRIGGER AS $$
DECLARE
  cfg numbering_config%ROWTYPE;
  n   BIGINT;
BEGIN
  SELECT * INTO cfg FROM numbering_config WHERE id = 1 FOR UPDATE;
  IF NOT FOUND THEN
    -- Seed a default singleton (idempotent) and re-read it.
    INSERT INTO numbering_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
    SELECT * INTO cfg FROM numbering_config WHERE id = 1 FOR UPDATE;
  END IF;

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
