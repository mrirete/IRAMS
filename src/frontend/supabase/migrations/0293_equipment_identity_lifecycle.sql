-- ============================================================================
-- 0293 — Equipment identity lifecycle: immutability + replacement
--
-- 0121 declared the two-identity model (tag = position, equipment_number =
-- physical object, equipment_generation = replacement counter) but never
-- enforced it: equipment_number was rewritable by any UPDATE, and nothing in
-- the system ever incremented the generation. This migration makes the model
-- real:
--
--   1. issue_equipment_number(company) — the 0174 equipment-range logic
--      (per-company override, else singleton, counter bump) extracted into a
--      callable function so inserts AND replacements draw from one range.
--   2. generate_equipment_number() rewritten to call it (behaviour identical).
--   3. Backfill: EQUIPMENT/COMPONENT rows with NULL equipment_number get one.
--      FLOC rows stay NULL BY DESIGN (0157 freeze-and-reconcile, F-004) —
--      the "27/69 NULL" observation in 0265 is mostly those.
--   4. asset_replacements — append-only log of physical swaps (who, when,
--      old/new identity, old serial, reason). Tenant-scoped RLS, no
--      update/delete for anyone (0186 tier-3a pattern).
--   5. replace_equipment(asset, new_en?, reason?, new_serial?) — the ONE
--      sanctioned way to change the object identity: issues/validates the new
--      number, increments the generation, clears the old unit's serial
--      (archived in the log), writes the log row. SECURITY INVOKER — RLS and
--      write gates apply to the caller.
--   6. Guard trigger: equipment_number may be FILLED once when NULL; any other
--      change must be a replacement (number change + generation exactly +1),
--      which only replace_equipment() produces. Everything else raises.
--
-- Client counterpart: bulkImportService stops sending equipment_number on the
-- sync/update path when the asset already has one (fill-only).
-- ============================================================================

BEGIN;

