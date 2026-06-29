-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0161: Make criticality NULLABLE on assets table
--
-- Rationale (ISO 14224 / ISO 55000):
-- Criticality is only meaningful at Equipment-level (L4+) and below.
-- Functional Locations at levels 1–3 (Site, Area/Plant, Unit/System) are
-- organisational containers — they do not have a maintainability criticality.
-- The original NOT NULL constraint forced a dummy criticality on every FLOC,
-- causing save errors ("null value in column 'criticality' violates not-null
-- constraint") when upper-level locations were created without one.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE assets ALTER COLUMN criticality DROP NOT NULL;

COMMENT ON COLUMN assets.criticality IS 
  'Asset criticality ranking (A–D). Mandatory for Equipment/Component (ISO 14224 L4+), optional for upper FLOC levels (Site/Area/Unit/System).';
