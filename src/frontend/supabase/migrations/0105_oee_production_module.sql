-- ═══════════════════════════════════════════════════════════════════════
-- Migration 0105: Data-Driven OEE Module
-- Creates production tracking tables, OEE computation, and dictionary data
-- Supports manufacturing, oil & gas, mining, food & beverage
-- ISO 22400-2 (KPI for MOM), ISO 55000 (Asset Management)
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. Asset Production Configuration ─────────────────────────────────
-- Per-asset manufacturing parameters (only for production equipment)
CREATE TABLE IF NOT EXISTS asset_production_config (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id                  UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  ideal_cycle_time_sec      NUMERIC NOT NULL DEFAULT 0,
  design_capacity_per_hr    NUMERIC NOT NULL DEFAULT 0,
  planned_production_hrs_day NUMERIC NOT NULL DEFAULT 24,
  uom                       TEXT NOT NULL DEFAULT 'units',
  quality_target_pct        NUMERIC NOT NULL DEFAULT 99.5,
  oee_target_pct            NUMERIC NOT NULL DEFAULT 85,
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(asset_id)
);

COMMENT ON TABLE asset_production_config IS
  'Per-asset manufacturing parameters: ideal cycle time, design capacity, target OEE. Required for OEE Performance factor calculation.';
COMMENT ON COLUMN asset_production_config.ideal_cycle_time_sec IS
  'Design cycle time per unit in seconds. For continuous processes, use 3600 / design_capacity_per_hr.';
COMMENT ON COLUMN asset_production_config.uom IS
  'Production unit of measure: units, barrels, tonnes, litres, cubic_metres, kg';


-- ─── 2. Production Logs (Shift-Level) ──────────────────────────────────
-- Core data source for OEE Performance and Quality factors
CREATE TABLE IF NOT EXISTS production_logs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id             UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  shift_date           DATE NOT NULL,
  shift                TEXT NOT NULL DEFAULT 'DAY'
                         CHECK (shift IN ('DAY', 'NIGHT', 'SWING', 'A', 'B', 'C', 'D')),
  planned_run_time_min NUMERIC NOT NULL DEFAULT 480,
  actual_run_time_min  NUMERIC NOT NULL DEFAULT 0,
  total_output         NUMERIC NOT NULL DEFAULT 0,
  good_output          NUMERIC NOT NULL DEFAULT 0,
  defect_count         NUMERIC NOT NULL DEFAULT 0,
  rework_count         NUMERIC NOT NULL DEFAULT 0,
  downtime_minutes     NUMERIC NOT NULL DEFAULT 0,
  downtime_reason_code TEXT,
  operator_id          UUID REFERENCES users(id),
  notes                TEXT,
  source               TEXT NOT NULL DEFAULT 'manual'
                         CHECK (source IN ('manual', 'iot', 'scada', 'api', 'plc')),
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_production_logs_asset_date
  ON production_logs(asset_id, shift_date DESC);
CREATE INDEX IF NOT EXISTS idx_production_logs_date
  ON production_logs(shift_date DESC);

COMMENT ON TABLE production_logs IS
  'Shift-level production data: output, quality, downtime. Primary data source for OEE Performance and Quality factors. Supports manual entry and IoT/SCADA integration.';


-- ─── 3. Production Downtime Events ─────────────────────────────────────
-- Granular stop events mapped to Six Big Losses framework
CREATE TABLE IF NOT EXISTS production_downtime_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  production_log_id UUID NOT NULL REFERENCES production_logs(id) ON DELETE CASCADE,
  asset_id          UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  event_type        TEXT NOT NULL
                      CHECK (event_type IN (
                        'planned_stop',      -- Changeover, setup, cleaning
                        'unplanned_stop',    -- Breakdown, equipment failure
                        'minor_stop',        -- Jams, misfeeds, obstructions (<5 min)
                        'speed_loss',        -- Running below ideal speed
                        'startup_reject',    -- Defects during warmup/startup
                        'production_reject'  -- Defects during steady-state production
                      )),
  duration_min      NUMERIC NOT NULL DEFAULT 0,
  reason_code       TEXT,
  description       TEXT,
  started_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_downtime_events_log
  ON production_downtime_events(production_log_id);
CREATE INDEX IF NOT EXISTS idx_downtime_events_asset
  ON production_downtime_events(asset_id, created_at DESC);

COMMENT ON TABLE production_downtime_events IS
  'Granular stop-event log mapped to the Six Big Losses framework (TPM). Feeds OEE loss waterfall analysis.';


