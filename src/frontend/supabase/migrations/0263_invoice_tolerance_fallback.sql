-- ═══════════════════════════════════════════════════════════════
-- 0263 — A new tenant could not match an invoice at all.
--
-- 0262 made invoice tolerances per-tenant, which is right: thresholds
-- differ by commodity and by how much a supplier is trusted. But the
-- lookup then raised
--
--     'ers_match_invoice: no active DEFAULT tolerance configured'
--
-- for any tenant nobody had seeded a row for — which is every tenant on
-- the day it is provisioned. Accounts payable would be dead on arrival
-- with an error message that reads like a bug rather than a setup step.
--
-- The fallback is the same conservative pair the DEFAULT row is seeded
-- with: 1.00 / 2% on price, and ZERO on quantity. That direction matters.
-- An unconfigured tenant therefore errs towards blocking — being invoiced
-- for goods nobody receipted is still refused — so the failure mode is
-- "too strict", which a person notices and fixes in a morning. The other
-- direction fails by paying, which nobody notices at all.
--
-- Resolution order is unchanged and explicit: the tenant's own row, then a
-- global row if one exists, then these built-ins.
--
-- Rollback: restore the 0262 body of ers_match_invoice.
-- ═══════════════════════════════════════════════════════════════
BEGIN;

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

    -- The tenant's own tolerance, then a global row, then the built-in.
    SELECT * INTO v_tol
    FROM public.invoice_tolerances t
    WHERE t.name = 'DEFAULT' AND t.active
      AND (t.company_id = v_company OR t.company_id IS NULL)
    ORDER BY t.company_id NULLS LAST
    LIMIT 1;

    IF NOT FOUND THEN
        -- Never block AP on missing configuration; block on the conservative
        -- side instead. Zero quantity tolerance means an over-billed invoice
        -- is still caught by an unconfigured tenant.
        v_tol.price_abs := 1.00;
        v_tol.price_pct := 2.00;
        v_tol.qty_abs   := 0;
        v_tol.qty_pct   := 0;
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

COMMENT ON FUNCTION public.ers_match_invoice(UUID) IS
    'Three-way match an invoice against its PO lines and goods receipts, scoped to the invoice''s tenant. Tolerances resolve tenant → global → conservative built-in, so a newly provisioned tenant can match invoices before anyone configures anything. Idempotent.';

COMMIT;
