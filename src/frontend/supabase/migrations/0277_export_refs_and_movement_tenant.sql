-- ═══════════════════════════════════════════════════════════════
-- 0277 — What an end-to-end assessment of the Tier-1 pipe found.
--
-- Driving one realistic period through the whole integration surface —
-- settle, move, receive, invoice, export — surfaced four defects. Three
-- are the same lesson wearing different hats: a layer that was correct
-- alone met a neighbour that had since moved.
--
-- ── 1. Movements with no JWT stopped working the day 0276 landed ──
-- ers_movement_defaults derives an untyped movement's cost centre from its
-- work order and its asset from its order — but never its tenant. That was
-- harmless while company_id was nullable: a service-role or cron insert
-- simply defaulted to NULL. 0276 made the column NOT NULL, and now the
-- same insert FAILS OUTRIGHT:
--
--     23502: null value in column "company_id" of relation
--     "inventory_transactions"
--
-- Measured live, not predicted. Browser inserts survive (the JWT feeds the
-- column DEFAULT); every trusted-context path — and erp-sync, when it
-- arrives, IS one — dies. The 0261 rule, again: a definer-context write
-- derives its tenant from the data, never from the session. The BEFORE
-- trigger is exactly where that belongs: work order first, then the item.
--
-- ── 2. The exports shipped OUR uuids as THEIR references ──
-- mapCostPosting embeds wo_number, asset tag and cost-centre code, because
-- "nobody's ERP can do anything with our UUIDs" (its own comment). The
-- movement, PO-line and invoice exports then did exactly that: raw wo_id,
-- po_id, cost_center_id, vendor_id, location_id. The views never joined
-- the business keys, so the mappers had nothing better to send. A receiver
-- getting `issue_to_order, 7f3a…` can file it in the bin.
--
-- ── 3. The commitment export had no date to give ──
-- sem_purchase_order_lines exposed no date column at all, so the mapper's
-- fallback chain (document_date, then created_at) resolved to ''. Every
-- open-commitment document shipped with an empty document_date.
--
-- ── 4. Two concurrent settles could both post the same delta ──
-- ers_settle_work_order computes delta = actual − posted, then inserts.
-- Two calls interleaving under READ COMMITTED both read posted=0 and both
-- insert the full delta — the exact double-posting the delta design exists
-- to prevent, reachable from the UI (the manual Post button racing the
-- status trigger). An advisory transaction lock on the work-order id makes
-- the second call wait and then compute a delta of zero.
--
-- Views are DROP/CREATE with security_invoker restated (the 0260 lesson:
-- CREATE OR REPLACE cannot insert a column mid-list, and a DROP takes the
-- 0259 setting with it).
--
-- Rollback: restore the 0261 body of ers_movement_defaults, the 0262 body
-- of ers_settle_work_order, and the 0245/0248/0260 view bodies.
-- ═══════════════════════════════════════════════════════════════
BEGIN;

-- ───────────────────────────────────────────────────────────────
-- 1. Movements derive their tenant like everything else does
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

    -- The tenant, by the 0261 rule: from the work order, else the item —
    -- never from the session. The column DEFAULT has already run by the
    -- time a BEFORE trigger fires, so NULL here means "no JWT": a trusted
    -- context whose insert would otherwise die on 0276's NOT NULL.
    IF NEW.company_id IS NULL AND NEW.wo_id IS NOT NULL THEN
        SELECT w.company_id INTO NEW.company_id FROM public.work_orders w WHERE w.id = NEW.wo_id;
    END IF;
    IF NEW.company_id IS NULL AND NEW.item_id IS NOT NULL THEN
        SELECT i.company_id INTO NEW.company_id FROM public.inventory_items i WHERE i.id = NEW.item_id;
    END IF;

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
-- 2. Settlement takes a lock before it computes a delta
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
    -- Serialise per order. delta = actual − posted is only exactly-once if
    -- no other transaction can read `posted` between our read and our
    -- insert; two concurrent settles otherwise both see posted=0 and both
    -- post the full amount. Advisory + xact-scoped: released on commit or
    -- rollback, no table lock held, different orders never wait on each
    -- other.
    PERFORM pg_advisory_xact_lock(hashtextextended(p_wo_id::TEXT, 42));

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

-- ───────────────────────────────────────────────────────────────
-- 3. The movement register speaks business keys
-- ───────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.sem_stock_movements;

