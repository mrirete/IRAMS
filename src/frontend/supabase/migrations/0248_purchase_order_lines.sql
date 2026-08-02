-- ═══════════════════════════════════════════════════════════════
-- 0248 — Purchase order lines become rows.
--
-- PO value, receipts and invoice matching all lived in one JSONB array
-- (`purchase_orders.items`). Three things follow from that, and all three
-- have already cost something:
--
--   • Nothing can reference a line. `goods_receipts.po_line_item` is an
--     integer pointing at an array position, so a line reorder silently
--     re-points every receipt ever taken. That is why goods_receipts was
--     never written by any code — there was nothing safe to point at.
--   • Nothing can aggregate. FinOps' three-way-match queue selected
--     `po.total_amount`, a column that does not exist, and crashed
--     production on 2026-08-02 (ERR-2Q5ZRV) calling .toLocaleString() on
--     the undefined it got back.
--   • Nothing can map to SAP. SAP posts per line item (EBELP); a GR/IR
--     match cannot be built out of array positions.
--
-- Lines are also where SERVICE cost enters the order-to-cost spine: a PO
-- line carrying a work order but no stock item is contractor/service cost
-- that never passes through inventory, so it can never be picked up by a
-- goods issue. 0249 settles those.
--
-- THE JSONB COLUMN IS NOT DROPPED. It is left exactly as it is, frozen, as
-- the rollback path and the evidence this backfill can be checked against.
-- Drop it in a later migration once the line table has run in anger.
--
-- Line identity: the app generated ids as `pi-` + Date.now(), which collide
-- when two lines are added inside the same millisecond and are not uuids.
-- Backfilled rows get real uuids and keep the old string in
-- `legacy_ref` so an existing screen, export or support question can still
-- be traced. New lines are uuids from the client.
--
-- Rollback:
--   DROP VIEW IF EXISTS sem_purchase_order_lines;
--   DROP TABLE IF EXISTS purchase_order_lines;
--   ALTER TABLE goods_receipts DROP COLUMN IF EXISTS po_line_id;
--   (purchase_orders.items is untouched and still authoritative)
-- ═══════════════════════════════════════════════════════════════
BEGIN;

CREATE TABLE IF NOT EXISTS public.purchase_order_lines (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_id          UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
    -- SAP EBELP. Spaced by 10 so a line can be inserted between two others
    -- without renumbering anything a receipt already points at.
    line_no        INTEGER NOT NULL,
    /** The pre-0248 array id (`pi-…`), kept for traceability. Never used as a key. */
    legacy_ref     TEXT,

    -- MATERIAL passes through stock and is consumed by a goods issue.
    -- SERVICE never touches stock, so receiving it IS the consumption.
    line_type      TEXT NOT NULL DEFAULT 'MATERIAL'
                   CHECK (line_type IN ('MATERIAL', 'SERVICE')),

    inventory_id   UUID REFERENCES public.inventory_items(id) ON DELETE SET NULL,
    description    TEXT NOT NULL DEFAULT '',
    uom            TEXT NOT NULL DEFAULT 'EA',

    qty_ordered    NUMERIC(14, 3) NOT NULL DEFAULT 0,
    qty_received   NUMERIC(14, 3) NOT NULL DEFAULT 0,

    unit_cost      NUMERIC(15, 4) NOT NULL DEFAULT 0,
    tax_amount     NUMERIC(15, 2) NOT NULL DEFAULT 0,
    -- Generated, so the stored total can never drift from its own inputs —
    -- the JSONB `lineTotal` could, and did, disagree with qty x cost.
    line_total     NUMERIC(15, 2) GENERATED ALWAYS AS (ROUND(qty_ordered * unit_cost, 2)) STORED,

    -- Account assignment (SAP: the line's account assignment category).
    work_order_id  UUID REFERENCES public.work_orders(id) ON DELETE SET NULL,
    cost_center_id UUID REFERENCES public.cost_centers(id),
    gl_account     TEXT,

    invoice_number  TEXT,
    invoice_matched BOOLEAN NOT NULL DEFAULT FALSE,

    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- DEFERRABLE because saving a reordered order renumbers several lines in
    -- one statement: swapping 10 and 20 passes through a moment where both
    -- exist twice. Checked at commit, so the end state is what is enforced.
    -- The id primary key stays immediate — it is what upserts arbitrate on.
    UNIQUE (po_id, line_no) DEFERRABLE INITIALLY DEFERRED
);

COMMENT ON TABLE public.purchase_order_lines IS
    'PO line items as rows (SAP EKPO). Replaces purchase_orders.items as the write target; the JSONB column is frozen legacy.';
COMMENT ON COLUMN public.purchase_order_lines.line_type IS
    'MATERIAL passes through stock and is consumed by a goods issue (261). SERVICE never touches stock, so receipt IS consumption and it settles to the order directly (0249).';
COMMENT ON COLUMN public.purchase_order_lines.line_no IS
    'SAP EBELP. Spaced by 10 so lines can be inserted without renumbering.';

CREATE INDEX IF NOT EXISTS idx_po_lines_po       ON public.purchase_order_lines (po_id, line_no);
CREATE INDEX IF NOT EXISTS idx_po_lines_wo       ON public.purchase_order_lines (work_order_id) WHERE work_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_po_lines_item     ON public.purchase_order_lines (inventory_id);
CREATE INDEX IF NOT EXISTS idx_po_lines_service  ON public.purchase_order_lines (work_order_id, line_type) WHERE line_type = 'SERVICE';

-- Same posture as `purchase_orders` itself, which 0246 deliberately left out
-- of the FinOps read gate pending purchasing's own reader sweep. When that
-- sweep happens this table must be swept WITH the header — a line carries the
-- price, so gating the order and not its lines protects nothing. Note the
-- shape to use: 0246 found that a `FOR ALL USING (true)` sitting beside a
-- restrictive SELECT policy silently re-grants read to everyone, because RLS
-- policies are OR-ed. Replace this policy, do not add beside it.
ALTER TABLE public.purchase_order_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "po_lines_auth_all" ON public.purchase_order_lines;
CREATE POLICY "po_lines_auth_all" ON public.purchase_order_lines
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ───────────────────────────────────────────────────────────────
-- Backfill from the JSONB
-- ───────────────────────────────────────────────────────────────
-- Guarded casts: `inventoryId` and `jobId` are free-form in the array and
-- have held codes as well as uuids. A malformed value becomes NULL rather
-- than failing the whole migration — and shows up as an unlinked line,
-- which is visible, instead of a bad reference, which is not.
INSERT INTO public.purchase_order_lines
    (po_id, line_no, legacy_ref, line_type, inventory_id, description, uom,
     qty_ordered, qty_received, unit_cost, tax_amount,
     work_order_id, gl_account, invoice_number, invoice_matched)
SELECT p.id,
       (ROW_NUMBER() OVER (PARTITION BY p.id ORDER BY t.ord)) * 10,
       NULLIF(t.it->>'id', ''),
       CASE WHEN NULLIF(t.it->>'inventoryId', '') IS NOT NULL THEN 'MATERIAL' ELSE 'SERVICE' END,
       CASE WHEN t.it->>'inventoryId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN (t.it->>'inventoryId')::UUID END,
       COALESCE(t.it->>'description', ''),
       COALESCE(NULLIF(t.it->>'uom', ''), 'EA'),
       COALESCE((t.it->>'qtyOrdered')::NUMERIC, 0),
       COALESCE((t.it->>'qtyReceivedTotal')::NUMERIC, 0),
       COALESCE((t.it->>'unitCost')::NUMERIC, 0),
       COALESCE((t.it->>'taxAmount')::NUMERIC, 0),
       CASE WHEN t.it->>'jobId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN (t.it->>'jobId')::UUID END,
       NULLIF(t.it->>'glCode', ''),
       NULLIF(t.it->>'invoiceNumber', ''),
       COALESCE((t.it->>'invoiceMatched')::BOOLEAN, FALSE)
FROM public.purchase_orders p
CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(p.items) = 'array' THEN p.items ELSE '[]'::jsonb END
) WITH ORDINALITY AS t(it, ord)
WHERE NOT EXISTS (SELECT 1 FROM public.purchase_order_lines l WHERE l.po_id = p.id);

