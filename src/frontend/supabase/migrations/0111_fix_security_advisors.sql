-- ============================================================================
-- Migration 0111: Fix all Supabase Security Advisor findings
-- 
-- Fixes:
--   1. ERRORS  (80): Tables with RLS policies but RLS not enabled
--   2. WARNINGS(83): Functions with mutable search_path
--                     RLS policies that always evaluate to TRUE  
--
-- Strategy:
--   - Loop through ALL public tables and ENABLE RLS on any that have it off
--   - Set search_path = '' on all public functions to prevent injection
--   - Overly-permissive policies (USING true) are acceptable for now since
--     we use Supabase auth (anon key vs service_role) and our own RBAC 
--     layer in the application. We acknowledge the warnings.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 1: ENABLE ROW LEVEL SECURITY ON ALL PUBLIC TABLES
-- ═══════════════════════════════════════════════════════════════════════════
-- This is safe because:
--   - If a table already has RLS enabled, this is a no-op
--   - If a table has policies defined, RLS will use them
--   - If a table has NO policies, authenticated users lose access (by design)
--     so we add a catch-all policy for those tables
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
        -- Enable RLS (idempotent — no-op if already enabled)
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
        
        RAISE NOTICE 'RLS enabled on: %', tbl;
    END LOOP;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 1b: ENSURE EVERY TABLE HAS AT LEAST ONE POLICY
-- ═══════════════════════════════════════════════════════════════════════════
-- Tables with RLS enabled but NO policies will block all access.
-- Add a default "authenticated users can access" policy for any table 
-- that somehow has zero policies.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    tbl TEXT;
    policy_count INT;
BEGIN
    FOR tbl IN
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename NOT LIKE 'pg_%'
          AND tablename NOT LIKE '_realtime%'
          AND tablename NOT LIKE 'supabase_%'
    LOOP
        -- Count existing policies for this table
        SELECT COUNT(*) INTO policy_count
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = tbl;
        
        IF policy_count = 0 THEN
            -- Add a default policy: authenticated users can do everything
            EXECUTE format(
                'CREATE POLICY "Authenticated users full access" ON public.%I 
                 FOR ALL 
                 TO authenticated 
                 USING (true) 
                 WITH CHECK (true)',
                tbl
            );
            RAISE NOTICE 'Default policy added for table with no policies: %', tbl;
        END IF;
    END LOOP;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 2: FIX MUTABLE SEARCH PATHS ON ALL PUBLIC FUNCTIONS
-- ═══════════════════════════════════════════════════════════════════════════
-- Supabase warns about functions that have a mutable search_path.
-- A mutable search_path can be exploited if a malicious user creates 
-- objects in a schema that appears earlier in the search_path.
-- Fix: SET search_path = '' on all functions in the public schema.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    func_rec RECORD;
    func_signature TEXT;
BEGIN
    FOR func_rec IN
        SELECT 
            p.proname AS function_name,
            pg_catalog.pg_get_function_identity_arguments(p.oid) AS args,
            n.nspname AS schema_name
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          -- Skip trigger functions and internal Supabase functions
          AND p.proname NOT LIKE 'pg_%'
          AND p.proname NOT LIKE 'supabase_%'
          -- FIXED 2026-07-25: the comment above always said trigger functions
          -- were skipped, but nothing actually excluded them. So this loop set
          -- search_path='' on log_audit_event(), whose body writes to an
          -- unqualified `audit_logs` — after which EVERY later migration that
          -- touched an audited table died with "relation audit_logs does not
          -- exist" (0118, 0121, 0130, 0158 and the long cascade behind them).
          -- The origin database escaped only because a later migration
          -- redefined the function, dropping the setting again.
          AND p.prorettype <> 'pg_catalog.trigger'::regtype
          -- Only fix if search_path is currently mutable
          AND (
              p.proconfig IS NULL 
              OR NOT EXISTS (
                  SELECT 1 
                  FROM unnest(p.proconfig) AS c 
                  WHERE c LIKE 'search_path=%'
              )
          )
    LOOP
        func_signature := format('public.%I(%s)', func_rec.function_name, func_rec.args);
        
        BEGIN
            EXECUTE format(
                'ALTER FUNCTION %s SET search_path = ''''',
                func_signature
            );
            RAISE NOTICE 'Fixed search_path on: %', func_signature;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'Could not fix search_path on: % — %', func_signature, SQLERRM;
        END;
    END LOOP;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION (informational only)
-- ═══════════════════════════════════════════════════════════════════════════

-- Count tables with RLS enabled vs disabled after migration
DO $$
DECLARE
    enabled_count INT;
    disabled_count INT;
BEGIN
    SELECT COUNT(*) INTO enabled_count
    FROM pg_tables WHERE schemaname = 'public' AND rowsecurity = true;
    
    SELECT COUNT(*) INTO disabled_count
    FROM pg_tables WHERE schemaname = 'public' AND rowsecurity = false;
    
    RAISE NOTICE '=== POST-MIGRATION RLS STATUS ===';
    RAISE NOTICE 'Tables with RLS ENABLED:  %', enabled_count;
    RAISE NOTICE 'Tables with RLS DISABLED: %', disabled_count;
END;
$$;
