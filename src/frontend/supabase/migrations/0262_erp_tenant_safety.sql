-- ═══════════════════════════════════════════════════════════════
-- 0262 — Make the ERP surface tenant-safe.
--
-- 0261 made SECURITY DEFINER inserts stamp the right tenant. This closes
-- the other three holes the shared-DB tier opens in the same surface.
--
-- ── 1. A DEFINER function is a hole THROUGH RLS, by definition ──
-- ers_settle_work_order, ers_refresh_budget_actual and ers_match_invoice
-- each take a UUID from an `authenticated` caller and run as owner, so no
-- policy sees the call. ers_settlement_run takes no id at all and would
-- happily settle every tenant's orders. Phase-2 RLS cannot fix this — it
-- is precisely the path RLS does not police — so the check belongs in the
-- function.
--
-- THE GUARD REFUSES ONLY WHEN BOTH TENANTS ARE KNOWN AND DIFFER, and that
-- asymmetry is deliberate:
--   • caller NULL  → a trigger, pg_cron or the service role. Trusted
--     contexts with no JWT, and the paths settlement actually runs on.
--     Refusing here would stop settlement today.
--   • target NULL  → data written before the tenant column existed.
--   • both known, different → the only case that is unambiguously wrong.
-- The guard is therefore exactly as strong as the JWT claim. It becomes
-- effective when the 0258 token hook goes live, and it is defence in depth
-- BESIDE Phase-2 RLS, not a substitute for it.
--
-- ── 2. Uniqueness keys that ignore the tenant ──
-- erp_object_map is keyed (system, entity_type, external_key): the moment
-- two tenants both map SAP vendor 100234, the second is rejected as a
-- duplicate of a row it cannot even see. invoice_tolerances is keyed
-- (name), and every tenant wants a row called DEFAULT. Same class the
-- tenancy plan flags for dictionaries (type, code) — miss one and customer
-- #2 hits a constraint violation on day one.
--
-- NULLS NOT DISTINCT (PG15+, this is 17.6) so rows that have not been
-- backfilled yet still collide with each other. Without it, widening the
-- key would silently switch uniqueness OFF for every existing row, since
-- NULL never equals NULL — the fix would quietly create the duplicates it
-- was meant to prevent.
--
-- ── 3. Per-tenant data on a shared catalog row ──
-- movement_types is product data, correctly excluded from the 0259 sweep.
-- But gl_account on it is the customer's chart of accounts: one tenant
-- setting it would set it for every tenant. Split, using the same shape as
-- numbering_config_overrides — a global default with a per-tenant override.
--
-- ── 4. A bug found while making the tolerance per-tenant ──
-- ers_match_invoice's `scored` CTE selected from invoice_match_lines with
-- NO filter on the invoice being matched, and the UPDATE then joined on
-- line id — so every call re-scored EVERY invoice line in the database.
-- With one shared tolerance that was invisible (the same inputs produced
-- the same verdicts) and merely wasteful. With per-tenant tolerances it
-- becomes corruption: matching tenant A's invoice would re-verdict tenant
-- B's lines using tenant A's thresholds. The missing WHERE is added here,
-- and it is a prerequisite for §3, not a tidy-up.
--
-- Rollback: restore the 0261 function bodies, drop the new constraints and
-- re-add the originals, drop movement_type_gl_overrides.
-- ═══════════════════════════════════════════════════════════════
BEGIN;

-- ───────────────────────────────────────────────────────────────
-- 1. Tenant-scoped uniqueness
-- ───────────────────────────────────────────────────────────────
ALTER TABLE public.erp_object_map
    DROP CONSTRAINT IF EXISTS erp_object_map_system_entity_type_entity_id_key,
    DROP CONSTRAINT IF EXISTS erp_object_map_system_entity_type_external_key_key,
    DROP CONSTRAINT IF EXISTS erp_object_map_tenant_entity_uq,
    DROP CONSTRAINT IF EXISTS erp_object_map_tenant_external_uq;

ALTER TABLE public.erp_object_map
    ADD CONSTRAINT erp_object_map_tenant_entity_uq
        UNIQUE NULLS NOT DISTINCT (company_id, system, entity_type, entity_id),
    ADD CONSTRAINT erp_object_map_tenant_external_uq
        UNIQUE NULLS NOT DISTINCT (company_id, system, entity_type, external_key);

