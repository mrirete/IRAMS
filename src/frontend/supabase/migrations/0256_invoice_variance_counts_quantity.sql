-- ═══════════════════════════════════════════════════════════════
-- 0256 — An invoice blocked for quantity reported a variance of zero.
--
-- Caught by testing 0255 against real data. Billing for 10 when 6 arrived
-- was correctly BLOCKED with reason QUANTITY, and then reported:
--
--     match_status  payment_block  variance_amount
--     BLOCKED       QUANTITY       0.00
--
-- which reads as a contradiction on a payables screen — blocked, but
-- apparently nothing is wrong. The variance only summed price differences,
-- and an over-delivery claim has no price difference: every unit is at the
-- agreed price, there are simply units nobody received.
--
-- Variance should answer one question — how much money is at risk on this
-- invoice — so it now counts both ways of being wrong:
--
--     |price variance|            wrong money for the right quantity
--   + over-billed qty x price     right money for a quantity that
--                                 has not been receipted
--
-- The verdict and the block reason are unchanged; only the number that
-- explains them is. Re-run ers_match_invoice on any open invoice to
-- restate it — the function is idempotent.
--
-- Rollback: restore the 0255 body of this function.
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
BEGIN
    SELECT * INTO v_tol FROM public.invoice_tolerances WHERE name = 'DEFAULT' AND active;
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
           -- Money at risk: wrong price on what arrived, PLUS the value of
           -- what is being billed for and has not arrived.
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
    'Three-way match an invoice against its PO lines and goods receipts. Scores every line, blocks the payment on the worst, and reports the money at risk — wrong price plus un-receipted quantity (0256). Idempotent.';

COMMIT;
