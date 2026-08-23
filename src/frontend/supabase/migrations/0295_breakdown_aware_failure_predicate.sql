-- ============================================================================
-- 0295 — KPI unification: the failure predicate learns the breakdown indicator
--
-- 0286 unified the view with the client engine's isFailure (type heuristic +
-- coded failure mode, windowed on malfunction_start). 0289 made it
-- primaries-only. But both still IGNORED work_orders.breakdown (0283, SAP
-- MSAUS) — the field SAP's own MCJB counts failures by, and which the import
-- chain now fills from SAP/Maximo history.
--
-- New precedence (reliabilityMetrics.ts isFailure changes in lockstep, same
-- commit):
--   breakdown IS TRUE   → failure, whatever the order type (a breakdown found
--                         during PM work IS a functional failure)
--   breakdown IS FALSE  → NOT a failure, whatever the order type (explicitly
--                         recorded as non-failure work; a minor defect with a
--                         damage code is an event, not a failure)
--   breakdown IS NULL   → not recorded (legacy rows, thin imports) → the 0286
--                         type-or-coded-mode heuristic, unchanged
--
-- An ex-SAP plant importing history with MSAUS therefore gets MTBF numbers
-- that reconcile with what MCJB used to report.
--
-- Deliberately NOT changed:
--   • rpc_pareto_analysis — its counts follow the caller's explicit
--     p_wo_types selection (a different, UI-driven contract).
--   • The layer-2 Python analyzer — not in the live serving path.
--   • sem_failure_events (0183) — an event log of CODED events, not the
--     failure counter; rows with breakdown=false remain legitimate entries.
-- ============================================================================

BEGIN;

-- ── sem_asset_reliability v4: breakdown-aware canonical predicate ──────────
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
    -- Canonical isFailure (reliabilityMetrics.ts), breakdown-aware (0295),
    -- PRIMARIES only (0289): collateral is not the victim's own reliability.
    WHERE (
            w.breakdown IS TRUE
            OR (
                w.breakdown IS NULL
                AND upper(COALESCE(w.type, '')) !~ '(PREVENT|PREDICT|INSPECT|SCHEDUL|\mPM\M|\mPDM\M)'
                AND (
                      upper(COALESCE(w.type, '')) ~ '(CORRECT|BREAK|EMERG|REPAIR|\mCM\M|\mEM\M)'
                      OR fd.failure_mode_code IS NOT NULL
                    )
               )
          )
      AND fd.secondary_failure IS DISTINCT FROM TRUE
      AND COALESCE(w.malfunction_start, w.closed_at, w.created_at) >= now() - interval '365 days'
    GROUP BY w.asset_id
),
collateral AS (
    SELECT w.asset_id, count(*) AS collateral_12mo
    FROM public.work_orders w
    JOIN public.wo_failure_data fd ON fd.wo_id = w.id
    WHERE fd.secondary_failure IS TRUE
      AND COALESCE(w.malfunction_start, w.closed_at, w.created_at) >= now() - interval '365 days'
    GROUP BY w.asset_id
)
SELECT
    a.id                                          AS asset_id,
    a.tag                                         AS asset_tag,
    a.criticality::text                           AS criticality,
    COALESCE(fail.failures_12mo, 0)               AS failures_12mo,
    ROUND(COALESCE(fail.downtime_hrs_12mo, 0), 1) AS downtime_hrs_12mo,
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
    END                                                                     AS downtime_coverage_pct,
    COALESCE(col.collateral_12mo, 0)              AS collateral_12mo
FROM public.assets a
LEFT JOIN fail ON fail.asset_id = a.id
LEFT JOIN collateral col ON col.asset_id = a.id;

GRANT SELECT ON public.sem_asset_reliability TO authenticated, service_role;

-- ── Catalog: the failure definition, stated where agents read it ───────────
INSERT INTO public.semantic_catalog
  (object_name, column_name, title, description, tags, owner, source_tables, iso_standard)
VALUES
  ('sem_asset_reliability', 'failures_12mo', 'Failures (12mo)',
   'Primary failure events in the trailing 365 days, windowed on malfunction_start (else closed/created). Predicate precedence: a recorded breakdown indicator wins (true = failure whatever the order type; false = not a failure whatever the type); only unrecorded rows fall back to the corrective-type-or-coded-mode heuristic. This matches SAP MCJB semantics, so MTBF reconciles for plants migrating SAP history. Collateral (secondary) failures are excluded and shown separately.',
   ARRAY['reliability','kpi','failures'], 'Reliability Engineering',
   ARRAY['work_orders','wo_failure_data'], 'ISO 14224')
ON CONFLICT (object_name, COALESCE(column_name, '·')) DO UPDATE
  SET description = EXCLUDED.description,
      tags        = EXCLUDED.tags,
      updated_at  = now();

COMMIT;

-- VERIFY (after apply):
--   -- breakdown=false CM orders no longer counted; breakdown=true PM orders are:
--   SELECT failures_12mo FROM sem_asset_reliability WHERE asset_tag = '<test tag>';