ALTER TABLE public.invoice_tolerances
    DROP CONSTRAINT IF EXISTS invoice_tolerances_name_key,
    DROP CONSTRAINT IF EXISTS invoice_tolerances_tenant_name_uq;

ALTER TABLE public.invoice_tolerances
    ADD CONSTRAINT invoice_tolerances_tenant_name_uq
        UNIQUE NULLS NOT DISTINCT (company_id, name);

COMMENT ON CONSTRAINT erp_object_map_tenant_external_uq ON public.erp_object_map IS
    'One mapping per external object PER TENANT. Two customers may both use SAP vendor 100234; neither can see the other''s row.';

-- ───────────────────────────────────────────────────────────────
-- 2. Per-tenant G/L accounts for movement types
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.movement_type_gl_overrides (
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    code       TEXT NOT NULL REFERENCES public.movement_types(code) ON DELETE CASCADE,
    gl_account TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (company_id, code)
);

COMMENT ON TABLE public.movement_type_gl_overrides IS
    'Per-tenant G/L account for a movement type. movement_types stays global product data; the chart of accounts is the customer''s. Same shape as numbering_config_overrides.';

ALTER TABLE public.movement_type_gl_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mt_gl_overrides_read" ON public.movement_type_gl_overrides;
CREATE POLICY "mt_gl_overrides_read" ON public.movement_type_gl_overrides
    FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "mt_gl_overrides_admin_write" ON public.movement_type_gl_overrides;
CREATE POLICY "mt_gl_overrides_admin_write" ON public.movement_type_gl_overrides
    FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

GRANT SELECT ON public.movement_type_gl_overrides TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────
-- 3. Movement defaults resolve the tenant's G/L first
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ers_movement_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_mt   public.movement_types%ROWTYPE;
    v_sign SMALLINT;
BEGIN
    IF NEW.movement_type IS NULL THEN
        NEW.movement_type := CASE
            WHEN NEW.transaction_type = 'ISSUE'   AND NEW.wo_id IS NOT NULL THEN '261'
            WHEN NEW.transaction_type = 'ISSUE'                             THEN '201'
            WHEN NEW.transaction_type = 'RECEIPT' AND NEW.po_id IS NOT NULL THEN '101'
            WHEN NEW.transaction_type = 'RECEIPT'                           THEN '501'
            WHEN NEW.transaction_type = 'RETURN'  AND NEW.wo_id IS NOT NULL THEN '262'
            WHEN NEW.transaction_type = 'RETURN'                            THEN '202'
            ELSE '701'
        END;
    END IF;

    SELECT * INTO v_mt FROM public.movement_types WHERE code = NEW.movement_type;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'unknown movement type %', NEW.movement_type;
    END IF;

    v_sign := CASE v_mt.direction WHEN 'OUT' THEN 1 WHEN 'IN' THEN -1 ELSE 0 END;

    IF NEW.total_value IS NULL THEN
        NEW.total_value := ROUND(ABS(COALESCE(NEW.quantity, 0)) * COALESCE(NEW.cost_at_time, 0) * v_sign, 2);
    END IF;

    IF NEW.cost_center_id IS NULL THEN
        IF NEW.wo_id IS NOT NULL THEN
            SELECT r.cost_center_id INTO NEW.cost_center_id
            FROM public.sem_wo_receiver r WHERE r.work_order_id = NEW.wo_id;
        END IF;
        IF NEW.cost_center_id IS NULL THEN
            SELECT i.cost_center_id INTO NEW.cost_center_id
            FROM public.inventory_items i WHERE i.id = NEW.item_id;
        END IF;
    END IF;

    IF NEW.asset_id IS NULL AND NEW.wo_id IS NOT NULL THEN
        SELECT w.asset_id INTO NEW.asset_id FROM public.work_orders w WHERE w.id = NEW.wo_id;
    END IF;

    -- The tenant's own account first, the catalog's only as a fallback.
    -- Column defaults are applied before BEFORE-INSERT triggers, so
    -- NEW.company_id is already populated here.
    IF NEW.gl_account IS NULL THEN
        SELECT o.gl_account INTO NEW.gl_account
        FROM public.movement_type_gl_overrides o
        WHERE o.code = NEW.movement_type
          AND o.company_id IS NOT DISTINCT FROM NEW.company_id;
        NEW.gl_account := COALESCE(NEW.gl_account, v_mt.gl_account);
    END IF;

    RETURN NEW;
