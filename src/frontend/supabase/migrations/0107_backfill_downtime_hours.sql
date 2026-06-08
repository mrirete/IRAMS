-- Migration: Backfill actual_downtime_hrs on existing work orders
-- Derives downtime from (closed_at - created_at) for completed WOs
-- Required for: MTBF vs MTTR chart, Downtime by Reason pie chart, Pareto chart
-- ISO 55000: Accurate downtime recording for reliability analytics

-- ═══════════════════════════════════════════════════════════════
-- Backfill actual_downtime_hrs using closed_at - created_at
-- Only for completed WOs (TECO/CLOSED) that don't already have a value
-- ═══════════════════════════════════════════════════════════════
UPDATE work_orders
SET actual_downtime_hrs = ROUND(
  EXTRACT(EPOCH FROM (closed_at - created_at)) / 3600.0,
  1
)
WHERE status IN ('TECO', 'CLOSED')
  AND closed_at IS NOT NULL
  AND created_at IS NOT NULL
  AND (actual_downtime_hrs IS NULL OR actual_downtime_hrs = 0);

-- Verify the backfill
SELECT
  count(*) AS total_updated,
  ROUND(AVG(actual_downtime_hrs), 1) AS avg_downtime_hrs,
  ROUND(MIN(actual_downtime_hrs), 1) AS min_hrs,
  ROUND(MAX(actual_downtime_hrs), 1) AS max_hrs,
  ROUND(SUM(actual_downtime_hrs), 1) AS total_downtime_hrs
FROM work_orders
WHERE status IN ('TECO', 'CLOSED')
  AND actual_downtime_hrs > 0;
