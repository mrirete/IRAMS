-- 0379 — stock moves through functions that check the domain permission
--
-- WHAT WAS WRONG
--   Stock moved by table writes from the browser, so the ROW policies had to
--   admit every role that ever moves stock: 0377b let workOrders.edit and
--   purchasing.edit write inventory_stock and inventory_transactions
--   outright. A technician could therefore UPDATE any stock row in the
--   company from devtools — not just the one their return-to-stores touched —
--   and a receipt was four separate requests (stock, GRN, line quantity,
--   settlement) with no transaction, so a failure after the first left stock
--   moved with no goods-receipt document to say why.
--
--   ers_issue_work_order_parts (0311) already did the issue in one
--   transaction, but as SECURITY INVOKER with no check of its own: its tenant
--   scoping was whatever the table policies happened to allow.
--
-- WHAT THIS DOES
--   Four SECURITY DEFINER functions. Each derives the tenant from the JWT,
--   checks the permission the ACT requires, then does the whole act in one
--   transaction. Then the row policies narrow to inventory.* only.
--
--     ers_stock_adjust            inventory.edit — or workOrders.edit with a
--                                 work order of this company (return to
--                                 stores), or purchasing.edit with a purchase
--                                 order of this company (receipt)
--     ers_adjust_stock_on_order   purchasing.edit or inventory.edit; a DELTA
--                                 against the locked row, clamped at zero
--     ers_receive_po_line         purchasing.edit; stock + on-order + GRN +
--                                 line quantity (+ service settlement) as one
--     ers_issue_work_order_parts  now DEFINER; asserts the order is in the
--                                 caller's company and workOrders.edit
--
--   Two behaviours tighten on purpose:
--     • stock cannot be adjusted below zero (the client never guarded this);
--     • a receipt cannot exceed the line's open quantity (the page blocked
--       it; the database did not).
--
--   Row policies afterwards:
--     inventory_stock          INSERT inventory.create|edit  UPDATE inventory.edit
--     inventory_transactions   INSERT inventory.create|edit
--   (DELETE and the admin-only ledger rules from 0377b are unchanged.)
--
--   Tenant stamping: inventory_stock, inventory_transactions and
--   goods_receipts all default company_id to caller_company() and carry
--   aa_stamp_tenant, both of which read the JWT — available inside a DEFINER
--   function — so rows written here land in the caller's company.
--
-- OUT OF SCOPE, NOTED
--   ers_settle_work_order is SECURITY DEFINER and executable by anon. It is
--   called from here for service lines; its grants are a separate fix.
--
-- SAFE TO RE-RUN.

BEGIN;

