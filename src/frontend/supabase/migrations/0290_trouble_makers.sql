-- 0290: Trouble Makers — cascade-initiator ranking (Systems-Thinking Phase 2)
--
-- Phase 1 (0289) let users record that a failure was COLLATERAL of another
-- failure. This makes the initiators visible: which asset causes damage
-- BEYOND itself. "Cooling water pump: 1 failure → 3 collateral events, 41h,
-- $84k" is a truer bad-actor ranking than per-asset counts, because the
-- per-asset view charges the victims and hides the cause.
--
-- Also pays the 0289 mirror debt on rpc_pareto_analysis: its wo_frequency
-- criterion now excludes collateral events (failure-COUNT semantics follow
-- the canonical rule; cost/downtime criteria still measure what was incurred
-- AT the asset — spend semantics — and deliberately keep collateral, since
-- excluding it would understate the victim without attributing anything).
-- The Python bad-actor analyzer consumes pre-aggregated data, so it inherits
-- whichever aggregator feeds it; its contract docstring is updated in the
-- same commit.

-- ── 1. sem_cascade_initiators ───────────────────────────────────────────────
CREATE OR REPLACE VIEW public.sem_cascade_initiators
WITH (security_invoker = true) AS
WITH links AS (
    -- victim failure record → initiating WO → initiating asset
    SELECT
        iw.asset_id AS initiator_asset_id,
        fd.wo_id    AS victim_wo_id,
        vw.asset_id AS victim_asset_id,
        COALESCE(vw.actual_downtime_hrs, vw.actual_duration_hrs, 0)                    AS victim_downtime_hrs,
        CASE WHEN COALESCE(vw.frozen_labor_cost, 0) + COALESCE(vw.frozen_material_cost, 0) > 0
             THEN COALESCE(vw.frozen_labor_cost, 0) + COALESCE(vw.frozen_material_cost, 0)
             ELSE COALESCE(vw.total_actual_cost, 0)
        END                                                                             AS victim_cost
    FROM public.wo_failure_data fd
    JOIN public.work_orders vw ON vw.id = fd.wo_id
    JOIN public.work_orders iw ON iw.id = fd.caused_by_wo_id
    WHERE fd.secondary_failure IS TRUE
      AND fd.caused_by_wo_id IS NOT NULL
      AND COALESCE(vw.malfunction_start, vw.closed_at, vw.created_at) >= now() - interval '365 days'
)
SELECT
    a.id                                        AS asset_id,
    a.tag                                       AS asset_tag,
    a.name                                      AS asset_name,
    a.criticality::text                         AS criticality,
    count(l.victim_wo_id)                       AS collateral_events_12mo,
    count(DISTINCT l.victim_asset_id)           AS victim_assets,
    ROUND(SUM(l.victim_downtime_hrs), 1)        AS collateral_downtime_hrs_12mo,
    ROUND(SUM(l.victim_cost), 2)                AS collateral_cost_12mo,
    COALESCE(r.failures_12mo, 0)                AS own_failures_12mo,
    COALESCE(r.downtime_hrs_12mo, 0)            AS own_downtime_hrs_12mo
FROM links l
JOIN public.assets a ON a.id = l.initiator_asset_id
LEFT JOIN public.sem_asset_reliability r ON r.asset_id = a.id
GROUP BY a.id, a.tag, a.name, a.criticality, r.failures_12mo, r.downtime_hrs_12mo;

GRANT SELECT ON public.sem_cascade_initiators TO authenticated, service_role;

