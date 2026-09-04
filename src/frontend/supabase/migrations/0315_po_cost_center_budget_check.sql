-- 0315_po_cost_center_budget_check.sql
-- Purchase orders get a cost centre and a real budget check at authorisation
-- (launch review LR-01, open item "PO budget check: no cost centre on PO").
--
-- What was true before:
--   * purchase_order_lines.cost_center_id existed (0248) but the header had no
--     receiver, the UI never set it, and only service settlement (0249) read it.
--   * budgets.committed ("POs issued but not received", 0034) was NEVER written.
--     Budget utilisation on FinOps and the watchdog's BUDGET_BREACH both read
--     actual + committed — so open commitments were invisible everywhere.
--   * The Authorise tab was a mock: canAuthorise = true, and the client wrote
--     purchase_orders.authorized_by, a column that does not exist.
--
-- What this adds:
--   1. purchase_orders.cost_center_id (header receiver; a line's own cost
--      centre or its work order's receiver still wins per line, as in 0249),
--      authorized_at, budget_override_reason, budget_check (the verdict at
--      authorisation, frozen).
--   2. sem_po_commitments: open commitment per cost centre and fiscal year =
--      Σ (qty_ordered − qty_received) × unit_cost over lines of OPEN /
--      PART_RECEIVED orders. Doctrine (0245/0249): ordering is a commitment,
--      receipt is the cost — so a received quantity leaves commitment the
--      moment it lands in actual via settlement.
--   3. ers_refresh_budget_committed(company, cost_center, fy) and triggers on
--      purchase_orders / purchase_order_lines that keep budgets.committed
--      current. SECURITY DEFINER because a storekeeper receiving a line must
--      not need UPDATE on budgets; tenant derived from the PO row (0261 rule).
--   4. ers_po_budget_check(po) → jsonb: per cost centre, budget / actual /
--      committed by others / this order / projected / status. Statuses:
--      OK (< 90 %), WARN (≥ 90 %), EXCEEDED (> 100 %), BLOCKED (an active HARD
--      budget_block whose threshold is crossed), NO_BUDGET (advisory).
--   5. ers_authorize_purchase_order(po, override_reason) — requires
--      caller_can('purchasing','approve'); refuses BLOCKED outright; refuses
--      EXCEEDED unless an override reason is given (recorded on the order);
--      stamps authorized_by_id / authorized_at / budget_check and moves a
--      DRAFT to OPEN.
--
-- Fiscal year = calendar year of purchase_orders.date_created, matching how
-- FinOps keys budgets (one ANNUAL/YEAR row per cost centre and year).

-- ── 1. header columns ────────────────────────────────────────────────────────
ALTER TABLE public.purchase_orders
    ADD COLUMN IF NOT EXISTS cost_center_id          uuid REFERENCES public.cost_centers(id),
    ADD COLUMN IF NOT EXISTS authorized_at           timestamptz,
    ADD COLUMN IF NOT EXISTS budget_override_reason  text,
    ADD COLUMN IF NOT EXISTS budget_check            jsonb;
CREATE INDEX IF NOT EXISTS purchase_orders_cost_center_idx ON public.purchase_orders(cost_center_id);
COMMENT ON COLUMN public.purchase_orders.cost_center_id IS 'Header receiver (0315). Per line: line.cost_center_id → work order receiver (sem_wo_receiver) → this.';
COMMENT ON COLUMN public.purchase_orders.budget_check IS 'Frozen verdict of ers_po_budget_check at authorisation (0315).';

-- Backfill the header from its lines: an explicit line cost centre first, else
-- the linked work order's receiver. Purely additive; NULL stays NULL.
UPDATE public.purchase_orders po
   SET cost_center_id = src.cc
  FROM (
        SELECT l.po_id, (array_agg(COALESCE(l.cost_center_id, r.cost_center_id) ORDER BY l.line_no))[1] AS cc
          FROM public.purchase_order_lines l
          LEFT JOIN public.sem_wo_receiver r ON r.work_order_id = l.work_order_id
         WHERE COALESCE(l.cost_center_id, r.cost_center_id) IS NOT NULL
         GROUP BY l.po_id
       ) src
 WHERE src.po_id = po.id AND po.cost_center_id IS NULL;

-- ── 2. open commitments ──────────────────────────────────────────────────────
-- Security-invoker: reads through RLS, so the FinOps UI sees its own tenant.
CREATE OR REPLACE VIEW public.sem_po_line_commitments AS
SELECT l.id                                                        AS line_id,
       po.id                                                       AS po_id,
       po.company_id,
       po.po_code,
       po.status,
       EXTRACT(YEAR FROM COALESCE(po.date_created, po.created_at::date))::int AS fiscal_year,
       COALESCE(l.cost_center_id, r.cost_center_id, po.cost_center_id)        AS cost_center_id,
       GREATEST(COALESCE(l.qty_ordered, 0) - COALESCE(l.qty_received, 0), 0)
         * COALESCE(l.unit_cost, 0)                                 AS open_value
  FROM public.purchase_order_lines l
  JOIN public.purchase_orders po ON po.id = l.po_id
  LEFT JOIN public.sem_wo_receiver r ON r.work_order_id = l.work_order_id
 WHERE po.status IN ('OPEN', 'PART_RECEIVED');

CREATE OR REPLACE VIEW public.sem_po_commitments AS
SELECT company_id, cost_center_id, fiscal_year,
       SUM(open_value)::numeric(15,2) AS committed,
       COUNT(DISTINCT po_id)::int     AS open_orders
  FROM public.sem_po_line_commitments
 WHERE cost_center_id IS NOT NULL
 GROUP BY company_id, cost_center_id, fiscal_year;

GRANT SELECT ON public.sem_po_line_commitments, public.sem_po_commitments TO authenticated;
COMMENT ON VIEW public.sem_po_commitments IS 'Open PO value (ordered − received, at unit cost) per cost centre and fiscal year (0315). Source of budgets.committed.';

-- ── 3. keep budgets.committed current ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ers_refresh_budget_committed(p_company uuid, p_cost_center uuid, p_fiscal_year int)
RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v numeric := 0;
BEGIN
    IF p_company IS NULL OR p_cost_center IS NULL OR p_fiscal_year IS NULL THEN RETURN 0; END IF;
    SELECT COALESCE(SUM(GREATEST(COALESCE(l.qty_ordered,0) - COALESCE(l.qty_received,0), 0) * COALESCE(l.unit_cost,0)), 0)
      INTO v
      FROM public.purchase_order_lines l
      JOIN public.purchase_orders po ON po.id = l.po_id
      LEFT JOIN public.sem_wo_receiver r ON r.work_order_id = l.work_order_id
     WHERE po.company_id = p_company
       AND po.status IN ('OPEN', 'PART_RECEIVED')
       AND COALESCE(l.cost_center_id, r.cost_center_id, po.cost_center_id) = p_cost_center
       AND EXTRACT(YEAR FROM COALESCE(po.date_created, po.created_at::date))::int = p_fiscal_year;

    UPDATE public.budgets
       SET committed = ROUND(v, 2)
     WHERE company_id = p_company
       AND cost_center_id = p_cost_center
       AND fiscal_year = p_fiscal_year
       AND COALESCE(period, 'ANNUAL') IN ('ANNUAL', 'YEAR')
       AND committed IS DISTINCT FROM ROUND(v, 2);
    RETURN ROUND(v, 2);
END $$;
REVOKE ALL ON FUNCTION public.ers_refresh_budget_committed(uuid, uuid, int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ers_refresh_budget_committed(uuid, uuid, int) TO authenticated, service_role;

-- Every cost centre a PO could touch (header, each line, each linked WO receiver).
CREATE OR REPLACE FUNCTION public.ers_po_cost_centers(p_po uuid)
RETURNS TABLE (cost_center_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
    SELECT DISTINCT cc FROM (
        SELECT po.cost_center_id AS cc FROM public.purchase_orders po WHERE po.id = p_po
        UNION ALL
        SELECT COALESCE(l.cost_center_id, r.cost_center_id)
          FROM public.purchase_order_lines l
          LEFT JOIN public.sem_wo_receiver r ON r.work_order_id = l.work_order_id
         WHERE l.po_id = p_po
    ) x WHERE cc IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.ers_po_cost_centers(uuid) FROM public, anon;

CREATE OR REPLACE FUNCTION public.trg_po_refresh_committed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_po_id uuid;
    v_company uuid;
    v_fy int;
    cc uuid;
BEGIN
    IF TG_TABLE_NAME = 'purchase_orders' THEN
        v_po_id := COALESCE(NEW.id, OLD.id);
    ELSE
        v_po_id := COALESCE(NEW.po_id, OLD.po_id);
    END IF;
    SELECT company_id, EXTRACT(YEAR FROM COALESCE(date_created, created_at::date))::int
      INTO v_company, v_fy FROM public.purchase_orders WHERE id = v_po_id;
    IF v_company IS NULL THEN RETURN NULL; END IF;

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

DROP TRIGGER IF EXISTS zz_po_refresh_committed ON public.purchase_orders;
CREATE TRIGGER zz_po_refresh_committed
    AFTER INSERT OR UPDATE OF status, cost_center_id, date_created OR DELETE ON public.purchase_orders
    FOR EACH ROW EXECUTE FUNCTION public.trg_po_refresh_committed();
DROP TRIGGER IF EXISTS zz_po_line_refresh_committed ON public.purchase_order_lines;
CREATE TRIGGER zz_po_line_refresh_committed
    AFTER INSERT OR UPDATE OF qty_ordered, qty_received, unit_cost, cost_center_id, work_order_id OR DELETE ON public.purchase_order_lines
    FOR EACH ROW EXECUTE FUNCTION public.trg_po_refresh_committed();

-- One-time catch-up: every budget row learns its true committed value.
DO $$
DECLARE b record;
BEGIN
    FOR b IN SELECT DISTINCT company_id, cost_center_id, fiscal_year FROM public.budgets WHERE cost_center_id IS NOT NULL LOOP
        PERFORM public.ers_refresh_budget_committed(b.company_id, b.cost_center_id, b.fiscal_year);
    END LOOP;
END $$;

-- ── 4. the check ─────────────────────────────────────────────────────────────
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
    v_fy := EXTRACT(YEAR FROM COALESCE(v_po.date_created, v_po.created_at::date))::int;

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
               AND EXTRACT(YEAR FROM COALESCE(po.date_created, po.created_at::date))::int = v_fy
             GROUP BY 1
        )
        SELECT t.cost_center_id, cc.code, cc.name,
               t.this_po,
               COALESCE(o.committed_other, 0)       AS committed_other,
               b.id                                  AS budget_id,
               COALESCE(b.opex_budget, 0)            AS opex_budget,
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
            pct       numeric := CASE WHEN r.opex_budget > 0 THEN ROUND(100 * projected / r.opex_budget, 1) END;
            st        text;
        BEGIN
            v_total := v_total + r.this_po;
            st := CASE
                    WHEN r.cost_center_id IS NULL THEN 'NO_COST_CENTER'
                    WHEN r.budget_id IS NULL OR r.opex_budget <= 0 THEN 'NO_BUDGET'
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
                'opex_budget', r.opex_budget, 'actual', r.actual,
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

-- ── 5. authorise ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ers_authorize_purchase_order(p_po uuid, p_override_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_check jsonb;
    v_user  text;
    v_po    public.purchase_orders%ROWTYPE;
BEGIN
    IF NOT public.caller_can('purchasing', 'approve') THEN
        RAISE EXCEPTION 'Not authorized: purchasing.approve is required to authorise a purchase order';
    END IF;
    SELECT * INTO v_po FROM public.purchase_orders WHERE id = p_po;
    IF NOT FOUND THEN RAISE EXCEPTION 'purchase order % not found', p_po; END IF;
    IF v_po.company_id IS DISTINCT FROM public.caller_company() THEN
        RAISE EXCEPTION 'purchase order % is not in your company', p_po;
    END IF;
    IF v_po.status IN ('COMPLETED', 'CANCELLED') THEN
        RAISE EXCEPTION 'purchase order % is %, it cannot be authorised', v_po.po_code, v_po.status;
    END IF;

    v_check := public.ers_po_budget_check(p_po);
    IF (v_check->>'blocked')::boolean THEN
        RAISE EXCEPTION 'BUDGET_BLOCKED: a hard budget block applies — raise the budget or remove the block before authorising' USING DETAIL = v_check::text;
    END IF;
    IF (v_check->>'requires_override')::boolean AND NULLIF(trim(COALESCE(p_override_reason, '')), '') IS NULL THEN
        RAISE EXCEPTION 'BUDGET_EXCEEDED: this order takes a cost centre over budget — an override reason is required' USING DETAIL = v_check::text;
    END IF;

    SELECT COALESCE(u.username, u.email, auth.uid()::text) INTO v_user FROM public.users u WHERE u.id = auth.uid();
    UPDATE public.purchase_orders
       SET authorized_by_id = COALESCE(v_user, authorized_by_id),
           authorized_at = now(),
           budget_check = v_check,
           budget_override_reason = CASE WHEN (v_check->>'requires_override')::boolean THEN trim(p_override_reason) ELSE NULL END,
           status = CASE WHEN status = 'DRAFT' THEN 'OPEN' ELSE status END,
           updated_at = now()
     WHERE id = p_po;
    RETURN v_check || jsonb_build_object('authorized_by', v_user, 'authorized_at', now());
END $$;
REVOKE ALL ON FUNCTION public.ers_authorize_purchase_order(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ers_authorize_purchase_order(uuid, text) TO authenticated;

-- ── proof ────────────────────────────────────────────────────────────────────
DO $$
DECLARE
    v_company uuid; v_cc uuid; v_po uuid; v_budget uuid; v_committed numeric; v_check jsonb; v_fy int := EXTRACT(YEAR FROM CURRENT_DATE)::int;
BEGIN
    SELECT id INTO v_company FROM public.companies ORDER BY created_at LIMIT 1;
    IF v_company IS NULL THEN RAISE NOTICE 'no company; proof skipped'; RETURN; END IF;
    INSERT INTO public.cost_centers (code, name, company_id) VALUES ('__CC0315', 'Probe 0315', v_company) RETURNING id INTO v_cc;
    INSERT INTO public.budgets (cost_center_id, fiscal_year, period, opex_budget, capex_budget, actual, committed, company_id)
    VALUES (v_cc, v_fy, 'ANNUAL', 1000, 0, 500, 0, v_company) RETURNING id INTO v_budget;
    INSERT INTO public.purchase_orders (po_code, status, cost_center_id, date_created, company_id)
    VALUES ('__PO0315', 'OPEN', v_cc, CURRENT_DATE, v_company) RETURNING id INTO v_po;
    INSERT INTO public.purchase_order_lines (po_id, line_no, description, qty_ordered, qty_received, unit_cost, company_id)
    VALUES (v_po, 10, 'probe', 10, 0, 60, v_company);

    SELECT committed INTO v_committed FROM public.budgets WHERE id = v_budget;
    IF v_committed <> 600 THEN RAISE EXCEPTION 'committed not refreshed by trigger: %', v_committed; END IF;

    v_check := public.ers_po_budget_check(v_po);
    -- 500 actual + 0 others + 600 this = 1100 / 1000 → EXCEEDED
    IF v_check->>'overall' <> 'EXCEEDED' THEN RAISE EXCEPTION 'expected EXCEEDED, got %', v_check->>'overall'; END IF;

    UPDATE public.purchase_order_lines SET qty_received = 5 WHERE po_id = v_po;
    SELECT committed INTO v_committed FROM public.budgets WHERE id = v_budget;
    IF v_committed <> 300 THEN RAISE EXCEPTION 'receipt did not release commitment: %', v_committed; END IF;

    UPDATE public.purchase_orders SET status = 'COMPLETED' WHERE id = v_po;
    SELECT committed INTO v_committed FROM public.budgets WHERE id = v_budget;
    IF v_committed <> 0 THEN RAISE EXCEPTION 'completion did not release commitment: %', v_committed; END IF;

    DELETE FROM public.purchase_orders WHERE id = v_po;
    DELETE FROM public.budgets WHERE id = v_budget;
    DELETE FROM public.cost_centers WHERE id = v_cc;
    RAISE NOTICE 'PO commitment + budget check verified';
END $$;

-- ── 6. someone has to hear it ────────────────────────────────────────────────
-- The live tenants carry curated rules for readings / pm / requests /
-- workOrders / inventory and NONE for purchasing, so PO_APPROVED and
-- PO_BUDGET_EXCEEDED would have been emitted into the void. Seed one rule per
-- event per active company, idempotent by (company, name). Shapes copied from
-- the live inventory rules.
INSERT INTO public.notification_rules (name, description, module, event_trigger, is_active, severity, filters, recipients, channels, escalation_timeout_minutes, company_id)
SELECT r.name, r.description, 'purchasing', r.event_trigger, true, r.severity, '[]'::jsonb, r.recipients::jsonb, r.channels::jsonb, 0, c.id
  FROM public.companies c
 CROSS JOIN (VALUES
    ('PO Authorised Over Budget',
     'A purchase order was authorised with a budget override — the cost centre is now projected over its OPEX budget. The entity carries the budget check and the override reason.',
     'PO_BUDGET_EXCEEDED', 'CRITICAL',
     '[{"type": "ROLE", "targetId": "MANAGER"}, {"type": "ROLE", "targetId": "SUPER_ADMIN"}]',
     '["IN_APP", "EMAIL"]'),
    ('Purchase Order Authorised',
     'A purchase order passed its budget check and is authorised — the store can expect the delivery.',
     'PO_APPROVED', 'INFO',
     '[{"type": "ROLE", "targetId": "STOREKEEPER"}, {"type": "ROLE", "targetId": "PLANNER"}]',
     '["IN_APP"]')
 ) AS r(name, description, event_trigger, severity, recipients, channels)
 WHERE c.active
   AND NOT EXISTS (SELECT 1 FROM public.notification_rules n WHERE n.company_id = c.id AND n.name = r.name);

-- New self-serve tenants are cloned from the seed registry (0279a), which is a
-- static id list — register the seed company's two new rules so signups get them.
INSERT INTO public.product_seed_rows (id, table_name)
SELECT n.id, 'notification_rules'
  FROM public.notification_rules n
 WHERE n.company_id = (SELECT id FROM public.companies WHERE active ORDER BY created_at LIMIT 1)
   AND n.module = 'purchasing'
   AND NOT EXISTS (SELECT 1 FROM public.product_seed_rows s WHERE s.id = n.id);