-- ── ers_stock_adjust ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ers_stock_adjust(
    p_item_id       uuid,
    p_location_id   uuid,
    p_target_qty    numeric,
    p_type          text,                      -- STOCKTAKE | ADJUSTMENT | RECEIPT | ISSUE
    p_reason        text    DEFAULT NULL,
    p_movement_type text    DEFAULT NULL,      -- explicit code (262, 561…) or NULL to derive
    p_wo_id         uuid    DEFAULT NULL,
    p_po_id         uuid    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
    v_company   uuid := public.caller_company();
    v_allowed   boolean := false;
    v_current   numeric := 0;
    v_stock_id  uuid;
    v_delta     numeric;
    v_unit_cost numeric := 0;
    v_tx_type   text;
    v_mt        text;
    v_tx_id     uuid;
BEGIN
    IF v_company IS NULL THEN
        RAISE EXCEPTION 'No tenant on this session' USING ERRCODE = '42501';
    END IF;
    IF p_target_qty IS NULL OR p_target_qty < 0 THEN
        RAISE EXCEPTION 'Stock cannot be set below zero' USING ERRCODE = '22003';
    END IF;

    -- The item and the store must both be this company's.
    SELECT coalesce(unit_cost, 0) INTO v_unit_cost
      FROM inventory_items WHERE id = p_item_id AND company_id = v_company;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Inventory item not found in this workspace' USING ERRCODE = 'P0002';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM inventory_locations WHERE id = p_location_id AND company_id = v_company) THEN
        RAISE EXCEPTION 'Store not found in this workspace' USING ERRCODE = 'P0002';
    END IF;

    -- Permission follows the act, not the table.
    v_allowed := public.caller_can('inventory', 'edit');
    IF NOT v_allowed AND p_wo_id IS NOT NULL THEN
        v_allowed := public.caller_can('workOrders', 'edit')
                 AND EXISTS (SELECT 1 FROM work_orders WHERE id = p_wo_id AND company_id = v_company);
    END IF;
    IF NOT v_allowed AND p_po_id IS NOT NULL THEN
        v_allowed := public.caller_can('purchasing', 'edit')
                 AND EXISTS (SELECT 1 FROM purchase_orders WHERE id = p_po_id AND company_id = v_company);
    END IF;
    IF NOT v_allowed THEN
        RAISE EXCEPTION 'You do not have permission to move stock' USING ERRCODE = '42501';
    END IF;

    -- Lock the row (or create it at zero) so two movements cannot race.
    SELECT id, coalesce(quantity, 0) INTO v_stock_id, v_current
      FROM inventory_stock WHERE item_id = p_item_id AND location_id = p_location_id
       FOR UPDATE;
    IF NOT FOUND THEN
        INSERT INTO inventory_stock (item_id, location_id, quantity, bin_location)
        VALUES (p_item_id, p_location_id, 0, '')
        RETURNING id INTO v_stock_id;
        v_current := 0;
    END IF;

    v_delta := p_target_qty - v_current;
    IF v_delta = 0 THEN
        RETURN jsonb_build_object('delta', 0, 'new_qty', v_current, 'movement_id', NULL);
    END IF;

    UPDATE inventory_stock SET quantity = p_target_qty, updated_at = now() WHERE id = v_stock_id;

    v_tx_type := CASE upper(p_type) WHEN 'RECEIPT' THEN 'RECEIPT' WHEN 'ISSUE' THEN 'ISSUE' ELSE 'ADJUST' END;
    v_mt := coalesce(p_movement_type, CASE
        WHEN v_tx_type = 'RECEIPT' THEN CASE WHEN p_po_id IS NOT NULL THEN '101' ELSE '501' END
        WHEN v_tx_type = 'ISSUE'   THEN CASE WHEN p_wo_id IS NOT NULL THEN '261' ELSE '201' END
        ELSE CASE WHEN v_delta < 0 THEN '702' ELSE '701' END
    END);

    INSERT INTO inventory_transactions
        (item_id, transaction_type, movement_type, location_id, wo_id, po_id,
         quantity, cost_at_time, performed_by, notes, timestamp)
    VALUES
        (p_item_id, v_tx_type::public.transaction_type, v_mt, p_location_id, p_wo_id, p_po_id,
         abs(v_delta), v_unit_cost, auth.uid(), nullif(p_reason, ''), now())
    RETURNING id INTO v_tx_id;

    RETURN jsonb_build_object('delta', v_delta, 'new_qty', p_target_qty, 'movement_id', v_tx_id);
END;
$$;

-- ── ers_adjust_stock_on_order ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ers_adjust_stock_on_order(
    p_item_id     uuid,
    p_location_id uuid,
    p_delta       numeric
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
    v_company uuid := public.caller_company();
    v_id      uuid;
    v_next    numeric;
BEGIN
    IF v_company IS NULL THEN
        RAISE EXCEPTION 'No tenant on this session' USING ERRCODE = '42501';
    END IF;
    IF NOT (public.caller_can('purchasing', 'edit') OR public.caller_can('inventory', 'edit')) THEN
        RAISE EXCEPTION 'You do not have permission to change quantity on order' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM inventory_items WHERE id = p_item_id AND company_id = v_company)
    OR NOT EXISTS (SELECT 1 FROM inventory_locations WHERE id = p_location_id AND company_id = v_company) THEN
        RAISE EXCEPTION 'Item or store not found in this workspace' USING ERRCODE = 'P0002';
    END IF;

    SELECT id, greatest(0, coalesce(qty_on_order, 0) + coalesce(p_delta, 0))
      INTO v_id, v_next
      FROM inventory_stock WHERE item_id = p_item_id AND location_id = p_location_id
       FOR UPDATE;
    IF NOT FOUND THEN
        v_next := greatest(0, coalesce(p_delta, 0));
        INSERT INTO inventory_stock (item_id, location_id, quantity, bin_location, qty_on_order)
        VALUES (p_item_id, p_location_id, 0, '', v_next);
    ELSE
        UPDATE inventory_stock SET qty_on_order = v_next, updated_at = now() WHERE id = v_id;
    END IF;
    RETURN v_next;
END;
$$;

-- ── ers_receive_po_line ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ers_receive_po_line(
    p_po_id       uuid,
    p_line_id     uuid,
    p_quantity    numeric,
    p_location_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
    v_company    uuid := public.caller_company();
    v_line       purchase_order_lines%ROWTYPE;
    v_open       numeric;
    v_current    numeric := 0;
    v_store_code text;
    v_grn        text;
    v_total      numeric;
    v_settled    boolean := true;
BEGIN
    IF v_company IS NULL THEN
        RAISE EXCEPTION 'No tenant on this session' USING ERRCODE = '42501';
    END IF;
    IF NOT public.caller_can('purchasing', 'edit') THEN
        RAISE EXCEPTION 'You do not have permission to receive against purchase orders' USING ERRCODE = '42501';
    END IF;
    IF p_quantity IS NULL OR p_quantity <= 0 THEN
        RAISE EXCEPTION 'Receive quantity must be greater than zero' USING ERRCODE = '22003';
    END IF;

    SELECT * INTO v_line FROM purchase_order_lines
     WHERE id = p_line_id AND po_id = p_po_id AND company_id = v_company
       FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Purchase order line not found in this workspace' USING ERRCODE = 'P0002';
    END IF;

    -- The page blocks over-receipt at 100% of ordered; make it a rule.
    v_open := coalesce(v_line.qty_ordered, 0) - coalesce(v_line.qty_received, 0);
    IF p_quantity > v_open + 0.0005 THEN
        RAISE EXCEPTION 'Only % of % remain open on this line — increase the order quantity first if this is a genuine over-delivery',
            v_open, v_line.qty_ordered USING ERRCODE = '23514';
    END IF;

    -- 1. Stock for a material line — the physical fact first. The PO reference
    --    makes the movement a 101; the on-order figure comes down by the same.
    IF v_line.inventory_id IS NOT NULL THEN
        IF p_location_id IS NULL THEN
            RAISE EXCEPTION 'Set a delivery location on the Details tab before receiving stock lines' USING ERRCODE = '22004';
        END IF;
        SELECT coalesce(quantity, 0) INTO v_current
          FROM inventory_stock WHERE item_id = v_line.inventory_id AND location_id = p_location_id;
        IF NOT FOUND THEN v_current := 0; END IF;
        PERFORM public.ers_stock_adjust(
            v_line.inventory_id, p_location_id, v_current + p_quantity, 'RECEIPT',
            'PO receipt against line ' || coalesce(v_line.line_no::text, '?'),
            NULL, NULL, p_po_id);
        PERFORM public.ers_adjust_stock_on_order(v_line.inventory_id, p_location_id, -p_quantity);
    END IF;

    -- 2. The receipt document. storage_location holds the store's CODE — a
    --    document field a receiver reads, not a uuid.
    IF p_location_id IS NOT NULL THEN
        SELECT coalesce(code, name, p_location_id::text) INTO v_store_code
          FROM inventory_locations WHERE id = p_location_id;
    END IF;
    INSERT INTO goods_receipts
        (po_id, po_line_id, inventory_id, quantity, unit_cost, total_cost,
         storage_location, received_date, received_by)
    VALUES
        (p_po_id, p_line_id, v_line.inventory_id, p_quantity, coalesce(v_line.unit_cost, 0),
         round(p_quantity * coalesce(v_line.unit_cost, 0), 2),
         v_store_code, current_date, auth.uid())
    RETURNING grn_number INTO v_grn;

    -- 3. The line's received quantity.
    v_total := round(coalesce(v_line.qty_received, 0) + p_quantity, 3);
    UPDATE purchase_order_lines SET qty_received = v_total, updated_at = now() WHERE id = p_line_id;

    -- 4. A received SERVICE line is actual cost on its work order the moment it
    --    lands (0249). Settlement is a delta posting and ers_settlement_run()
    --    catches anything missed, so a settlement failure defers rather than
    --    undoing the receipt.
    IF v_line.work_order_id IS NOT NULL AND v_line.line_type = 'SERVICE' THEN
        BEGIN
            PERFORM public.ers_settle_work_order(v_line.work_order_id);
        EXCEPTION WHEN OTHERS THEN
            v_settled := false;
        END;
    END IF;

    RETURN jsonb_build_object(
        'grn_number', v_grn,
        'qty_received_total', v_total,
        'on_order_adjusted', v_line.inventory_id IS NOT NULL,
        'settlement_deferred', NOT v_settled
    );
END;
$$;

-- ── ers_issue_work_order_parts — now DEFINER with its own guard ───────────
CREATE OR REPLACE FUNCTION public.ers_issue_work_order_parts(p_wo_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
    v_company   uuid := public.caller_company();
    part        record;
    loc         record;
    remaining   numeric;
    take        numeric;
    issued_parts int := 0;
    issued_qty  numeric := 0;
    already     int := 0;
    shortfalls  jsonb := '[]'::jsonb;
    touched     uuid[] := '{}';
    low_stock   jsonb := '[]'::jsonb;
BEGIN
    IF v_company IS NULL THEN
        RAISE EXCEPTION 'No tenant on this session' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM work_orders WHERE id = p_wo_id AND company_id = v_company) THEN
        RAISE EXCEPTION 'Work order not found in this workspace' USING ERRCODE = 'P0002';
    END IF;
    IF NOT (public.caller_can('workOrders', 'edit') OR public.caller_can('inventory', 'edit')) THEN
        RAISE EXCEPTION 'You do not have permission to issue parts' USING ERRCODE = '42501';
    END IF;

    FOR part IN
        SELECT p.id, p.item_id, coalesce(p.quantity, 0)::numeric AS qty, coalesce(p.unit_cost, 0)::numeric AS unit_cost,
               p.is_planned, i.description
          FROM public.work_order_parts p
          LEFT JOIN public.inventory_items i ON i.id = p.item_id
         WHERE p.wo_id = p_wo_id
         ORDER BY p.id
    LOOP
        IF part.is_planned IS FALSE THEN already := already + 1; CONTINUE; END IF;   -- idempotent re-entry
        IF part.item_id IS NULL OR part.qty <= 0 THEN CONTINUE; END IF;

        remaining := part.qty;
        FOR loc IN
            SELECT id, location_id, coalesce(quantity, 0)::numeric AS quantity
              FROM public.inventory_stock
             WHERE item_id = part.item_id AND company_id = v_company AND coalesce(quantity, 0) > 0
             ORDER BY quantity DESC, id
             FOR UPDATE
        LOOP
            EXIT WHEN remaining <= 0;
            take := LEAST(remaining, loc.quantity);
            UPDATE public.inventory_stock SET quantity = loc.quantity - take, updated_at = now() WHERE id = loc.id;
            INSERT INTO public.inventory_transactions
                (item_id, transaction_type, movement_type, wo_id, location_id, quantity, cost_at_time, performed_by, timestamp)
            VALUES
                (part.item_id, 'ISSUE', '261', p_wo_id, loc.location_id, take, part.unit_cost, auth.uid(), now());
            remaining := remaining - take;
        END LOOP;

        UPDATE public.work_order_parts SET is_planned = false, date_used = current_date WHERE id = part.id;
        issued_parts := issued_parts + 1;
        issued_qty := issued_qty + part.qty;
        IF remaining > 0 THEN
            shortfalls := shortfalls || jsonb_build_object('description', coalesce(part.description, 'part'), 'short', remaining);
        END IF;
        touched := array_append(touched, part.item_id);
    END LOOP;

    IF array_length(touched, 1) > 0 THEN
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'item_id', i.id, 'code', i.code, 'description', i.description,
                   'on_hand', s.on_hand, 'min_level', i.min_level)), '[]'::jsonb)
          INTO low_stock
          FROM public.inventory_items i
          JOIN LATERAL (SELECT coalesce(sum(quantity), 0)::numeric AS on_hand FROM public.inventory_stock WHERE item_id = i.id) s ON true
         WHERE i.id = ANY (SELECT DISTINCT unnest(touched))
           AND coalesce(i.min_level, 0) > 0
           AND s.on_hand <= i.min_level;
    END IF;

    RETURN jsonb_build_object(
        'issued_parts', issued_parts, 'issued_qty', issued_qty, 'already_issued', already,
        'shortfalls', shortfalls, 'low_stock', low_stock);
