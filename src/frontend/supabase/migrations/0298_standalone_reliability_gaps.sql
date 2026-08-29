-- ============================================================================
-- 0298 — Standalone-reliability gaps: honest failure coding, lifetime KPIs,
--         and the sensor→condition-reading bridge column
--
-- IREAMS is sold in a reliability-only tier where ALL history arrives via the
-- CMMS import wizard / sync API rather than the in-app work-order lifecycle.
-- Three things silently degraded that tenant's numbers:
--
--   1. 'UNKNOWN' failure-mode pads. failure_mode_code was NOT NULL (0000), so
--      the import chain padded cause-only rows with 'UNKNOWN' — not a catalog
--      code. Those rows counted as "coded failure evidence" in the failure
--      predicate and decoded to blank in sem_failure_events. The column
--      becomes nullable; existing pads convert to NULL ("not recorded" is an
--      honest state — same philosophy as 0283's breakdown handling).
--      reliabilityMetrics.ts and ImportService change in lockstep this commit.
--
--   2. sem_asset_reliability only reported a trailing-365-day window. A tenant
--      importing five years of SAP history (ending months ago, export lag)
--      saw blank scoreboards while Weibull happily fitted the same rows.
--      v5 keeps every 12-month column unchanged and ADDS lifetime columns so
--      surfaces can fall back honestly ("no failures in the last 12 months —
--      37 on record").
--
--   3. reading_definitions.sensor_tag — the missing link between the two
--      condition stores. Connector/ingest data lands in ers_sensor_readings
--      while meter-based PMs and reading alarms read reading_logs; nothing
--      connected them. A definition that names its sensor_tag now gets live
--      pushes mirrored into reading_logs by ingest-readings (same commit), so
--      a vibration feed can trip a condition-based PM.
-- ============================================================================

BEGIN;

-- ── 1. Failure coding: NULL over pad ────────────────────────────────────────
ALTER TABLE public.wo_failure_data ALTER COLUMN failure_mode_code DROP NOT NULL;

UPDATE public.wo_failure_data
   SET failure_mode_code = NULL
 WHERE upper(failure_mode_code) = 'UNKNOWN';

COMMENT ON COLUMN public.wo_failure_data.failure_mode_code IS
    'ISO 14224 failure-mode catalog code. NULL = not recorded (an honest state — import chains must NOT pad; pre-0298 ''UNKNOWN'' pads were converted to NULL).';

-- ── 2. sem_asset_reliability v5: + lifetime columns ─────────────────────────
CREATE OR REPLACE VIEW public.sem_asset_reliability
WITH (security_invoker = true) AS
WITH fail_all AS (
    -- Canonical isFailure (reliabilityMetrics.ts), breakdown-aware (0295),
    -- PRIMARIES only (0289) — over ALL history, windowed columns derived below.
    SELECT
        w.asset_id,
        COALESCE(w.malfunction_start, w.closed_at, w.created_at)          AS event_at,
        COALESCE(w.actual_downtime_hrs, w.actual_duration_hrs)            AS repair_hrs
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
    COALESCE(col.collateral_12mo, 0)              AS collateral_12mo,
    -- Lifetime columns (0298) — the fallback surfaces read when the trailing
    -- year is quiet but imported history is not.
    COALESCE(fail.failures_total, 0)              AS failures_total,
    fail.first_failure_at,
    fail.last_failure_at,
    CASE WHEN COALESCE(fail.failures_total, 0) >= 2
              AND fail.last_failure_at > fail.first_failure_at
         THEN ROUND((EXTRACT(EPOCH FROM (fail.last_failure_at - fail.first_failure_at)) / 3600.0
                     / (fail.failures_total - 1))::numeric, 1)
    END                                                                     AS mtbf_hours_lifetime,
    CASE WHEN COALESCE(fail.timed_repairs_total, 0) > 0
         THEN ROUND(fail.timed_downtime_hrs_total / fail.timed_repairs_total, 1)
    END                                                                     AS mttr_hours_lifetime
FROM public.assets a
LEFT JOIN fail ON fail.asset_id = a.id
LEFT JOIN collateral col ON col.asset_id = a.id;

GRANT SELECT ON public.sem_asset_reliability TO authenticated, service_role;

INSERT INTO public.semantic_catalog
  (object_name, column_name, title, description, tags, owner, source_tables, iso_standard)
VALUES
  ('sem_asset_reliability', 'failures_total', 'Failures (lifetime)',
   'Primary failure events over ALL recorded history — including imported CMMS history older than the 12-month KPI window. Read this (with first/last_failure_at and mtbf_hours_lifetime) when failures_12mo is 0 but history exists, so imported-history tenants are not shown blank scoreboards.',
   ARRAY['reliability','kpi','failures','lifetime'], 'Reliability Engineering',
   ARRAY['work_orders','wo_failure_data'], 'ISO 14224'),
  ('sem_asset_reliability', 'mtbf_hours_lifetime', 'MTBF hours (lifetime)',
   'Inter-arrival MTBF over all recorded failures (span between first and last event ÷ (n−1)), the same basis the client engine derives when the 12-month window is quiet. NULL below 2 failures.',
   ARRAY['reliability','kpi','mtbf','lifetime'], 'Reliability Engineering',
   ARRAY['work_orders','wo_failure_data'], 'ISO 14224')
ON CONFLICT (object_name, COALESCE(column_name, '·')) DO UPDATE
  SET description = EXCLUDED.description,
      tags        = EXCLUDED.tags,
      updated_at  = now();

-- ── 3. Sensor → condition-reading bridge ────────────────────────────────────
ALTER TABLE public.reading_definitions
    ADD COLUMN IF NOT EXISTS sensor_tag TEXT;

COMMENT ON COLUMN public.reading_definitions.sensor_tag IS
    'Links this condition-reading definition to a live sensor series (ers_sensor_reading_points.tag on the same asset). When set, ingest-readings mirrors the latest pushed value into reading_logs so meter-based PMs and reading alarms react to connector data. Matched case-insensitively; reading_type_code doubles as a zero-config fallback match.';

-- One definition per live series — a duplicate mapping would double-mirror.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reading_defs_sensor_tag
    ON public.reading_definitions (asset_id, lower(sensor_tag))
    WHERE sensor_tag IS NOT NULL;

COMMIT;

-- VERIFY (after apply):
--   SELECT count(*) FROM wo_failure_data WHERE upper(failure_mode_code) = 'UNKNOWN';  -- 0
--   SELECT failures_total, mtbf_hours_lifetime FROM sem_asset_reliability
--    WHERE failures_12mo = 0 AND failures_total > 0 LIMIT 5;  -- imported-history assets now visible
