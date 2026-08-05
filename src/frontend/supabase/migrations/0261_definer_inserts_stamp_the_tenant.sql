-- ═══════════════════════════════════════════════════════════════
-- 0261 — SECURITY DEFINER inserts were writing rows with no tenant.
--
-- 0259_tenant_column added `company_id uuid DEFAULT public.caller_company()`
-- to 152 tables — including every table this stream added, which is the
-- generated sweep working exactly as designed.
--
-- But `caller_company()` reads the JWT, and a SECURITY DEFINER function
-- invoked by a trigger, by pg_cron, or by the service role has no JWT. So
-- the default resolves to NULL and the two paths that post money wrote
-- rows belonging to nobody:
--
--     ers_settle_work_order   → cost_allocations   company_id NULL
--     ers_movement_post_fi    → cost_allocations   company_id NULL
--
-- Measured, not assumed: after a settlement run, 2 postings, 150.00,
-- `count(company_id) = 0`.
--
-- WHY THIS HAD TO BE FIXED BEFORE THE NEXT TENANCY STEP, not after.
-- Phase 1 ends by flipping the column to NOT NULL. At that moment
-- ers_settle_work_order starts throwing — and the trigger that calls it
-- catches and logs a warning on purpose, so that closing a work order is
-- never blocked by the ledger (0244). The failure would therefore be
-- silent: no error anyone sees, settlement quietly stops, and the only
-- symptom is `sem_wo_settlement.unsettled_variance` growing for weeks.
--
-- THE FIX IS ALSO THE MORE CORRECT ONE. A posting belongs to the same
-- tenant as the work order it settles — that is a fact about the data, not
-- about who happened to be logged in. Deriving from the parent gives the
-- right answer for cron, for the service role, and for a user, and it is
-- the same integrity the tenancy plan asks for with a composite FK on
-- (id, company_id). `caller_company()` remains the fallback for the case
-- where there is no parent to ask.
--
-- Rollback: restore the 0246 body of ers_settle_work_order and the 0245
-- body of ers_movement_post_fi.
-- ═══════════════════════════════════════════════════════════════
BEGIN;

