-- ═══════════════════════════════════════════════════════════════════════
-- 0174: Org-keyed numbering (W-2 T-2) — per-company number ranges (SAP NRIV)
-- ═══════════════════════════════════════════════════════════════════════
-- Lets each sub-company issue its own equipment / functional-location numbers
-- (e.g. Company 1000 → EQ-10xxxx, Company 2000 → EQ-20xxxx), resolved
-- most-specific-wins: a per-company override if one exists, else the existing
-- client-level default singleton.
--
-- ── BACKWARD-COMPATIBILITY GUARANTEE (this is the whole safety story) ──
-- The per-company path activates ONLY when the new asset carries a company_id
-- AND that company has an override row. Every existing asset has company_id =
-- NULL, and there are no override rows, so the trigger resolves from the
-- singleton and advances the singleton EXACTLY as today. Asset creation is
-- unchanged until an admin both assigns a company to an asset and defines an
-- override for it. No backfill; no behaviour change on apply.
--
-- ATOMIC + idempotent (0171 lesson). Re-establishes the trigger's
-- SECURITY DEFINER + search_path hardening (0171) explicitly.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. assets carry their owning company (nullable; set at create/edit) ──
ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);
CREATE INDEX IF NOT EXISTS idx_assets_company_id ON assets(company_id);

-- ── 2. per-company number-range overrides ───────────────────────────────
CREATE TABLE IF NOT EXISTS numbering_config_overrides (
  company_id   UUID   NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  object_class TEXT   NOT NULL CHECK (object_class IN ('EQUIPMENT', 'FLOC')),
  prefix       TEXT   NOT NULL,
  pad          INT    NOT NULL DEFAULT 6,
  next_number  BIGINT NOT NULL DEFAULT 1,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, object_class)
);

ALTER TABLE numbering_config_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_numbering_ov"  ON numbering_config_overrides;
DROP POLICY IF EXISTS "admin_insert_numbering_ov" ON numbering_config_overrides;
DROP POLICY IF EXISTS "admin_update_numbering_ov" ON numbering_config_overrides;
DROP POLICY IF EXISTS "admin_delete_numbering_ov" ON numbering_config_overrides;
CREATE POLICY "auth_select_numbering_ov"  ON numbering_config_overrides FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_insert_numbering_ov" ON numbering_config_overrides FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "admin_update_numbering_ov" ON numbering_config_overrides FOR UPDATE TO authenticated USING (public.is_admin());
CREATE POLICY "admin_delete_numbering_ov" ON numbering_config_overrides FOR DELETE TO authenticated USING (public.is_admin());

-- ── 3. trigger — resolve per-company override, else singleton default ────
CREATE OR REPLACE FUNCTION generate_equipment_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cfg numbering_config%ROWTYPE;
  ov_equip numbering_config_overrides%ROWTYPE;
  ov_floc  numbering_config_overrides%ROWTYPE;
  has_equip_ov BOOLEAN := false;
  has_floc_ov  BOOLEAN := false;
  eq_prefix TEXT; eq_pad INT; eq_next BIGINT;
  fl_prefix TEXT; fl_pad INT; fl_next BIGINT;
BEGIN
  -- Client-level default singleton (self-heal — 0167).
  SELECT * INTO cfg FROM numbering_config WHERE id = 1 FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO numbering_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
    SELECT * INTO cfg FROM numbering_config WHERE id = 1 FOR UPDATE;
  END IF;

  -- Per-company overrides — ONLY when the asset carries a company (else the
  -- singleton path below is identical to pre-0174 behaviour).
  IF NEW.company_id IS NOT NULL THEN
    SELECT * INTO ov_equip FROM numbering_config_overrides
      WHERE company_id = NEW.company_id AND object_class = 'EQUIPMENT' FOR UPDATE;
    has_equip_ov := FOUND;
    SELECT * INTO ov_floc FROM numbering_config_overrides
      WHERE company_id = NEW.company_id AND object_class = 'FLOC' FOR UPDATE;
    has_floc_ov := FOUND;
  END IF;

  -- Effective EQUIPMENT range (override wins, else singleton).
  IF has_equip_ov THEN
    eq_prefix := ov_equip.prefix; eq_pad := ov_equip.pad; eq_next := ov_equip.next_number;
  ELSE
    eq_prefix := COALESCE(cfg.equip_prefix, 'EQ-'); eq_pad := COALESCE(cfg.equip_pad, 6); eq_next := COALESCE(cfg.equip_next, 1);
  END IF;
  -- Effective FLOC range.
  IF has_floc_ov THEN
    fl_prefix := ov_floc.prefix; fl_pad := ov_floc.pad; fl_next := ov_floc.next_number;
  ELSE
    fl_prefix := COALESCE(cfg.floc_prefix, 'FL-'); fl_pad := COALESCE(cfg.floc_pad, 6); fl_next := COALESCE(cfg.floc_next, 1);
  END IF;

  -- Internal Equipment Number — Equipment-class objects only (F-004).
  IF NEW.equipment_number IS NULL AND NEW.hierarchy_level IN ('EQUIPMENT', 'COMPONENT') THEN
    NEW.equipment_number := eq_prefix || LPAD(eq_next::text, eq_pad, '0');
    IF has_equip_ov THEN
      UPDATE numbering_config_overrides SET next_number = eq_next + 1, updated_at = now()
        WHERE company_id = NEW.company_id AND object_class = 'EQUIPMENT';
    ELSE
      UPDATE numbering_config SET equip_next = eq_next + 1, updated_at = now() WHERE id = 1;
    END IF;
  END IF;

  -- Blank Tag ID → auto-number from the correct range (if enabled).
  IF (NEW.tag IS NULL OR btrim(NEW.tag) = '') AND COALESCE(cfg.auto_number_untagged, true) THEN
    IF NEW.hierarchy_level IN ('EQUIPMENT', 'COMPONENT') THEN
      -- Reuse the equipment number just issued (no extra counter advance).
      NEW.tag := COALESCE(NEW.equipment_number, eq_prefix || LPAD(eq_next::text, eq_pad, '0'));
    ELSE
      NEW.tag := fl_prefix || LPAD(fl_next::text, fl_pad, '0');
      IF has_floc_ov THEN
        UPDATE numbering_config_overrides SET next_number = fl_next + 1, updated_at = now()
          WHERE company_id = NEW.company_id AND object_class = 'FLOC';
      ELSE
        UPDATE numbering_config SET floc_next = fl_next + 1, updated_at = now() WHERE id = 1;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════
-- VERIFY (do these AFTER apply — proves both paths)
--   -- A) default path unchanged: create an asset with NO company →
--   --    gets the next EQ-/FL- from the singleton, singleton counter advances.
--   -- B) per-company path: pick a company, add an override, create a
--   --    company-tagged asset → gets the override prefix, override counter
--   --    advances, singleton untouched. Example:
--   --   INSERT INTO numbering_config_overrides(company_id,object_class,prefix,pad,next_number)
--   --     VALUES ('<company-uuid>','EQUIPMENT','EQ-10',4,1);
--   --   INSERT INTO assets(name,hierarchy_level,company_id)
--   --     VALUES ('T2 probe','EQUIPMENT','<company-uuid>') RETURNING equipment_number;  -- EQ-100001
--   --   (clean up the probe asset + override afterwards)
-- ROLLBACK (manual):
--   DROP TABLE IF EXISTS numbering_config_overrides;
--   ALTER TABLE assets DROP COLUMN IF EXISTS company_id;
--   -- and restore the 0167/0171 version of generate_equipment_number().
-- ═══════════════════════════════════════════════════════════════════════
