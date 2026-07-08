-- 0186 — Phase-2 RLS hardening (single-tenant posture, per 0171 decision).
--
-- What this does — four privilege tiers, enforced in the database instead of
-- scattered client-side role arrays (which have drifted repeatedly):
--
--   1. GOVERNANCE tables  → reads open to authenticated, ALL writes admin-only
--      (is_admin() = active SUPER_ADMIN / SYS_ADMIN). This also CLOSES A REAL
--      HOLE: reference_codes still carried permissive policies from 0049/0062
--      ("Enable all for authenticated" etc.) that 0171 never dropped — and
--      permissive policies OR together, so its admin-only writes were a no-op.
--      We wipe ALL existing policies per table and recreate a canonical set,
--      so no leftover policy can silently re-open a table again.
--
--   2. OPERATIONAL PARENT records → reads/inserts/updates stay open to
--      authenticated (technicians complete WOs, raise requests, log readings),
--      but DELETE becomes admin-only — matching the app RBAC templates, where
--      no non-admin role has delete on core modules.
--
--   3. APPEND-ONLY logs → select+insert only; nobody (admin included) can
--      update or delete audit trails. Error/notification logs additionally
--      allow admin delete (housekeeping).
--
--   4. NOTIFICATIONS → recipient-owned: you can only read/update/delete YOUR
--      notifications (admins see all); anyone may insert (cross-user sends).
--
-- Deliberately NOT in scope (deferred to the multi-tenant T-0..T-4 program in
-- docs/Multi-Tenancy-Enterprise-Structure-Design.md): site/company scoping,
-- per-role write granularity on operational tables (PLANNER vs TECHNICIAN),
-- organization_units (managers still edit org), ers_* write tiers
-- (RELIABILITY_ENG is not is_admin and must keep writing FMEA/RCA/integrity).
--
-- SECURITY DEFINER RPCs (create_auth_user, admin_reset_password,
-- delete_auth_user) and the service-role key bypass RLS — unaffected.
--
-- Rollback (per table): DROP the p2_* policies and recreate the 0150-style
-- open ones:
--   CREATE POLICY auth_all ON public.<t> FOR ALL TO authenticated
--     USING (true) WITH CHECK (true);
--
-- Atomic: wrap in a txn.
BEGIN;

DO $$
DECLARE
  t text;
  p record;
  -- Tier 1: governance/config — reads open, writes admin-only.
  governance text[] := ARRAY[
    'dictionaries', 'reference_codes', 'hierarchy_config',
    'numbering_config', 'numbering_config_overrides', 'companies',
    'maintenance_strategies', 'strategy_packages',
    'connectors', 'connector_sync_logs', 'semantic_catalog',
    'work_centers', 'manufacturers',
    'notification_rules', 'notification_channels', 'message_templates',
    'users'
  ];
  -- Tier 2: operational parents — open CRU, admin-only DELETE.
  admin_delete text[] := ARRAY[
    'assets', 'work_orders', 'service_requests', 'recurring_work',
    'contacts', 'inventory_items', 'reading_definitions', 'purchase_orders'
  ];
  -- Tier 3a: append-only audit trails — select+insert only, for everyone.
  append_only text[] := ARRAY[
    'audit_logs', 'ers_rca_audit_log', 'ers_ai_audit_log'
  ];
  -- Tier 3b: housekeeping logs — select+insert open, delete admin, no update.
  logs_admin_delete text[] := ARRAY[
    'error_logs', 'notification_logs'
  ];

  wipe_sql text := 'DROP POLICY %I ON public.%I';
BEGIN
  -- ── Tier 1: governance — reads open, writes admin ──────────────────────
  FOREACH t IN ARRAY governance LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format(wipe_sql, p.policyname, t);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)',
                   'p2_select_' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_admin())',
                   'p2_admin_insert_' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())',
                   'p2_admin_update_' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.is_admin())',
                   'p2_admin_delete_' || t, t);
  END LOOP;

  -- ── Tier 2: operational parents — open CRU, admin-only delete ──────────
  FOREACH t IN ARRAY admin_delete LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format(wipe_sql, p.policyname, t);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)',
                   'p2_select_' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (true)',
                   'p2_insert_' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (true) WITH CHECK (true)',
                   'p2_update_' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.is_admin())',
                   'p2_admin_delete_' || t, t);
  END LOOP;

  -- ── Tier 3a: append-only audit trails ──────────────────────────────────
  FOREACH t IN ARRAY append_only LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format(wipe_sql, p.policyname, t);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)',
                   'p2_select_' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (true)',
                   'p2_insert_' || t, t);
    -- no UPDATE / DELETE policies: audit trails are immutable for everyone.
  END LOOP;

  -- ── Tier 3b: housekeeping logs — append + admin delete ─────────────────
  FOREACH t IN ARRAY logs_admin_delete LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format(wipe_sql, p.policyname, t);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)',
                   'p2_select_' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (true)',
                   'p2_insert_' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.is_admin())',
                   'p2_admin_delete_' || t, t);
  END LOOP;

  -- ── Tier 4: notifications — recipient-owned ────────────────────────────
  IF to_regclass('public.notifications') IS NOT NULL THEN
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notifications' LOOP
      EXECUTE format(wipe_sql, p.policyname, 'notifications');
    END LOOP;
    ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
    -- NOTE: recipient_id is TEXT on the live table (0052), so cast auth.uid().
    CREATE POLICY p2_select_notifications ON public.notifications
      FOR SELECT TO authenticated
      USING (recipient_id = auth.uid()::text OR public.is_admin());
    -- anyone may send a notification to anyone (system + cross-user flows)
    CREATE POLICY p2_insert_notifications ON public.notifications
      FOR INSERT TO authenticated WITH CHECK (true);
    CREATE POLICY p2_update_notifications ON public.notifications
      FOR UPDATE TO authenticated
      USING (recipient_id = auth.uid()::text OR public.is_admin())
      WITH CHECK (recipient_id = auth.uid()::text OR public.is_admin());
    CREATE POLICY p2_delete_notifications ON public.notifications
      FOR DELETE TO authenticated
      USING (recipient_id = auth.uid()::text OR public.is_admin());
  END IF;
END $$;

-- ── Anon lockdown: the API surface is authenticated-only ─────────────────
-- RLS already denies anon (no policies grant it), but revoke the underlying
-- grants too so a policy mistake can never expose data pre-login.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;

COMMIT;
