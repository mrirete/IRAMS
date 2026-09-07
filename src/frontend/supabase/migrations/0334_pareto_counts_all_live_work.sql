-- 0334 — Bad-actor Pareto: count every non-cancelled work order, cost the settled ones by
-- their frozen figures.
--
-- rpc_pareto_analysis counted only CLOSED/TECO orders and priced them from labour and parts
-- lines. P-101-A had four corrective orders in twelve months and the Pareto saw one, because
-- three were still open and none had lines — an asset failing every quarter did not rank as a
-- bad actor. A bad actor is an asset that keeps generating work; whether the paperwork has been
-- closed is a different question.
--
--   * scope: every order that is not cancelled (open work is still work);
--   * cost: frozen labour + material when the order was settled (0283 freezes at CLOSED),
--     else labour lines + parts lines, else total_actual_cost;
--   * the rest of the function is unchanged.
BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_pareto_analysis(p_parent_asset_id uuid DEFAULT NULL::uuid, p_hierarchy_level text DEFAULT 'EQUIPMENT'::text, p_criteria text DEFAULT 'cost'::text, p_date_from timestamp with time zone DEFAULT (now() - '1 year'::interval), p_date_to timestamp with time zone DEFAULT now(), p_wo_types text[] DEFAULT ARRAY['CM'::text, 'PM'::text], p_limit integer DEFAULT 20)
 RETURNS TABLE(asset_id uuid, asset_tag text, asset_name text, hierarchy_level text, criticality text, metric_value numeric, metric_unit text, event_count bigint, pct_of_total numeric, cumulative_pct numeric, rank bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
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
      -- 0334: settled orders carry frozen figures; use them first.
      (COALESCE(wo.frozen_labor_cost, 0) + COALESCE(wo.frozen_material_cost, 0)) AS frozen_cost,
      wo.total_actual_cost,
      -- 0290: collateral events (secondary failures, 0289) are excluded from
      -- failure COUNTS; cost/downtime keep them (incurred at the asset).
      COALESCE(fd.secondary_failure, FALSE) AS is_secondary
    FROM public.work_orders wo
    LEFT JOIN public.wo_failure_data fd ON fd.wo_id = wo.id
    -- 0334: every live order counts, not only the closed ones.
    WHERE upper(wo.status::text) NOT IN ('CANCELLED', 'CANCELED', 'CANC')
      AND wo.type = ANY(p_wo_types)
      AND wo.created_at >= p_date_from
      AND wo.created_at <= p_date_to
      AND wo.asset_id IN (SELECT leaf_id FROM scope)
  ),
  wo_costs AS (
    SELECT
      wf.wo_id,
      wf.asset_id,
      CASE
        WHEN wf.frozen_cost > 0 THEN wf.frozen_cost
        WHEN COALESCE(lab.labor_total, 0) + COALESCE(prt.parts_total, 0) > 0
          THEN COALESCE(lab.labor_total, 0) + COALESCE(prt.parts_total, 0)
        ELSE COALESCE(wf.total_actual_cost, 0)
      END AS total_cost
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
$function$;

COMMIT;
