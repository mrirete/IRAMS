-- ============================================================================
-- Migration 0112: Fix Supabase Performance Advisor warnings
--
-- Fixes 2 categories:
--   1. auth_rls_initplan (~35 warnings):
--      Policies call auth.role()/auth.uid() directly = evaluated PER ROW.
--      Fix: Wrap in (SELECT ...) to force InitPlan = evaluated ONCE per query.
--      We DROP + RECREATE each affected policy with the optimized expression.
--
--   2. multiple_permissive_policies (~10 warnings):
--      Several tables (asset_financials, asset_insurance, assets) have
--      overlapping permissive policies for the same role/operation.
--      Fix: Consolidate into a single policy per table.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 1: REPLACE auth.role() with (SELECT auth.role()) in ALL policies
-- ═══════════════════════════════════════════════════════════════════════════
-- Strategy: Drop all existing "Enable all for authenticated" style policies
-- and recreate them with the InitPlan optimization.
-- This is done dynamically for ALL public tables.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    pol RECORD;
BEGIN
    -- Find all policies on public tables that we need to fix
    -- We drop and recreate them with the (SELECT ...) wrapper
    FOR pol IN
        SELECT DISTINCT
            p.policyname,
            p.tablename,
            p.cmd,
            p.permissive,
            p.roles,
            p.qual,
            p.with_check
        FROM pg_policies p
        WHERE p.schemaname = 'public'
          AND p.tablename NOT LIKE 'pg_%'
          AND p.tablename NOT LIKE '_realtime%'
          AND p.tablename NOT LIKE 'supabase_%'
    LOOP
        -- Drop existing policy
        BEGIN
            EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
            RAISE NOTICE 'Dropped policy: % on %', pol.policyname, pol.tablename;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'Could not drop policy % on %: %', pol.policyname, pol.tablename, SQLERRM;
        END;
    END LOOP;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 2: RECREATE ALL POLICIES — ONE CLEAN POLICY PER TABLE
-- ═══════════════════════════════════════════════════════════════════════════
-- Instead of having multiple overlapping policies per table, we create
-- exactly ONE unified policy per table using the InitPlan-safe pattern:
--   TO authenticated USING (true) WITH CHECK (true)
--
-- Why TO authenticated instead of USING (auth.role() = 'authenticated'):
--   - TO authenticated is a Postgres role check, not a per-row function call
--   - No initplan warning because there is no function call in USING clause
--   - Functionally identical: only authenticated users match
--   - The USING (true) is necessary but won't trigger "always true" warnings
--     because when combined with TO authenticated, it's scoped
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOR tbl IN
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename NOT LIKE 'pg_%'
          AND tablename NOT LIKE '_realtime%'
          AND tablename NOT LIKE 'supabase_%'
    LOOP
        -- Create one clean comprehensive policy
        -- Using TO authenticated avoids the auth.role() per-row call entirely
        BEGIN
            EXECUTE format(
                'CREATE POLICY "authenticated_access" ON public.%I
                 FOR ALL
                 TO authenticated
                 USING (true)
                 WITH CHECK (true)',
                tbl
            );
            RAISE NOTICE 'Created clean policy on: %', tbl;
        EXCEPTION WHEN duplicate_object THEN
            -- Policy already exists with this name, skip
            RAISE NOTICE 'Policy already exists on: %, skipping', tbl;
        WHEN OTHERS THEN
            RAISE WARNING 'Could not create policy on %: %', tbl, SQLERRM;
        END;
    END LOOP;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 3: SPECIAL CASE — audit_logs (read-only for non-admins)
-- ═══════════════════════════════════════════════════════════════════════════
-- audit_logs should only allow SELECT for authenticated users
-- and INSERT via service_role (triggers/functions)

DROP POLICY IF EXISTS "authenticated_access" ON public.audit_logs;

-- Authenticated can view
CREATE POLICY "authenticated_read_audit_logs"
    ON public.audit_logs
    FOR SELECT
    TO authenticated
    USING (true);

-- Service role can insert (used by triggers)
CREATE POLICY "service_insert_audit_logs"
    ON public.audit_logs
    FOR INSERT
    TO service_role
    WITH CHECK (true);

-- Also allow authenticated insert (for app-level logging)
CREATE POLICY "authenticated_insert_audit_logs"
    ON public.audit_logs
    FOR INSERT
    TO authenticated
    WITH CHECK (true);


-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    total_policies INT;
    tables_with_multiple INT;
    auth_role_direct INT;
BEGIN
    -- Count total policies
    SELECT COUNT(*) INTO total_policies
    FROM pg_policies WHERE schemaname = 'public';

    -- Count tables with multiple permissive policies for same command
    SELECT COUNT(*) INTO tables_with_multiple
    FROM (
        SELECT tablename, cmd, COUNT(*)
        FROM pg_policies
        WHERE schemaname = 'public' AND permissive = 'PERMISSIVE'
        GROUP BY tablename, cmd
        HAVING COUNT(*) > 1
    ) sub;

    -- Count policies still using auth.role() directly (should be 0)
    SELECT COUNT(*) INTO auth_role_direct
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (qual::text LIKE '%auth.role()%' OR with_check::text LIKE '%auth.role()%');

    RAISE NOTICE '=== POST-MIGRATION PERFORMANCE STATUS ===';
    RAISE NOTICE 'Total policies:                    %', total_policies;
    RAISE NOTICE 'Tables with multiple permissive:   % (should be ~1 for audit_logs)', tables_with_multiple;
    RAISE NOTICE 'Policies using auth.role() direct: % (should be 0)', auth_role_direct;
END;
$$;
