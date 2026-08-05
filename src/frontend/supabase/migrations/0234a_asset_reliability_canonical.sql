-- ═══════════════════════════════════════════════════════════════
-- 0234 — Per-asset MTBF/MTTR computed, not remembered
--
-- assets.mtbf_days and assets.mttr_hours were filled ONCE by migration
-- 0108 (no trigger, nothing recomputes them) using a different formula
-- again — span between first and last work order ÷ (failures − 1). They
-- have been frozen ever since, and sem_asset_health passes them straight
-- through to `get_asset_health`, which is how the Specialist quotes MTBF
-- to a customer. A stale number in an agent's mouth is the worst place
-- for one.
--
-- This migration:
--   1. sem_asset_reliability — per-asset MTBF/MTTR/availability computed
--      from work orders with the SAME definitions as
--      src/lib/reliabilityKpis.ts (operating hours ÷ corrective events;
--      MTTR over timed corrective repairs; inherent availability).
--   2. sem_asset_health rebuilt so mtbf_days/mttr_hours ARE the computed
--      values — every existing consumer becomes correct without a code
--      change — while the frozen originals stay visible, renamed
--      *_stored, so nothing is hidden.
--   3. open_wo_count now uses the canonical is-open rule from 0233
--      instead of the fourth private status list it carried.
--
-- The stored columns are NOT dropped: other code still writes them and
-- destroying data is not this migration's job.
-- ═══════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE VIEW public.sem_asset_reliability
WITH (security_invoker = true) AS
WITH cm AS (
    SELECT
        w.asset_id,
        count(*)                                                          AS failures_12mo,
        COALESCE(sum(w.actual_downtime_hrs), 0)                           AS downtime_hrs_12mo,
        count(*) FILTER (WHERE COALESCE(w.actual_downtime_hrs, 0) > 0)    AS timed_repairs,
        COALESCE(sum(w.actual_downtime_hrs) FILTER (WHERE COALESCE(w.actual_downtime_hrs, 0) > 0), 0)
                                                                          AS timed_downtime_hrs
    FROM public.work_orders w
    WHERE upper(COALESCE(w.type, '')) = 'CM'
      AND w.created_at >= now() - interval '365 days'
    GROUP BY w.asset_id
)
SELECT
    a.id                                        AS asset_id,
    a.tag                                       AS asset_tag,
    a.criticality::text                         AS criticality,
    COALESCE(cm.failures_12mo, 0)               AS failures_12mo,
    ROUND(COALESCE(cm.downtime_hrs_12mo, 0), 1) AS downtime_hrs_12mo,
    -- Operating hours: one year of calendar time less recorded downtime.
    -- Without run-hour meters this is the defensible approximation, and it
    -- is stated wherever the number is shown.
    GREATEST(0, 8760 - COALESCE(cm.downtime_hrs_12mo, 0))                 AS operating_hrs_12mo,
    CASE WHEN COALESCE(cm.failures_12mo, 0) > 0
         THEN ROUND(GREATEST(0, 8760 - COALESCE(cm.downtime_hrs_12mo, 0)) / cm.failures_12mo, 1)
    END                                                                   AS mtbf_hours,
    CASE WHEN COALESCE(cm.failures_12mo, 0) > 0
         THEN ROUND(GREATEST(0, 8760 - COALESCE(cm.downtime_hrs_12mo, 0)) / cm.failures_12mo / 24.0, 1)
    END                                                                   AS mtbf_days,
    CASE WHEN COALESCE(cm.timed_repairs, 0) > 0
         THEN ROUND(cm.timed_downtime_hrs / cm.timed_repairs, 1)
    END                                                                   AS mttr_hours,
    CASE WHEN COALESCE(cm.failures_12mo, 0) > 0 AND COALESCE(cm.timed_repairs, 0) > 0
         THEN ROUND(
             (GREATEST(0, 8760 - cm.downtime_hrs_12mo) / cm.failures_12mo)
             / NULLIF((GREATEST(0, 8760 - cm.downtime_hrs_12mo) / cm.failures_12mo)
                      + (cm.timed_downtime_hrs / cm.timed_repairs), 0) * 100, 1)
    END                                                                   AS availability_pct,
    CASE WHEN COALESCE(cm.failures_12mo, 0) > 0
         THEN ROUND(COALESCE(cm.timed_repairs, 0)::numeric / cm.failures_12mo * 100, 0)
         ELSE 0
    END                                                                   AS downtime_coverage_pct
FROM public.assets a
LEFT JOIN cm ON cm.asset_id = a.id;

GRANT SELECT ON public.sem_asset_reliability TO authenticated, service_role;

