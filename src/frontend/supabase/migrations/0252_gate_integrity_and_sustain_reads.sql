-- ════════════════════════════════════════════════════════════════════════════
-- 0252 — Integrity and sustainability reads answer to the matrix
--
-- Continues the read-leak closure. TECHNICIAN and REQUESTER could read
-- inspection records, RBI assessments, corrosion data and carbon metrics
-- straight from the API while the matrix says integrity and sustain are
-- NO_ACCESS for both.
--
-- ── Why these two families are safe, when others were not ───────────────────
-- The reader sweep is the whole job here; it has changed the answer four times
-- in this workstream (FinancialsTab, cost_centers, generateWOFromPM, and the
-- FOR ALL trap). What it found this time:
--
--   integrity  Every consumer is a /comply/* page, and those routes are ALREADY
--              PermissionGate'd on `integrity` via the shared map in
--              config/modulePermissions. So the only people who can reach a
--              page that reads these tables are the people this policy admits.
--              UI and database finally agree instead of contradicting.
--              (AssetContext merely NAMES useIntegrity in a comment;
--              InspectionAssetTab is rendered nowhere.)
--
--   sustain    ers_carbon_metrics and ers_climate_risks have NO live consumer
--              at all — AnalyzeService can read them, nothing calls it, and no
--              component references either type. The `sustain` module is also
--              launchReady:false. Closing these costs nothing today and stops
--              them leaking the moment the module ships.
--
-- ── Deliberately NOT in this pass, with reasons ─────────────────────────────
--   jsa_assessments   JSATab, WorkOrders and RecurringWork read it. Technicians
--                     complete JSAs on their jobs; safety: NO_ACCESS would stop
--                     them. The matrix is wrong here, not the code.
--   hierarchy_config  AppLayout reads it for EVERY user on EVERY page load. It
--                     is app infrastructure, not an admin module — recorded in
--                     EXPECTED_OPEN rather than gated.
--   cost_centers      Released deliberately in 0247: work-order costing master
--                     data, not finance-module data.
--   contacts,         Assignee names, supplier pickers, on-order lists — all
--   vendors,          read from surfaces the affected roles legitimately open.
--   purchase_orders   Each needs its UI handled first, exactly as FinancialsTab
--                     was, or it empties a control with no explanation.
--
-- Reads only; writes preserved exactly. Every call wrapped in (SELECT …), which
-- is the difference between an InitPlan and a per-row scan (0243).
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    t     text;
    perm  text;
    r     record;
    pairs constant text[][] := ARRAY[
        ['ers_inspections',        'integrity'],
        ['ers_rbi_assessments',    'integrity'],
        ['ers_cmls',               'integrity'],
        ['ers_thickness_readings', 'integrity'],
        ['ers_corrosion_rates',    'integrity'],
        ['ers_damage_mechanisms',  'integrity'],
        ['ers_ffs_assessments',    'integrity'],
        ['ers_iow_parameters',     'integrity'],
        ['ers_carbon_metrics',     'sustain'],
        ['ers_climate_risks',      'sustain']
    ];
BEGIN
    FOR i IN 1 .. array_length(pairs, 1) LOOP
        t    := pairs[i][1];
        perm := pairs[i][2];

        -- Every policy granting SELECT must go, FOR ALL ones included: RLS is
        -- OR-ed, so one surviving `USING (true)` grants exactly what it granted
        -- before and the migration becomes a no-op that reports success. That
        -- is precisely how 0238 applied cleanly and changed nothing.
        FOR r IN
            SELECT policyname, cmd FROM pg_policies
            WHERE schemaname = 'public' AND tablename = t AND cmd IN ('SELECT', 'ALL')
        LOOP
            EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, t);
            -- A FOR ALL policy was also the write grant. Put those back
            -- unchanged so only reading changes meaning.
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