-- ─── 4. Dictionary Seed Data ───────────────────────────────────────────
INSERT INTO dictionaries (type, code, description, active)
VALUES
  -- Shift types
  ('SHIFT_TYPE', 'DAY',   'Day Shift (06:00–18:00)',   true),
  ('SHIFT_TYPE', 'NIGHT', 'Night Shift (18:00–06:00)', true),
  ('SHIFT_TYPE', 'SWING', 'Swing Shift (14:00–22:00)', true),
  ('SHIFT_TYPE', 'A',     'Rotation A',                true),
  ('SHIFT_TYPE', 'B',     'Rotation B',                true),
  ('SHIFT_TYPE', 'C',     'Rotation C',                true),
  ('SHIFT_TYPE', 'D',     'Rotation D',                true),

  -- Downtime reason codes
  ('DOWNTIME_REASON', 'BREAKDOWN',     'Equipment Breakdown',        true),
  ('DOWNTIME_REASON', 'SETUP',         'Setup / Changeover',         true),
  ('DOWNTIME_REASON', 'MATERIAL',      'Material Shortage',          true),
  ('DOWNTIME_REASON', 'QUALITY_HOLD',  'Quality Hold',               true),
  ('DOWNTIME_REASON', 'PLANNED_MAINT', 'Planned Maintenance',        true),
  ('DOWNTIME_REASON', 'STARTUP',       'Startup / Warmup',           true),
  ('DOWNTIME_REASON', 'MINOR_STOP',    'Minor Stop / Jam',           true),
  ('DOWNTIME_REASON', 'SPEED_LOSS',    'Speed Loss / Slow Running',  true),
  ('DOWNTIME_REASON', 'NO_DEMAND',     'No Production Demand',       true),
  ('DOWNTIME_REASON', 'UTILITY',       'Utility Failure (Power/Steam/Air)', true),
  ('DOWNTIME_REASON', 'OPERATOR',      'Operator Unavailable',       true),
  ('DOWNTIME_REASON', 'OTHER',         'Other',                      true),

  -- OEE Loss Categories (Six Big Losses)
  ('OEE_LOSS_CATEGORY', 'PLANNED_STOP',      'Planned Stops (Setup, Adjustments)',      true),
  ('OEE_LOSS_CATEGORY', 'UNPLANNED_STOP',    'Unplanned Stops (Breakdowns)',            true),
  ('OEE_LOSS_CATEGORY', 'MINOR_STOP',        'Small Stops (Jams, Misfeeds)',            true),
  ('OEE_LOSS_CATEGORY', 'SPEED_LOSS',        'Speed Loss (Slow Cycles, Reduced Speed)', true),
  ('OEE_LOSS_CATEGORY', 'STARTUP_REJECT',    'Startup Rejects (Warmup Defects)',        true),
  ('OEE_LOSS_CATEGORY', 'PRODUCTION_REJECT', 'Production Rejects (Steady-State Defects)', true),

  -- Production UOM
  ('PRODUCTION_UOM', 'units',         'Units / Pieces',    true),
  ('PRODUCTION_UOM', 'barrels',       'Barrels (bbl)',     true),
  ('PRODUCTION_UOM', 'tonnes',        'Metric Tonnes',     true),
  ('PRODUCTION_UOM', 'litres',        'Litres',            true),
  ('PRODUCTION_UOM', 'cubic_metres',  'Cubic Metres (m³)', true),
  ('PRODUCTION_UOM', 'kg',            'Kilograms',         true),
  ('PRODUCTION_UOM', 'gallons',       'Gallons',           true)
ON CONFLICT (type, code) DO NOTHING;


