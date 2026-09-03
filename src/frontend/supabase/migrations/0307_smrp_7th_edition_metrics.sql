-- ============================================================================
-- 0307 — SMRP Best Practices, 7th Edition alignment
--
-- Part A — sem_asset_reliability v6: the mean metrics per Guideline 4.0
--          (3.5.1 MTBF, 3.5.2 MTTR, 3.5.3 MTBM, 3.5.4 MDT) and the two
--          availabilities of Guideline 6.0 (Ai inherent, Ao operational).
--          reliabilityMetrics.ts computeAssetReliability changes in lockstep.
--
--   What was wrong: the column named mttr_hours averaged actual_downtime_hrs
--   — the malfunction window, failure → back in service, delays included.
--   The 7th Edition defines that as MEAN DOWNTIME (3.5.4). MTTR (3.5.2,
--   revised) is repair start → repair complete, i.e. the order's actual
--   repair hours (actual_duration_hrs, 0283). The view now emits both, and
--   mttr_basis says which one mttr_hours is standing on for this asset.
--
--   MTBM (3.5.3) = operating time ÷ maintenance actions that interrupted the
--   function: failures + preventive/scheduled orders that carried downtime
--   (actual, else planned est_downtime_hrs). A PM with no downtime did not
--   interrupt the function and does not count.
--
--   Ai (G6.0) = MTBF / (MTBF + MTTR) — kept as availability_pct for every
--   existing consumer. Ao (G6.0) = MTBM / (MTBM + MDT) — new.
--
--   MTTF (3.5.5) is for NON-repairable items. No per-component repairable
--   flag exists, so a failure closed with the REPLACED remedy (RPL) is the
--   proxy for an item run to failure; mttf_hours is NULL when none were.
--
--   Scheduled (3.3) / unscheduled (3.4) downtime split is exposed so the
--   Metrics page can show both against Total Available Time. Operating time
--   now subtracts BOTH (before, only failure downtime was subtracted).
--
-- Part B — compute_oee / get_plant_oee to 2.1.1 (revised 2023), 2.1.2 TEEP,
--          2.4 Idle Time, 2.5 Utilization Time: no-demand / no-material stops
--          are IDLE TIME (outside the availability denominator), planned
--          maintenance stops are SCHEDULED DOWNTIME, everything else is
--          unscheduled. Performance is reported raw as well as capped so a
--          mis-specified best rate is visible (7th-ed caution).
--
-- All 12-month and lifetime columns of 0298 are preserved.
-- ============================================================================

BEGIN;