END;
$$;

-- ───────────────────────────────────────────────────────────────
-- 4. Cross-tenant guards on the DEFINER entry points
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
    v_company UUID;
    v_caller  UUID;
    v_ids     UUID[];
BEGIN
    SELECT w.asset_id, w.company_id INTO v_asset, v_company
    FROM public.work_orders w WHERE w.id = p_wo_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ers_settle_work_order: work order % not found', p_wo_id;
    END IF;

    BEGIN v_user   := auth.uid();               EXCEPTION WHEN OTHERS THEN v_user := NULL; END;
    BEGIN v_caller := public.caller_company();   EXCEPTION WHEN OTHERS THEN v_caller := NULL; END;

    IF v_caller IS NOT NULL AND v_company IS NOT NULL AND v_caller <> v_company THEN
        RAISE EXCEPTION 'ers_settle_work_order: work order % belongs to another tenant', p_wo_id
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_company := COALESCE(v_company, v_caller);

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
    v_year    INT := COALESCE(p_fiscal_year, EXTRACT(YEAR FROM CURRENT_DATE)::INT);
    v_total   NUMERIC;
    v_company UUID;
    v_caller  UUID;
BEGIN
    IF p_cost_center_id IS NULL THEN RETURN NULL; END IF;

    SELECT cc.company_id INTO v_company FROM public.cost_centers cc WHERE cc.id = p_cost_center_id;
    BEGIN v_caller := public.caller_company(); EXCEPTION WHEN OTHERS THEN v_caller := NULL; END;
    IF v_caller IS NOT NULL AND v_company IS NOT NULL AND v_caller <> v_company THEN
        RAISE EXCEPTION 'ers_refresh_budget_actual: cost centre belongs to another tenant'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

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