-- ─── 5. compute_oee() RPC Function ────────────────────────────────────
-- Core OEE calculation: Availability × Performance × Quality
-- Supports per-asset or plant-wide aggregation over a date range
CREATE OR REPLACE FUNCTION public.compute_oee(
  p_asset_id UUID    DEFAULT NULL,
  p_from     DATE    DEFAULT CURRENT_DATE - 30,
  p_to       DATE    DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  asset_id          UUID,
  asset_tag         TEXT,
  asset_name        TEXT,
  availability_pct  NUMERIC,
  performance_pct   NUMERIC,
  quality_pct       NUMERIC,
  oee_pct           NUMERIC,
  total_output      NUMERIC,
  good_output       NUMERIC,
  defect_count      NUMERIC,
  planned_hrs       NUMERIC,
  actual_hrs        NUMERIC,
  oee_target_pct    NUMERIC
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    a.id                                                    AS asset_id,
    a.tag                                                   AS asset_tag,
    a.name                                                  AS asset_name,

    -- Availability = actual_run_time / planned_run_time × 100
    ROUND(
      CASE WHEN SUM(pl.planned_run_time_min) > 0
        THEN SUM(pl.actual_run_time_min) / SUM(pl.planned_run_time_min) * 100
        ELSE 0
      END, 1
    )                                                       AS availability_pct,

    -- Performance = (total_output × ideal_cycle_time_sec) / (actual_run_time_min × 60) × 100
    ROUND(
      CASE WHEN SUM(pl.actual_run_time_min) > 0 AND MAX(apc.ideal_cycle_time_sec) > 0
        THEN LEAST(100,
          (SUM(pl.total_output) * MAX(apc.ideal_cycle_time_sec))
          / (SUM(pl.actual_run_time_min) * 60) * 100
        )
        -- Fallback: if no cycle time configured, use capacity-based calculation
        WHEN SUM(pl.actual_run_time_min) > 0 AND MAX(apc.design_capacity_per_hr) > 0
        THEN LEAST(100,
          SUM(pl.total_output)
          / (SUM(pl.actual_run_time_min) / 60 * MAX(apc.design_capacity_per_hr)) * 100
        )
        ELSE 0
      END, 1
    )                                                       AS performance_pct,

    -- Quality = good_output / total_output × 100
    ROUND(
      CASE WHEN SUM(pl.total_output) > 0
        THEN SUM(pl.good_output) / SUM(pl.total_output) * 100
        ELSE 0
      END, 1
    )                                                       AS quality_pct,

    -- OEE = A × P × Q / 10000
    ROUND(
      CASE WHEN SUM(pl.planned_run_time_min) > 0
                AND SUM(pl.total_output) > 0
        THEN (
          (SUM(pl.actual_run_time_min) / SUM(pl.planned_run_time_min))
          * LEAST(1,
              CASE
                WHEN MAX(apc.ideal_cycle_time_sec) > 0
                  THEN (SUM(pl.total_output) * MAX(apc.ideal_cycle_time_sec))
                       / (SUM(pl.actual_run_time_min) * 60)
                WHEN MAX(apc.design_capacity_per_hr) > 0
                  THEN SUM(pl.total_output)
                       / (SUM(pl.actual_run_time_min) / 60 * MAX(apc.design_capacity_per_hr))
                ELSE 0
              END
          )
          * (SUM(pl.good_output) / SUM(pl.total_output))
          * 100
        )
        ELSE 0
      END, 1
    )                                                       AS oee_pct,

    COALESCE(SUM(pl.total_output), 0)                       AS total_output,
    COALESCE(SUM(pl.good_output), 0)                        AS good_output,
    COALESCE(SUM(pl.defect_count), 0)                       AS defect_count,
    ROUND(COALESCE(SUM(pl.planned_run_time_min), 0) / 60, 1) AS planned_hrs,
    ROUND(COALESCE(SUM(pl.actual_run_time_min), 0) / 60, 1)  AS actual_hrs,
    COALESCE(MAX(apc.oee_target_pct), 85)                    AS oee_target_pct

  FROM assets a
  JOIN production_logs pl ON pl.asset_id = a.id
  LEFT JOIN asset_production_config apc ON apc.asset_id = a.id
  WHERE pl.shift_date BETWEEN p_from AND p_to
    AND (p_asset_id IS NULL OR a.id = p_asset_id)
  GROUP BY a.id, a.tag, a.name
  ORDER BY oee_pct ASC;  -- Worst performers first
$$;

COMMENT ON FUNCTION public.compute_oee(UUID, DATE, DATE) IS
  'Computes OEE (Availability × Performance × Quality) per asset over a date range. Returns worst performers first. ISO 22400-2 compliant. Supports both cycle-time and capacity-based Performance calculation.';


-- ─── 6. Plant-wide OEE summary (single-row aggregate) ─────────────────
CREATE OR REPLACE FUNCTION public.get_plant_oee(
  p_from DATE DEFAULT CURRENT_DATE - 30,
  p_to   DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  availability_pct NUMERIC,
  performance_pct  NUMERIC,
  quality_pct      NUMERIC,
  oee_pct          NUMERIC,
  total_output     NUMERIC,
  good_output      NUMERIC,
  defect_count     NUMERIC,
  asset_count      BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    ROUND(AVG(c.availability_pct), 1) AS availability_pct,
    ROUND(AVG(c.performance_pct), 1)  AS performance_pct,
    ROUND(AVG(c.quality_pct), 1)      AS quality_pct,
    ROUND(AVG(c.oee_pct), 1)          AS oee_pct,
    SUM(c.total_output)               AS total_output,
    SUM(c.good_output)                AS good_output,
    SUM(c.defect_count)               AS defect_count,
    COUNT(*)                          AS asset_count
  FROM compute_oee(NULL, p_from, p_to) c;
$$;

COMMENT ON FUNCTION public.get_plant_oee(DATE, DATE) IS
  'Returns plant-wide OEE summary averaging across all production assets. Used by Reports KPI cards.';


-- ─── 7. Six Big Losses breakdown ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_oee_losses(
  p_asset_id UUID DEFAULT NULL,
  p_from     DATE DEFAULT CURRENT_DATE - 30,
  p_to       DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  loss_category TEXT,
  loss_label    TEXT,
  total_minutes NUMERIC,
  event_count   BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    pde.event_type                                 AS loss_category,
    COALESCE(d.description, pde.event_type)        AS loss_label,
    COALESCE(SUM(pde.duration_min), 0)             AS total_minutes,
    COUNT(*)                                       AS event_count
  FROM production_downtime_events pde
  JOIN production_logs pl ON pl.id = pde.production_log_id
  LEFT JOIN dictionaries d ON d.type = 'OEE_LOSS_CATEGORY' AND d.code = UPPER(pde.event_type)
  WHERE pl.shift_date BETWEEN p_from AND p_to
    AND (p_asset_id IS NULL OR pde.asset_id = p_asset_id)
  GROUP BY pde.event_type, d.description
  ORDER BY total_minutes DESC;
$$;

COMMENT ON FUNCTION public.get_oee_losses(UUID, DATE, DATE) IS
  'Returns Six Big Losses breakdown for OEE waterfall chart. Aggregates downtime events by loss category.';


-- ─── 8. RLS Policies ───────────────────────────────────────────────────
ALTER TABLE asset_production_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_downtime_events ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read all production data
CREATE POLICY "select_production_config" ON asset_production_config
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "select_production_logs" ON production_logs
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "select_downtime_events" ON production_downtime_events
  FOR SELECT TO authenticated USING (true);

-- Authenticated users can insert/update production data
CREATE POLICY "insert_production_logs" ON production_logs
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_production_logs" ON production_logs
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "insert_downtime_events" ON production_downtime_events
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_downtime_events" ON production_downtime_events
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "insert_production_config" ON asset_production_config
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_production_config" ON asset_production_config
  FOR UPDATE TO authenticated USING (true);


-- ─── 9. Sample seed data (for development) ────────────────────────────
-- Creates production config for first 3 assets and sample production logs
DO $$
DECLARE
  v_asset_1 UUID;
  v_asset_2 UUID;
  v_asset_3 UUID;
  v_log_id  UUID;
  v_user_id UUID;
BEGIN
  -- Get up to 3 equipment-level assets
  SELECT id INTO v_asset_1 FROM assets WHERE hierarchy_level IN ('EQUIPMENT', 'SUBUNIT') ORDER BY tag LIMIT 1;
  SELECT id INTO v_asset_2 FROM assets WHERE hierarchy_level IN ('EQUIPMENT', 'SUBUNIT') ORDER BY tag LIMIT 1 OFFSET 1;
  SELECT id INTO v_asset_3 FROM assets WHERE hierarchy_level IN ('EQUIPMENT', 'SUBUNIT') ORDER BY tag LIMIT 1 OFFSET 2;
  SELECT id INTO v_user_id FROM users LIMIT 1;

  -- Skip if no assets exist
  IF v_asset_1 IS NULL THEN
    RAISE NOTICE 'No equipment assets found — skipping OEE seed data';
    RETURN;
  END IF;

  -- Asset 1: High-performing compressor (OEE ~87%)
  INSERT INTO asset_production_config (asset_id, ideal_cycle_time_sec, design_capacity_per_hr, uom, oee_target_pct)
  VALUES (v_asset_1, 30, 120, 'barrels', 85)
  ON CONFLICT (asset_id) DO NOTHING;

  -- 14 days of production logs for Asset 1
  FOR i IN 0..13 LOOP
    v_log_id := gen_random_uuid();
    INSERT INTO production_logs (id, asset_id, shift_date, shift, planned_run_time_min, actual_run_time_min,
      total_output, good_output, defect_count, rework_count, downtime_minutes, operator_id, source)
    VALUES (
      v_log_id, v_asset_1,
      CURRENT_DATE - i, CASE WHEN i % 2 = 0 THEN 'DAY' ELSE 'NIGHT' END,
      480,                                          -- 8-hr shift
      480 - (10 + (random() * 30)::int),            -- 10-40 min downtime
      (100 + (random() * 40)::int),                 -- 100-140 units
      (95 + (random() * 40)::int),                  -- 95-135 good
      (1 + (random() * 5)::int),                    -- 1-6 defects
      (0 + (random() * 2)::int),                    -- 0-2 rework
      (10 + (random() * 30)::int),                  -- downtime
      v_user_id, 'manual'
    );
    -- Add a downtime event for each log
    INSERT INTO production_downtime_events (production_log_id, asset_id, event_type, duration_min, reason_code, started_at)
    VALUES (
      v_log_id, v_asset_1,
      CASE (i % 6)
        WHEN 0 THEN 'planned_stop'
        WHEN 1 THEN 'unplanned_stop'
        WHEN 2 THEN 'minor_stop'
        WHEN 3 THEN 'speed_loss'
        WHEN 4 THEN 'startup_reject'
        ELSE 'production_reject'
      END,
      (5 + (random() * 20)::int),
      CASE (i % 4) WHEN 0 THEN 'SETUP' WHEN 1 THEN 'BREAKDOWN' WHEN 2 THEN 'MINOR_STOP' ELSE 'MATERIAL' END,
      (CURRENT_DATE - i)::timestamptz + interval '8 hours'
    );
  END LOOP;

  -- Asset 2: Mid-performing pump (OEE ~72%)
  IF v_asset_2 IS NOT NULL THEN
    INSERT INTO asset_production_config (asset_id, ideal_cycle_time_sec, design_capacity_per_hr, uom, oee_target_pct)
    VALUES (v_asset_2, 45, 80, 'barrels', 85)
    ON CONFLICT (asset_id) DO NOTHING;

    FOR i IN 0..13 LOOP
      v_log_id := gen_random_uuid();
      INSERT INTO production_logs (id, asset_id, shift_date, shift, planned_run_time_min, actual_run_time_min,
        total_output, good_output, defect_count, rework_count, downtime_minutes, operator_id, source)
      VALUES (
        v_log_id, v_asset_2,
        CURRENT_DATE - i, 'DAY', 480,
        480 - (40 + (random() * 60)::int),    -- more downtime
        (55 + (random() * 30)::int),          -- lower output
        (48 + (random() * 25)::int),          -- lower quality
        (3 + (random() * 8)::int),            -- more defects
        (1 + (random() * 3)::int),
        (40 + (random() * 60)::int),
        v_user_id, 'manual'
      );
      INSERT INTO production_downtime_events (production_log_id, asset_id, event_type, duration_min, reason_code, started_at)
      VALUES (v_log_id, v_asset_2, 'unplanned_stop', (15 + (random() * 40)::int), 'BREAKDOWN',
        (CURRENT_DATE - i)::timestamptz + interval '10 hours');
    END LOOP;
  END IF;

  -- Asset 3: Low-performing generator (OEE ~55%)
  IF v_asset_3 IS NOT NULL THEN
    INSERT INTO asset_production_config (asset_id, ideal_cycle_time_sec, design_capacity_per_hr, uom, oee_target_pct)
    VALUES (v_asset_3, 20, 180, 'units', 85)
    ON CONFLICT (asset_id) DO NOTHING;

    FOR i IN 0..13 LOOP
      v_log_id := gen_random_uuid();
      INSERT INTO production_logs (id, asset_id, shift_date, shift, planned_run_time_min, actual_run_time_min,
        total_output, good_output, defect_count, rework_count, downtime_minutes, operator_id, source)
      VALUES (
        v_log_id, v_asset_3,
        CURRENT_DATE - i, 'NIGHT', 480,
        480 - (80 + (random() * 100)::int),   -- heavy downtime
        (40 + (random() * 20)::int),          -- very low output
        (30 + (random() * 15)::int),          -- poor quality
        (5 + (random() * 12)::int),           -- high defects
        (2 + (random() * 4)::int),
        (80 + (random() * 100)::int),
        v_user_id, 'manual'
      );
      INSERT INTO production_downtime_events (production_log_id, asset_id, event_type, duration_min, reason_code, started_at)
      VALUES (v_log_id, v_asset_3, 'unplanned_stop', (30 + (random() * 60)::int), 'BREAKDOWN',
        (CURRENT_DATE - i)::timestamptz + interval '20 hours');
    END LOOP;
  END IF;

  RAISE NOTICE 'OEE seed data created for % asset(s)',
    CASE WHEN v_asset_3 IS NOT NULL THEN 3
         WHEN v_asset_2 IS NOT NULL THEN 2
         ELSE 1
    END;
END $$;