-- ── Part A: sem_asset_reliability v6 ────────────────────────────────────────
CREATE OR REPLACE VIEW public.sem_asset_reliability
WITH (security_invoker = true) AS
WITH fail_all AS (
    -- Canonical isFailure (reliabilityMetrics.ts), breakdown-aware (0295),
    -- PRIMARIES only (0289) — over ALL history, windowed columns derived below.
    SELECT
        w.asset_id,
        COALESCE(w.malfunction_start, w.closed_at, w.created_at)          AS event_at,
        COALESCE(w.actual_downtime_hrs, w.actual_duration_hrs)            AS repair_hrs,   -- MDT basis (outage)
        w.actual_duration_hrs                                             AS labor_hrs,    -- MTTR basis (repair)
        -- 3.5.5 MTTF basis: the item was REPLACED, i.e. run to failure as a
        -- non-repairable item. 'RPL' is the REMEDY_CODE dictionary value.
        (upper(COALESCE(fd.remedy_code, '')) ~ '^RPL$|REPLAC')            AS replaced
    FROM public.work_orders w
    LEFT JOIN public.wo_failure_data fd ON fd.wo_id = w.id
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
),
fail AS (
    SELECT
        asset_id,
        count(*) FILTER (WHERE event_at >= now() - interval '365 days')   AS failures_12mo,
        COALESCE(sum(repair_hrs) FILTER (WHERE event_at >= now() - interval '365 days'), 0)
                                                                          AS downtime_hrs_12mo,
        count(*) FILTER (WHERE event_at >= now() - interval '365 days'
                           AND COALESCE(repair_hrs, 0) > 0)               AS timed_repairs,
        COALESCE(sum(repair_hrs) FILTER (WHERE event_at >= now() - interval '365 days'
                                           AND COALESCE(repair_hrs, 0) > 0), 0)
                                                                          AS timed_downtime_hrs,
        -- 3.5.2 repair-hour basis (0307)
        count(*) FILTER (WHERE event_at >= now() - interval '365 days'
                           AND COALESCE(labor_hrs, 0) > 0)                AS repaired_12mo,
        COALESCE(sum(labor_hrs) FILTER (WHERE event_at >= now() - interval '365 days'
                                          AND COALESCE(labor_hrs, 0) > 0), 0)
                                                                          AS repair_hrs_12mo,
        -- 3.5.5 replacement-closed failures (0307)
        count(*) FILTER (WHERE event_at >= now() - interval '365 days' AND replaced)
                                                                          AS replacements_12mo,
        -- Lifetime (0298): the imported-history fallback basis.
        count(*)                                                          AS failures_total,
        min(event_at)                                                     AS first_failure_at,
        max(event_at)                                                     AS last_failure_at,
        count(*) FILTER (WHERE COALESCE(repair_hrs, 0) > 0)               AS timed_repairs_total,
        COALESCE(sum(repair_hrs) FILTER (WHERE COALESCE(repair_hrs, 0) > 0), 0)
                                                                          AS timed_downtime_hrs_total
    FROM fail_all
    GROUP BY asset_id
),
-- 3.3 scheduled downtime / 3.5.3 maintenance actions: preventive-typed orders
-- that took the asset down (actual, else planned downtime), NOT failures.
sched AS (
    SELECT
        w.asset_id,
        count(*)                                                          AS pm_interrupts_12mo,
        COALESCE(sum(COALESCE(NULLIF(w.actual_downtime_hrs, 0), w.est_downtime_hrs)), 0)
                                                                          AS scheduled_downtime_hrs_12mo
    FROM public.work_orders w
    WHERE w.breakdown IS DISTINCT FROM TRUE
      AND upper(COALESCE(w.type, '')) ~ '(PREVENT|PREDICT|INSPECT|SCHEDUL|CALIB|\mPM\M|\mPDM\M)'
      AND COALESCE(NULLIF(w.actual_downtime_hrs, 0), w.est_downtime_hrs, 0) > 0
      AND COALESCE(w.closed_at, w.created_at) >= now() - interval '365 days'
    GROUP BY w.asset_id
),
collateral AS (
    SELECT w.asset_id, count(*) AS collateral_12mo
    FROM public.work_orders w
    JOIN public.wo_failure_data fd ON fd.wo_id = w.id
    WHERE fd.secondary_failure IS TRUE
      AND COALESCE(w.malfunction_start, w.closed_at, w.created_at) >= now() - interval '365 days'
    GROUP BY w.asset_id
),
calc AS (
    SELECT
        a.id AS asset_id,
        COALESCE(fail.failures_12mo, 0)::bigint                           AS failures_12mo,
        COALESCE(fail.downtime_hrs_12mo, 0)::numeric                      AS unsched_dt,
        COALESCE(sched.scheduled_downtime_hrs_12mo, 0)                    AS sched_dt,
        COALESCE(sched.pm_interrupts_12mo, 0)                             AS pm_interrupts,
        COALESCE(fail.replacements_12mo, 0)::bigint                       AS replacements_12mo,
        GREATEST(0, 8760 - COALESCE(fail.downtime_hrs_12mo, 0)
                        - COALESCE(sched.scheduled_downtime_hrs_12mo, 0))::numeric AS operating_hrs,
        -- 3.5.4 MDT
        CASE WHEN COALESCE(fail.timed_repairs, 0) > 0
             THEN fail.timed_downtime_hrs / fail.timed_repairs END        AS mdt,
        -- 3.5.2 MTTR: repair hours when present, else MDT proxy
        CASE WHEN COALESCE(fail.repaired_12mo, 0) > 0
             THEN fail.repair_hrs_12mo / fail.repaired_12mo
             WHEN COALESCE(fail.timed_repairs, 0) > 0
             THEN fail.timed_downtime_hrs / fail.timed_repairs END        AS mttr,
        CASE WHEN COALESCE(fail.repaired_12mo, 0) > 0 THEN 'repair'
             WHEN COALESCE(fail.timed_repairs, 0) > 0 THEN 'downtime-proxy' END
                                                                          AS mttr_basis
    FROM public.assets a
    LEFT JOIN fail  ON fail.asset_id  = a.id
    LEFT JOIN sched ON sched.asset_id = a.id
)
SELECT
    -- Column ORDER and types of 0298 preserved exactly: CREATE OR REPLACE VIEW
    -- may only APPEND columns (sem_asset_health and sem_cascade_initiators
    -- depend on this view, so a DROP would cascade). New 7th-edition columns
    -- follow the original seventeen.
    a.id                                          AS asset_id,
    a.tag                                         AS asset_tag,
    a.criticality::text                           AS criticality,
    c.failures_12mo                               AS failures_12mo,
    ROUND(c.unsched_dt, 1)                        AS downtime_hrs_12mo,
    c.operating_hrs                               AS operating_hrs_12mo,
    -- SMRP 3.5.1 MTBF = operating time ÷ failures
    CASE WHEN c.failures_12mo > 0 THEN ROUND(c.operating_hrs / c.failures_12mo, 1) END          AS mtbf_hours,
    CASE WHEN c.failures_12mo > 0 THEN ROUND(c.operating_hrs / c.failures_12mo / 24.0, 1) END   AS mtbf_days,
    -- SMRP 3.5.2 MTTR (repair hours; MDT proxy when none — see mttr_basis)
    CASE WHEN c.mttr IS NOT NULL THEN ROUND(c.mttr, 1) END                                     AS mttr_hours,
    -- Guideline 6.0 Ai, kept under its legacy name for existing consumers
    CASE WHEN c.failures_12mo > 0 AND c.mttr IS NOT NULL
         THEN ROUND((c.operating_hrs / c.failures_12mo)
                    / NULLIF((c.operating_hrs / c.failures_12mo) + c.mttr, 0) * 100, 1) END   AS availability_pct,
    CASE WHEN c.failures_12mo > 0
         THEN ROUND(COALESCE(fail.timed_repairs, 0)::numeric / c.failures_12mo * 100, 0)
         ELSE 0
    END                                                                                        AS downtime_coverage_pct,
    COALESCE(col.collateral_12mo, 0)              AS collateral_12mo,
    -- Lifetime columns (0298), unchanged.
    COALESCE(fail.failures_total, 0)              AS failures_total,
    fail.first_failure_at,
    fail.last_failure_at,
    CASE WHEN COALESCE(fail.failures_total, 0) >= 2
              AND fail.last_failure_at > fail.first_failure_at
         THEN ROUND((EXTRACT(EPOCH FROM (fail.last_failure_at - fail.first_failure_at)) / 3600.0
                     / (fail.failures_total - 1))::numeric, 1)
    END                                                                                        AS mtbf_hours_lifetime,
    CASE WHEN COALESCE(fail.timed_repairs_total, 0) > 0
         THEN ROUND(fail.timed_downtime_hrs_total / fail.timed_repairs_total, 1)
    END                                                                                        AS mttr_hours_lifetime,
    -- ── 7th-edition additions (appended) ──────────────────────────────────
    ROUND(c.unsched_dt, 1)                        AS unscheduled_downtime_hrs_12mo,   -- SMRP 3.4
    ROUND(c.sched_dt, 1)                          AS scheduled_downtime_hrs_12mo,     -- SMRP 3.3
    c.mttr_basis,
    CASE WHEN c.mdt IS NOT NULL THEN ROUND(c.mdt, 1) END                                       AS mdt_hours,          -- SMRP 3.5.4
    (c.failures_12mo + c.pm_interrupts)                                                        AS maintenance_actions_12mo,
    -- SMRP 3.5.3 MTBM = operating time ÷ (failures + function-interrupting PM/PdM)
    CASE WHEN (c.failures_12mo + c.pm_interrupts) > 0
         THEN ROUND(c.operating_hrs / (c.failures_12mo + c.pm_interrupts), 1) END              AS mtbm_hours,
    CASE WHEN c.failures_12mo > 0 AND c.mttr IS NOT NULL
         THEN ROUND((c.operating_hrs / c.failures_12mo)
                    / NULLIF((c.operating_hrs / c.failures_12mo) + c.mttr, 0) * 100, 1) END   AS ai_pct,
    CASE WHEN (c.failures_12mo + c.pm_interrupts) > 0 AND c.mdt IS NOT NULL
         THEN ROUND((c.operating_hrs / (c.failures_12mo + c.pm_interrupts))
                    / NULLIF((c.operating_hrs / (c.failures_12mo + c.pm_interrupts)) + c.mdt, 0) * 100, 1) END
                                                                                               AS ao_pct,
    -- SMRP 3.5.5 MTTF = operating time ÷ items run to failure (replacement-closed)
    c.replacements_12mo                                                                        AS replacements_12mo,
    CASE WHEN c.replacements_12mo > 0 THEN ROUND(c.operating_hrs / c.replacements_12mo, 1) END AS mttf_hours