-- ── 2. rpc_pareto_analysis: failure counts exclude collateral ───────────────
-- Only the wo_filtered CTE and the wo_frequency branch change; everything else
-- is 0079 verbatim.
CREATE OR REPLACE FUNCTION public.rpc_pareto_analysis(
  p_parent_asset_id  UUID     DEFAULT NULL,
  p_hierarchy_level  TEXT     DEFAULT 'EQUIPMENT',
  p_criteria         TEXT     DEFAULT 'cost',
  p_date_from        TIMESTAMPTZ DEFAULT (NOW() - INTERVAL '12 months'),
  p_date_to          TIMESTAMPTZ DEFAULT NOW(),
  p_wo_types         TEXT[]   DEFAULT ARRAY['CM','PM'],
  p_limit            INT      DEFAULT 20
)
RETURNS TABLE (
  asset_id        UUID,
  asset_tag       TEXT,
  asset_name      TEXT,
  hierarchy_level TEXT,
  criticality     TEXT,
  metric_value    NUMERIC,
  metric_unit     TEXT,
  event_count     BIGINT,
  pct_of_total    NUMERIC,
  cumulative_pct  NUMERIC,
  rank            BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $fn$
BEGIN
  RETURN QUERY
  WITH RECURSIVE asset_tree AS (
    SELECT
      a.id, a.tag, a.name,
      a.hierarchy_level AS hlevel,
      a.criticality AS crit,
      a.parent_id,
      CASE WHEN a.hierarchy_level = p_hierarchy_level THEN a.id ELSE NULL::UUID END AS rollup_id
    FROM public.assets a
    WHERE CASE WHEN p_parent_asset_id IS NULL THEN a.parent_id IS NULL
               ELSE a.parent_id = p_parent_asset_id END
    UNION ALL
    SELECT
      c.id, c.tag, c.name, c.hierarchy_level, c.criticality, c.parent_id,
      CASE WHEN c.hierarchy_level = p_hierarchy_level THEN c.id ELSE at.rollup_id END
    FROM public.assets c
    JOIN asset_tree at ON c.parent_id = at.id
  ),
  parent_self AS (
    SELECT
      a.id, a.tag, a.name,
      a.hierarchy_level AS hlevel,
      a.criticality AS crit,
      a.parent_id,
      CASE WHEN a.hierarchy_level = p_hierarchy_level THEN a.id ELSE NULL::UUID END AS rollup_id
    FROM public.assets a
    WHERE p_parent_asset_id IS NOT NULL AND a.id = p_parent_asset_id
  ),
  full_tree AS (
    SELECT * FROM asset_tree
    UNION ALL
    SELECT * FROM parent_self
  ),
  scope AS (
    SELECT ft.id AS leaf_id, COALESCE(ft.rollup_id, ft.id) AS target_id
    FROM full_tree ft
    WHERE ft.rollup_id IS NOT NULL OR ft.hlevel = p_hierarchy_level
  ),
  wo_filtered AS (
    SELECT
      wo.id AS wo_id,
      wo.asset_id,
      wo.type AS wo_type,
      wo.est_duration,
      wo.actual_downtime_hrs,
      -- 0290: collateral events (secondary failures, 0289) are excluded from
      -- failure COUNTS; cost/downtime keep them (incurred at the asset).
      COALESCE(fd.secondary_failure, FALSE) AS is_secondary
    FROM public.work_orders wo
    LEFT JOIN public.wo_failure_data fd ON fd.wo_id = wo.id
    WHERE wo.status IN ('CLOSED', 'TECO')
      AND wo.type = ANY(p_wo_types)
      AND wo.created_at >= p_date_from
      AND wo.created_at <= p_date_to
      AND wo.asset_id IN (SELECT leaf_id FROM scope)
  ),
  wo_costs AS (
    SELECT
      wf.wo_id,
      wf.asset_id,
      COALESCE(lab.labor_total, 0) + COALESCE(prt.parts_total, 0) AS total_cost
    FROM wo_filtered wf
    LEFT JOIN LATERAL (
      SELECT SUM(wl.hours_worked * wl.rate_per_hour) AS labor_total
      FROM public.work_order_labor wl WHERE wl.wo_id = wf.wo_id
    ) lab ON true
    LEFT JOIN LATERAL (
      SELECT SUM(wp.quantity * wp.unit_cost) AS parts_total
      FROM public.work_order_parts wp WHERE wp.wo_id = wf.wo_id
    ) prt ON true
  ),
  agg AS (
    SELECT
      s.target_id,
      CASE p_criteria
        WHEN 'cost'         THEN COALESCE(SUM(wc.total_cost), 0)
        WHEN 'downtime'     THEN COALESCE(SUM(COALESCE(wf.actual_downtime_hrs, wf.est_duration, 0)), 0)
        WHEN 'wo_frequency' THEN (COUNT(wf.wo_id) FILTER (WHERE NOT wf.is_secondary))::NUMERIC
        ELSE 0
      END AS metric_val,
      COUNT(wf.wo_id) AS evt_count
    FROM scope s
    LEFT JOIN wo_filtered wf ON wf.asset_id = s.leaf_id
    LEFT JOIN wo_costs wc ON wc.wo_id = wf.wo_id
    GROUP BY s.target_id
  ),
  ranked AS (
    SELECT
      a2.id        AS r_asset_id,
      a2.tag       AS r_asset_tag,
      a2.name      AS r_asset_name,
      a2.hierarchy_level::TEXT AS r_hierarchy_level,
      a2.criticality::TEXT     AS r_criticality,
      COALESCE(agg.metric_val, 0)  AS r_metric_value,
      CASE p_criteria
        WHEN 'cost'         THEN '$'
        WHEN 'downtime'     THEN 'hrs'
        WHEN 'wo_frequency' THEN 'WOs'
        ELSE ''
      END AS r_metric_unit,
      COALESCE(agg.evt_count, 0)   AS r_event_count,
      ROW_NUMBER() OVER (ORDER BY COALESCE(agg.metric_val, 0) DESC) AS r_rank
    FROM agg
    JOIN public.assets a2 ON a2.id = agg.target_id
    WHERE COALESCE(agg.metric_val, 0) > 0
  ),
  grand AS (
    SELECT SUM(r_metric_value) AS total FROM ranked
  )
  SELECT
    r.r_asset_id,
    r.r_asset_tag,
    r.r_asset_name,
    r.r_hierarchy_level,
    r.r_criticality,
    ROUND(r.r_metric_value, 2),
    r.r_metric_unit,
    r.r_event_count,
    CASE WHEN g.total > 0 THEN ROUND((r.r_metric_value / g.total) * 100, 1) ELSE 0 END,
    CASE WHEN g.total > 0
      THEN ROUND((SUM(r.r_metric_value) OVER (ORDER BY r.r_rank)) / g.total * 100, 1)
      ELSE 0 END,
    r.r_rank
  FROM ranked r
  CROSS JOIN grand g
  ORDER BY r.r_rank
  LIMIT p_limit;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.rpc_pareto_analysis TO authenticated;

COMMENT ON FUNCTION public.rpc_pareto_analysis IS
  'Pareto Bad Actor Analysis — WO cost/downtime/frequency with recursive hierarchy roll-up. wo_frequency excludes collateral (secondary) failures per 0289/0290; cost & downtime measure what was incurred at the asset and include them.';

-- ── 3. Catalog ──────────────────────────────────────────────────────────────
INSERT INTO public.semantic_catalog
  (object_name, column_name, title, description, tags, owner, source_tables, iso_standard)
VALUES
  ('sem_cascade_initiators', NULL, 'Trouble Makers (cascade initiators)',
   'Assets whose failures caused collateral damage on OTHER assets (12-month window, from secondary-failure links). Ranks by damage caused beyond the asset itself — collateral events, distinct victim assets, victim downtime and victim cost — alongside the initiator''s own failure record. A truer bad-actor ranking than per-asset counts, which charge the victims and hide the cause.',
   ARRAY['reliability','kpi','systems','canonical'], 'Reliability Engineering',
   ARRAY['wo_failure_data','work_orders','assets','sem_asset_reliability'], 'ISO 14224')
ON CONFLICT DO NOTHING;
