-- ============================================================================
-- Migration: 0158_manufacturer_master
-- UAT F-003 follow-up — a dedicated Manufacturer master (consolidation, not a
-- third silo). Manufacturers previously lived in BOTH contacts (typed
-- MANUFACTURER/VENDOR) AND vendors, with models keyed by contact_id/vendor_id and
-- assets referencing the manufacturer by NAME (fragile: name collisions, broken
-- links on rename).
--
-- This creates ONE manufacturer master, migrates the existing sources into it, and
-- adds id-references. ADDITIVE & REVERSIBLE: legacy contact_id/vendor_id columns
-- and assets.manufacturer (name) are retained during the transition.
-- ============================================================================

-- 1. The master table.
CREATE TABLE IF NOT EXISTS manufacturers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  country    TEXT,
  website    TEXT,
  phone      TEXT,
  email      TEXT,
  notes      TEXT,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS per project convention (0150/0155): permissive authenticated policy.
ALTER TABLE manufacturers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_manufacturers" ON manufacturers;
CREATE POLICY "auth_all_manufacturers"
  ON manufacturers FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 2. Id-references (additive, nullable). Models + assets point at the master.
ALTER TABLE manufacturer_models ADD COLUMN IF NOT EXISTS manufacturer_id UUID REFERENCES manufacturers(id);
ALTER TABLE assets              ADD COLUMN IF NOT EXISTS manufacturer_id UUID REFERENCES manufacturers(id);
CREATE INDEX IF NOT EXISTS idx_manufacturer_models_manufacturer_id ON manufacturer_models(manufacturer_id);
CREATE INDEX IF NOT EXISTS idx_assets_manufacturer_id              ON assets(manufacturer_id);

-- 3. Seed the master from every existing manufacturer source (by name).
--    a) vendors typed MANUFACTURER
INSERT INTO manufacturers (name, active)
SELECT DISTINCT btrim(v.name), true
FROM vendors v
WHERE v.type = 'MANUFACTURER' AND v.name IS NOT NULL AND btrim(v.name) <> ''
ON CONFLICT (name) DO NOTHING;

--    b) names already used on assets
INSERT INTO manufacturers (name, active)
SELECT DISTINCT btrim(a.manufacturer), true
FROM assets a
WHERE a.manufacturer IS NOT NULL AND btrim(a.manufacturer) <> ''
ON CONFLICT (name) DO NOTHING;

--    c) contact-manufacturers that own models (so their models can be linked)
INSERT INTO manufacturers (name, active)
SELECT DISTINCT btrim(c.name), true
FROM contacts c
JOIN manufacturer_models mm ON mm.contact_id = c.id
WHERE c.name IS NOT NULL AND btrim(c.name) <> ''
ON CONFLICT (name) DO NOTHING;

-- 4. Backfill the id-references by name match.
UPDATE assets a
SET manufacturer_id = m.id
FROM manufacturers m
WHERE a.manufacturer_id IS NULL AND btrim(a.manufacturer) = m.name;

UPDATE manufacturer_models mm
SET manufacturer_id = m.id
FROM vendors v
JOIN manufacturers m ON m.name = btrim(v.name)
WHERE mm.manufacturer_id IS NULL AND mm.vendor_id = v.id;

UPDATE manufacturer_models mm
SET manufacturer_id = m.id
FROM contacts c
JOIN manufacturers m ON m.name = btrim(c.name)
WHERE mm.manufacturer_id IS NULL AND mm.contact_id = c.id;

-- ── Verify ──────────────────────────────────────────────────────────────────
-- SELECT count(*) AS manufacturers FROM manufacturers;
-- SELECT count(*) AS assets_linked FROM assets WHERE manufacturer_id IS NOT NULL;
-- SELECT count(*) AS models_linked FROM manufacturer_models WHERE manufacturer_id IS NOT NULL;

-- ── Rollback (manual) ───────────────────────────────────────────────────────
--   ALTER TABLE assets              DROP COLUMN IF EXISTS manufacturer_id;
--   ALTER TABLE manufacturer_models DROP COLUMN IF EXISTS manufacturer_id;
--   DROP TABLE IF EXISTS manufacturers;
