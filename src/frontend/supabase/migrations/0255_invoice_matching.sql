-- ═══════════════════════════════════════════════════════════════
-- 0255 — FI-3: the invoice leg. Three-way match becomes real.
--
-- PO and GR became real documents in 0248. The invoice was still a
-- checkbox: "matched" was a boolean plus a free-text number typed onto a
-- line, with no amount, no date, no vendor, and nothing to compare. So the
-- one control the whole exercise exists for — do not pay for what you did
-- not order or did not receive — could not be enforced.
--
--   PO line    (0248)  what we agreed to buy, and at what price
--   GR         (0248)  what actually arrived
--   INVOICE    (here)  what they are asking to be paid for
--
-- A match compares all three PER LINE, because that is where the two ways
-- of being wrong live: an over-price (right quantity, wrong money) and an
-- over-delivery claim (invoicing more than was received). A header-only
-- comparison nets them against each other and can pass an invoice that is
-- wrong twice.
--
-- WHAT BLOCKS PAYMENT, and why those two:
--   PRICE     invoiced unit price exceeds the PO price beyond tolerance
--   QUANTITY  invoiced quantity exceeds what has been receipted
-- Both default to blocking rather than warning. An invoice that is
-- questioned late is an argument; one that is paid early is a write-off.
--
-- DUPLICATE INVOICE CONTROL: UNIQUE (vendor_id, invoice_number). Paying the
-- same invoice twice is the most common accounts-payable loss there is, and
-- it is a one-line constraint.
--
-- Tolerances are a table, not a constant, because they are exactly what an
-- ERP onboarding configures per tenant (SAP tolerance keys PP/DQ) and they
-- differ by commodity and supplier maturity.
--
-- Rollback:
--   DROP VIEW IF EXISTS sem_invoice_matches;
--   DROP FUNCTION IF EXISTS ers_match_invoice(uuid);
--   DROP TABLE IF EXISTS invoice_match_lines, invoice_tolerances;
--   ALTER TABLE invoice_matches DROP CONSTRAINT IF EXISTS invoice_matches_vendor_number_uq;
-- ═══════════════════════════════════════════════════════════════
BEGIN;

