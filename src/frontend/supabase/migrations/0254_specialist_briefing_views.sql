-- ════════════════════════════════════════════════════════════════════════════
-- 0254 — The Specialist reads a narrow projection, not the work-order table
--
-- Two rulings collided. "Every role sees the Specialist" (reliability is
-- VIEW_ONLY on every template) versus "REQUESTER has workOrders: NO_ACCESS".
-- SpecialistWorkspacePage queries work_orders and recurring_work directly to
-- build the briefing, so gating those tables on workOrders.view / pm.view would
-- have blanked the Specialist for exactly the roles the first ruling admits.
--
-- Resolved by separating WHAT the Specialist needs from WHERE it lives. It does
-- not need work orders; it needs asset, type, status, date and cost, aggregated
-- into a Pareto. So it gets a view with precisely those columns and nothing
-- else — no title, description, assignee, notes or scope — gated on the
-- permission that admits people to the Specialist in the first place.
--
-- The base tables can then answer to their own keys, and a REQUESTER who reads
-- the briefing still cannot read a work order.
--
-- ── Why the views need an explicit permission test ──────────────────────────
-- A view with security_invoker unset runs as its OWNER, so RLS on the base
-- table does not apply to it. That is what makes this work — and it is also why
-- a view is a bypass unless it checks permission itself. sem_work_orders was
-- exactly that: readable by everyone, definer semantics, no filter. Gating
-- work_orders while leaving it alone would have been theatre.
-- ════════════════════════════════════════════════════════════════════════════

-- ── What the briefing actually consumes ─────────────────────────────────────
DROP VIEW IF EXISTS public.sem_specialist_briefing_wo;
CREATE VIEW public.sem_specialist_briefing_wo AS
    SELECT w.id, w.asset_id, w.type, w.status, w.created_at,
           w.frozen_labor_cost, w.frozen_material_cost, w.total_actual_cost
    FROM public.work_orders w
    WHERE (SELECT public.caller_can('reliability', 'view'));

COMMENT ON VIEW public.sem_specialist_briefing_wo IS
    'The only work-order columns the Specialist briefing needs (asset, type, status, date, cost). Definer semantics by design, so it bypasses work_orders RLS — the permission test in the WHERE clause is what makes that safe. Gated on reliability.view: seeing the briefing is what admits you, not work-order access.';

DROP VIEW IF EXISTS public.sem_specialist_overdue_pm;
CREATE VIEW public.sem_specialist_overdue_pm AS
    SELECT r.id, r.asset_id
    FROM public.recurring_work r
    WHERE r.active = true
      AND r.next_due_date < now()
      AND (SELECT public.caller_can('reliability', 'view'));

COMMENT ON VIEW public.sem_specialist_overdue_pm IS
    'Overdue PM programmes for the Specialist''s mission counts — the same definition the digest agent uses (active AND next_due_date < now). Gated on reliability.view.';

GRANT SELECT ON public.sem_specialist_briefing_wo TO authenticated;
GRANT SELECT ON public.sem_specialist_overdue_pm  TO authenticated;

-- ── Close the general-purpose view as a bypass ──────────────────────────────
-- sem_work_orders exposes every work-order column with definer semantics and no
-- permission test, so it would hand back through the REST API exactly what the
-- gate below takes away.
--
-- Revoked rather than rewritten. Adding a WHERE clause means CREATE OR REPLACE,
-- which cannot change a view's column list — and this one carries computed
-- columns from 0233 (wo_state, is_open, is_done) that a naive SELECT * would
-- silently drop. Copying a view definition I have not authored, to add one
-- predicate, is more risk than the problem deserves.
--
-- Safe to revoke: no application code queries it (lib/woState.ts only mentions
-- it in a comment), and the agents connect as service_role, which is not
-- `authenticated` and is unaffected.
REVOKE SELECT ON public.sem_work_orders FROM authenticated;

COMMENT ON VIEW public.sem_work_orders IS
    'Full work-order projection for the semantic layer and agent tools. NOT granted to `authenticated` (0254): definer semantics with no permission test made it a way around the work_orders RLS gate. Service-role callers are unaffected.';

-- ── Now the base tables can answer to their own keys ────────────────────────
DO $$
DECLARE
    r record;
    t text;
    perm text;
    pairs constant text[][] := ARRAY[
        ['work_orders',      'workOrders'],
        ['work_order_labor', 'workOrders'],
        ['work_order_parts', 'workOrders'],
        ['job_tasks',        'workOrders'],
        ['recurring_work',   'pm']
    ];
BEGIN
    FOR i IN 1 .. array_length(pairs, 1) LOOP
        t := pairs[i][1]; perm := pairs[i][2];
        FOR r IN SELECT policyname, cmd FROM pg_policies
                 WHERE schemaname='public' AND tablename=t AND cmd IN ('SELECT','ALL')
        LOOP
            EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, t);
            IF r.cmd = 'ALL' THEN
                EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'auth_insert_' || t, t);
                EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'auth_delete_' || t, t);
                EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (true)', 'auth_insert_' || t, t);
                EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (true)', 'auth_delete_' || t, t);
            END IF;
        END LOOP;
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format($p$
            CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
            USING ((SELECT public.caller_can(%L, 'view')))$p$, 'rbac_select_' || t, t, perm);
    END LOOP;
END $$;
