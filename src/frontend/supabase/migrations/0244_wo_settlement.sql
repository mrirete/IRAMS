-- ═══════════════════════════════════════════════════════════════
-- 0244 — FI-1: work-order settlement. Actual cost reaches the ledger.
--
-- WM-2c built the confirmation layer (0169/0170) and the client computes
-- actual labour and material per order — but nothing ever POSTED it.
-- `cost_allocations` only received hand-typed rows from one FinOps form,
-- `goods_receipts` was never written, and `budgets.actual` never moved
-- (FinOpsService.updateBudgetActuals called an `increment_budget_actual`
-- RPC that does not exist in any migration). So the order-to-cost spine
-- stopped one step short of the books:
--
--   confirmations ──▶ actual labour  ─┐
--   parts         ──▶ actual material ─┴─▶ ??? ──▶ budget actual vs plan
--
-- This closes it. Settlement is a DELTA posting, not a snapshot rewrite:
-- each run posts (current actual − already settled) per receiver, so it is
-- idempotent, late costs post as a top-up, and reversals post as negatives.
-- Nothing already in the ledger is ever mutated — a finance auditor reads
-- an append-only history, which is also what the future SAP outbound
-- adapter needs (each row is a document to send, exactly once).
--
-- Receiver (SAP multi-receiver settlement rule — decision (b) in
-- docs/SAP-Parity-Gap-Assessment.md §7): every posting carries BOTH a cost
-- center and the asset. One row, two receiver dimensions — the amount is
-- not split, so cost-center reporting and asset life-cycle cost both read
-- the same money without double counting.
--
--   cost center: work_orders.cost_center_id
--                → work_centers.cost_center_id (the order's work center)
--                → assets.cost_center_id
--   labour on an operation settles to ITS OWN work center's cost center,
--   falling back to the order receiver. That is why LABOR can post to
--   several cost centers on one order.
--
-- NO BACKFILL. Historical done orders are not settled by this migration —
-- posting years of cost into a live ledger is a business decision, not a
-- schema change. Run `SELECT * FROM ers_settlement_run(500);` deliberately,
-- in batches, once the numbers on sem_wo_settlement have been reviewed.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_work_orders_settle ON work_orders;
--   DROP FUNCTION IF EXISTS trg_settle_on_done, ers_settlement_run(int),
--        ers_settle_work_order(uuid), ers_refresh_budget_actual(uuid,int);
--   DROP VIEW IF EXISTS sem_wo_settlement, sem_wo_actual_lines, sem_wo_receiver;
--   DELETE FROM cost_allocations WHERE source = 'WO_SETTLEMENT';
--   ALTER TABLE cost_allocations DROP COLUMN source, DROP COLUMN asset_id;
-- ═══════════════════════════════════════════════════════════════
BEGIN;

-- ───────────────────────────────────────────────────────────────
-- 1. Ledger columns
-- ───────────────────────────────────────────────────────────────
-- `source` separates machine postings from the hand-typed ones. Without it
-- a manual allocation on the same order would look like settled cost and
-- suppress the delta. Existing rows are manual by definition.
ALTER TABLE public.cost_allocations
    ADD COLUMN IF NOT EXISTS asset_id UUID,
    ADD COLUMN IF NOT EXISTS source   TEXT NOT NULL DEFAULT 'MANUAL';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cost_allocations_asset_id_fkey') THEN
        ALTER TABLE public.cost_allocations
            ADD CONSTRAINT cost_allocations_asset_id_fkey
            FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cost_allocations_source_chk') THEN
        ALTER TABLE public.cost_allocations
            ADD CONSTRAINT cost_allocations_source_chk
            CHECK (source IN ('MANUAL', 'WO_SETTLEMENT', 'WARRANTY_CREDIT', 'ERP_INBOUND'));
    END IF;
END $$;

COMMENT ON COLUMN public.cost_allocations.asset_id IS
    'Second settlement receiver (SAP multi-receiver rule). Same amount as cost_center_id — a dimension, not a split.';
COMMENT ON COLUMN public.cost_allocations.source IS
    'Who posted this: MANUAL (FinOps form) | WO_SETTLEMENT (ers_settle_work_order) | WARRANTY_CREDIT | ERP_INBOUND. Delta settlement only ever nets against WO_SETTLEMENT rows.';

CREATE INDEX IF NOT EXISTS idx_cost_allocations_settlement
    ON public.cost_allocations (work_order_id, cost_type, cost_center_id)
    WHERE source = 'WO_SETTLEMENT';
CREATE INDEX IF NOT EXISTS idx_cost_allocations_asset_id
    ON public.cost_allocations (asset_id);

-- ───────────────────────────────────────────────────────────────
-- 2. The settlement receiver, resolved once
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.sem_wo_receiver AS
SELECT w.id                                                     AS work_order_id,
       w.asset_id                                               AS asset_id,
       COALESCE(w.cost_center_id, wc.cost_center_id, a.cost_center_id) AS cost_center_id
FROM public.work_orders w
LEFT JOIN public.work_centers wc ON wc.id = w.work_center_id
LEFT JOIN public.assets       a  ON a.id  = w.asset_id;

COMMENT ON VIEW public.sem_wo_receiver IS
    'Settlement receivers per order: cost center (order → work center → asset) plus the asset itself.';

-- ───────────────────────────────────────────────────────────────
-- 3. ONE definition of an order's actual cost
-- ───────────────────────────────────────────────────────────────
-- Mirrors DatabaseService.getOperationActuals / getOrderActuals exactly, so
-- the Cost tab and the ledger can never quote different numbers. Rate
-- precedence: the posted rate on the confirmation (the snapshot resolved at
-- posting time) → the operation's planned rate → the work centre rate.
--
-- KNOWN SEMANTIC GAP, deliberately mirrored rather than silently "fixed":
-- MATERIAL sums EVERY work_order_parts row, including rows still flagged
-- is_planned — exactly what the Cost tab shows today. Narrowing actuals to
-- consumed parts changes a number on screen as well as in the ledger, so it
-- is a product decision, not a migration. Decide it before a client sees a
-- posted material figure.
CREATE OR REPLACE VIEW public.sem_wo_actual_lines AS
SELECT s.work_order_id,
       s.cost_type,
       s.cost_center_id,
       ROUND(SUM(s.amount), 2)              AS amount,
       NULLIF(ROUND(SUM(s.quantity), 3), 0) AS quantity,
       MAX(s.unit)                          AS unit
FROM (
    -- Labour confirmed against an operation → the operation's own receiver
    SELECT l.wo_id                                           AS work_order_id,
           'LABOR'::TEXT                                     AS cost_type,
           COALESCE(wc.cost_center_id, r.cost_center_id)     AS cost_center_id,
           SUM(COALESCE(l.hours_worked, 0)
               * COALESCE(NULLIF(l.rate_per_hour, 0), t.planned_rate, wc.activity_rate, 0)) AS amount,
           SUM(COALESCE(l.hours_worked, 0))                  AS quantity,
           'H'::TEXT                                         AS unit
    FROM public.work_order_labor l
    JOIN public.job_tasks       t ON t.id = l.job_task_id
    JOIN public.sem_wo_receiver r ON r.work_order_id = l.wo_id
    LEFT JOIN public.work_centers wc ON wc.id = t.work_center_id
    GROUP BY l.wo_id, COALESCE(wc.cost_center_id, r.cost_center_id)

    UNION ALL

    -- Order-level labour (no operation link) → the order receiver, own rate only
    SELECT l.wo_id,
           'LABOR'::TEXT,
           r.cost_center_id,
           SUM(COALESCE(l.hours_worked, 0) * COALESCE(l.rate_per_hour, 0)),
           SUM(COALESCE(l.hours_worked, 0)),
           'H'::TEXT
    FROM public.work_order_labor l
    JOIN public.sem_wo_receiver r ON r.work_order_id = l.wo_id
    WHERE l.job_task_id IS NULL
    GROUP BY l.wo_id, r.cost_center_id

    UNION ALL

    -- Material → the order receiver. Quantity is left NULL: an aggregate
    -- across mixed units of measure is not a quantity.
    SELECT p.wo_id,
           'MATERIAL'::TEXT,
           r.cost_center_id,
           SUM(COALESCE(p.quantity, 0) * COALESCE(p.unit_cost, 0)),
           NULL::NUMERIC,
           NULL::TEXT
    FROM public.work_order_parts p
    JOIN public.sem_wo_receiver r ON r.work_order_id = p.wo_id
    GROUP BY p.wo_id, r.cost_center_id
) s
GROUP BY s.work_order_id, s.cost_type, s.cost_center_id
HAVING ROUND(SUM(s.amount), 2) <> 0;

COMMENT ON VIEW public.sem_wo_actual_lines IS
    'Canonical actual cost per (work order, cost type, receiving cost center). The settlement basis. Mirrors DatabaseService.getOrderActuals — change both together.';

-- ───────────────────────────────────────────────────────────────
-- 4. Budget actual — recomputed, never incremented
-- ───────────────────────────────────────────────────────────────
-- Replaces the broken increment path. Recomputing from the ledger is
-- idempotent and self-healing: a missed or double call cannot drift the
-- budget, because the answer is always "whatever the ledger says".
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
    v_year  INT := COALESCE(p_fiscal_year, EXTRACT(YEAR FROM CURRENT_DATE)::INT);
    v_total NUMERIC;
BEGIN
    IF p_cost_center_id IS NULL THEN RETURN NULL; END IF;

    SELECT COALESCE(SUM(c.amount), 0) INTO v_total
    FROM public.cost_allocations c
    WHERE c.cost_center_id = p_cost_center_id
      AND EXTRACT(YEAR FROM COALESCE(c.posting_date, c.created_at::DATE))::INT = v_year;

    UPDATE public.budgets
       SET actual = v_total, updated_at = NOW()
     WHERE cost_center_id = p_cost_center_id
       AND fiscal_year    = v_year;

    RETURN v_total;
END;
$$;

COMMENT ON FUNCTION public.ers_refresh_budget_actual(UUID, INT) IS
    'Recompute budgets.actual for a cost center/year from the cost_allocations ledger. Idempotent — call as often as you like.';

-- ───────────────────────────────────────────────────────────────
-- 5. Settle one order
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ers_settle_work_order(p_wo_id UUID)
RETURNS TABLE (cost_type TEXT, cost_center_id UUID, delta_amount NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_asset   UUID;
    v_user    UUID;
    v_started TIMESTAMPTZ := clock_timestamp();
BEGIN
    SELECT w.asset_id INTO v_asset FROM public.work_orders w WHERE w.id = p_wo_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ers_settle_work_order: work order % not found', p_wo_id;
    END IF;

    -- auth.uid() is absent under the service role and in cron; a null poster
    -- is not a reason to refuse a posting.
    BEGIN v_user := auth.uid(); EXCEPTION WHEN OTHERS THEN v_user := NULL; END;

    WITH actual AS (
        SELECT a.cost_type, a.cost_center_id, a.amount, a.quantity, a.unit
        FROM public.sem_wo_actual_lines a
        WHERE a.work_order_id = p_wo_id
    ),
    posted AS (
        SELECT c.cost_type::TEXT              AS cost_type,
               c.cost_center_id               AS cost_center_id,
               SUM(c.amount)                  AS amount,
               SUM(COALESCE(c.quantity, 0))   AS quantity
        FROM public.cost_allocations c
        WHERE c.work_order_id = p_wo_id
          AND c.source        = 'WO_SETTLEMENT'
        GROUP BY c.cost_type, c.cost_center_id
    ),
    delta AS (
        -- FULL OUTER so a receiver that has disappeared from the actuals
        -- still gets its reversal posted.
        SELECT COALESCE(a.cost_type,      p.cost_type)      AS cost_type,
               COALESCE(a.cost_center_id, p.cost_center_id) AS cost_center_id,
               ROUND(COALESCE(a.amount, 0)   - COALESCE(p.amount, 0),   2) AS d_amount,
               ROUND(COALESCE(a.quantity, 0) - COALESCE(p.quantity, 0), 3) AS d_quantity,
               a.unit                                       AS unit
        FROM actual a
        FULL OUTER JOIN posted p
          ON  p.cost_type      = a.cost_type
          AND p.cost_center_id IS NOT DISTINCT FROM a.cost_center_id
    )
    INSERT INTO public.cost_allocations
        (work_order_id, asset_id, cost_center_id, cost_type,
         amount, quantity, unit, posting_date, source, created_by)
    SELECT p_wo_id, v_asset, d.cost_center_id, d.cost_type,
           d.d_amount, NULLIF(d.d_quantity, 0), d.unit,
           CURRENT_DATE, 'WO_SETTLEMENT', v_user
    FROM delta d
    WHERE ABS(d.d_amount) >= 0.01;   -- nothing moved → no document

    -- Budget actuals follow the ledger, for every receiver this order touches.
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
    WHERE c.work_order_id = p_wo_id
      AND c.source        = 'WO_SETTLEMENT'
      AND c.created_at   >= v_started;
END;
$$;

COMMENT ON FUNCTION public.ers_settle_work_order(UUID) IS
    'Post the delta between an order''s actual cost and what has already been settled. Idempotent: no movement, no rows. Returns the postings made.';

-- ───────────────────────────────────────────────────────────────
-- 6. Settle automatically when the order finishes
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_settle_on_done()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF public.ers_wo_state(NEW.status::TEXT) = 'done'
       AND public.ers_wo_state(COALESCE(OLD.status::TEXT, '')) IS DISTINCT FROM 'done'
    THEN
        -- Closing work must never be blocked by the finance ledger. A failed
        -- settlement leaves a visible variance on sem_wo_settlement, which
        -- ers_settlement_run() clears on the next pass.
        BEGIN
            PERFORM * FROM public.ers_settle_work_order(NEW.id);
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'settlement failed for work order % (%): %', NEW.id, NEW.wo_number, SQLERRM;
        END;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_work_orders_settle ON public.work_orders;
CREATE TRIGGER trg_work_orders_settle
    AFTER UPDATE OF status ON public.work_orders
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION public.trg_settle_on_done();

-- Deliberately NOT triggered by work_order_labor / work_order_parts writes:
-- the UI re-syncs an order's child rows by delete-and-reinsert on every
-- save, so a row-level trigger would post a reversal and a re-posting on
-- each keystroke-debounce. Late costs are picked up by ers_settlement_run()
-- or the per-order re-settle, which is also how SAP does it (periodic run).

-- ───────────────────────────────────────────────────────────────
-- 7. Reconciliation surface
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.sem_wo_settlement AS
SELECT w.id                                     AS work_order_id,
       w.wo_number,
       w.asset_id,
       public.ers_wo_state(w.status::TEXT)      AS wo_state,
       COALESCE(a.actual_cost, 0)               AS actual_cost,
       COALESCE(p.settled_cost, 0)              AS settled_cost,
       ROUND(COALESCE(a.actual_cost, 0) - COALESCE(p.settled_cost, 0), 2) AS unsettled_variance,
       p.last_settled_at
FROM public.work_orders w
LEFT JOIN (
    SELECT l.work_order_id, SUM(l.amount) AS actual_cost
    FROM public.sem_wo_actual_lines l GROUP BY l.work_order_id
) a ON a.work_order_id = w.id
LEFT JOIN (
    SELECT c.work_order_id, SUM(c.amount) AS settled_cost, MAX(c.created_at) AS last_settled_at
    FROM public.cost_allocations c WHERE c.source = 'WO_SETTLEMENT' GROUP BY c.work_order_id
) p ON p.work_order_id = w.id;

COMMENT ON VIEW public.sem_wo_settlement IS
    'Per order: actual cost vs what has reached the ledger. Non-zero unsettled_variance on a done order is the finance backlog.';

-- ───────────────────────────────────────────────────────────────
-- 8. Periodic settlement run (SAP KO8G)
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ers_settlement_run(p_limit INT DEFAULT 500)
RETURNS TABLE (work_order_id UUID, wo_number TEXT, postings BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    r      RECORD;
    v_rows BIGINT;
BEGIN
    FOR r IN
        SELECT s.work_order_id AS id, s.wo_number AS num
        FROM public.sem_wo_settlement s
        WHERE s.wo_state = 'done'
          AND ABS(s.unsettled_variance) >= 0.01
        ORDER BY s.wo_number
        LIMIT GREATEST(p_limit, 0)
    LOOP
        SELECT COUNT(*) INTO v_rows FROM public.ers_settle_work_order(r.id);
        work_order_id := r.id;
        wo_number     := r.num;
        postings      := v_rows;
        RETURN NEXT;
    END LOOP;
END;
$$;

COMMENT ON FUNCTION public.ers_settlement_run(INT) IS
    'Settle every finished order carrying an unsettled variance. Safe to re-run; service_role only (batch weight).';

-- ───────────────────────────────────────────────────────────────
-- 9. Grants + catalog
-- ───────────────────────────────────────────────────────────────
GRANT SELECT ON public.sem_wo_receiver     TO authenticated, service_role;
GRANT SELECT ON public.sem_wo_actual_lines TO authenticated, service_role;
GRANT SELECT ON public.sem_wo_settlement   TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.ers_settle_work_order(UUID)          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ers_refresh_budget_actual(UUID, INT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ers_settlement_run(INT)              TO service_role;

DELETE FROM public.semantic_catalog
 WHERE object_name = 'sem_wo_settlement'
   AND column_name IN ('actual_cost', 'settled_cost', 'unsettled_variance');

INSERT INTO public.semantic_catalog
    (object_name, column_name, title, description, tags, source_tables, iso_standard)
VALUES
    ('sem_wo_settlement', 'actual_cost', 'Work-order actual cost',
     'Confirmed labour (hours x the rate posted with the confirmation, falling back to the operation then work-centre rate) plus parts (quantity x unit cost). The settlement basis — the same definition the work order Cost tab displays.',
     ARRAY['finops', 'work_management', 'canonical'], ARRAY['work_order_labor', 'work_order_parts', 'job_tasks', 'work_centers'], 'ISO 14224'),
    ('sem_wo_settlement', 'settled_cost', 'Settled cost',
     'How much of the actual cost has been posted to cost_allocations by settlement. Rises in deltas; never rewritten.',
     ARRAY['finops', 'canonical'], ARRAY['cost_allocations'], NULL),
    ('sem_wo_settlement', 'unsettled_variance', 'Unsettled variance',
     'Actual cost that has not reached the ledger. Non-zero on a finished order means settlement has not caught up — the finance backlog, and the queue an ERP outbound adapter would drain.',
     ARRAY['finops', 'kpi', 'canonical'], ARRAY['cost_allocations', 'work_orders'], NULL);

COMMIT;
