-- 0188 — SMEA: Success Mode and Effects Analysis (PSC framework, slice 2).
--
-- The value-centric complement to FMEA (Olorunfemi 2026, §4.4): instead of
-- cataloging failure modes, SMEA captures the CONDITIONS that sustain optimal
-- performance and prioritizes them by SPN = Value Impact × Sustainability ×
-- Monitorability. Monitorability is scored DIRECTLY (10 = continuously
-- monitorable = actively manageable) — the deliberate inversion of FMEA's
-- Detectability. SPN is a GENERATED column so the math can never drift from
-- the definition.
--
-- RLS: reliability-engineer working tables — same open-authenticated posture
-- as the sibling ers_* tables (0155); write-tiering deferred with them.
-- Atomic: wrap in a txn.
BEGIN;

CREATE TABLE IF NOT EXISTS public.ers_smea_worksheets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id     UUID REFERENCES public.assets(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','review','closed')),
  description  TEXT,
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ers_smea_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worksheet_id      UUID NOT NULL REFERENCES public.ers_smea_worksheets(id) ON DELETE CASCADE,
  success_mode      TEXT NOT NULL,          -- e.g. "Bearing within thermal envelope"
  success_condition TEXT,                   -- e.g. "Temp 45-65°C; vib <2.5 mm/s"
  value_impact      INTEGER NOT NULL DEFAULT 5 CHECK (value_impact BETWEEN 1 AND 10),
  sustainability    INTEGER NOT NULL DEFAULT 5 CHECK (sustainability BETWEEN 1 AND 10),
  monitorability    INTEGER NOT NULL DEFAULT 5 CHECK (monitorability BETWEEN 1 AND 10),
  spn               INTEGER GENERATED ALWAYS AS (value_impact * sustainability * monitorability) STORED,
  priority_action   TEXT,                   -- how the condition is actively sustained
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','monitored','sustained','dropped')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_smea_ws_asset ON public.ers_smea_worksheets(asset_id);
CREATE INDEX IF NOT EXISTS idx_smea_items_ws ON public.ers_smea_items(worksheet_id);

ALTER TABLE public.ers_smea_worksheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ers_smea_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p2_all_ers_smea_worksheets ON public.ers_smea_worksheets;
CREATE POLICY p2_all_ers_smea_worksheets ON public.ers_smea_worksheets
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS p2_all_ers_smea_items ON public.ers_smea_items;
CREATE POLICY p2_all_ers_smea_items ON public.ers_smea_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Catalog the SPN definition alongside the other PSC vocabulary (0187).
INSERT INTO public.semantic_catalog
  (object_name, column_name, title, description, tags, owner, source_tables, iso_standard)
VALUES
  ('ers_smea_items', 'spn', 'Success Priority Number',
   'SPN = Value Impact × Sustainability × Monitorability (each 1-10; max 1000). Prioritizes the conditions that SUSTAIN optimal performance. Monitorability is scored directly — a continuously monitorable condition scores HIGH because it can be actively managed, the inversion of FMEA Detectability. Generated column; the math cannot drift.',
   ARRAY['psc','smea','kpi'], 'Reliability Engineering',
   ARRAY['ers_smea_items'], 'ISO 55000:2024')
ON CONFLICT DO NOTHING;

COMMIT;