-- ── 1. Extract the equipment number range into a callable issuer ───────────
CREATE OR REPLACE FUNCTION public.issue_equipment_number(p_company uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cfg numbering_config%ROWTYPE;
  ov  numbering_config_overrides%ROWTYPE;
  has_ov boolean := false;
  v_prefix text; v_pad int; v_next bigint;
BEGIN
  -- Client-level default singleton (self-heal — 0167).
  SELECT * INTO cfg FROM numbering_config WHERE id = 1 FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO numbering_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
    SELECT * INTO cfg FROM numbering_config WHERE id = 1 FOR UPDATE;
  END IF;

  -- Per-company override wins (0174), else the singleton range.
  IF p_company IS NOT NULL THEN
    SELECT * INTO ov FROM numbering_config_overrides
      WHERE company_id = p_company AND object_class = 'EQUIPMENT' FOR UPDATE;
    has_ov := FOUND;
  END IF;

  IF has_ov THEN
    v_prefix := ov.prefix; v_pad := ov.pad; v_next := ov.next_number;
    UPDATE numbering_config_overrides SET next_number = v_next + 1, updated_at = now()
      WHERE company_id = p_company AND object_class = 'EQUIPMENT';
  ELSE
    v_prefix := COALESCE(cfg.equip_prefix, 'EQ-');
    v_pad    := COALESCE(cfg.equip_pad, 6);
    v_next   := COALESCE(cfg.equip_next, 1);
    UPDATE numbering_config SET equip_next = v_next + 1, updated_at = now() WHERE id = 1;
  END IF;

  RETURN v_prefix || LPAD(v_next::text, v_pad, '0');
END;
$$;

-- ── 2. Insert trigger now draws from the shared issuer ─────────────────────
-- Behaviour identical to 0174; the FLOC tag range stays inline (only the
-- equipment range needed to be shared with replace_equipment()).
CREATE OR REPLACE FUNCTION generate_equipment_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cfg numbering_config%ROWTYPE;
  ov_floc numbering_config_overrides%ROWTYPE;
  has_floc_ov boolean := false;
  fl_prefix TEXT; fl_pad INT; fl_next BIGINT;
BEGIN
  SELECT * INTO cfg FROM numbering_config WHERE id = 1 FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO numbering_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
    SELECT * INTO cfg FROM numbering_config WHERE id = 1 FOR UPDATE;
  END IF;

  -- Internal Equipment Number — Equipment-class objects only (F-004).
  IF NEW.equipment_number IS NULL AND NEW.hierarchy_level IN ('EQUIPMENT', 'COMPONENT') THEN
    NEW.equipment_number := public.issue_equipment_number(NEW.company_id);
  END IF;

  -- Blank Tag ID → auto-number from the correct range (if enabled).
  IF (NEW.tag IS NULL OR btrim(NEW.tag) = '') AND COALESCE(cfg.auto_number_untagged, true) THEN
    IF NEW.hierarchy_level IN ('EQUIPMENT', 'COMPONENT') THEN
      -- Reuse the equipment number (supplied or just issued — never NULL here).
      NEW.tag := COALESCE(NEW.equipment_number, public.issue_equipment_number(NEW.company_id));
    ELSE
      IF NEW.company_id IS NOT NULL THEN
        SELECT * INTO ov_floc FROM numbering_config_overrides
          WHERE company_id = NEW.company_id AND object_class = 'FLOC' FOR UPDATE;
        has_floc_ov := FOUND;
      END IF;
      IF has_floc_ov THEN
        fl_prefix := ov_floc.prefix; fl_pad := ov_floc.pad; fl_next := ov_floc.next_number;
        UPDATE numbering_config_overrides SET next_number = fl_next + 1, updated_at = now()
          WHERE company_id = NEW.company_id AND object_class = 'FLOC';
      ELSE
        fl_prefix := COALESCE(cfg.floc_prefix, 'FL-');
        fl_pad    := COALESCE(cfg.floc_pad, 6);
        fl_next   := COALESCE(cfg.floc_next, 1);
        UPDATE numbering_config SET floc_next = fl_next + 1, updated_at = now() WHERE id = 1;
      END IF;
      NEW.tag := fl_prefix || LPAD(fl_next::text, fl_pad, '0');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ── 3. Backfill equipment-class rows that lack an identity ─────────────────
-- BEFORE the guard trigger exists, so this is a plain fill. FLOC rows are
-- intentionally left NULL (0157 cleared them on purpose).
DO $$
DECLARE r RECORD; n int := 0;
BEGIN
  FOR r IN
    SELECT id, company_id FROM assets
    WHERE equipment_number IS NULL AND hierarchy_level IN ('EQUIPMENT', 'COMPONENT')
    ORDER BY created_at ASC
  LOOP
    UPDATE assets SET equipment_number = public.issue_equipment_number(r.company_id)
      WHERE id = r.id;
    n := n + 1;
  END LOOP;
  RAISE NOTICE '0293: backfilled % equipment-class asset(s); FLOC rows stay NULL by design (0157/F-004)', n;
END $$;

-- ── 4. Replacement log — append-only, tenant-scoped ────────────────────────
CREATE TABLE IF NOT EXISTS public.asset_replacements (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL,
  asset_id              uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  from_equipment_number text,
  to_equipment_number   text NOT NULL,
  from_generation       int  NOT NULL,
  to_generation         int  NOT NULL,
  from_serial_number    text,
  reason                text,
  replaced_by           uuid DEFAULT auth.uid(),
  replaced_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_asset_replacements_asset ON public.asset_replacements (asset_id, replaced_at DESC);

ALTER TABLE public.asset_replacements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ar_select ON public.asset_replacements;
DROP POLICY IF EXISTS ar_insert ON public.asset_replacements;
CREATE POLICY ar_select ON public.asset_replacements FOR SELECT TO authenticated
  USING (company_id = public.caller_company());
CREATE POLICY ar_insert ON public.asset_replacements FOR INSERT TO authenticated
  WITH CHECK (company_id = public.caller_company());
-- No UPDATE/DELETE policies: append-only for everyone (0186 tier-3a).

-- ── 5. The sanctioned swap ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.replace_equipment(
  p_asset_id             uuid,
  p_new_equipment_number text DEFAULT NULL,
  p_reason               text DEFAULT NULL,
  p_new_serial_number    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER            -- caller's RLS/write gates decide, not this function
SET search_path = public
AS $$
DECLARE
  a assets%ROWTYPE;
  new_en  text;
  new_gen int;
BEGIN
  SELECT * INTO a FROM assets WHERE id = p_asset_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Asset not found (or not visible to you)';
  END IF;
  IF a.hierarchy_level NOT IN ('EQUIPMENT', 'COMPONENT') THEN
    RAISE EXCEPTION 'replace_equipment() applies to equipment-class assets only — % is a %', a.tag, a.hierarchy_level;
  END IF;

  new_en := NULLIF(btrim(COALESCE(p_new_equipment_number, '')), '');
  IF new_en IS NULL THEN
    new_en := public.issue_equipment_number(a.company_id);
  END IF;
  IF new_en IS NOT DISTINCT FROM a.equipment_number THEN
    RAISE EXCEPTION 'New equipment number equals the current one — nothing was replaced';
  END IF;

  new_gen := COALESCE(a.equipment_generation, 1) + 1;

  -- The position (tag, history, hierarchy) stays; the object identity moves on.
  -- The outgoing unit's serial is archived in the log, not left on the row —
  -- a serial describes the physical unit, and that unit just left the plant.
  UPDATE assets SET
    equipment_number     = new_en,
    equipment_generation = new_gen,
    serial_number        = NULLIF(btrim(COALESCE(p_new_serial_number, '')), '')
  WHERE id = p_asset_id;

  INSERT INTO asset_replacements
    (company_id, asset_id, from_equipment_number, to_equipment_number,
     from_generation, to_generation, from_serial_number, reason, replaced_by)
  VALUES
    (a.company_id, a.id, a.equipment_number, new_en,
     COALESCE(a.equipment_generation, 1), new_gen, a.serial_number,
     NULLIF(btrim(COALESCE(p_reason, '')), ''), auth.uid());

  RETURN jsonb_build_object(
    'equipment_number', new_en,
    'equipment_generation', new_gen,
    'previous_equipment_number', a.equipment_number
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.replace_equipment(uuid, text, text, text) TO authenticated;

-- ── 6. Immutability guard — after the backfill, before anyone else writes ──
CREATE OR REPLACE FUNCTION public.guard_equipment_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  en_changed  boolean := NEW.equipment_number IS DISTINCT FROM OLD.equipment_number;
  gen_changed boolean := NEW.equipment_generation IS DISTINCT FROM OLD.equipment_generation;
BEGIN
  IF NOT en_changed AND NOT gen_changed THEN
    RETURN NEW;
  END IF;
  -- Fill: a NULL identity may be set once (imports, backfills). Generation stays.
  IF OLD.equipment_number IS NULL AND en_changed AND NOT gen_changed THEN
    RETURN NEW;
  END IF;
  -- Replacement: new non-null number AND generation exactly +1 — the shape
  -- only replace_equipment() produces.
  IF en_changed AND NEW.equipment_number IS NOT NULL
     AND NEW.equipment_generation = COALESCE(OLD.equipment_generation, 1) + 1 THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'equipment_number is immutable once set — record a physical swap with replace_equipment(), which issues the new number and increments the generation'
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS equipment_identity_guard ON assets;
CREATE TRIGGER equipment_identity_guard
  BEFORE UPDATE ON assets
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_equipment_identity();

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════
-- VERIFY (after apply)
-- 1. No equipment-class rows without an identity:
--    SELECT count(*) FROM assets
--     WHERE equipment_number IS NULL AND hierarchy_level IN ('EQUIPMENT','COMPONENT');
--    -- expect 0
-- 2. Rewrite is refused:
--    UPDATE assets SET equipment_number = 'HACK' WHERE equipment_number IS NOT NULL LIMIT 1...
--    -- expect: ERROR equipment_number is immutable once set
-- 3. Swap works and logs:
--    SELECT replace_equipment(id, NULL, 'bench test') FROM assets
--     WHERE hierarchy_level = 'EQUIPMENT' LIMIT 1;
--    SELECT * FROM asset_replacements ORDER BY replaced_at DESC LIMIT 1;
