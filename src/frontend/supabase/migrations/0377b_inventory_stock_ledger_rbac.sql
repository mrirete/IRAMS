-- 0377b — who may move stock, and nobody may rewrite the movement ledger
--
-- WHAT WAS WRONG
--   0248a gated UPDATE on the core records by role but set inventory_stock
--   aside: "stock movements are written while executing a work order, and
--   gating them on inventory.edit would stop a technician issuing parts. They
--   need the parts-issue flow mapped first."
--
--   Mapped now. From the browser, exactly three flows write stock:
--     Inventory  Adjust / Save / New Item / Remove Location   inventory.*
--     Work order goods issue (goodsIssue.ts, WorkOrders.tsx)  workOrders.edit
--     Purchasing receipt and on-order (receivePOLine, PO)     purchasing.edit
--   Everything else that touches these tables is a SECURITY DEFINER function
--   or a trigger, which RLS does not see.
--
--   Meanwhile inventory_stock, inventory_transactions and inventory_locations
--   were tenant-only for every command. Any login in the company — a REQUESTER
--   included — could UPDATE or DELETE a movement. Since 0245 a movement is
--   financial evidence (it carries the account assignment and may be the row
--   behind a posted ledger entry). The UI has never offered a way to edit one;
--   the database allowed it.
--
-- WHAT THIS DOES
--   inventory_stock         INSERT/UPDATE  inventory.create|edit, workOrders.edit, purchasing.edit
--                           DELETE         inventory.delete   (0377a still refuses rows with stock)
--   inventory_transactions  INSERT         the same writers
--                           UPDATE/DELETE  is_admin()  — append-only for everyone else
--   inventory_locations     INSERT/UPDATE  inventory.edit
--                           DELETE         is_admin()  (the FK from inventory_stock is RESTRICT anyway)
--
--   SELECT is not touched on any of the three. inventory_stock already
--   requires inventory.view (0361); the other two stay tenant-wide because
--   store names and movement history are read from work orders, purchasing
--   and reports by roles that do not hold inventory.view.
--
--   Every function call is wrapped in (SELECT …) so it is evaluated once per
--   statement, not once per row (0243).
--
-- NOT IN THIS PASS
--   The right end state is that stock never moves through a table write from
--   the browser at all: issue, receipt and adjustment become SECURITY DEFINER
--   functions that check the DOMAIN permission and write stock + movement in
--   one transaction. Then inventory_stock locks to inventory.edit alone.
--   That touches goodsIssue.ts, receivePOLine and adjustInventoryStock and is
--   a roadmap item, not a policy edit.
--
-- SAFE TO RE-RUN.

BEGIN;

DO $$
DECLARE
    r record;
    t text;
BEGIN
    -- Drop every write policy on the three tables, FOR ALL included. RLS is
    -- OR-ed: a permissive policy left beside the new gate grants exactly what
    -- it granted before. SELECT policies are left in place; where a FOR ALL
    -- policy was also carrying SELECT, a per-command SELECT policy already
    -- exists on each of these tables (verified on production before writing
    -- this), and the assertion below makes sure of it.
    FOREACH t IN ARRAY ARRAY['inventory_stock', 'inventory_transactions', 'inventory_locations'] LOOP
        FOR r IN
            SELECT policyname FROM pg_policies
             WHERE schemaname = 'public' AND tablename = t
               AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
        LOOP
            EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, t);
        END LOOP;

        IF NOT EXISTS (SELECT 1 FROM pg_policies
                        WHERE schemaname = 'public' AND tablename = t AND cmd = 'SELECT') THEN
            RAISE EXCEPTION '0377b: % has no SELECT policy left — refusing to continue', t;
        END IF;
    END LOOP;
END $$;

-- ── inventory_stock ─────────────────────────────────────────────────────────
CREATE POLICY rbac_insert_inventory_stock ON public.inventory_stock
    FOR INSERT TO authenticated
    WITH CHECK (
        company_id = (SELECT public.caller_company())
        AND (   (SELECT public.caller_can('inventory',  'create'))
             OR (SELECT public.caller_can('inventory',  'edit'))
             OR (SELECT public.caller_can('workOrders', 'edit'))
             OR (SELECT public.caller_can('purchasing', 'edit')) )
    );

CREATE POLICY rbac_update_inventory_stock ON public.inventory_stock
    FOR UPDATE TO authenticated
    USING (
        company_id = (SELECT public.caller_company())
        AND (   (SELECT public.caller_can('inventory',  'edit'))
             OR (SELECT public.caller_can('workOrders', 'edit'))
             OR (SELECT public.caller_can('purchasing', 'edit')) )
    )
    WITH CHECK (
        company_id = (SELECT public.caller_company())
        AND (   (SELECT public.caller_can('inventory',  'edit'))
             OR (SELECT public.caller_can('workOrders', 'edit'))
             OR (SELECT public.caller_can('purchasing', 'edit')) )
    );