-- ───────────────────────────────────────────────────────────────
-- Goods receipts can finally point at something stable
-- ───────────────────────────────────────────────────────────────
ALTER TABLE public.goods_receipts
    ADD COLUMN IF NOT EXISTS po_line_id UUID;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'goods_receipts_po_line_id_fkey') THEN
        ALTER TABLE public.goods_receipts
            ADD CONSTRAINT goods_receipts_po_line_id_fkey
            FOREIGN KEY (po_line_id) REFERENCES public.purchase_order_lines(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_goods_receipts_po_line ON public.goods_receipts (po_line_id);

COMMENT ON COLUMN public.goods_receipts.po_line_id IS
    'The line this receipt is against. Replaces po_line_item, an array position that moved whenever lines were reordered.';

-- A goods receipt is a numbered document (SAP number range), so the number
-- comes from the database, not from whichever client happened to create it.
-- grn_number is UNIQUE and NOT NULL with no default, which is a large part
-- of why nothing ever wrote this table.
CREATE SEQUENCE IF NOT EXISTS public.goods_receipt_seq;

ALTER TABLE public.goods_receipts
    ALTER COLUMN grn_number SET DEFAULT
        'GRN-' || to_char(CURRENT_DATE, 'YYYY') || '-' ||
        lpad(nextval('public.goods_receipt_seq')::TEXT, 6, '0');

GRANT USAGE ON SEQUENCE public.goods_receipt_seq TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────
-- One place to read a PO line with everything it means
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.sem_purchase_order_lines AS
SELECT l.id                                   AS line_id,
       l.po_id,
       p.po_code,
       p.status                               AS po_status,
       p.supplier_id,
       l.line_no,
       l.line_type,
       l.description,
       l.inventory_id,
       i.part_number,
       l.work_order_id,
       w.wo_number,
       l.uom,
       l.qty_ordered,
       l.qty_received,
       GREATEST(l.qty_ordered - l.qty_received, 0) AS qty_outstanding,
       l.unit_cost,
       l.line_total,
       ROUND(l.qty_received * l.unit_cost, 2)  AS received_value,
       l.cost_center_id,
       l.gl_account,
       l.invoice_matched,
       -- Where the line has got to, in one word.
       CASE
           WHEN l.qty_received <= 0                 THEN 'awaiting delivery'
           WHEN l.qty_received < l.qty_ordered      THEN 'part received'
           WHEN l.invoice_matched                   THEN 'invoiced'
           ELSE 'received, awaiting invoice'
       END                                    AS line_status
FROM public.purchase_order_lines l
JOIN public.purchase_orders p ON p.id = l.po_id
LEFT JOIN public.inventory_items i ON i.id = l.inventory_id
LEFT JOIN public.work_orders     w ON w.id = l.work_order_id;

COMMENT ON VIEW public.sem_purchase_order_lines IS
    'PO lines with their order, item, work order and receipt state. The extract an ERP purchasing integration reads.';

GRANT SELECT ON public.sem_purchase_order_lines TO authenticated, service_role;

COMMIT;
