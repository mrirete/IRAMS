-- ═══════════════════════════════════════════════════════════════
-- 0260 — Two gaps the Tier-1 export walked into.
--
-- 1. `goods_receipts.po_id` and `.inventory_id` were declared "soft FK" in
--    0034 and never constrained. Two consequences:
--
--    • Nothing stopped a receipt pointing at a purchase order or an item
--      that does not exist. This is the same lost-FK class the July
--      quality audit called out as a recurring root cause here.
--    • PostgREST derives its embedding graph from foreign keys, so
--      `goods_receipts?select=*,purchase_orders(po_code)` fails — there is
--      no relationship to traverse. The export service needs exactly that
--      to put a PO code and a material number on a receipt document,
--      because a receiver can do nothing with our UUIDs.
--
--    Verified zero orphans before adding them. ON DELETE SET NULL rather
--    than CASCADE: a receipt is a financial document and must survive the
--    deletion of what it refers to, holding its own quantities and values.
--
-- 2. `sem_invoice_matches` omitted `currency`, so the export defaulted
--    every invoice to the tenant currency. Harmless while one currency is
--    in use and wrong the moment one is not — and a wrong currency on a
--    payment document is not a rounding error.
--
-- Rollback:
--   ALTER TABLE goods_receipts DROP CONSTRAINT goods_receipts_po_id_fkey,
--                              DROP CONSTRAINT goods_receipts_inventory_id_fkey;
--   (restore the 0255 body of sem_invoice_matches)
-- ═══════════════════════════════════════════════════════════════
BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'goods_receipts_po_id_fkey') THEN
        ALTER TABLE public.goods_receipts
            ADD CONSTRAINT goods_receipts_po_id_fkey
            FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'goods_receipts_inventory_id_fkey') THEN
        ALTER TABLE public.goods_receipts
            ADD CONSTRAINT goods_receipts_inventory_id_fkey
            FOREIGN KEY (inventory_id) REFERENCES public.inventory_items(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_goods_receipts_inventory ON public.goods_receipts (inventory_id);

-- DROP then CREATE, not CREATE OR REPLACE: replace can only APPEND columns,
-- and `currency` belongs next to `invoice_amount` rather than bolted on the
-- end. (The first attempt at this migration failed on exactly that —
-- "cannot change name of view column po_amount to currency" — and the runner
-- rolled the whole file back, which is the transaction discipline working.)
-- security_invoker is restated because a DROP takes the 0259 setting with it.
DROP VIEW IF EXISTS public.sem_invoice_matches;

CREATE VIEW public.sem_invoice_matches
WITH (security_invoker = true) AS
SELECT m.id                       AS invoice_id,
       m.invoice_number,
       m.invoice_date,
       m.vendor_id,
       v.name                     AS vendor_name,
       m.po_id,
       p.po_code,
       m.invoice_amount,
       m.currency,
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

GRANT SELECT ON public.sem_invoice_matches TO authenticated, service_role;

COMMIT;
