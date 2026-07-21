-- ============================================================
-- 0209: Integrity P0 trust fixes
--
-- 1) Purge 0075 demo seed rows from the Integrity tables.
--    A production database must never present fabricated CMLs,
--    inspections, RBI/FFS records or vision findings as real.
--    Seed rows are identified by the deterministic uuid_v5 demo
--    asset ids from 0050 — customer data never references them.
--
-- 2) Extend ers_inspections so inspection EXECUTION can persist:
--    the UI captures findings/notes/team/checklist but the table
--    only stored scheduling metadata, so completed inspections
--    were silently lost.
--
-- 3) Allow the 'deferred' status the UI already models.
-- ============================================================

-- ── 1) Purge demo seeds ─────────────────────────────────────
DO $$
DECLARE
  ns UUID := '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; -- DNS namespace (same as 0050/0075)
  demo_assets UUID[] := ARRAY[
    uuid_generate_v5(ns, 'K-601'),
    uuid_generate_v5(ns, 'GT-301'),
    uuid_generate_v5(ns, 'P-102'),
    uuid_generate_v5(ns, 'HX-105'),
    uuid_generate_v5(ns, 'V-602'),
    uuid_generate_v5(ns, 'PMP-411'),
    uuid_generate_v5(ns, 'CMP-201'),
    uuid_generate_v5(ns, 'MV-881'),
    uuid_generate_v5(ns, 'TK-005'),
    uuid_generate_v5(ns, 'C-902'),
    uuid_generate_v5(ns, 'E-605')
  ];
  demo_asset_texts TEXT[];
BEGIN
  SELECT array_agg(u::text) INTO demo_asset_texts FROM unnest(demo_assets) AS u;

  -- thickness readings cascade from ers_cmls, but delete explicitly first
  DELETE FROM ers_thickness_readings
   WHERE cml_id IN (SELECT id FROM ers_cmls WHERE asset_id = ANY(demo_assets));
  DELETE FROM ers_cmls            WHERE asset_id = ANY(demo_assets);
  DELETE FROM ers_corrosion_rates WHERE asset_id = ANY(demo_assets);
  DELETE FROM ers_rbi_assessments WHERE asset_id = ANY(demo_assets);
  DELETE FROM ers_iow_parameters  WHERE asset_id = ANY(demo_assets);
  DELETE FROM ers_inspections     WHERE asset_id = ANY(demo_assets);
  DELETE FROM ers_ffs_assessments WHERE asset_id = ANY(demo_assets);
  DELETE FROM ers_vision_results  WHERE asset_id = ANY(demo_assets);

  -- damage mechanisms link assets via a JSONB string array
  DELETE FROM ers_damage_mechanisms WHERE affected_asset_ids ?| demo_asset_texts;
END $$;

-- ── 2) Inspection execution columns ─────────────────────────
ALTER TABLE ers_inspections
  ADD COLUMN IF NOT EXISTS asset_name           TEXT,
  ADD COLUMN IF NOT EXISTS governing_code       TEXT,
  ADD COLUMN IF NOT EXISTS description          TEXT,
  ADD COLUMN IF NOT EXISTS location_description TEXT,
  ADD COLUMN IF NOT EXISTS circuit_id           TEXT,
  ADD COLUMN IF NOT EXISTS work_order_id        TEXT,
  ADD COLUMN IF NOT EXISTS weather_conditions   TEXT,
  ADD COLUMN IF NOT EXISTS approval_mode        TEXT NOT NULL DEFAULT 'simple'
    CHECK (approval_mode IN ('simple','two_step')),
  ADD COLUMN IF NOT EXISTS reviewer             TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_date        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS started_date         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_date       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS team                 JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS findings             JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS notes                JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS checklist_responses  JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ── 3) 'deferred' status ────────────────────────────────────
ALTER TABLE ers_inspections DROP CONSTRAINT IF EXISTS ers_inspections_status_check;
ALTER TABLE ers_inspections ADD CONSTRAINT ers_inspections_status_check
  CHECK (status IN ('scheduled','in_progress','completed','overdue','deferred','cancelled'));
