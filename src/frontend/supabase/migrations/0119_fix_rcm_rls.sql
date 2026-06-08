-- ============================================================================
-- Migration 0119: Enable RLS on RCM tables
--
-- Fixes 4 Security Advisor ERRORS:
--   - ers_rcm_studies:       RLS Disabled in Public
--   - ers_rcm_functions:     RLS Disabled in Public
--   - ers_rcm_failure_modes: RLS Disabled in Public
--   - ers_rcm_decisions:     RLS Disabled in Public
--
-- Migration 0118 disabled RLS for MVP convenience. Now that the module is
-- stable, re-enable RLS and add authenticated-user policies consistent
-- with the rest of the ERS schema (see 0111_fix_security_advisors.sql).
-- ============================================================================

-- ─── 1. ENABLE ROW LEVEL SECURITY ──────────────────────────────────────
ALTER TABLE public.ers_rcm_studies        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ers_rcm_functions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ers_rcm_failure_modes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ers_rcm_decisions      ENABLE ROW LEVEL SECURITY;

-- ─── 2. ADD POLICIES (only if none exist yet) ──────────────────────────
-- Pattern: Authenticated users get full CRUD. Fine-grained RBAC is
-- enforced in the application layer via the ERS permission matrix.

DO $$
DECLARE
    tbl TEXT;
    policy_count INT;
BEGIN
    FOR tbl IN
        SELECT unnest(ARRAY[
            'ers_rcm_studies',
            'ers_rcm_functions',
            'ers_rcm_failure_modes',
            'ers_rcm_decisions'
        ])
    LOOP
        SELECT COUNT(*) INTO policy_count
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = tbl;

        IF policy_count = 0 THEN
            EXECUTE format(
                'CREATE POLICY "Authenticated users full access" ON public.%I
                 FOR ALL
                 TO authenticated
                 USING (true)
                 WITH CHECK (true)',
                tbl
            );
            RAISE NOTICE 'Policy added for: %', tbl;
        ELSE
            RAISE NOTICE 'Policy already exists for: % (% policies)', tbl, policy_count;
        END IF;
    END LOOP;
END;
$$;

-- ─── 3. VERIFICATION ───────────────────────────────────────────────────
DO $$
DECLARE
    tbl TEXT;
    rls_on BOOLEAN;
BEGIN
    FOR tbl IN
        SELECT unnest(ARRAY[
            'ers_rcm_studies',
            'ers_rcm_functions',
            'ers_rcm_failure_modes',
            'ers_rcm_decisions'
        ])
    LOOP
        SELECT rowsecurity INTO rls_on
        FROM pg_tables
        WHERE schemaname = 'public' AND tablename = tbl;

        RAISE NOTICE 'RLS on %: %', tbl, CASE WHEN rls_on THEN 'ENABLED' ELSE 'DISABLED' END;
    END LOOP;
END;
$$;
