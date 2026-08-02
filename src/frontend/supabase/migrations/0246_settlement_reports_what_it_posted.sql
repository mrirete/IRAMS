-- ═══════════════════════════════════════════════════════════════
-- 0246 — ers_settle_work_order silently under-reported itself.
--
-- Caught by running 0244 against real data: settling WO-2025-0014 posted
-- its line correctly, and ers_settlement_run reported `postings 0`.
--
-- The cause is a timestamp comparison that can never be true.
-- 0244 closed with:
--
--     v_started TIMESTAMPTZ := clock_timestamp();     -- at function entry
--     ...
--     WHERE ... AND c.created_at >= v_started;
--
-- but `cost_allocations.created_at` defaults to `now()`, which is the
-- TRANSACTION start time — always EARLIER than a clock_timestamp() taken
-- once the transaction is already running. So the closing SELECT matched
-- nothing, every time, no matter what had just been inserted.
--
-- The postings themselves were always correct — this only ever affected
-- what the function said it had done. That still matters: the Cost tab
-- reads the returned rows and announces "Already settled — no cost
-- movement to post." on an empty result, so a successful settlement
-- reported itself as a no-op, and the periodic run logged every order as
-- posting nothing.
--
-- Fixed by keeping the ids the INSERT actually produced instead of trying
-- to recognise them afterwards by time. No clock involved, so it is also
-- correct when several settlements share one transaction — which is
-- exactly what ers_settlement_run does.
--
-- Rollback: re-run the 0244 body of this function.
-- ═══════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.ers_settle_work_order(p_wo_id UUID)
RETURNS TABLE (cost_type TEXT, cost_center_id UUID, delta_amount NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_asset UUID;
    v_user  UUID;
    v_ids   UUID[];
BEGIN
    SELECT w.asset_id INTO v_asset FROM public.work_orders w WHERE w.id = p_wo_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ers_settle_work_order: work order % not found', p_wo_id;
    END IF;

    BEGIN v_user := auth.uid(); EXCEPTION WHEN OTHERS THEN v_user := NULL; END;

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
             amount, quantity, unit, posting_date, source, created_by)
        SELECT p_wo_id, v_asset, d.cost_center_id, d.cost_type,
               d.d_amount, NULLIF(d.d_quantity, 0), d.unit,
               CURRENT_DATE, 'WO_SETTLEMENT', v_user
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

COMMENT ON FUNCTION public.ers_settle_work_order(UUID) IS
    'Post the delta between an order''s actual cost and what has already been settled. Idempotent: no movement, no rows. Returns exactly the postings it made (0246).';

COMMIT;