-- ── sem_asset_health rebuilt on the canonical numbers ───────────────────
CREATE OR REPLACE VIEW public.sem_asset_health
WITH (security_invoker = true) AS
SELECT
  a.id                     AS asset_id,
  a.tag                    AS asset_tag,
  a.name                   AS asset_name,
  a.criticality::text      AS criticality,
  a.status_code,
  a.hierarchy_level,
  wc.code                  AS work_center_code,
  -- Same position and names as before, but now COMPUTED. CREATE OR REPLACE
  -- forbids reordering or renaming existing view columns, so the additions
  -- (availability + the frozen originals) are appended at the end.
  ar.mtbf_days,
  ar.mttr_hours,
  a.failure_count_ytd,
  a.running_hours,
  ow.open_wo_count,
  fe.failure_events_12mo,
  fe.downtime_hrs_12mo,
  pm.overdue_pm_count,
  lr.last_reading_at,
  ar.availability_pct,
  a.mtbf_days              AS mtbf_days_stored,
  a.mttr_hours             AS mttr_hours_stored
FROM public.assets a
LEFT JOIN public.work_centers wc ON wc.id = a.responsible_work_center_id
LEFT JOIN public.sem_asset_reliability ar ON ar.asset_id = a.id
LEFT JOIN LATERAL (
  -- Canonical backlog rule (0233), not a private status list.
  SELECT count(*) AS open_wo_count
  FROM public.work_orders w
  WHERE w.asset_id = a.id
    AND public.ers_wo_state(w.status::text) IN ('open', 'unknown')
) ow ON true
LEFT JOIN LATERAL (
  SELECT count(*)                          AS failure_events_12mo,
         COALESCE(sum(w.actual_downtime_hrs), 0) AS downtime_hrs_12mo
  FROM public.work_orders w
  JOIN public.wo_failure_data fd ON fd.wo_id = w.id
  WHERE w.asset_id = a.id
    AND w.created_at >= now() - interval '365 days'
) fe ON true
LEFT JOIN LATERAL (
  SELECT count(*) AS overdue_pm_count
  FROM public.recurring_work rw
  WHERE rw.asset_id = a.id::text
    AND rw.active
    AND rw.next_due_date IS NOT NULL
    AND rw.next_due_date < now()
) pm ON true
LEFT JOIN LATERAL (
  SELECT max(rl.created_at) AS last_reading_at
  FROM public.reading_logs rl
  WHERE rl.asset_id = a.id
) lr ON true;

DELETE FROM public.semantic_catalog
 WHERE object_name IN ('sem_asset_reliability')
    OR (object_name = 'sem_asset_health' AND column_name IN ('mtbf_days', 'mttr_hours', 'mtbf_days_stored'));

INSERT INTO public.semantic_catalog
  (object_name, column_name, title, description, tags, owner, source_tables, iso_standard)
VALUES
  ('sem_asset_reliability', NULL, 'Asset Reliability (computed)',
   'Per-asset MTBF, MTTR and inherent availability computed from the last 365 days of corrective work orders. Operating hours = calendar year less recorded downtime (no run-hour meters), failures = corrective events, MTTR averaged over repairs that carry a duration. Same definitions as src/lib/reliabilityKpis.ts.',
   ARRAY['reliability','kpi','canonical'], 'Reliability Engineering',
   ARRAY['work_orders','assets'], 'ISO 14224'),
  ('sem_asset_reliability', 'mtbf_hours', 'MTBF',
   'Mean operating time between corrective failures. NULL when the asset had no failures in the window — an honest absence, never 0.',
   ARRAY['reliability','kpi'], NULL, ARRAY['work_orders'], 'ISO 14224'),
  ('sem_asset_reliability', 'downtime_coverage_pct', 'Downtime coverage',
   'Share of corrective events carrying a downtime figure. Low coverage means MTTR and availability rest on a thin denominator — quote them with that caveat.',
   ARRAY['data_quality'], NULL, ARRAY['work_orders'], NULL),
  ('sem_asset_health', 'mtbf_days', 'MTBF (days)',
   'COMPUTED from the last 365 days of corrective work orders (sem_asset_reliability). Superseded the frozen assets.mtbf_days column, which migration 0108 filled once with a different formula and never refreshed; that legacy value is still visible as mtbf_days_stored.',
   ARRAY['reliability','kpi','canonical'], NULL, ARRAY['work_orders','assets'], 'ISO 14224'),
  ('sem_asset_health', 'mtbf_days_stored', 'MTBF (days, legacy stored)',
   'The frozen assets.mtbf_days column — a 2026 one-off backfill, not maintained. Kept for reference and reconciliation only; do not quote it.',
   ARRAY['legacy'], NULL, ARRAY['assets'], NULL);

COMMIT;
