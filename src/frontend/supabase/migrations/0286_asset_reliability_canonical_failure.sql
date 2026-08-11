-- 0286: sem_asset_reliability adopts the canonical failure predicate and the
--       real failure-event basis (engine unification, closes the last gap
--       between the SQL view and src/eam/services/reliabilityMetrics.ts)
--
-- Two disagreements remained between the client engine (isFailure) and this
-- view (0234a):
--
--   1. Predicate: the view counted only upper(type)='CM'. The client counts
--      corrective/breakdown work (CORRECT|BREAK|EMERG|REPAIR|CM|EM) OR any WO
--      carrying a coded failure mode, excluding preventive types. EM
--      breakdowns and coded failures typed oddly were invisible to the view
--      but counted by every client surface.
--
--   2. Event basis: the view windowed on created_at. Since 0283 the app
--      records malfunction_start (the actual equipment event; SAP AUSVN) and
--      the client engine prefers it. The view now windows on
--      COALESCE(malfunction_start, closed_at, created_at) — same order as
--      eventDate() in reliabilityMetrics.ts — and its repair-hours basis
--      matches repairHoursOf(): actual_downtime_hrs, else actual_duration_hrs.
--
-- Column list is unchanged, so every consumer (Reports, drill-downs,
-- Dashboard bad actors, sem_asset_health, agents) picks the fix up without a
-- code change. NOTE for the mirrors listed in reliabilityMetrics.ts:42-45:
-- rpc_pareto_analysis and the Python bad_actor_hunter also carry this
-- predicate — they were already on the isFailure definition; this view was
-- the odd one out.

BEGIN;

CREATE OR REPLACE VIEW public.sem_asset_reliability
WITH (security_invoker = true) AS
WITH fail AS (
    SELECT
        w.asset_id,
        count(*)                                                          AS failures_12mo,
        COALESCE(sum(COALESCE(w.actual_downtime_hrs, w.actual_duration_hrs)), 0)
                                                                          AS downtime_hrs_12mo,
        count(*) FILTER (WHERE COALESCE(w.actual_downtime_hrs, w.actual_duration_hrs, 0) > 0)
                                                                          AS timed_repairs,
        COALESCE(sum(COALESCE(w.actual_downtime_hrs, w.actual_duration_hrs))
                 FILTER (WHERE COALESCE(w.actual_downtime_hrs, w.actual_duration_hrs, 0) > 0), 0)
                                                                          AS timed_downtime_hrs
    FROM public.work_orders w
    LEFT JOIN public.wo_failure_data fd ON fd.wo_id = w.id
    -- Canonical isFailure (reliabilityMetrics.ts): not preventive, and either
    -- corrective/breakdown-typed or carrying a coded failure mode.
    WHERE upper(COALESCE(w.type, '')) !~ '(PREVENT|PREDICT|INSPECT|SCHEDUL|\mPM\M|\mPDM\M)'
      AND (
            upper(COALESCE(w.type, '')) ~ '(CORRECT|BREAK|EMERG|REPAIR|\mCM\M|\mEM\M)'
            OR fd.failure_mode_code IS NOT NULL
          )
      AND COALESCE(w.malfunction_start, w.closed_at, w.created_at) >= now() - interval '365 days'
    GROUP BY w.asset_id
)
SELECT
    a.id                                          AS asset_id,
    a.tag                                         AS asset_tag,
    a.criticality::text                           AS criticality,
    COALESCE(fail.failures_12mo, 0)               AS failures_12mo,
    ROUND(COALESCE(fail.downtime_hrs_12mo, 0), 1) AS downtime_hrs_12mo,
    -- Operating hours: one year of calendar time less recorded downtime.
    -- Without run-hour meters this is the defensible approximation, and it
    -- is stated wherever the number is shown.
    GREATEST(0, 8760 - COALESCE(fail.downtime_hrs_12mo, 0))                 AS operating_hrs_12mo,
    CASE WHEN COALESCE(fail.failures_12mo, 0) > 0
         THEN ROUND(GREATEST(0, 8760 - COALESCE(fail.downtime_hrs_12mo, 0)) / fail.failures_12mo, 1)
    END                                                                     AS mtbf_hours,
    CASE WHEN COALESCE(fail.failures_12mo, 0) > 0
         THEN ROUND(GREATEST(0, 8760 - COALESCE(fail.downtime_hrs_12mo, 0)) / fail.failures_12mo / 24.0, 1)
    END                                                                     AS mtbf_days,
    CASE WHEN COALESCE(fail.timed_repairs, 0) > 0
         THEN ROUND(fail.timed_downtime_hrs / fail.timed_repairs, 1)
    END                                                                     AS mttr_hours,
    CASE WHEN COALESCE(fail.failures_12mo, 0) > 0 AND COALESCE(fail.timed_repairs, 0) > 0
         THEN ROUND(
             (GREATEST(0, 8760 - fail.downtime_hrs_12mo) / fail.failures_12mo)
             / NULLIF((GREATEST(0, 8760 - fail.downtime_hrs_12mo) / fail.failures_12mo)
                      + (fail.timed_downtime_hrs / fail.timed_repairs), 0) * 100, 1)
    END                                                                     AS availability_pct,
    CASE WHEN COALESCE(fail.failures_12mo, 0) > 0
         THEN ROUND(COALESCE(fail.timed_repairs, 0)::numeric / fail.failures_12mo * 100, 0)
         ELSE 0
    END                                                                     AS downtime_coverage_pct
FROM public.assets a
LEFT JOIN fail ON fail.asset_id = a.id;

GRANT SELECT ON public.sem_asset_reliability TO authenticated, service_role;

-- Refresh the catalog description to state the new basis.
DELETE FROM public.semantic_catalog
 WHERE object_name = 'sem_asset_reliability' AND column_name IS NULL;

INSERT INTO public.semantic_catalog
  (object_name, column_name, title, description, tags, owner, source_tables, iso_standard)
VALUES
  ('sem_asset_reliability', NULL, 'Asset Reliability (computed)',
   'Per-asset MTBF, MTTR and inherent availability from the last 365 days of failures. A failure = the canonical isFailure rule (corrective/breakdown-typed work OR any WO carrying a coded failure mode; preventive types excluded) — the SAME rule as the client engine, rpc_pareto_analysis and the Python bad-actor analyzer. Failure event time = malfunction_start when recorded (0283), else closure, else creation. Repair hours = actual_downtime_hrs, else actual_duration_hrs. Operating hours = calendar year less recorded downtime (no run-hour meters).',
   ARRAY['reliability','kpi','canonical'], 'Reliability Engineering',
   ARRAY['work_orders','wo_failure_data','assets'], 'ISO 14224')
ON CONFLICT DO NOTHING;

COMMIT;
