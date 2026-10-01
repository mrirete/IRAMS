-- ════════════════════════════════════════════════════════════════════════════
-- 0396 — Budgets follow the tenant's fiscal year (P3a of the FinOps audit)
--
-- Admin › Settings has had "Fiscal Year Start" (companies.app_settings,
-- 0235) for months. Nothing in the database read it: every function that
-- turns a date into a budget year used EXTRACT(YEAR …), so a tenant whose
-- year starts in April saw January–March spend booked to the wrong budget,
-- and the PO budget check measured an order against the wrong year.
--
-- ── Convention ──────────────────────────────────────────────────────────────
-- A fiscal year is labelled by the calendar year it STARTS in: with an April
-- start, Apr 2026 – Mar 2027 is FY 2026 (shown as "FY 2026/27"). With the
-- default January start the label is the calendar year, so for every tenant
-- that never changed the setting this migration changes nothing — the
-- recompute at the end produces the same numbers.
--
-- ── What changes ────────────────────────────────────────────────────────────
--   ers_fiscal_start(company)        → 1..12 from app_settings, default 1
--   ers_fiscal_year(company, date)   → the fiscal-year label for a date
--   ers_refresh_budget_actual        → sums postings inside the fiscal year
--   ers_refresh_budget_committed     → open PO value inside the fiscal year
--   trg_po_refresh_committed         → refreshes the PO's fiscal year
--   sem_po_line_commitments          → fiscal_year column is fiscal
--   ers_po_budget_check              → fiscal year, AND measures against the
--       TOTAL budget (opex + capex). "actual" is the whole ledger for the
--       centre — it does not split OPEX from CAPEX — so comparing it with the
--       OPEX line alone made capital spend eat operating headroom (the same
--       mismatch P2 fixed in the app's own check). The JSON keeps
--       `opex_budget` for older clients and adds `budget` (the total).
-- Every budget row's actual and committed are recomputed at the end.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── helpers ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ers_fiscal_start(p_company uuid)
RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    -- Returns only a month number; DEFINER so the views and triggers that call
    -- it work whatever the caller may read of companies.
    SELECT LEAST(12, GREATEST(1, COALESCE(
               CASE WHEN (c.app_settings->>'fiscalYearStart') ~ '^\d{1,2}$'
                    THEN (c.app_settings->>'fiscalYearStart')::int END, 1)))
      FROM public.companies c WHERE c.id = p_company
    UNION ALL SELECT 1
    LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.ers_fiscal_start(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ers_fiscal_start(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.ers_fiscal_start(uuid) IS 'Fiscal-year start month (1-12) from companies.app_settings.fiscalYearStart; 1 when unset (0396).';

-- The rule itself, pure: testable without touching any tenant's settings.
CREATE OR REPLACE FUNCTION public.ers_fiscal_year_for(p_start_month int, p_date date)
RETURNS int
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN EXTRACT(MONTH FROM p_date)::int >= LEAST(12, GREATEST(1, COALESCE(p_start_month, 1)))
                THEN EXTRACT(YEAR FROM p_date)::int
                ELSE EXTRACT(YEAR FROM p_date)::int - 1 END
$$;
GRANT EXECUTE ON FUNCTION public.ers_fiscal_year_for(int, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ers_fiscal_year(p_company uuid, p_date date)
RETURNS int
LANGUAGE sql STABLE SET search_path = public AS $$
    SELECT public.ers_fiscal_year_for(public.ers_fiscal_start(p_company), p_date)
$$;
REVOKE ALL ON FUNCTION public.ers_fiscal_year(uuid, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ers_fiscal_year(uuid, date) TO authenticated, service_role;
COMMENT ON FUNCTION public.ers_fiscal_year(uuid, date) IS 'Fiscal-year label for a date: the calendar year the fiscal year starts in (0396).';

-- ── actual ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ers_refresh_budget_actual(
    p_cost_center_id UUID,
    p_fiscal_year    INT DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_year    INT;
    v_total   NUMERIC;
    v_company UUID;
    v_caller  UUID;
    v_from    DATE;
BEGIN
    IF p_cost_center_id IS NULL THEN RETURN NULL; END IF;

    SELECT cc.company_id INTO v_company FROM public.cost_centers cc WHERE cc.id = p_cost_center_id;
    BEGIN v_caller := public.caller_company(); EXCEPTION WHEN OTHERS THEN v_caller := NULL; END;
    IF v_caller IS NOT NULL AND v_company IS NOT NULL AND v_caller <> v_company THEN
        RAISE EXCEPTION 'ers_refresh_budget_actual: cost centre belongs to another tenant'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    v_year := COALESCE(p_fiscal_year, public.ers_fiscal_year(v_company, CURRENT_DATE));
    v_from := make_date(v_year, public.ers_fiscal_start(v_company), 1);

    -- A date range, not a function of the date, so the posting_date index applies.
    SELECT COALESCE(SUM(c.amount), 0) INTO v_total
    FROM public.cost_allocations c
    WHERE c.cost_center_id = p_cost_center_id
      AND COALESCE(c.posting_date, c.created_at::DATE) >= v_from
      AND COALESCE(c.posting_date, c.created_at::DATE) <  (v_from + INTERVAL '1 year')::DATE;

    UPDATE public.budgets
       SET actual = v_total, updated_at = NOW()
     WHERE cost_center_id = p_cost_center_id
       AND fiscal_year    = v_year;

    RETURN v_total;
END;
$$;

-- ── committed ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ers_refresh_budget_committed(p_company uuid, p_cost_center uuid, p_fiscal_year int)
RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v         numeric := 0;
    v_company uuid;
    v_caller  uuid;
BEGIN
    IF p_cost_center IS NULL OR p_fiscal_year IS NULL THEN RETURN 0; END IF;

    -- The tenant is the cost centre's, never the argument's (0261 rule, 0394).
    SELECT cc.company_id INTO v_company FROM public.cost_centers cc WHERE cc.id = p_cost_center;
    IF v_company IS NULL THEN RETURN 0; END IF;
    IF p_company IS NOT NULL AND p_company <> v_company THEN
        RAISE EXCEPTION 'ers_refresh_budget_committed: cost centre belongs to another tenant'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    BEGIN v_caller := public.caller_company(); EXCEPTION WHEN OTHERS THEN v_caller := NULL; END;
    IF v_caller IS NOT NULL AND v_caller <> v_company THEN
        RAISE EXCEPTION 'ers_refresh_budget_committed: cost centre belongs to another tenant'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT COALESCE(SUM(GREATEST(COALESCE(l.qty_ordered,0) - COALESCE(l.qty_received,0), 0) * COALESCE(l.unit_cost,0)), 0)
      INTO v
      FROM public.purchase_order_lines l
      JOIN public.purchase_orders po ON po.id = l.po_id
      LEFT JOIN public.sem_wo_receiver r ON r.work_order_id = l.work_order_id
     WHERE po.company_id = v_company
       AND po.status IN ('OPEN', 'PART_RECEIVED')
       AND COALESCE(l.cost_center_id, r.cost_center_id, po.cost_center_id) = p_cost_center
       AND public.ers_fiscal_year(v_company, COALESCE(po.date_created, po.created_at::date)) = p_fiscal_year;

    UPDATE public.budgets
       SET committed = ROUND(v, 2)
     WHERE company_id = v_company
       AND cost_center_id = p_cost_center
       AND fiscal_year = p_fiscal_year
       AND COALESCE(period, 'ANNUAL') IN ('ANNUAL', 'YEAR')
       AND committed IS DISTINCT FROM ROUND(v, 2);
    RETURN ROUND(v, 2);
END $$;
REVOKE ALL ON FUNCTION public.ers_refresh_budget_committed(uuid, uuid, int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ers_refresh_budget_committed(uuid, uuid, int) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.trg_po_refresh_committed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_po_id uuid;
    v_company uuid;
    v_date date;
    v_fy int;
    cc uuid;
BEGIN
    IF TG_TABLE_NAME = 'purchase_orders' THEN
        v_po_id := COALESCE(NEW.id, OLD.id);
    ELSE
        v_po_id := COALESCE(NEW.po_id, OLD.po_id);
    END IF;
    SELECT company_id, COALESCE(date_created, created_at::date)
      INTO v_company, v_date FROM public.purchase_orders WHERE id = v_po_id;
    IF v_company IS NULL THEN RETURN NULL; END IF;
    v_fy := public.ers_fiscal_year(v_company, v_date);

    FOR cc IN SELECT cost_center_id FROM public.ers_po_cost_centers(v_po_id) LOOP
        PERFORM public.ers_refresh_budget_committed(v_company, cc, v_fy);
    END LOOP;
    -- A header cost-centre change must also release the OLD centre.
    IF TG_TABLE_NAME = 'purchase_orders' AND TG_OP = 'UPDATE'
       AND OLD.cost_center_id IS DISTINCT FROM NEW.cost_center_id AND OLD.cost_center_id IS NOT NULL THEN
        PERFORM public.ers_refresh_budget_committed(v_company, OLD.cost_center_id, v_fy);
    END IF;
    IF TG_TABLE_NAME = 'purchase_order_lines' AND TG_OP = 'UPDATE'
       AND OLD.cost_center_id IS DISTINCT FROM NEW.cost_center_id AND OLD.cost_center_id IS NOT NULL THEN
        PERFORM public.ers_refresh_budget_committed(v_company, OLD.cost_center_id, v_fy);
    END IF;
    RETURN NULL;
END $$;

-- ── commitment view: fiscal_year is fiscal ──────────────────────────────────
CREATE OR REPLACE VIEW public.sem_po_line_commitments AS
SELECT l.id                                                        AS line_id,
       po.id                                                       AS po_id,
       po.company_id,
       po.po_code,
       po.status,
       public.ers_fiscal_year(po.company_id, COALESCE(po.date_created, po.created_at::date)) AS fiscal_year,
       COALESCE(l.cost_center_id, r.cost_center_id, po.cost_center_id)        AS cost_center_id,
       GREATEST(COALESCE(l.qty_ordered, 0) - COALESCE(l.qty_received, 0), 0)
         * COALESCE(l.unit_cost, 0)                                 AS open_value
  FROM public.purchase_order_lines l
  JOIN public.purchase_orders po ON po.id = l.po_id
  LEFT JOIN public.sem_wo_receiver r ON r.work_order_id = l.work_order_id
 WHERE po.status IN ('OPEN', 'PART_RECEIVED');
-- 0361 made both views security-invoker; restate it so a replace can never drop it.
ALTER VIEW public.sem_po_line_commitments SET (security_invoker = true);
ALTER VIEW public.sem_po_commitments      SET (security_invoker = true);

-- ── the PO budget check ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ers_po_budget_check(p_po uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE
    v_po      public.purchase_orders%ROWTYPE;
    v_fy      int;
    v_rows    jsonb := '[]'::jsonb;
    v_overall text := 'OK';
    v_total   numeric := 0;
    r         record;
BEGIN
    SELECT * INTO v_po FROM public.purchase_orders WHERE id = p_po;
    IF NOT FOUND THEN RAISE EXCEPTION 'purchase order % not found', p_po; END IF;
    -- Tenant guard: a caller may only check an order in their own company.
    IF v_po.company_id IS DISTINCT FROM public.caller_company() AND public.caller_company() IS NOT NULL THEN
        RAISE EXCEPTION 'purchase order % is not in your company', p_po;
    END IF;
    v_fy := public.ers_fiscal_year(v_po.company_id, COALESCE(v_po.date_created, v_po.created_at::date));

    FOR r IN
        WITH this AS (
            SELECT COALESCE(l.cost_center_id, wr.cost_center_id, v_po.cost_center_id) AS cost_center_id,
                   SUM(GREATEST(COALESCE(l.qty_ordered,0) - COALESCE(l.qty_received,0), 0) * COALESCE(l.unit_cost,0)) AS this_po
              FROM public.purchase_order_lines l
              LEFT JOIN public.sem_wo_receiver wr ON wr.work_order_id = l.work_order_id
             WHERE l.po_id = p_po
             GROUP BY 1
        ),
        others AS (
            SELECT COALESCE(l.cost_center_id, wr.cost_center_id, po.cost_center_id) AS cost_center_id,
                   SUM(GREATEST(COALESCE(l.qty_ordered,0) - COALESCE(l.qty_received,0), 0) * COALESCE(l.unit_cost,0)) AS committed_other
              FROM public.purchase_order_lines l
              JOIN public.purchase_orders po ON po.id = l.po_id
              LEFT JOIN public.sem_wo_receiver wr ON wr.work_order_id = l.work_order_id
             WHERE po.company_id = v_po.company_id AND po.id <> p_po
               AND po.status IN ('OPEN', 'PART_RECEIVED')
               AND public.ers_fiscal_year(po.company_id, COALESCE(po.date_created, po.created_at::date)) = v_fy
             GROUP BY 1
        )
        SELECT t.cost_center_id, cc.code, cc.name,
               t.this_po,
               COALESCE(o.committed_other, 0)       AS committed_other,
               b.id                                  AS budget_id,
               COALESCE(b.opex_budget, 0)            AS opex_budget,
               COALESCE(b.opex_budget, 0) + COALESCE(b.capex_budget, 0) AS budget_total,
               COALESCE(b.actual, 0)                 AS actual,
               b.currency,
               (SELECT MIN(bb.threshold_pct) FROM public.budget_blocks bb
                 WHERE bb.budget_id = b.id AND bb.active AND bb.block_type = 'HARD') AS hard_pct
          FROM this t
          LEFT JOIN public.cost_centers cc ON cc.id = t.cost_center_id
          LEFT JOIN others o ON o.cost_center_id = t.cost_center_id
          LEFT JOIN public.budgets b ON b.company_id = v_po.company_id AND b.cost_center_id = t.cost_center_id
                                     AND b.fiscal_year = v_fy AND COALESCE(b.period,'ANNUAL') IN ('ANNUAL','YEAR')
         ORDER BY t.this_po DESC
    LOOP
        DECLARE
            projected numeric := r.actual + r.committed_other + r.this_po;
            -- against the TOTAL budget: actual is not split OPEX/CAPEX (0396)
            pct       numeric := CASE WHEN r.budget_total > 0 THEN ROUND(100 * projected / r.budget_total, 1) END;
            st        text;
        BEGIN
            v_total := v_total + r.this_po;
            st := CASE
                    WHEN r.cost_center_id IS NULL THEN 'NO_COST_CENTER'
                    WHEN r.budget_id IS NULL OR r.budget_total <= 0 THEN 'NO_BUDGET'
                    WHEN r.hard_pct IS NOT NULL AND pct >= r.hard_pct THEN 'BLOCKED'
                    WHEN pct > 100 THEN 'EXCEEDED'
                    WHEN pct >= 90 THEN 'WARN'
                    ELSE 'OK' END;
            v_overall := CASE
                    WHEN 'BLOCKED' IN (v_overall, st) THEN 'BLOCKED'
                    WHEN 'EXCEEDED' IN (v_overall, st) THEN 'EXCEEDED'
                    WHEN 'WARN' IN (v_overall, st) THEN 'WARN'
                    WHEN 'NO_COST_CENTER' IN (v_overall, st) THEN 'NO_COST_CENTER'
                    WHEN 'NO_BUDGET' IN (v_overall, st) THEN 'NO_BUDGET'
                    ELSE 'OK' END;
            v_rows := v_rows || jsonb_build_object(
                'cost_center_id', r.cost_center_id, 'code', r.code, 'name', r.name,
                'fiscal_year', v_fy, 'currency', r.currency,
                'opex_budget', r.opex_budget, 'budget', r.budget_total, 'actual', r.actual,
                'committed_other', r.committed_other, 'this_po', ROUND(r.this_po, 2),
                'projected', ROUND(projected, 2), 'utilisation_pct', pct, 'status', st);
        END;
    END LOOP;

    RETURN jsonb_build_object(
        'po_id', p_po, 'po_code', v_po.po_code, 'fiscal_year', v_fy,
        'this_po_total', ROUND(v_total, 2), 'overall', v_overall,
        'requires_override', v_overall = 'EXCEEDED', 'blocked', v_overall = 'BLOCKED',
        'checked_at', now(), 'lines', v_rows);
END $$;
REVOKE ALL ON FUNCTION public.ers_po_budget_check(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ers_po_budget_check(uuid) TO authenticated, service_role;

-- ── recompute every budget row on the new rules ─────────────────────────────
-- Runs as the migration owner (no caller company), so the tenant guards pass.
DO $$
DECLARE b record; n int := 0;
BEGIN
    FOR b IN SELECT DISTINCT company_id, cost_center_id, fiscal_year FROM public.budgets WHERE cost_center_id IS NOT NULL LOOP
        PERFORM public.ers_refresh_budget_actual(b.cost_center_id, b.fiscal_year);
        PERFORM public.ers_refresh_budget_committed(b.company_id, b.cost_center_id, b.fiscal_year);
        n := n + 1;
    END LOOP;
    RAISE NOTICE '0396: % budget rows recomputed on fiscal-year rules', n;
END $$;

-- ── proof: a January start is the calendar year; an April start is not ─────
-- On the pure rule, so no tenant's settings (or the audit trail) are touched.
DO $$
BEGIN
    IF public.ers_fiscal_year_for(1, DATE '2026-02-15') <> 2026 THEN RAISE EXCEPTION '0396 proof: Jan start, Feb 2026 should be FY 2026'; END IF;
    IF public.ers_fiscal_year_for(4, DATE '2026-02-15') <> 2025 THEN RAISE EXCEPTION '0396 proof: Apr start, Feb 2026 should be FY 2025'; END IF;
    IF public.ers_fiscal_year_for(4, DATE '2026-04-01') <> 2026 THEN RAISE EXCEPTION '0396 proof: Apr start, 1 Apr 2026 should be FY 2026'; END IF;
    IF public.ers_fiscal_year_for(NULL, DATE '2026-07-01') <> 2026 THEN RAISE EXCEPTION '0396 proof: unset start should be January'; END IF;
    IF public.ers_fiscal_year(gen_random_uuid(), DATE '2026-02-15') <> 2026 THEN RAISE EXCEPTION '0396 proof: unknown company should default to January'; END IF;
    RAISE NOTICE '0396: fiscal-year proof passed';
END $$;

COMMIT;