FROM public.assets a
JOIN calc c ON c.asset_id = a.id
LEFT JOIN fail ON fail.asset_id = a.id
LEFT JOIN collateral col ON col.asset_id = a.id;

GRANT SELECT ON public.sem_asset_reliability TO authenticated, service_role;

INSERT INTO public.semantic_catalog
  (object_name, column_name, title, description, tags, owner, source_tables, iso_standard)
VALUES
  ('sem_asset_reliability', 'mtbf_hours', 'MTBF hours (SMRP 3.5.1)',
   'Mean Time Between Failures = operating time ÷ primary failures in the trailing 365 days. Operating time = 8,760 h less recorded unscheduled AND scheduled downtime (calendar-hour approximation, no run-hour meters). SMRP Best Practices 7th Edition, metric 3.5.1 / Guideline 4.0.',
   ARRAY['reliability','kpi','mtbf','smrp'], 'Reliability Engineering',
   ARRAY['work_orders','wo_failure_data'], 'SMRP 7th Ed. 3.5.1'),
  ('sem_asset_reliability', 'mttr_hours', 'MTTR hours (SMRP 3.5.2)',
   'Mean Time to Repair or Replace = repair hours ÷ repair events, repair start to repair complete (work_orders.actual_duration_hrs). When no failure in the window carries repair hours, mean downtime stands in and mttr_basis reads ''downtime-proxy''. SMRP 7th Edition 3.5.2.',
   ARRAY['reliability','kpi','mttr','smrp'], 'Reliability Engineering',
   ARRAY['work_orders'], 'SMRP 7th Ed. 3.5.2'),
  ('sem_asset_reliability', 'mdt_hours', 'Mean Downtime hours (SMRP 3.5.4)',
   'Mean Downtime = total downtime ÷ downtime events: failure to back in service, waits and delays included (actual_downtime_hrs — the malfunction window, 0283). Distinct from MTTR by definition; the 7th Edition cautions to be clear which is reported.',
   ARRAY['reliability','kpi','mdt','smrp'], 'Reliability Engineering',
   ARRAY['work_orders'], 'SMRP 7th Ed. 3.5.4'),
  ('sem_asset_reliability', 'mtbm_hours', 'MTBM hours (SMRP 3.5.3)',
   'Mean Time Between Maintenance = operating time ÷ maintenance actions that interrupted the asset function: failures plus preventive/predictive orders carrying downtime (actual, else planned est_downtime_hrs).',
   ARRAY['reliability','kpi','mtbm','smrp'], 'Reliability Engineering',
   ARRAY['work_orders'], 'SMRP 7th Ed. 3.5.3'),
  ('sem_asset_reliability', 'ai_pct', 'Inherent availability Ai (SMRP Guideline 6.0)',
   'Ai = MTBF ÷ (MTBF + MTTR) × 100 — design-driven availability between planned shutdowns. availability_pct is the same number under its legacy name.',
   ARRAY['reliability','kpi','availability','smrp'], 'Reliability Engineering',
   ARRAY['work_orders'], 'SMRP 7th Ed. G6.0'),
  ('sem_asset_reliability', 'ao_pct', 'Operational availability Ao (SMRP Guideline 6.0)',
   'Ao = MTBM ÷ (MTBM + MDT) × 100 — the availability the plant actually experienced: preventive interruptions and administrative/logistic delays included. Always ≤ Ai.',
   ARRAY['reliability','kpi','availability','smrp'], 'Reliability Engineering',
   ARRAY['work_orders'], 'SMRP 7th Ed. G6.0'),
  ('sem_asset_reliability', 'scheduled_downtime_hrs_12mo', 'Scheduled downtime hours (SMRP 3.3)',
   'Downtime on preventive/scheduled work in the trailing 365 days (actual, else planned). Expressed against Total Available Time (8,760 h) on the Metrics page.',
   ARRAY['reliability','kpi','downtime','smrp'], 'Reliability Engineering',
   ARRAY['work_orders'], 'SMRP 7th Ed. 3.3'),
  ('sem_asset_reliability', 'unscheduled_downtime_hrs_12mo', 'Unscheduled downtime hours (SMRP 3.4)',
   'Downtime on primary failures in the trailing 365 days. Best-in-class total maintenance downtime is <0.5–2% of Total Available Time (SMRP 3.2).',
   ARRAY['reliability','kpi','downtime','smrp'], 'Reliability Engineering',
   ARRAY['work_orders'], 'SMRP 7th Ed. 3.4'),
  ('sem_asset_reliability', 'mttf_hours', 'MTTF hours (SMRP 3.5.5)',
   'Mean Time To Failure = operating time ÷ non-repairable items run to failure. IREAMS has no per-component repairable flag, so the denominator is the trailing-365-day primary failures closed with the REPLACED remedy code (wo_failure_data.remedy_code = RPL). NULL when nothing was replaced. Failures closed by repair belong to MTBF (3.5.1).',
   ARRAY['reliability','kpi','mttf','smrp'], 'Reliability Engineering',
   ARRAY['work_orders','wo_failure_data'], 'SMRP 7th Ed. 3.5.5')