-- The batch run SCOPES rather than merely refusing: a signed-in user runs it
-- for their own tenant, and only a trusted no-JWT context sweeps everything.
CREATE OR REPLACE FUNCTION public.ers_settlement_run(p_limit INT DEFAULT 500)
RETURNS TABLE (work_order_id UUID, wo_number TEXT, postings BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    r        RECORD;
    v_rows   BIGINT;
    v_caller UUID;
BEGIN
    BEGIN v_caller := public.caller_company(); EXCEPTION WHEN OTHERS THEN v_caller := NULL; END;

    FOR r IN
        SELECT s.work_order_id AS id, s.wo_number AS num
        FROM public.sem_wo_settlement s
        JOIN public.work_orders w ON w.id = s.work_order_id
        WHERE s.wo_state = 'done'
          AND ABS(s.unsettled_variance) >= 0.01
          -- sem_wo_settlement is security_invoker, but inside a DEFINER
          -- function the invoker IS the owner, so RLS does not filter here.
          -- The predicate has to be explicit.
          AND (v_caller IS NULL OR w.company_id = v_caller)
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

-- ───────────────────────────────────────────────────────────────
-- 5. Invoice matching: guarded, and tolerances per tenant
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ers_match_invoice(p_invoice_id UUID)
RETURNS TABLE (match_status TEXT, payment_block TEXT, variance_amount NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tol      public.invoice_tolerances%ROWTYPE;
    v_status   TEXT;
    v_block    TEXT;
    v_variance NUMERIC;
    v_po       NUMERIC;
    v_grn      NUMERIC;
    v_user     UUID;
    v_company  UUID;
    v_caller   UUID;
BEGIN
    SELECT m.company_id INTO v_company FROM public.invoice_matches m WHERE m.id = p_invoice_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ers_match_invoice: invoice % not found', p_invoice_id;
    END IF;

    BEGIN v_caller := public.caller_company(); EXCEPTION WHEN OTHERS THEN v_caller := NULL; END;
    IF v_caller IS NOT NULL AND v_company IS NOT NULL AND v_caller <> v_company THEN
        RAISE EXCEPTION 'ers_match_invoice: invoice % belongs to another tenant', p_invoice_id
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- The tenant's own tolerance wins; the global row is the fallback.
    SELECT * INTO v_tol
    FROM public.invoice_tolerances t
    WHERE t.name = 'DEFAULT' AND t.active
      AND (t.company_id = v_company OR t.company_id IS NULL)
    ORDER BY t.company_id NULLS LAST
    LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ers_match_invoice: no active DEFAULT tolerance configured';
    END IF;

    BEGIN v_user := auth.uid(); EXCEPTION WHEN OTHERS THEN v_user := NULL; END;

    WITH gr AS (
        SELECT g.po_line_id, SUM(g.quantity) AS qty
        FROM public.goods_receipts g
        WHERE g.po_line_id IS NOT NULL
        GROUP BY g.po_line_id
    ),
    scored AS (
        SELECT iml.id,
               iml.unit_price,
               pol.unit_cost                                             AS po_unit_cost,
               COALESCE(gr.qty, 0)                                       AS gr_qty,
               ROUND((iml.unit_price - COALESCE(pol.unit_cost, iml.unit_price)) * iml.quantity, 2) AS price_var,
               GREATEST(iml.quantity - COALESCE(gr.qty, 0), 0)           AS qty_over
        FROM public.invoice_match_lines iml
        LEFT JOIN public.purchase_order_lines pol ON pol.id = iml.po_line_id
        LEFT JOIN gr ON gr.po_line_id = iml.po_line_id
        WHERE iml.invoice_id = p_invoice_id
    ),
    verdict AS (
        SELECT s.*,
               (ABS(s.price_var) > v_tol.price_abs
                AND ABS(s.price_var) > (v_tol.price_pct / 100.0)
                    * NULLIF(ABS(s.po_unit_cost * NULLIF(s.gr_qty, 0)), 0)) AS price_bad,
               (s.qty_over > v_tol.qty_abs)                                 AS qty_bad
        FROM scored s
    )
    UPDATE public.invoice_match_lines iml
       SET po_unit_cost   = v.po_unit_cost,
           gr_quantity    = v.gr_qty,
           price_variance = v.price_var,
           qty_variance   = v.qty_over,
           block_reason   = CASE WHEN COALESCE(v.qty_bad, FALSE)   THEN 'QUANTITY'
                                 WHEN COALESCE(v.price_bad, FALSE) THEN 'PRICE' END,
           line_status    = CASE WHEN COALESCE(v.qty_bad, FALSE) OR COALESCE(v.price_bad, FALSE)
                                 THEN 'BLOCKED' ELSE 'MATCHED' END
      FROM verdict v
     WHERE v.id = iml.id;

    SELECT CASE WHEN COUNT(*) FILTER (WHERE l.line_status = 'BLOCKED') > 0 THEN 'BLOCKED'
                WHEN COUNT(*) = 0                                          THEN 'PENDING'
                ELSE 'MATCHED' END,
           MAX(l.block_reason),
           COALESCE(SUM(ABS(l.price_variance)
                        + COALESCE(l.qty_variance, 0) * COALESCE(l.unit_price, 0)), 0)
      INTO v_status, v_block, v_variance
      FROM public.invoice_match_lines l
     WHERE l.invoice_id = p_invoice_id;

    SELECT COALESCE(SUM(pol.qty_ordered * pol.unit_cost), 0),
           COALESCE(SUM(l.gr_quantity  * pol.unit_cost), 0)
      INTO v_po, v_grn
      FROM public.invoice_match_lines l
      LEFT JOIN public.purchase_order_lines pol ON pol.id = l.po_line_id
     WHERE l.invoice_id = p_invoice_id;

    UPDATE public.invoice_matches m
       SET match_status      = v_status,
           payment_block     = v_block,
           po_amount         = v_po,
           grn_amount        = v_grn,
           variance_amount   = ROUND(v_variance, 2),
           tolerance_exceeded = (v_status = 'BLOCKED'),
           matched_by        = COALESCE(m.matched_by, v_user),
           matched_at        = NOW(),
           updated_at        = NOW()
     WHERE m.id = p_invoice_id;

    UPDATE public.purchase_order_lines pol
       SET invoice_matched = (v_status = 'MATCHED'),
           invoice_number  = m.invoice_number,
           updated_at      = NOW()
      FROM public.invoice_match_lines l
      JOIN public.invoice_matches m ON m.id = l.invoice_id
     WHERE l.po_line_id = pol.id AND l.invoice_id = p_invoice_id;

    RETURN QUERY SELECT v_status, v_block, ROUND(v_variance, 2);
END;
$$;

COMMENT ON FUNCTION public.ers_settlement_run(INT) IS
    'Settle every finished order carrying an unsettled variance, scoped to the caller''s tenant when the JWT carries one. Safe to re-run.';

COMMIT;
