-- ============================================================================
-- 0301 — sem_asset_lifecycle_cost: the asset manager's native unit of thought
--         (RF-01 item 5 — ISO 55000 lifecycle principle, made visible)
--
-- One row per asset answering "what has this asset truly cost, trending how":
--   • maintenance spend — frozen costs first (the settlement basis, 0284),
--     total_actual_cost fallback — trailing 12mo, the 12mo before that
--     (trend), and lifetime;
--   • unplanned downtime hours (canonical breakdown-aware failure predicate,
--     0295) — 12mo and lifetime. MONETIZATION IS DELIBERATELY CLIENT-SIDE:
--     the effective rate is asset_financials.downtime_cost_per_hour falling
--     back to companies.downtime_cost_per_hour, and every money figure must
--     be labelled with the rate it used (lib/downtimeCost.ts owns that);
--   • the financial identity — acquisition cost/date, useful life,
--     replacement value — from asset_financials where it exists.
--
-- Feeds the Lifecycle Cost card (asset Financials tab) and the renewal
-- queue (lib/renewal.ts) — which treats these as SCREENING inputs, never
-- verdicts.
-- ============================================================================

BEGIN;

CREATE OR REPLACE VIEW public.sem_asset_lifecycle_cost
WITH (security_invoker = true) AS
WITH wo AS (
    SELECT
        w.asset_id,
        -- Canonical WO cost: frozen labor+material at financial close, else total actual.
        CASE WHEN w.cost_frozen
             THEN COALESCE(w.frozen_labor_cost, 0) + COALESCE(w.frozen_material_cost, 0)
             ELSE COALESCE(w.total_actual_cost, 0)
        END                                                               AS cost,
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

INSERT INTO public.semantic_catalog
  (object_name, column_name, title, description, tags, owner, source_tables, iso_standard)
VALUES
  ('sem_asset_lifecycle_cost', NULL, 'Asset Lifecycle Cost',
   'Per-asset total-cost-of-ownership basis: maintenance spend (frozen-cost basis) over 12mo / prior-12mo / lifetime, unplanned downtime hours (canonical failure predicate), and the financial identity from asset_financials (acquisition, useful life, replacement value). Downtime is monetized CLIENT-SIDE via the asset→company rate fallback and always labelled with the rate used. Screening input for the renewal queue — candidates earn a What-If study, the view issues no verdicts.',
   ARRAY['finance','lifecycle','tco','asset-management'], 'Asset Management',
   ARRAY['work_orders','wo_failure_data','assets','asset_financials'], 'ISO 55000')
ON CONFLICT (object_name, COALESCE(column_name, '·')) DO UPDATE
  SET description = EXCLUDED.description,
      tags        = EXCLUDED.tags,
      updated_at  = now();

COMMIT;

-- VERIFY (after apply):
--   SELECT asset_tag, maint_cost_12mo, maint_cost_prior12, unplanned_downtime_hrs_12mo,
--          acquisition_cost, replacement_value
--     FROM sem_asset_lifecycle_cost WHERE wo_count_lifetime > 0 ORDER BY maint_cost_12mo DESC LIMIT 5;