ON CONFLICT (object_name, COALESCE(column_name, '·')) DO UPDATE
  SET title       = EXCLUDED.title,
      description = EXCLUDED.description,
      tags        = EXCLUDED.tags,
      iso_standard = EXCLUDED.iso_standard,
      updated_at  = now();

-- ── Part B: OEE per SMRP 2.1.1 (rev. 2023), 2.1.2, 2.2, 2.4, 2.5 ────────────
-- Return shapes change (new columns), so the functions are dropped and
-- recreated; search_path stays pinned (0203). Every existing column keeps its
-- name and meaning except availability_pct, which now follows metric 2.2
-- (idle time removed from the denominator). lib/oee7.ts mirrors this.

ALTER TABLE public.asset_production_config
    ADD COLUMN IF NOT EXISTS process_type TEXT NOT NULL DEFAULT 'batch'
        CHECK (process_type IN ('batch', 'discrete', 'continuous'));
COMMENT ON COLUMN public.asset_production_config.process_type IS
    'SMRP 2.1.1 best-in-class OEE band: batch 85–100%, continuous discrete 90–100%, continuous process 95–100%.';

DROP FUNCTION IF EXISTS public.get_plant_oee(DATE, DATE);
DROP FUNCTION IF EXISTS public.compute_oee(UUID, DATE, DATE);