END;
$$;

-- ── Grants ────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.ers_stock_adjust(uuid, uuid, numeric, text, text, text, uuid, uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.ers_adjust_stock_on_order(uuid, uuid, numeric)                     FROM public, anon;
REVOKE ALL ON FUNCTION public.ers_receive_po_line(uuid, uuid, numeric, uuid)                     FROM public, anon;
REVOKE ALL ON FUNCTION public.ers_issue_work_order_parts(uuid)                                   FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ers_stock_adjust(uuid, uuid, numeric, text, text, text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ers_adjust_stock_on_order(uuid, uuid, numeric)                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.ers_receive_po_line(uuid, uuid, numeric, uuid)                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.ers_issue_work_order_parts(uuid)                                   TO authenticated;

COMMENT ON FUNCTION public.ers_stock_adjust(uuid, uuid, numeric, text, text, text, uuid, uuid) IS
    'Sets on-hand at one store to a target and records the movement, in one transaction (0379). inventory.edit; or workOrders.edit with a work order of this company; or purchasing.edit with a purchase order of this company.';
COMMENT ON FUNCTION public.ers_adjust_stock_on_order(uuid, uuid, numeric) IS
    'Moves quantity on order at one store by a delta against the locked row, clamped at zero (0379). purchasing.edit or inventory.edit.';
COMMENT ON FUNCTION public.ers_receive_po_line(uuid, uuid, numeric, uuid) IS
    'Receives a quantity against a purchase order line: stock, on-order, goods receipt, line quantity and service settlement in one transaction (0379). purchasing.edit. Refuses over-receipt.';
COMMENT ON FUNCTION public.ers_issue_work_order_parts(uuid) IS
    'Issues the planned parts of a work order on completion, in one transaction (0311; DEFINER with tenant + workOrders.edit guard since 0379).';

-- ── Row policies narrow to the inventory role ─────────────────────────────
DROP POLICY IF EXISTS rbac_insert_inventory_stock        ON public.inventory_stock;
DROP POLICY IF EXISTS rbac_update_inventory_stock        ON public.inventory_stock;
DROP POLICY IF EXISTS rbac_insert_inventory_transactions ON public.inventory_transactions;

CREATE POLICY rbac_insert_inventory_stock ON public.inventory_stock
    FOR INSERT TO authenticated
    WITH CHECK (
        company_id = (SELECT public.caller_company())
        AND ((SELECT public.caller_can('inventory', 'create')) OR (SELECT public.caller_can('inventory', 'edit')))
    );

CREATE POLICY rbac_update_inventory_stock ON public.inventory_stock
    FOR UPDATE TO authenticated
    USING      (company_id = (SELECT public.caller_company()) AND (SELECT public.caller_can('inventory', 'edit')))
    WITH CHECK (company_id = (SELECT public.caller_company()) AND (SELECT public.caller_can('inventory', 'edit')));

CREATE POLICY rbac_insert_inventory_transactions ON public.inventory_transactions
    FOR INSERT TO authenticated
    WITH CHECK (
        company_id = (SELECT public.caller_company())
        AND ((SELECT public.caller_can('inventory', 'create')) OR (SELECT public.caller_can('inventory', 'edit')))
    );

-- ── Assert the shape before committing ────────────────────────────────────
DO $$
DECLARE n int; r record;
BEGIN
    FOR r IN
        SELECT p.proname, p.prosecdef,
               has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
               has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
          FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
         WHERE ns.nspname = 'public'
           AND p.proname IN ('ers_stock_adjust', 'ers_adjust_stock_on_order', 'ers_receive_po_line', 'ers_issue_work_order_parts')
    LOOP
        IF NOT r.prosecdef THEN RAISE EXCEPTION '0379: % is not SECURITY DEFINER', r.proname; END IF;
        IF r.anon_exec    THEN RAISE EXCEPTION '0379: anon can execute %', r.proname; END IF;
        IF NOT r.auth_exec THEN RAISE EXCEPTION '0379: authenticated cannot execute %', r.proname; END IF;
    END LOOP;

    SELECT count(*) INTO n FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('inventory_stock', 'inventory_transactions', 'inventory_locations')
       AND cmd IN ('INSERT', 'UPDATE', 'DELETE');
    IF n <> 9 THEN RAISE EXCEPTION '0379: expected 9 write policies, found %', n; END IF;

    IF EXISTS (SELECT 1 FROM pg_policies
                WHERE tablename = 'inventory_stock' AND cmd = 'UPDATE'
                  AND (qual LIKE '%workOrders%' OR qual LIKE '%purchasing%')) THEN
        RAISE EXCEPTION '0379: inventory_stock UPDATE still admits non-inventory roles';
    END IF;
    RAISE NOTICE '0379 verified: 4 DEFINER functions, anon revoked, stock rows inventory-only';
END $$;

COMMIT;

-- VERIFY (as postgres; each block one transaction, rolled back)
--   Technician: may return to stores (WO given), may not adjust freely, may not touch rows.
--   BEGIN;
--   SET LOCAL ROLE authenticated;
--   SELECT set_config('request.jwt.claims','{"email":"j.tech@cainergy.com","app_metadata":{"company_id":"<company>"}}',true);
--   SELECT ers_stock_adjust('<item>','<store>', 99, 'ADJUSTMENT', 'probe');                       -- expect 42501
--   SELECT ers_stock_adjust('<item>','<store>', 99, 'ADJUSTMENT', 'probe', '262', '<wo of company>'); -- expect delta json
--   UPDATE inventory_stock SET updated_at = now() WHERE id = '<row>';                              -- expect UPDATE 0
--   ROLLBACK;
--   Storekeeper: receives, cannot over-receive.
--   SELECT ers_receive_po_line('<po>','<line>', <open qty + 1>, '<store>');                       -- expect 23514
