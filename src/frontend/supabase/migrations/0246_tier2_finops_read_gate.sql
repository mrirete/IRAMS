-- ════════════════════════════════════════════════════════════════════════════
-- 0246 — RBAC Phase 3 (Tier 2): the finance tables answer to the matrix
--
-- First policies to depend on caller_can(). The reads were measured open to
-- every role by tests/rls/rls-matrix.mjs — REQUESTER could read cost_centers,
-- depreciation_books and capital_events straight from the API — while the
-- matrix says finops is NO_ACCESS for everyone except SUPER_ADMIN, SYS_ADMIN
-- (full), MANAGER and EXECUTIVE (view).
--
-- ── Reads only, deliberately ────────────────────────────────────────────────
-- Each table carried ONE `authenticated_access FOR ALL USING (true)` policy
-- covering select, insert, update and delete together. Replacing that wholesale
-- would silently re-decide write access as a side effect of fixing reads, and
-- no sweep has been done of which flows write these rows. So the write
-- behaviour is preserved EXACTLY as it is today — `true` — in explicit
-- per-command policies, and only SELECT starts consulting the matrix.
-- Writes are their own decision, with their own reader sweep.
--
-- ── The (SELECT …) wrap is mandatory ────────────────────────────────────────
-- A bare caller_can() in a policy is evaluated once per ROW: 18,969 ms versus
-- 33 ms on 200k rows (0243). Wrapped in an uncorrelated scalar subquery it
-- becomes an InitPlan, evaluated once per statement.
--
-- ── What this changes in the UI ─────────────────────────────────────────────
-- FinancialsTab renders on asset detail (Assets.tsx:1566) with no permission
-- gate, so a technician can currently open depreciation and insurance for any
-- asset. After this migration those queries return nothing and the tab would go
-- quietly empty — a worse experience than an honest refusal — so the same
-- change gates the tab in the UI on permissions.finops.view.
--
-- ── Deliberately NOT in this migration ──────────────────────────────────────
-- purchase_orders and vendors, though both are Tier 2. The reader sweep found
-- them read from surfaces that non-purchasing roles legitimately open:
--   getVendors()        Assets.tsx:138, Inventory.tsx (x4) — supplier pickers
--   getPurchaseOrders() Inventory.tsx:1809 — the on-order list for an item
-- Gating them empties a dropdown or a list with no explanation. They need the
-- UI handled first, exactly as FinancialsTab is handled here.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    t text;
    finops_tables text[] := ARRAY[
        'cost_centers', 'depreciation_books', 'depreciation_schedules',
        'capital_events', 'budgets', 'budget_blocks', 'cost_allocations',
        'journal_entries', 'wbs_elements'
    ];
BEGIN
    FOREACH t IN ARRAY finops_tables LOOP
        -- The blanket FOR ALL policy, and any earlier per-command ones, so no
        -- permissive leftover can quietly re-grant what we just restricted.
        -- (0238 applied cleanly and changed nothing precisely because a
        -- permissive policy survived beside the new one — RLS is OR-ed.)
        EXECUTE format('DROP POLICY IF EXISTS authenticated_access          ON public.%I', t);
        EXECUTE format('DROP POLICY IF EXISTS auth_select_%s                ON public.%I', t, t);
        EXECUTE format('DROP POLICY IF EXISTS auth_insert_%s                ON public.%I', t, t);
        EXECUTE format('DROP POLICY IF EXISTS auth_update_%s                ON public.%I', t, t);
        EXECUTE format('DROP POLICY IF EXISTS auth_delete_%s                ON public.%I', t, t);
        EXECUTE format('DROP POLICY IF EXISTS finops_select_%s              ON public.%I', t, t);
        EXECUTE format('DROP POLICY IF EXISTS finops_insert_%s ON public.%I', t, t);
        EXECUTE format('DROP POLICY IF EXISTS finops_update_%s ON public.%I', t, t);
        EXECUTE format('DROP POLICY IF EXISTS finops_delete_%s ON public.%I', t, t);

        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

        -- READ: the matrix decides. Wrapped, so it is an InitPlan.
        EXECUTE format($p$
            CREATE POLICY finops_select_%s ON public.%I
            FOR SELECT TO authenticated
            USING ((SELECT public.caller_can('finops', 'view')))$p$, t, t);

        -- WRITE: unchanged from today. Not an endorsement — an explicit refusal
        -- to change two things at once.
        --
        -- Enumerated per command rather than FOR ALL, and that distinction is
        -- the whole point: FOR ALL covers SELECT as well, and RLS policies are
        -- OR-ed, so a `FOR ALL USING (true)` sitting beside the read gate above
        -- would grant SELECT to everyone and quietly undo this entire
        -- migration. That is precisely how 0238 applied cleanly and changed
        -- nothing.
        EXECUTE format($p$
            CREATE POLICY finops_insert_%s ON public.%I
            FOR INSERT TO authenticated WITH CHECK (true)$p$, t, t);
        EXECUTE format($p$
            CREATE POLICY finops_update_%s ON public.%I
            FOR UPDATE TO authenticated USING (true) WITH CHECK (true)$p$, t, t);
        EXECUTE format($p$
            CREATE POLICY finops_delete_%s ON public.%I
            FOR DELETE TO authenticated USING (true)$p$, t, t);
    END LOOP;
END $$;

COMMENT ON TABLE public.cost_centers IS
    'Finance master data. SELECT is gated on caller_can(''finops'',''view'') since 0246; writes remain open pending their own reader sweep.';