-- ───────────────────────────────────────────────────────────────
-- 1. Tolerances (SAP tolerance keys)
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invoice_tolerances (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL UNIQUE,
    -- A variance must exceed BOTH the absolute and the percentage figure to
    -- count. Absolute alone punishes small orders; percentage alone lets a
    -- large order leak real money inside a "small" percentage.
    price_abs     NUMERIC(15, 2) NOT NULL DEFAULT 1.00,
    price_pct     NUMERIC(5, 2)  NOT NULL DEFAULT 2.00,
    qty_abs       NUMERIC(14, 3) NOT NULL DEFAULT 0,
    qty_pct       NUMERIC(5, 2)  NOT NULL DEFAULT 0,
    active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.invoice_tolerances IS
    'Invoice matching tolerances (SAP tolerance keys PP price / DQ quantity). Configured per tenant at ERP onboarding.';
COMMENT ON COLUMN public.invoice_tolerances.qty_abs IS
    'Defaults to zero: being invoiced for more than was receipted is not a rounding difference, it is a claim about goods nobody has seen.';

INSERT INTO public.invoice_tolerances (name, price_abs, price_pct, qty_abs, qty_pct)
VALUES ('DEFAULT', 1.00, 2.00, 0, 0)
ON CONFLICT (name) DO NOTHING;

ALTER TABLE public.invoice_tolerances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "invoice_tolerances_read" ON public.invoice_tolerances;
CREATE POLICY "invoice_tolerances_read" ON public.invoice_tolerances
    FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "invoice_tolerances_admin_write" ON public.invoice_tolerances;
CREATE POLICY "invoice_tolerances_admin_write" ON public.invoice_tolerances
    FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ───────────────────────────────────────────────────────────────
-- 2. The invoice, per line
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invoice_match_lines (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id     UUID NOT NULL REFERENCES public.invoice_matches(id) ON DELETE CASCADE,
    po_line_id     UUID REFERENCES public.purchase_order_lines(id) ON DELETE SET NULL,

    -- What the vendor is claiming on this line.
    quantity       NUMERIC(14, 3) NOT NULL DEFAULT 0,
    unit_price     NUMERIC(15, 4) NOT NULL DEFAULT 0,
    amount         NUMERIC(15, 2) GENERATED ALWAYS AS (ROUND(quantity * unit_price, 2)) STORED,

    -- Filled by ers_match_invoice. Stored rather than derived so the verdict
    -- that was acted on stays readable after prices or receipts move on.
    po_unit_cost   NUMERIC(15, 4),
    gr_quantity    NUMERIC(14, 3),
    price_variance NUMERIC(15, 2),
    qty_variance   NUMERIC(14, 3),
    line_status    TEXT,
    block_reason   TEXT,

    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.invoice_match_lines IS
    'Invoice lines matched to PO lines. The three-way comparison happens here — a header-only match nets a price error against a quantity error and can pass an invoice that is wrong twice.';

CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON public.invoice_match_lines (invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_po_line ON public.invoice_match_lines (po_line_id);

ALTER TABLE public.invoice_match_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "invoice_lines_auth_all" ON public.invoice_match_lines;
CREATE POLICY "invoice_lines_auth_all" ON public.invoice_match_lines
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- The duplicate-payment control. NULL vendor_id rows are exempt because
-- NULLs are never equal — a vendor is required for the control to bite, and
-- an invoice without one cannot be paid anyway.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_matches_vendor_number_uq') THEN
        ALTER TABLE public.invoice_matches
            ADD CONSTRAINT invoice_matches_vendor_number_uq UNIQUE (vendor_id, invoice_number);
    END IF;
END $$;

-- ───────────────────────────────────────────────────────────────
-- 3. The match
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
BEGIN
    SELECT * INTO v_tol FROM public.invoice_tolerances WHERE name = 'DEFAULT' AND active;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ers_match_invoice: no active DEFAULT tolerance configured';
    END IF;

    BEGIN v_user := auth.uid(); EXCEPTION WHEN OTHERS THEN v_user := NULL; END;

    -- Score every line against its PO line and its receipts.
    WITH gr AS (
        SELECT g.po_line_id, SUM(g.quantity) AS qty
        FROM public.goods_receipts g
        WHERE g.po_line_id IS NOT NULL
        GROUP BY g.po_line_id
    ),
    scored AS (
        SELECT iml.id,
               pol.unit_cost                                             AS po_unit_cost,
               COALESCE(gr.qty, 0)                                       AS gr_qty,
               -- Price: what the difference in unit price costs on the
               -- quantity actually being invoiced.
               ROUND((iml.unit_price - COALESCE(pol.unit_cost, iml.unit_price)) * iml.quantity, 2) AS price_var,
               -- Quantity: only over-invoicing is a fault. Being invoiced for
               -- less than arrived is the vendor's loss, not ours.
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

    -- The header takes the worst line: one bad line blocks the payment,
    -- because a payment is made or withheld as a whole.
    SELECT CASE WHEN COUNT(*) FILTER (WHERE l.line_status = 'BLOCKED') > 0 THEN 'BLOCKED'
                WHEN COUNT(*) = 0                                          THEN 'PENDING'
                ELSE 'MATCHED' END,
           MAX(l.block_reason),
           COALESCE(SUM(ABS(l.price_variance)), 0)
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
           variance_amount   = v_variance,
           tolerance_exceeded = (v_status = 'BLOCKED'),
           matched_by        = COALESCE(m.matched_by, v_user),
           matched_at        = NOW(),
           updated_at        = NOW()
     WHERE m.id = p_invoice_id;

    -- Keep the PO line's badge honest: a line is "invoiced" only once an
    -- invoice covering it has actually passed.
    UPDATE public.purchase_order_lines pol
       SET invoice_matched = (v_status = 'MATCHED'),
           invoice_number  = m.invoice_number,
           updated_at      = NOW()
      FROM public.invoice_match_lines l
      JOIN public.invoice_matches m ON m.id = l.invoice_id
     WHERE l.po_line_id = pol.id AND l.invoice_id = p_invoice_id;

    RETURN QUERY SELECT v_status, v_block, v_variance;
END;
$$;

COMMENT ON FUNCTION public.ers_match_invoice(UUID) IS
    'Three-way match an invoice against its PO lines and goods receipts. Scores every line, blocks the payment on the worst. Idempotent — re-run after a late receipt to re-verdict.';

-- ───────────────────────────────────────────────────────────────
-- 4. The payables queue
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.sem_invoice_matches AS
SELECT m.id                       AS invoice_id,
       m.invoice_number,
       m.invoice_date,
       m.vendor_id,
       v.name                     AS vendor_name,
       m.po_id,
       p.po_code,
       m.invoice_amount,
       m.po_amount,
       m.grn_amount,
       m.variance_amount,
       m.match_status,
       m.payment_block,
       m.payment_date IS NOT NULL AS paid,
       m.matched_at,
       (SELECT COUNT(*) FROM public.invoice_match_lines l WHERE l.invoice_id = m.id) AS lines,
       (SELECT COUNT(*) FROM public.invoice_match_lines l
         WHERE l.invoice_id = m.id AND l.line_status = 'BLOCKED')                    AS blocked_lines,
       -- What a payables clerk needs to know in one column.
       CASE
           WHEN m.payment_date IS NOT NULL      THEN 'paid'
           WHEN m.match_status = 'BLOCKED'      THEN 'blocked — ' || COALESCE(lower(m.payment_block), 'variance')
           WHEN m.match_status = 'MATCHED'      THEN 'cleared for payment'
           ELSE 'not yet matched'
       END                        AS payables_status
FROM public.invoice_matches m
LEFT JOIN public.vendors         v ON v.id = m.vendor_id
LEFT JOIN public.purchase_orders p ON p.id = m.po_id;

COMMENT ON VIEW public.sem_invoice_matches IS
    'Accounts-payable queue: every invoice with its three-way match verdict and why it is blocked. The extract an AP or ERP finance integration reads.';

GRANT SELECT ON public.invoice_tolerances    TO authenticated, service_role;
GRANT SELECT ON public.sem_invoice_matches   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ers_match_invoice(UUID) TO authenticated, service_role;

DELETE FROM public.semantic_catalog
 WHERE object_name = 'sem_invoice_matches'
   AND column_name IN ('match_status', 'payables_status');

INSERT INTO public.semantic_catalog
    (object_name, column_name, title, description, tags, source_tables, iso_standard)
VALUES
    ('sem_invoice_matches', 'match_status', 'Three-way match verdict',
     'MATCHED (invoice agrees with the order and the receipts within tolerance), BLOCKED (a line is over-priced or claims more than was received), PENDING (no lines matched yet). Scored per line, because a header-only comparison nets a price error against a quantity error.',
     ARRAY['finops', 'purchasing', 'canonical'], ARRAY['invoice_matches', 'invoice_match_lines', 'purchase_order_lines', 'goods_receipts'], NULL),
    ('sem_invoice_matches', 'payables_status', 'Payables status',
     'What a payables clerk should do with this invoice: cleared for payment, blocked with the reason, already paid, or not yet matched.',
     ARRAY['finops', 'kpi'], ARRAY['invoice_matches'], NULL);

COMMIT;
