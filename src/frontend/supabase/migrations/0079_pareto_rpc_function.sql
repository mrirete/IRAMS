-- ============================================================================
-- Migration 0079: Pareto Analysis RPC Function
-- 
-- Creates a PostgreSQL function that aggregates live Work Order data
-- (cost, downtime, frequency) with recursive hierarchy roll-up for
-- ISO 14224 asset taxonomy (Site → Unit → System → Equipment → Component).
--
-- Also adds actual_downtime_hrs to work_orders for future use.
-- ============================================================================

-- 1. Add actual_downtime_hrs column to work_orders (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'work_orders'
      AND column_name = 'actual_downtime_hrs'
  ) THEN
    ALTER TABLE public.work_orders
      ADD COLUMN actual_downtime_hrs NUMERIC DEFAULT NULL;
    COMMENT ON COLUMN public.work_orders.actual_downtime_hrs
      IS 'Actual equipment downtime in hours recorded at WO close. Used by Pareto analysis.';
  END IF;
END $$;

-- 2. Create the Pareto Analysis RPC function
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
DECLARE
  v_grand_total NUMERIC;
BEGIN
  -- ──────────────────────────────────────────────────────────
  -- Step 1: Identify in-scope assets via recursive CTE
  --         If p_parent_asset_id is NULL → entire plant
  --         Otherwise → all descendants of that parent
  -- ──────────────────────────────────────────────────────────

  RETURN QUERY
  WITH RECURSIVE asset_tree AS (
    -- Base: direct children of parent (or all top-level if NULL)
    SELECT
      a.id,
      a.tag,
      a.name,
      a.hierarchy_level AS hlevel,
      a.criticality AS crit,
      a.parent_id,
      -- The "roll-up target": the nearest ancestor at the requested level
      -- If this asset IS at the requested level, it rolls up to itself
      CASE
        WHEN a.hierarchy_level = p_hierarchy_level THEN a.id
        ELSE NULL::UUID
      END AS rollup_id
    FROM public.assets a
    WHERE
      CASE
        WHEN p_parent_asset_id IS NULL THEN a.parent_id IS NULL
        ELSE a.parent_id = p_parent_asset_id
      END

    UNION ALL

    -- Recurse into children
    SELECT
      c.id,
      c.tag,
      c.name,
      c.hierarchy_level,
      c.criticality,
      c.parent_id,
      -- Inherit roll-up target from parent, or set if at requested level
      CASE
        WHEN c.hierarchy_level = p_hierarchy_level THEN c.id
        ELSE at.rollup_id
      END
    FROM public.assets c
    JOIN asset_tree at ON c.parent_id = at.id
  ),

  -- If parent is at the target level, include it too
  parent_self AS (
    SELECT
      a.id,
      a.tag,
      a.name,
      a.hierarchy_level AS hlevel,
      a.criticality AS crit,
      a.parent_id,
      CASE
        WHEN a.hierarchy_level = p_hierarchy_level THEN a.id
        ELSE NULL::UUID
      END AS rollup_id
    FROM public.assets a
    WHERE p_parent_asset_id IS NOT NULL
      AND a.id = p_parent_asset_id
  ),

  -- Combined tree: descendants + parent itself
  full_tree AS (
    SELECT * FROM asset_tree
    UNION ALL
    SELECT * FROM parent_self
  ),

  -- All leaf-level asset IDs with their roll-up target
  scope AS (
    SELECT
      ft.id AS leaf_id,
      COALESCE(ft.rollup_id, ft.id) AS target_id
    FROM full_tree ft
    WHERE ft.rollup_id IS NOT NULL
       OR ft.hlevel = p_hierarchy_level
  ),

  -- ──────────────────────────────────────────────────────────
  -- Step 2: Aggregate WO metrics per target asset
  -- ──────────────────────────────────────────────────────────
  wo_filtered AS (
    SELECT
      wo.id AS wo_id,
      wo.asset_id,
      wo.type AS wo_type,
      wo.est_duration,
      wo.actual_downtime_hrs
    FROM public.work_orders wo
    WHERE wo.status IN ('CLOSED', 'TECO')
      AND wo.type = ANY(p_wo_types)
      AND wo.created_at >= p_date_from
      AND wo.created_at <= p_date_to
      AND wo.asset_id IN (SELECT leaf_id FROM scope)
  ),

  -- Cost: labor + parts per WO
  wo_costs AS (
    SELECT
      wf.wo_id,
      wf.asset_id,
      COALESCE(lab.labor_total, 0) + COALESCE(prt.parts_total, 0) AS total_cost
    FROM wo_filtered wf
    LEFT JOIN LATERAL (
      SELECT SUM(wl.hours_worked * wl.rate_per_hour) AS labor_total
      FROM public.work_order_labor wl
      WHERE wl.wo_id = wf.wo_id
    ) lab ON true
    LEFT JOIN LATERAL (
      SELECT SUM(wp.quantity * wp.unit_cost) AS parts_total
      FROM public.work_order_parts wp
      WHERE wp.wo_id = wf.wo_id
    ) prt ON true
  ),

  -- Aggregate by target asset
  agg AS (
    SELECT
      s.target_id,
      CASE p_criteria
        WHEN 'cost'         THEN COALESCE(SUM(wc.total_cost), 0)
        WHEN 'downtime'     THEN COALESCE(SUM(
                                   COALESCE(wf.actual_downtime_hrs, wf.est_duration, 0)
                                 ), 0)
        WHEN 'wo_frequency' THEN COUNT(wf.wo_id)::NUMERIC
        ELSE 0
      END AS metric_val,
      COUNT(wf.wo_id) AS evt_count
    FROM scope s
    LEFT JOIN wo_filtered wf ON wf.asset_id = s.leaf_id
    LEFT JOIN wo_costs wc ON wc.wo_id = wf.wo_id
    GROUP BY s.target_id
  ),

  -- ──────────────────────────────────────────────────────────
  -- Step 3: Rank and compute Pareto percentages
  -- ──────────────────────────────────────────────────────────
  ranked AS (
    SELECT
      a2.id        AS asset_id,
      a2.tag       AS asset_tag,
      a2.name      AS asset_name,
      a2.hierarchy_level::TEXT AS hierarchy_level,
      a2.criticality::TEXT    AS criticality,
      COALESCE(agg.metric_val, 0)  AS metric_value,
      CASE p_criteria
        WHEN 'cost'         THEN '$'
        WHEN 'downtime'     THEN 'hrs'
        WHEN 'wo_frequency' THEN 'WOs'
        ELSE ''
      END AS metric_unit,
      COALESCE(agg.evt_count, 0)   AS event_count,
      ROW_NUMBER() OVER (ORDER BY COALESCE(agg.metric_val, 0) DESC) AS rank
    FROM agg
    JOIN public.assets a2 ON a2.id = agg.target_id
    WHERE COALESCE(agg.metric_val, 0) > 0
  ),

  grand AS (
    SELECT SUM(metric_value) AS total FROM ranked
  ),

  final AS (
    SELECT
      r.asset_id,
      r.asset_tag,
      r.asset_name,
      r.hierarchy_level,
      r.criticality,
      ROUND(r.metric_value, 2) AS metric_value,
      r.metric_unit,
      r.event_count,
      CASE WHEN g.total > 0
        THEN ROUND((r.metric_value / g.total) * 100, 1)
        ELSE 0
      END AS pct_of_total,
      CASE WHEN g.total > 0
        THEN ROUND(
          (SUM(r.metric_value) OVER (ORDER BY r.rank)) / g.total * 100,
          1
        )
        ELSE 0
      END AS cumulative_pct,
      r.rank
    FROM ranked r
    CROSS JOIN grand g
    ORDER BY r.rank
    LIMIT p_limit
  )

  SELECT
    f.asset_id,
    f.asset_tag,
    f.asset_name,
    f.hierarchy_level,
    f.criticality,
    f.metric_value,
    f.metric_unit,
    f.event_count,
    f.pct_of_total,
    f.cumulative_pct,
    f.rank
  FROM final f;

END;
$fn$;

-- Grant access
GRANT EXECUTE ON FUNCTION public.rpc_pareto_analysis TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_pareto_analysis TO anon;

COMMENT ON FUNCTION public.rpc_pareto_analysis IS
  'Pareto Bad Actor Analysis — aggregates WO cost/downtime/frequency with recursive hierarchy roll-up. ISO 55000 compliant.';
