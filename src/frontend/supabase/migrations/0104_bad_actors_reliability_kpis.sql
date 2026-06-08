-- Migration: Create get_bad_actors & get_reliability_kpis RPC functions
-- Called by Reports.tsx → Asset Health tab
-- ISO 55000: Monthly Pareto Analysis for Top Bad Actors
-- Syncs work_orders ↔ assets for downtime, cost, and frequency ranking

-- ═══════════════════════════════════════════════════════════════
-- 1. get_bad_actors(p_limit int)
-- Returns worst-performing assets ranked by WO frequency + cost + downtime
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_bad_actors(p_limit int DEFAULT 10)
RETURNS TABLE (
  asset_id        uuid,
  asset_tag       text,
  asset_name      text,
  criticality     text,
  wo_count        bigint,
  total_cost      numeric,
  total_downtime_hrs numeric,
  pct_of_total_wos numeric
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH total AS (
    SELECT COUNT(*)::numeric AS cnt
    FROM work_orders
    WHERE status NOT IN ('CANCELLED')
  )
  SELECT
    a.id                                                       AS asset_id,
    a.tag                                                      AS asset_tag,
    a.name                                                     AS asset_name,
    a.criticality::text                                        AS criticality,
    COUNT(w.id)                                                AS wo_count,
    COALESCE(SUM(
      CASE
        WHEN w.cost_frozen THEN COALESCE(w.frozen_labor_cost, 0) + COALESCE(w.frozen_material_cost, 0)
        ELSE COALESCE(w.total_actual_cost, 0)
      END
    ), 0)                                                      AS total_cost,
    COALESCE(SUM(COALESCE(w.actual_downtime_hrs, 0)), 0)       AS total_downtime_hrs,
    ROUND(COUNT(w.id) * 100.0 / NULLIF(t.cnt, 0), 1)          AS pct_of_total_wos
  FROM assets a
  JOIN work_orders w ON w.asset_id = a.id
  CROSS JOIN total t
  WHERE w.status NOT IN ('CANCELLED')
  GROUP BY a.id, a.tag, a.name, a.criticality, t.cnt
  ORDER BY wo_count DESC, total_cost DESC
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.get_bad_actors(int) IS
  'Returns the top N worst-performing assets (Bad Actors) ranked by WO count, cost, and downtime. Used by Reports → Asset Health. ISO 55000 Pareto Analysis compliant.';


-- ═══════════════════════════════════════════════════════════════
-- 2. get_reliability_kpis()
-- Returns plant-wide reliability metrics: total WOs, avg MTTR,
-- availability %, total maintenance cost
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_reliability_kpis()
RETURNS TABLE (
  total_wos        bigint,
  avg_mttr_hrs     numeric,
  availability_pct numeric,
  total_cost       numeric
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH wo_metrics AS (
    SELECT
      COUNT(*)                                           AS total_wos,
      COALESCE(SUM(
        CASE
          WHEN cost_frozen THEN COALESCE(frozen_labor_cost, 0) + COALESCE(frozen_material_cost, 0)
          ELSE COALESCE(total_actual_cost, 0)
        END
      ), 0)                                              AS total_cost,
      COALESCE(AVG(
        CASE
          WHEN actual_downtime_hrs IS NOT NULL AND actual_downtime_hrs > 0
          THEN actual_downtime_hrs
          ELSE NULL
        END
      ), 0)                                              AS avg_mttr_hrs,
      COALESCE(SUM(COALESCE(actual_downtime_hrs, 0)), 0) AS total_downtime_hrs
    FROM work_orders
    WHERE status NOT IN ('CANCELLED')
  )
  SELECT
    wm.total_wos,
    ROUND(wm.avg_mttr_hrs, 2)                           AS avg_mttr_hrs,
    -- Availability = (total_operational_hrs - downtime) / total_operational_hrs × 100
    -- Using 8760 hrs/year as baseline (365 × 24)
    ROUND(
      GREATEST(0, LEAST(100,
        (8760.0 - wm.total_downtime_hrs) / 8760.0 * 100
      )), 1
    )                                                    AS availability_pct,
    wm.total_cost
  FROM wo_metrics wm;
$$;

COMMENT ON FUNCTION public.get_reliability_kpis() IS
  'Returns plant-wide reliability KPIs: total WO count, average MTTR (hours), asset availability (%), total maintenance cost. Used by Reports → Overview & Asset Health KPI cards.';