CREATE FUNCTION public.compute_oee(
  p_asset_id UUID    DEFAULT NULL,
  p_from     DATE    DEFAULT CURRENT_DATE - 30,
  p_to       DATE    DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  asset_id                  UUID,
  asset_tag                 TEXT,
  asset_name                TEXT,
  availability_pct          NUMERIC,   -- 2.2  uptime ÷ (TAT − idle)
  performance_pct           NUMERIC,   -- capped at 100
  performance_raw_pct       NUMERIC,   -- uncapped (7th-ed caution: > 100 = best rate mis-specified)
  quality_pct               NUMERIC,
  oee_pct                   NUMERIC,   -- 2.1.1 (OEE 2)
  utilization_pct           NUMERIC,   -- 2.5  (TAT − idle) ÷ TAT
  teep_pct                  NUMERIC,   -- 2.1.2 utilization × OEE
  total_output              NUMERIC,
  good_output               NUMERIC,
  defect_count              NUMERIC,
  planned_hrs               NUMERIC,   -- Total Available Time logged (Σ planned_run_time_min)
  actual_hrs                NUMERIC,   -- uptime
  idle_hrs                  NUMERIC,   -- 2.4
  scheduled_downtime_hrs    NUMERIC,   -- 3.3
  unscheduled_downtime_hrs  NUMERIC,   -- 3.4
  oee_target_pct            NUMERIC,
  process_type              TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH t AS (
    SELECT
      a.id, a.tag, a.name,
      SUM(pl.planned_run_time_min)                                                       AS tat_min,
      SUM(pl.actual_run_time_min)                                                        AS up_min,
      SUM(CASE WHEN upper(COALESCE(pl.downtime_reason_code, '')) IN ('NO_DEMAND', 'MATERIAL')
               THEN pl.downtime_minutes ELSE 0 END)                                      AS idle_min,
      SUM(CASE WHEN upper(COALESCE(pl.downtime_reason_code, '')) = 'PLANNED_MAINT'
               THEN pl.downtime_minutes ELSE 0 END)                                      AS sched_min,
      SUM(CASE WHEN upper(COALESCE(pl.downtime_reason_code, '')) NOT IN ('NO_DEMAND', 'MATERIAL', 'PLANNED_MAINT')
               THEN pl.downtime_minutes ELSE 0 END)                                      AS unsched_min,
      SUM(pl.total_output)                                                               AS total_output,
      SUM(pl.good_output)                                                                AS good_output,
      SUM(pl.defect_count)                                                               AS defect_count,
      MAX(apc.ideal_cycle_time_sec)                                                      AS cycle_sec,
      MAX(apc.design_capacity_per_hr)                                                    AS cap_hr,
      COALESCE(MAX(apc.oee_target_pct), 85)                                              AS oee_target_pct,
      COALESCE(MAX(apc.process_type), 'batch')                                           AS process_type
    FROM assets a
    JOIN production_logs pl ON pl.asset_id = a.id
    LEFT JOIN asset_production_config apc ON apc.asset_id = a.id
    WHERE pl.shift_date BETWEEN p_from AND p_to
      AND (p_asset_id IS NULL OR a.id = p_asset_id)
    GROUP BY a.id, a.tag, a.name
  ),
  legs AS (
    SELECT t.*,
      CASE WHEN (t.tat_min - t.idle_min) > 0
           THEN t.up_min / (t.tat_min - t.idle_min) ELSE NULL END                        AS a,
      CASE WHEN t.up_min > 0 AND t.cycle_sec > 0
           THEN (t.total_output * t.cycle_sec) / (t.up_min * 60)
           WHEN t.up_min > 0 AND t.cap_hr > 0
           THEN t.total_output / (t.up_min / 60 * t.cap_hr)
           ELSE NULL END                                                                 AS p_raw,
      CASE WHEN t.total_output > 0 THEN t.good_output / t.total_output ELSE NULL END     AS q,
      CASE WHEN t.tat_min > 0 THEN (t.tat_min - t.idle_min) / t.tat_min ELSE NULL END    AS u
    FROM t
  )
  SELECT
    l.id, l.tag, l.name,
    ROUND(l.a * 100, 1)                                                                  AS availability_pct,
    ROUND(LEAST(1, l.p_raw) * 100, 1)                                                    AS performance_pct,
    ROUND(l.p_raw * 100, 1)                                                              AS performance_raw_pct,
    ROUND(l.q * 100, 1)                                                                  AS quality_pct,
    ROUND(l.a * LEAST(1, l.p_raw) * l.q * 100, 1)                                        AS oee_pct,
    ROUND(l.u * 100, 1)                                                                  AS utilization_pct,
    ROUND(l.u * l.a * LEAST(1, l.p_raw) * l.q * 100, 1)                                  AS teep_pct,
    COALESCE(l.total_output, 0), COALESCE(l.good_output, 0), COALESCE(l.defect_count, 0),
    ROUND(COALESCE(l.tat_min, 0) / 60, 1)                                                AS planned_hrs,
    ROUND(COALESCE(l.up_min, 0) / 60, 1)                                                 AS actual_hrs,
    ROUND(COALESCE(l.idle_min, 0) / 60, 1)                                               AS idle_hrs,
    ROUND(COALESCE(l.sched_min, 0) / 60, 1)                                              AS scheduled_downtime_hrs,
    ROUND(COALESCE(l.unsched_min, 0) / 60, 1)                                            AS unscheduled_downtime_hrs,
    l.oee_target_pct,
    l.process_type
  FROM legs l
  ORDER BY oee_pct ASC NULLS LAST;
$$;

COMMENT ON FUNCTION public.compute_oee(UUID, DATE, DATE) IS
  'OEE per asset over a date range per SMRP Best Practices 7th Edition 2.1.1 (Availability = uptime ÷ (Total Available Time − Idle Time); no-demand and material stops are idle time, planned maintenance is scheduled downtime), with 2.1.2 TEEP, 2.4 idle, 2.5 utilization and an uncapped performance leg. Worst performers first. ISO 22400-2 consistent.';

CREATE FUNCTION public.get_plant_oee(
  p_from DATE DEFAULT CURRENT_DATE - 30,
  p_to   DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  availability_pct NUMERIC,
  performance_pct  NUMERIC,
  quality_pct      NUMERIC,
  oee_pct          NUMERIC,
  utilization_pct  NUMERIC,
  teep_pct         NUMERIC,
  total_output     NUMERIC,
  good_output      NUMERIC,
  defect_count     NUMERIC,
  planned_hrs      NUMERIC,
  actual_hrs       NUMERIC,
  idle_hrs         NUMERIC,
  scheduled_downtime_hrs   NUMERIC,
  unscheduled_downtime_hrs NUMERIC,
  asset_count      BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  -- Plant time legs are TIME-WEIGHTED, not averaged across assets: SMRP cautions
  -- that plant-level OEE must take each element to its basic form first.
  SELECT
    ROUND(CASE WHEN SUM(c.planned_hrs - c.idle_hrs) > 0 THEN SUM(c.actual_hrs) / SUM(c.planned_hrs - c.idle_hrs) * 100 END, 1)   AS availability_pct,
    ROUND(AVG(c.performance_pct), 1)                                                                                               AS performance_pct,
    ROUND(CASE WHEN SUM(c.total_output) > 0 THEN SUM(c.good_output) / SUM(c.total_output) * 100 END, 1)                          AS quality_pct,
    ROUND(AVG(c.oee_pct), 1)                                                                                                       AS oee_pct,
    ROUND(CASE WHEN SUM(c.planned_hrs) > 0 THEN SUM(c.planned_hrs - c.idle_hrs) / SUM(c.planned_hrs) * 100 END, 1)               AS utilization_pct,
    ROUND(AVG(c.teep_pct), 1)                                                                                                      AS teep_pct,
    SUM(c.total_output), SUM(c.good_output), SUM(c.defect_count),
    SUM(c.planned_hrs), SUM(c.actual_hrs), SUM(c.idle_hrs), SUM(c.scheduled_downtime_hrs), SUM(c.unscheduled_downtime_hrs),
    COUNT(*)
  FROM compute_oee(NULL, p_from, p_to) c;
$$;

COMMENT ON FUNCTION public.get_plant_oee(DATE, DATE) IS
  'Plant-wide OEE summary (SMRP 7th Ed. 2.1.1/2.1.2): availability, utilization and quality time/unit-weighted across assets; performance, OEE and TEEP averaged. Used by Reports KPI cards.';

GRANT EXECUTE ON FUNCTION public.compute_oee(UUID, DATE, DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_plant_oee(DATE, DATE) TO authenticated, service_role;

COMMIT;

-- VERIFY (after apply):
--   SELECT asset_tag, availability_pct, utilization_pct, teep_pct, idle_hrs FROM compute_oee(NULL, CURRENT_DATE-90, CURRENT_DATE);
--   -- an asset whose only downtime is NO_DEMAND now reads availability 100% and utilization < 100%.
--   SELECT asset_tag, mtbf_days, mttr_hours, mttr_basis, mdt_hours, mtbm_hours, ai_pct, ao_pct
--     FROM sem_asset_reliability WHERE failures_12mo > 0 ORDER BY ao_pct LIMIT 10;
--   -- ao_pct <= ai_pct on every row; mttr_basis = 'repair' only where actual_duration_hrs was captured.
