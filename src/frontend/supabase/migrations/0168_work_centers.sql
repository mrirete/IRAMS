-- ============================================================================
-- Migration: 0168_work_centers
-- WM-2a (SAP PM/CR) — Work Center master data.
--
-- A work center is the capacity-bearing, costed resource an operation is
-- performed at (SAP CR01). It carries a default costing rate and daily capacity,
-- and a default settlement receiver (cost center) that the order-to-cost spine
-- (WM-2c confirmations -> FI-1 settlement) will use.
--
-- Standalone & ADDITIVE: new table only. Operations (job_tasks) and confirmations
-- (work_order_labor) gain work_center_id references in later WM-2b/2c migrations.
-- site_id -> organization_units (sites live in the org spine; no dedicated sites
-- table). cost_center_id -> cost_centers.
-- ============================================================================

CREATE TABLE IF NOT EXISTS work_centers (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                   TEXT NOT NULL UNIQUE,           -- e.g. MECH-01, ELEC-01, I&C-01
  name                   TEXT NOT NULL,
  site_id                UUID REFERENCES organization_units(id),
  cost_center_id         UUID REFERENCES cost_centers(id),
  activity_rate          NUMERIC(12, 2) NOT NULL DEFAULT 0,   -- planned cost / hour
  capacity_hours_per_day NUMERIC(6, 2)  NOT NULL DEFAULT 8,   -- available capacity / day
  category               TEXT,                                -- optional grouping (MECHANICAL/ELECTRICAL/I&C/...)
  active                 BOOLEAN NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_work_centers_site_id        ON work_centers(site_id);
CREATE INDEX IF NOT EXISTS idx_work_centers_cost_center_id ON work_centers(cost_center_id);

-- RLS per project convention (0150/0155): permissive authenticated policy.
ALTER TABLE work_centers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_work_centers" ON work_centers;
CREATE POLICY "auth_all_work_centers"
  ON work_centers FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Seed a starter set of standard maintenance work centers (idempotent).
INSERT INTO work_centers (code, name, category, activity_rate, capacity_hours_per_day)
VALUES
  ('MECH-01', 'Mechanical Maintenance', 'MECHANICAL', 85, 8),
  ('ELEC-01', 'Electrical Maintenance', 'ELECTRICAL', 90, 8),
  ('INST-01', 'Instrumentation & Control', 'I&C',       95, 8),
  ('RELI-01', 'Reliability / Condition Monitoring', 'RELIABILITY', 110, 8),
  ('CIVL-01', 'Civil / Structural', 'CIVIL', 70, 8)
ON CONFLICT (code) DO NOTHING;

-- Rollback:
--   DROP TABLE IF EXISTS work_centers;
