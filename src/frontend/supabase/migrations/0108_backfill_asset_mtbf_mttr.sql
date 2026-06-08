-- Migration: Backfill assets.mtbf_days, mttr_hours, failure_count_ytd from work order history
-- Root cause: the get_asset_mtbf_mttr RPC computes values dynamically for charts,
-- but the drilldown pages read stored columns directly from the assets table.
-- This migration populates those columns and creates a refresh function.
--
-- ISO 14224: Failure data collection at maintainable item level
-- ISO 55000: Asset performance measurement and continuous improvement

-- ═══════════════════════════════════════════════════════════════
-- 1. Ensure columns exist on assets table
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS mtbf_days     NUMERIC;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS mttr_hours    NUMERIC;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS failure_count_ytd INTEGER DEFAULT 0;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS running_hours NUMERIC DEFAULT 0;

-- ═══════════════════════════════════════════════════════════════
-- 2. Backfill from work_orders
--    - mtbf_days: (span between first and last WO) / (failure_count - 1)
--                 Single-failure assets get 365 days (ISO 14224 convention)
--    - mttr_hours: AVG(actual_downtime_hrs) per asset
--    - failure_count_ytd: count of non-cancelled WOs in current year
-- ═══════════════════════════════════════════════════════════════
WITH asset_stats AS (
  SELECT
    w.asset_id,
    COUNT(w.id)                                        AS total_failures,
    -- MTBF: operational span / (failures - 1)
    CASE
      WHEN COUNT(w.id) > 1 THEN
        ROUND(
          EXTRACT(EPOCH FROM (MAX(w.created_at) - MIN(w.created_at))) / 86400.0
          / NULLIF(COUNT(w.id) - 1, 0),
          1
        )
      WHEN COUNT(w.id) = 1 THEN 365.0
      ELSE NULL
    END                                                AS calc_mtbf_days,
    -- MTTR: average repair time
    ROUND(
      COALESCE(AVG(
        CASE WHEN w.actual_downtime_hrs > 0 THEN w.actual_downtime_hrs ELSE NULL END
      ), 0),
      1
    )                                                  AS calc_mttr_hours,
    -- Total downtime for running_hours estimation
    COALESCE(SUM(w.actual_downtime_hrs), 0)            AS total_downtime_hrs,
    -- Failure count YTD
    COUNT(w.id) FILTER (
      WHERE EXTRACT(YEAR FROM w.created_at) = EXTRACT(YEAR FROM NOW())
    )                                                  AS calc_failure_count_ytd
  FROM work_orders w
  WHERE w.status NOT IN ('CANCELLED')
  GROUP BY w.asset_id
)
UPDATE public.assets a
SET
  mtbf_days         = s.calc_mtbf_days,
  mttr_hours        = s.calc_mttr_hours,
  failure_count_ytd = s.calc_failure_count_ytd,
  -- Running hours: estimate from install date minus total downtime
  running_hours     = GREATEST(0,
    ROUND(
      EXTRACT(EPOCH FROM (NOW() - a.created_at)) / 3600.0
      - s.total_downtime_hrs,
      0
    )
  )
FROM asset_stats s
WHERE a.id = s.asset_id;


-- ═══════════════════════════════════════════════════════════════
-- 3. Reusable refresh function — call periodically or after WO close
--    Usage: SELECT refresh_asset_reliability_stats();
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.refresh_asset_reliability_stats()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  WITH asset_stats AS (
    SELECT
      w.asset_id,
      COUNT(w.id)                                        AS total_failures,
      CASE
        WHEN COUNT(w.id) > 1 THEN
          ROUND(
            EXTRACT(EPOCH FROM (MAX(w.created_at) - MIN(w.created_at))) / 86400.0
            / NULLIF(COUNT(w.id) - 1, 0),
            1
          )
        WHEN COUNT(w.id) = 1 THEN 365.0
        ELSE NULL
      END                                                AS calc_mtbf_days,
      ROUND(
        COALESCE(AVG(
          CASE WHEN w.actual_downtime_hrs > 0 THEN w.actual_downtime_hrs ELSE NULL END
        ), 0),
        1
      )                                                  AS calc_mttr_hours,
      COALESCE(SUM(w.actual_downtime_hrs), 0)            AS total_downtime_hrs,
      COUNT(w.id) FILTER (
        WHERE EXTRACT(YEAR FROM w.created_at) = EXTRACT(YEAR FROM NOW())
      )                                                  AS calc_failure_count_ytd
    FROM work_orders w
    WHERE w.status NOT IN ('CANCELLED')
    GROUP BY w.asset_id
  )
  UPDATE public.assets a
  SET
    mtbf_days         = s.calc_mtbf_days,
    mttr_hours        = s.calc_mttr_hours,
    failure_count_ytd = s.calc_failure_count_ytd,
    running_hours     = GREATEST(0,
      ROUND(
        EXTRACT(EPOCH FROM (NOW() - a.created_at)) / 3600.0
        - s.total_downtime_hrs,
        0
      )
    )
  FROM asset_stats s
  WHERE a.id = s.asset_id;
END;
$$;

COMMENT ON FUNCTION public.refresh_asset_reliability_stats() IS
  'Recomputes mtbf_days, mttr_hours, failure_count_ytd, and running_hours on all assets from work order history. Call after WO closure or on a schedule. ISO 14224 compliant.';


-- ═══════════════════════════════════════════════════════════════
-- 4. Verify backfill results
-- ═══════════════════════════════════════════════════════════════
SELECT
  COUNT(*)                                              AS assets_with_data,
  ROUND(AVG(mtbf_days), 1)                             AS avg_mtbf_days,
  ROUND(AVG(mttr_hours), 1)                            AS avg_mttr_hours,
  SUM(failure_count_ytd)                                AS total_failures_ytd,
  ROUND(AVG(running_hours), 0)                         AS avg_running_hours
FROM public.assets
WHERE mtbf_days IS NOT NULL OR mttr_hours IS NOT NULL;
