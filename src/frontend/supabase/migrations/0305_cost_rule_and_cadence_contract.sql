-- ============================================================================
-- 0305 — One cost rule + the EAM↔Reliability cadence contract
--
-- (1) sem_asset_lifecycle_cost undercounted: its cost CASE trusted the
--     cost_frozen FLAG, but imported work orders carry real frozen
--     labor/material VALUES with the flag unset — so $122,275 of settled
--     12-month cost read as $875 on the Assets dashboard while Reports
--     (value-based woCost) showed the full figure. Two engines, two answers.
--     The view now uses the same value-based rule as Reports and
--     assessmentEngine/AnalyzeService:
--         frozen labor+material  ||  frozen_total_cost  ||  total_actual_cost
--     A set flag with zero components still reads 0 via the fallbacks only
--     when every component is absent — matching woCost exactly.
--
-- (2) Cadence contract (the PM-31048 class of bug, made impossible):
--     a TIME schedule must carry a calendar unit (Days/Weeks/Months/Years);
--     running-meter cadences belong to READING schedules. Enforced at the
--     database so NO writer — UI, agent, import, sync API — can create a
--     schedule the calendar Autopilot (0304) can never serve. Added NOT VALID
--     then validated in a guarded block: dirty legacy rows on some tenant
--     would leave the constraint NOT VALID (new writes still enforced)
--     instead of failing the migration.
-- ============================================================================

BEGIN;

CREATE OR REPLACE VIEW public.sem_asset_lifecycle_cost
WITH (security_invoker = true) AS
WITH wo AS (
    SELECT
        w.asset_id,
        -- Canonical WO cost — VALUE-based, identical to Reports' woCost:
        -- frozen labor+material || frozen_total_cost || total_actual_cost.
        -- (0301 gated on the cost_frozen flag; imported WOs carry values
        -- without the flag and silently summed to zero.)
        COALESCE(
            NULLIF(COALESCE(w.frozen_labor_cost, 0) + COALESCE(w.frozen_material_cost, 0), 0),
            NULLIF(w.frozen_total_cost, 0),
            w.total_actual_cost,
            0
        )                                                                 AS cost,
        COALESCE(w.malfunction_start, w.closed_at, w.created_at)          AS event_at,
        -- Canonical isFailure (0295) marks the row's downtime as UNPLANNED.
        CASE WHEN (
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
             THEN COALESCE(w.actual_downtime_hrs, 0) ELSE 0
        END                                                               AS unplanned_downtime_hrs
    FROM public.work_orders w
    LEFT JOIN public.wo_failure_data fd ON fd.wo_id = w.id
    WHERE w.asset_id IS NOT NULL
),
agg AS (
    SELECT
        asset_id,
        count(*)                                                          AS wo_count_lifetime,
        min(event_at)                                                     AS first_event_at,
        ROUND(SUM(cost))                                                  AS maint_cost_lifetime,
        ROUND(SUM(cost) FILTER (WHERE event_at >= now() - interval '365 days'))
                                                                          AS maint_cost_12mo,
        ROUND(SUM(cost) FILTER (WHERE event_at >= now() - interval '730 days'
                                  AND event_at <  now() - interval '365 days'))
                                                                          AS maint_cost_prior12,
        ROUND(SUM(unplanned_downtime_hrs)::numeric, 1)                    AS unplanned_downtime_hrs_lifetime,
        ROUND(SUM(unplanned_downtime_hrs) FILTER (WHERE event_at >= now() - interval '365 days')::numeric, 1)
                                                                          AS unplanned_downtime_hrs_12mo
    FROM wo
    GROUP BY asset_id
)
SELECT
    a.id                                    AS asset_id,
    a.tag                                   AS asset_tag,
    a.name                                  AS asset_name,
    a.criticality::text                     AS criticality,
    COALESCE(agg.wo_count_lifetime, 0)      AS wo_count_lifetime,
    agg.first_event_at,
    COALESCE(agg.maint_cost_lifetime, 0)    AS maint_cost_lifetime,
    COALESCE(agg.maint_cost_12mo, 0)        AS maint_cost_12mo,
    COALESCE(agg.maint_cost_prior12, 0)     AS maint_cost_prior12,
    COALESCE(agg.unplanned_downtime_hrs_12mo, 0)      AS unplanned_downtime_hrs_12mo,
    COALESCE(agg.unplanned_downtime_hrs_lifetime, 0)  AS unplanned_downtime_hrs_lifetime,
    af.acquisition_cost,
    af.acquisition_date,
    af.useful_life_months,
    af.replacement_value,
    af.downtime_cost_per_hour               AS asset_downtime_rate
FROM public.assets a
LEFT JOIN agg ON agg.asset_id = a.id
LEFT JOIN public.asset_financials af ON af.asset_id = a.id;

GRANT SELECT ON public.sem_asset_lifecycle_cost TO authenticated, service_role;

UPDATE public.semantic_catalog
SET description = 'Per-asset total-cost-of-ownership basis: maintenance spend over 12mo / prior-12mo / lifetime using the ONE value-based cost rule shared with Reports (frozen labor+material || frozen_total_cost || total_actual_cost — 0305), unplanned downtime hours (canonical failure predicate), and the financial identity from asset_financials. Downtime is monetized CLIENT-SIDE via the asset→company rate fallback and always labelled with the rate used. Screening input for the renewal queue — candidates earn a What-If study, the view issues no verdicts.',
    updated_at = now()
WHERE object_name = 'sem_asset_lifecycle_cost' AND column_name IS NULL;

-- ── (2) Cadence contract ────────────────────────────────────────────────────
ALTER TABLE public.recurring_work DROP CONSTRAINT IF EXISTS chk_time_pm_calendar_unit;
ALTER TABLE public.recurring_work ADD CONSTRAINT chk_time_pm_calendar_unit
CHECK (
    upper(COALESCE(schedule_type, 'TIME')) <> 'TIME'
    OR upper(COALESCE(frequency_unit, '')) IN ('DAYS', 'WEEKS', 'MONTHS', 'YEARS')
) NOT VALID;

COMMENT ON CONSTRAINT chk_time_pm_calendar_unit ON public.recurring_work IS
    '0305: a TIME schedule must have a calendar unit the 0304 Autopilot can serve; meter cadences (Hours/KM/Cycles/Starts) belong to READING schedules. The DB-level half of the EAM↔Reliability handoff contract (builder: eam/lib/pmStrategy.ts).';

DO $$
BEGIN
    ALTER TABLE public.recurring_work VALIDATE CONSTRAINT chk_time_pm_calendar_unit;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '0305: legacy recurring_work rows violate the TIME→calendar-unit contract; constraint stays NOT VALID (new writes are still enforced). %', SQLERRM;
END $$;

COMMIT;

-- VERIFY (after apply):
--   SELECT SUM(maint_cost_12mo) FROM sem_asset_lifecycle_cost;   -- expect ~122275, not 875
--   INSERT INTO recurring_work (..., schedule_type, frequency_unit) VALUES (..., 'TIME', 'Hours');  -- expect 23514 check violation