CREATE POLICY rbac_delete_inventory_stock ON public.inventory_stock
    FOR DELETE TO authenticated
    USING (
        company_id = (SELECT public.caller_company())
        AND (SELECT public.caller_can('inventory', 'delete'))
    );

-- ── inventory_transactions — append-only below admin ───────────────────────
CREATE POLICY rbac_insert_inventory_transactions ON public.inventory_transactions
    FOR INSERT TO authenticated
    WITH CHECK (
        company_id = (SELECT public.caller_company())
        AND (   (SELECT public.caller_can('inventory',  'create'))
             OR (SELECT public.caller_can('inventory',  'edit'))
             OR (SELECT public.caller_can('workOrders', 'edit'))
             OR (SELECT public.caller_can('purchasing', 'edit')) )
    );

CREATE POLICY p2_admin_update_inventory_transactions ON public.inventory_transactions
    FOR UPDATE TO authenticated
    USING      (company_id = (SELECT public.caller_company()) AND (SELECT public.is_admin()))
    WITH CHECK (company_id = (SELECT public.caller_company()) AND (SELECT public.is_admin()));

CREATE POLICY p2_admin_delete_inventory_transactions ON public.inventory_transactions
    FOR DELETE TO authenticated
    USING (company_id = (SELECT public.caller_company()) AND (SELECT public.is_admin()));

-- ── inventory_locations — store definitions ────────────────────────────────
CREATE POLICY rbac_insert_inventory_locations ON public.inventory_locations
    FOR INSERT TO authenticated
    WITH CHECK (
        company_id = (SELECT public.caller_company())
        AND (SELECT public.caller_can('inventory', 'edit'))
    );

CREATE POLICY rbac_update_inventory_locations ON public.inventory_locations
    FOR UPDATE TO authenticated
    USING      (company_id = (SELECT public.caller_company()) AND (SELECT public.caller_can('inventory', 'edit')))
    WITH CHECK (company_id = (SELECT public.caller_company()) AND (SELECT public.caller_can('inventory', 'edit')));

CREATE POLICY p2_admin_delete_inventory_locations ON public.inventory_locations
    FOR DELETE TO authenticated
    USING (company_id = (SELECT public.caller_company()) AND (SELECT public.is_admin()));

-- ── Assert the final shape before committing ───────────────────────────────
DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('inventory_stock', 'inventory_transactions', 'inventory_locations')
       AND cmd IN ('INSERT', 'UPDATE', 'DELETE');
    IF n <> 9 THEN
        RAISE EXCEPTION '0377b: expected 9 write policies across the three tables, found %', n;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies
                WHERE schemaname = 'public'
                  AND tablename IN ('inventory_stock', 'inventory_transactions', 'inventory_locations')
                  AND cmd = 'ALL') THEN
        RAISE EXCEPTION '0377b: a FOR ALL policy survived — the gate would be OR-ed away';
    END IF;
    RAISE NOTICE '0377b verified: 9 write policies, no FOR ALL policy remains';
END $$;

COMMIT;

-- VERIFY (run as the postgres role; each block is one transaction and rolls back)
--
-- 1. A technician (TECHNICIAN: inventory VIEW_ONLY, workOrders BASIC) can move
--    stock — parts issue keeps working — but cannot rewrite a movement.
--    BEGIN;
--    SET LOCAL ROLE authenticated;
--    SELECT set_config('request.jwt.claims',
--      '{"email":"j.tech@cainergy.com","app_metadata":{"company_id":"7157991c-86c0-45b7-a0eb-ca36d83ac8dc"}}', true);
--    UPDATE inventory_stock SET updated_at = now() WHERE id = (SELECT id FROM inventory_stock LIMIT 1);
--    -- expect: UPDATE 1
--    UPDATE inventory_transactions SET notes = notes WHERE id = (SELECT id FROM inventory_transactions LIMIT 1);
--    -- expect: UPDATE 0   (RLS hides the row; no error, no change)
--    DELETE FROM inventory_stock WHERE id = (SELECT id FROM inventory_stock WHERE quantity = 0 LIMIT 1);
--    -- expect: DELETE 0   (inventory.delete is false for TECHNICIAN)
--    ROLLBACK;
--
-- 2. Admin still can.
--    BEGIN;
--    SET LOCAL ROLE authenticated;
--    SELECT set_config('request.jwt.claims',
--      '{"email":"admin001@cainergy.com","app_metadata":{"company_id":"7157991c-86c0-45b7-a0eb-ca36d83ac8dc"}}', true);
--    UPDATE inventory_transactions SET notes = notes WHERE id = (SELECT id FROM inventory_transactions LIMIT 1);
--    -- expect: UPDATE 1
--    ROLLBACK;
--
-- 3. Shape.
--    SELECT tablename, policyname, cmd FROM pg_policies
--     WHERE tablename IN ('inventory_stock','inventory_transactions','inventory_locations') ORDER BY 1, 3;
--    -- expect: no cmd = ALL; nine INSERT/UPDATE/DELETE rows named rbac_* / p2_admin_*
