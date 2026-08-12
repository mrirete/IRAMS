-- 0289: Secondary failures — "a failure can be caused by another failure"
--       (Systems-Thinking plan, Phase 1: docs/Systems-Thinking-Failure-Analysis-Plan.md)
--
-- ISO 14224 distinguishes PRIMARY failures (the item's own) from SECONDARY
-- failures (caused directly or indirectly by the failure of another item —
-- collateral damage). Until now every failure was recorded as primary, which
-- quietly corrupted the victim's record: a compressor bearing wrecked by a
-- cooling-water failure dragged down the COMPRESSOR's MTBF while the true
-- initiator hid.
--
--   secondary_failure  NULL  = never asked (legacy rows)
--                      false = asked, primary (the asset's own failure)
--                      true  = collateral of another failure
--   caused_by_wo_id    the initiating failure's work order (SET NULL if that
--                      WO is ever deleted; the boolean keeps the record honest)
--
-- sem_asset_reliability moves to primaries-only for its failure aggregates and
-- exposes collateral_12mo so nothing is silently dropped — cards read
-- "4 failures (+1 collateral)". The client engine (reliabilityMetrics.ts)
-- changes in lockstep in the same commit.
--
-- MIRROR NOTE (reliabilityMetrics.ts:42-45 contract): rpc_pareto_analysis and
-- the Python bad-actor analyzer still count collateral against the victim.
-- Acceptable short-term (they over-rank victims, never hide initiators); they
-- adopt the same exclusion in the Phase-2 "Trouble Makers" work, which is
-- where initiator-vs-victim ranking becomes a product surface.

ALTER TABLE public.wo_failure_data
    ADD COLUMN IF NOT EXISTS secondary_failure boolean,
    ADD COLUMN IF NOT EXISTS caused_by_wo_id   uuid REFERENCES public.work_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS wo_failure_data_caused_by_idx
    ON public.wo_failure_data (caused_by_wo_id)
    WHERE caused_by_wo_id IS NOT NULL;

COMMENT ON COLUMN public.wo_failure_data.secondary_failure
    IS 'ISO 14224 primary/secondary: true = collateral damage from another failure; false = the asset''s own (primary) failure; NULL = question never answered (legacy).';
COMMENT ON COLUMN public.wo_failure_data.caused_by_wo_id
    IS 'The initiating failure''s work order, when this record is collateral (secondary_failure = true).';

-- ── sem_asset_reliability v3: primaries only + visible collateral count ────
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
    -- Canonical isFailure (reliabilityMetrics.ts), PRIMARIES only (0289):
    -- collateral events are not the victim asset's own reliability.
    WHERE upper(COALESCE(w.type, '')) !~ '(PREVENT|PREDICT|INSPECT|SCHEDUL|\mPM\M|\mPDM\M)'
      AND (
            upper(COALESCE(w.type, '')) ~ '(CORRECT|BREAK|EMERG|REPAIR|\mCM\M|\mEM\M)'
            OR fd.failure_mode_code IS NOT NULL
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

-- ── Catalog ─────────────────────────────────────────────────────────────────
INSERT INTO public.semantic_catalog
  (object_name, column_name, title, description, tags, owner, source_tables, iso_standard)
VALUES
  ('wo_failure_data', 'secondary_failure', 'Secondary Failure (collateral)',
   'ISO 14224 primary/secondary distinction: true = this failure was collateral damage caused by another failure (see caused_by_wo_id). Secondary failures are excluded from the victim asset''s MTBF/failure counts (shown separately as collateral) — they belong on the INITIATOR''s account. NULL = the question was never answered.',
   ARRAY['work_management','reliability','iso14224','systems'], 'Reliability Engineering',
   ARRAY['wo_failure_data','work_orders'], 'ISO 14224'),
  ('sem_asset_reliability', 'collateral_12mo', 'Collateral events (12mo)',
   'Failures on this asset in the window that were marked as collateral of another failure. Kept out of failures_12mo/MTBF (not the asset''s own reliability) but always shown — never silently dropped.',
   ARRAY['reliability','kpi','systems'], NULL, ARRAY['work_orders','wo_failure_data'], 'ISO 14224')
ON CONFLICT DO NOTHING;
