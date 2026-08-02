-- ════════════════════════════════════════════════════════════════════════════
-- 0248 — Roadblock 1: stop any logged-in user rewriting the core records
--
-- Measured with same-value UPDATE probes against production. A REQUESTER — the
-- lowest-privilege role, "Dashboard + Requests only" — could modify:
--     assets, contacts, work_orders, inventory_items, ers_agent_actions
-- The UI blocks all of it. The database did not. Anyone with a login and
-- devtools could rewrite the asset register, and DELETE was already admin-only
-- on most of these, so the exposure was silent corruption rather than loss —
-- which is harder to notice, not better.
--
-- ── UPDATE only, deliberately ───────────────────────────────────────────────
-- INSERT is NOT gated here, and that is a finding rather than laziness. The
-- writer sweep found technician flows that create work orders:
--     Readings.tsx:415      raise a WO from a reading alarm
--     RaiseWorkModal.tsx:82 "raise work"
-- while TECHNICIAN's matrix says workOrders.create = false. The app and the
-- matrix disagree about who may create work. Gating INSERT would enforce the
-- matrix and break a flow technicians use daily, so the disagreement needs
-- resolving as a product decision first. UPDATE closes the demonstrated hole;
-- INSERT is the next conversation.
--
-- DELETE is already admin-only on assets, contacts and inventory_items (0186),
-- so it is left alone.
--
-- ── Preserved exactly ───────────────────────────────────────────────────────
-- Several child tables carry BOTH `authenticated_access FOR ALL USING (true)`
-- and per-command policies. Dropping the FOR ALL removes select/insert/delete
-- as a side effect, so those are re-declared unchanged. Only UPDATE changes
-- meaning.
--
-- Every function call is wrapped in (SELECT …): bare, it is evaluated once per
-- row — 18,969 ms vs 33 ms on 200k rows (0243).
--
-- ── Not in this pass ────────────────────────────────────────────────────────
-- inventory_stock and qualifications. Stock movements are written while
-- executing a work order, and gating them on inventory.edit would stop a
-- technician issuing parts. They need the parts-issue flow mapped first.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    r record;
    -- table → the permission key whose `edit` flag governs updating it
    targets constant text[][] := ARRAY[
        ['assets',           'assets'],
        ['contacts',         'contacts'],
        ['work_orders',      'workOrders'],
        -- Work-order execution children: labour, parts and task completion are
        -- what a technician DOES on a job, and TECHNICIAN holds workOrders.edit,
        -- so these follow the parent.
        ['work_order_labor', 'workOrders'],
        ['work_order_parts', 'workOrders'],
        ['job_tasks',        'workOrders'],
        ['inventory_items',  'inventory']
    ];
    t text;
    perm text;
BEGIN
    FOR i IN 1 .. array_length(targets, 1) LOOP
        t    := targets[i][1];
        perm := targets[i][2];

        -- Drop every policy that currently grants UPDATE on this table,
        -- including FOR ALL ones. RLS is OR-ed: leaving a permissive policy
        -- beside the new gate grants exactly what it granted before, which is
        -- how 0238 applied cleanly and changed nothing.
        FOR r IN
            SELECT policyname, cmd FROM pg_policies
            WHERE schemaname = 'public' AND tablename = t AND cmd IN ('UPDATE', 'ALL')
        LOOP
            EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, t);
            -- A FOR ALL policy was also the table's select/insert/delete grant.
            -- Re-declare those unchanged so only UPDATE changes meaning.
            --
            -- Dropped first because several of these tables carry BOTH the
            -- FOR ALL policy and per-command ones of the same name from the
            -- 0150/0155 loops — creating blind raises 42710 and aborts the
            -- migration halfway. Re-creating an identical policy is a no-op.
            IF r.cmd = 'ALL' THEN
                EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'auth_select_' || t, t);
                EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'auth_insert_' || t, t);
                EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'auth_delete_' || t, t);
                EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)',
                               'auth_select_' || t, t);
                EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (true)',
                               'auth_insert_' || t, t);
                EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (true)',
                               'auth_delete_' || t, t);
            END IF;
        END LOOP;

        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format($p$
            CREATE POLICY %I ON public.%I
            FOR UPDATE TO authenticated
            USING ((SELECT public.caller_can(%L, 'edit')))
            WITH CHECK ((SELECT public.caller_can(%L, 'edit')))$p$,
            'rbac_update_' || t, t, perm, perm);
    END LOOP;
END $$;

-- ── ers_agent_actions ───────────────────────────────────────────────────────
-- 0149 authored three narrow policies (SELECT / INSERT / UPDATE, deliberately
-- no DELETE). An out-of-band `FOR ALL USING (true)` replaced all three, so the
-- record of what the AI proposed and who reviewed it became editable AND
-- deletable by anyone logged in. 0240 captured that without endorsing it; this
-- restores the intent and gates review on reliability.edit.
DROP POLICY IF EXISTS "Authenticated users can manage agent actions" ON public.ers_agent_actions;

CREATE POLICY agent_actions_select ON public.ers_agent_actions
    FOR SELECT TO authenticated USING (true);
CREATE POLICY agent_actions_insert ON public.ers_agent_actions
    FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY agent_actions_update ON public.ers_agent_actions
    FOR UPDATE TO authenticated
    USING ((SELECT public.caller_can('reliability', 'edit')))
    WITH CHECK ((SELECT public.caller_can('reliability', 'edit')));
CREATE POLICY agent_actions_delete ON public.ers_agent_actions
    FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

COMMENT ON TABLE public.ers_agent_actions IS
    'AI agent action queue. Review (UPDATE) requires reliability.edit; DELETE is admin-only, restoring 0149''s intent after an out-of-band FOR ALL policy opened both (0248).';