CREATE VIEW public.sem_stock_movements
WITH (security_invoker = true) AS
SELECT t.id                                   AS movement_id,
       t."timestamp"                          AS moved_at,
       t.movement_type,
       mt.name                                AS movement_name,
       mt.direction,
       mt.fi_posting,
       t.item_id,
       i.part_number,
       i.material_number,
       t.location_id,
       -- The reference a receiver can actually resolve. Kept BESIDE the
       -- uuids, which remain for joins on our side.
       COALESCE(il.code, il.name)             AS location_code,
       t.quantity,
       t.cost_at_time,
       t.total_value,
       t.wo_id,
       w.wo_number,
       t.po_id,
       p.po_code,
       t.cost_center_id,
       cc.code                                AS cost_center_code,
       t.asset_id,
       a.tag                                  AS asset_tag,
       t.gl_account,
       t.cost_allocation_id,
       CASE
           WHEN mt.fi_posting = 'NONE'                             THEN 'stock only'
           WHEN mt.fi_posting = 'VIA_SETTLEMENT'                   THEN 'settles with the order'
           WHEN t.cost_allocation_id IS NOT NULL                   THEN 'posted'
           WHEN COALESCE(t.total_value, 0) = 0                     THEN 'no value'
           ELSE 'unposted'
       END                                    AS fi_status
FROM public.inventory_transactions t
LEFT JOIN public.movement_types      mt ON mt.code = t.movement_type
LEFT JOIN public.inventory_items     i  ON i.id    = t.item_id
LEFT JOIN public.inventory_locations il ON il.id   = t.location_id
LEFT JOIN public.work_orders         w  ON w.id    = t.wo_id
LEFT JOIN public.purchase_orders     p  ON p.id    = t.po_id
LEFT JOIN public.cost_centers        cc ON cc.id   = t.cost_center_id
LEFT JOIN public.assets              a  ON a.id    = t.asset_id;

COMMENT ON VIEW public.sem_stock_movements IS
    'Every stock movement with its SAP movement type, account assignment, value, financial document — and the business keys (wo_number, po_code, cost_center_code, asset_tag, location_code) a receiving system can resolve. The extract an MM integration reads.';

GRANT SELECT ON public.sem_stock_movements TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────
-- 4. PO lines carry their date, and a supplier a receiver can name
-- ───────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.sem_purchase_order_lines;

CREATE VIEW public.sem_purchase_order_lines
WITH (security_invoker = true) AS
SELECT l.id                                   AS line_id,
       l.po_id,
       p.po_code,
       p.status                               AS po_status,
       p.supplier_id,
       v.code                                 AS supplier_code,
       v.name                                 AS supplier_name,
       l.line_no,
       l.line_type,
       l.description,
       l.inventory_id,
       i.part_number,
       i.material_number,
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
       cc.code                                AS cost_center_code,
       l.gl_account,
       l.invoice_matched,
       l.created_at,
       CASE
           WHEN l.qty_received <= 0                 THEN 'awaiting delivery'
           WHEN l.qty_received < l.qty_ordered      THEN 'part received'
           WHEN l.invoice_matched                   THEN 'invoiced'
           ELSE 'received, awaiting invoice'
       END                                    AS line_status
FROM public.purchase_order_lines l
JOIN public.purchase_orders p ON p.id = l.po_id
LEFT JOIN public.vendors         v  ON v.id  = p.supplier_id
LEFT JOIN public.inventory_items i  ON i.id  = l.inventory_id
LEFT JOIN public.work_orders     w  ON w.id  = l.work_order_id
LEFT JOIN public.cost_centers    cc ON cc.id = l.cost_center_id;

COMMENT ON VIEW public.sem_purchase_order_lines IS
    'PO lines with their order, item, work order, receipt state and the business keys a receiver can resolve. The extract an ERP purchasing integration reads.';

GRANT SELECT ON public.sem_purchase_order_lines TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────
-- 5. Invoices name their vendor by code, not uuid
-- ───────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.sem_invoice_matches;

CREATE VIEW public.sem_invoice_matches
WITH (security_invoker = true) AS
SELECT m.id                       AS invoice_id,
       m.invoice_number,
       m.invoice_date,
       m.vendor_id,
       v.code                     AS vendor_code,
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
    'Accounts-payable queue: every invoice with its three-way match verdict, why it is blocked, and the vendor by code. The extract an AP or ERP finance integration reads.';

GRANT SELECT ON public.sem_invoice_matches TO authenticated, service_role;

COMMIT;