-- ── Settlement stamps the order's tenant ────────────────────────
CREATE OR REPLACE FUNCTION public.ers_settle_work_order(p_wo_id UUID)
RETURNS TABLE (cost_type TEXT, cost_center_id UUID, delta_amount NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_asset   UUID;
    v_user    UUID;
    v_company UUID;
    v_ids     UUID[];
BEGIN
    SELECT w.asset_id, w.company_id INTO v_asset, v_company
    FROM public.work_orders w WHERE w.id = p_wo_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ers_settle_work_order: work order % not found', p_wo_id;
    END IF;

    BEGIN v_user := auth.uid(); EXCEPTION WHEN OTHERS THEN v_user := NULL; END;
    -- The order's tenant first; the caller's only if the order has none.
    BEGIN
        v_company := COALESCE(v_company, public.caller_company());
    EXCEPTION WHEN OTHERS THEN NULL;   -- pre-0259 databases have no such function
    END;

    WITH actual AS (
        SELECT a.cost_type, a.cost_center_id, a.amount, a.quantity, a.unit
        FROM public.sem_wo_actual_lines a
        WHERE a.work_order_id = p_wo_id
    ),
    posted AS (
        SELECT c.cost_type::TEXT            AS cost_type,
               c.cost_center_id             AS cost_center_id,
               SUM(c.amount)                AS amount,
               SUM(COALESCE(c.quantity, 0)) AS quantity
        FROM public.cost_allocations c
        WHERE c.work_order_id = p_wo_id
          AND c.source        = 'WO_SETTLEMENT'
        GROUP BY c.cost_type, c.cost_center_id
    ),
    delta AS (
        SELECT COALESCE(a.cost_type,      p.cost_type)      AS cost_type,
               COALESCE(a.cost_center_id, p.cost_center_id) AS cost_center_id,
               ROUND(COALESCE(a.amount, 0)   - COALESCE(p.amount, 0),   2) AS d_amount,
               ROUND(COALESCE(a.quantity, 0) - COALESCE(p.quantity, 0), 3) AS d_quantity,
               a.unit                                       AS unit
        FROM actual a
        FULL OUTER JOIN posted p
          ON  p.cost_type      = a.cost_type
          AND p.cost_center_id IS NOT DISTINCT FROM a.cost_center_id
    ),
    ins AS (
        INSERT INTO public.cost_allocations
            (work_order_id, asset_id, cost_center_id, cost_type,
             amount, quantity, unit, posting_date, source, created_by, company_id)
        SELECT p_wo_id, v_asset, d.cost_center_id, d.cost_type,
               d.d_amount, NULLIF(d.d_quantity, 0), d.unit,
               CURRENT_DATE, 'WO_SETTLEMENT', v_user, v_company
        FROM delta d
        WHERE ABS(d.d_amount) >= 0.01
        RETURNING public.cost_allocations.id
    )
    SELECT COALESCE(array_agg(ins.id), '{}') INTO v_ids FROM ins;

    PERFORM public.ers_refresh_budget_actual(cc.cost_center_id)
    FROM (
        SELECT DISTINCT c.cost_center_id
        FROM public.cost_allocations c
        WHERE c.work_order_id  = p_wo_id
          AND c.source         = 'WO_SETTLEMENT'
          AND c.cost_center_id IS NOT NULL
    ) cc;

    RETURN QUERY
    SELECT c.cost_type::TEXT, c.cost_center_id, c.amount
    FROM public.cost_allocations c
    WHERE c.id = ANY(v_ids);
END;
$$;

-- ── A directly-posting movement stamps its own tenant ───────────
CREATE OR REPLACE FUNCTION public.ers_movement_post_fi()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_posting TEXT;
    v_alloc   UUID;
    v_company UUID;
BEGIN
    SELECT fi_posting INTO v_posting FROM public.movement_types WHERE code = NEW.movement_type;

    IF v_posting <> 'DIRECT' OR COALESCE(NEW.total_value, 0) = 0 THEN
        RETURN NEW;
    END IF;

    -- The movement's own tenant, else the order's, else the item's.
    v_company := NEW.company_id;
    IF v_company IS NULL AND NEW.wo_id IS NOT NULL THEN
        SELECT w.company_id INTO v_company FROM public.work_orders w WHERE w.id = NEW.wo_id;
    END IF;
    IF v_company IS NULL AND NEW.item_id IS NOT NULL THEN
        SELECT i.company_id INTO v_company FROM public.inventory_items i WHERE i.id = NEW.item_id;
    END IF;

    INSERT INTO public.cost_allocations
        (work_order_id, asset_id, cost_center_id, cost_type, amount, quantity, unit,
         posting_date, source, created_by, company_id)
    VALUES
        (NEW.wo_id, NEW.asset_id, NEW.cost_center_id, 'MATERIAL', NEW.total_value,
         ABS(COALESCE(NEW.quantity, 0)), NULL, COALESCE(NEW."timestamp"::DATE, CURRENT_DATE),
         'STOCK_MOVEMENT', NEW.performed_by, v_company)
    RETURNING id INTO v_alloc;

    UPDATE public.inventory_transactions SET cost_allocation_id = v_alloc WHERE id = NEW.id;

    IF NEW.cost_center_id IS NOT NULL THEN
        PERFORM public.ers_refresh_budget_actual(NEW.cost_center_id);
    END IF;

    RETURN NEW;
END;
$$;

-- ── Repair what the unstamped period already wrote ──────────────
-- Postings created between 0259 and this migration carry no tenant. They
-- can be traced through their own work order, which is stamped.
UPDATE public.cost_allocations c
   SET company_id = w.company_id
  FROM public.work_orders w
 WHERE c.work_order_id = w.id
   AND c.company_id IS NULL
   AND w.company_id IS NOT NULL;

COMMIT;
