-- ════════════════════════════════════════════════════════════════════════════
-- 0257 — The last of the read leaks: contacts, vendors, purchasing, inventory
--
-- Closes the final 10 role×table read leaks found by tests/rls/rls-matrix.mjs:
-- TECHNICIAN and REQUESTER could read the contact directory (names, emails,
-- phones), supplier records, purchase orders with pricing, and stock levels,
-- while the matrix says contacts/vendors/purchasing are NO_ACCESS for both and
-- inventory is NO_ACCESS for REQUESTER.
--
-- ── The problem these four had that the earlier tables did not ──────────────
-- Every previous gate was clean because the pages reading the table were gated
-- on the same permission. These are different: `contacts` and `vendors` are
-- read to turn an id into a NAME — "Responsible: Jane Smith", a supplier label
-- in a picker — from Assets and Inventory, which both roles legitimately open.
-- Gating the base table alone would blank those labels across the app. That is
-- the "closed the leak, broke the feature" trap that nearly took out the asset
-- Audit Trail tab and did briefly empty the cost-centre dropdown (0246/0247).
--
-- So the sensitive columns follow the matrix, and the NAME is separated out:
--
--   contact_directory   (id, name)   readable by every authenticated user
--   vendor_directory    (id, name)   readable by every authenticated user
--   contacts / vendors               gated on contacts.view / vendors.view
--
-- These views deliberately run with DEFINER semantics — they are NOT
-- security_invoker — so they see past the base-table policy. That is the same
-- mechanism that made sem_work_orders bypass a gate accidentally; here it is
-- the point, and the exposure is bounded to two columns that a colleague's name
-- badge already shows. Do not "fix" these to security_invoker: it would blank
-- every name label in the product.
--
-- DatabaseService.getContacts/getVendors fall back to these views when the base
-- read returns zero rows, so no call site changes and no label goes blank.
--
-- ── purchase_orders and inventory ───────────────────────────────────────────
-- No name-lookup problem; they are simply read from surfaces the roles reach.
-- Gated outright. The UI consequences are handled in the same change: the
-- Inventory on-order subtab and the Dashboard stock tile are hidden from roles
-- without the permission, so they show nothing rather than a misleading zero.
--
-- Reads only. Writes are untouched — 0248 already gates the ones that matter.
-- Every call wrapped in (SELECT …): bare is 72x slower (0243).
-- ════════════════════════════════════════════════════════════════════════════

-- ── Name-only directories ───────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.contact_directory AS
    SELECT id, name FROM public.contacts;

CREATE OR REPLACE VIEW public.vendor_directory AS
    SELECT id, name FROM public.vendors;

GRANT SELECT ON public.contact_directory TO authenticated;
GRANT SELECT ON public.vendor_directory  TO authenticated;

COMMENT ON VIEW public.contact_directory IS
    'Names only, for rendering labels. DEFINER semantics on purpose: it sees past the contacts RLS gate so "Responsible: Jane Smith" still renders for roles without contacts.view. Do not add security_invoker — it would blank every name label in the app (0257).';
COMMENT ON VIEW public.vendor_directory IS
    'Names only, for supplier pickers on Assets and Inventory. DEFINER semantics on purpose — see contact_directory (0257).';

-- ── Gate the base tables ────────────────────────────────────────────────────
DO $$
DECLARE
    t     text;
    perm  text;
    r     record;
    pairs constant text[][] := ARRAY[
        ['contacts',         'contacts'],
        ['qualifications',   'contacts'],
        ['vendors',          'vendors'],
        ['purchase_orders',  'purchasing'],
        ['inventory_items',  'inventory'],
        ['inventory_stock',  'inventory']
    ];
BEGIN
    FOR i IN 1 .. array_length(pairs, 1) LOOP
        t    := pairs[i][1];
        perm := pairs[i][2];

        -- Drop every policy granting SELECT, FOR ALL included. RLS is OR-ed, so
        -- one surviving USING (true) leaves the gate decorative and the
        -- migration reports success having changed nothing (0238).
        FOR r IN
            SELECT policyname, cmd FROM pg_policies
            WHERE schemaname = 'public' AND tablename = t AND cmd IN ('SELECT', 'ALL')
        LOOP
            EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, t);
            -- A FOR ALL policy was also the write grant; restore those unchanged
            -- so only reading changes meaning.
            IF r.cmd = 'ALL' THEN
                EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'auth_insert_' || t, t);
                EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'auth_update_' || t, t);
                EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'auth_delete_' || t, t);
                EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (true)',
                               'auth_insert_' || t, t);
                EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (true) WITH CHECK (true)',
                               'auth_update_' || t, t);
                EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (true)',
                               'auth_delete_' || t, t);
            END IF;
        END LOOP;

        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format($p$
            CREATE POLICY %I ON public.%I
            FOR SELECT TO authenticated
            USING ((SELECT public.caller_can(%L, 'view')))$p$,
            'rbac_select_' || t, t, perm);
    END LOOP;
END $$;
