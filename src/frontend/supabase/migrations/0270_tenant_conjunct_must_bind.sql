-- ════════════════════════════════════════════════════════════════════════════
-- 0270 — leading is not the same as binding
--
-- 0269 required the tenant test to come FIRST. Self-testing it found that is
-- not sufficient, on the one shape it was written to catch:
--
--     USING (company_id = (SELECT caller_company()) OR true)
--
-- That starts with the tenant test, satisfies "leading", and is wide open. Four
-- of five probe shapes were caught; this was the fifth, and it is the one an
-- actual mistake would look like.
--
-- What matters is not position but BINDING: the tenant test must be a top-level
-- conjunct, meaning the thing immediately after it is `AND`, or nothing at all.
-- If an `OR` follows, some other branch can satisfy the policy on its own and
-- the tenant test is decorative.
--
--     company_id = … AND <role test>     ✅ tenant always required
--     company_id IS NULL OR company_id = …   ✅ config (0267), ends there
--     company_id = … OR true             ❌ any row matches
--     is_admin() OR company_id = …       ❌ admins escape the tenant
--
-- Parens are stripped before matching, so `A AND (B OR C)` flattens to
-- `A AND B OR C` and still matches on ` AND ` — correct, because A is a
-- conjunct regardless of what sits inside the group. Conversely
-- `(A OR B) AND C` flattens to `A OR B AND C` and is flagged — also correct,
-- because there A really is OR-defeated.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.tenancy_policy_gaps()
RETURNS TABLE (kind text, object_name text, detail text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
    WITH tenant_tables AS (
        SELECT c.oid, c.relname
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relkind = 'r'
           AND EXISTS (SELECT 1 FROM information_schema.columns col
                        WHERE col.table_schema = 'public'
                          AND col.table_name = c.relname
                          AND col.column_name = 'company_id')
           AND c.relname NOT IN ('users', 'companies')
    )
    SELECT 'rls_disabled'::text, t.relname::text,
           format('rls_enabled=%s policies=%s', c.relrowsecurity,
                  (SELECT count(*) FROM pg_policies p
                    WHERE p.schemaname = 'public' AND p.tablename = t.relname))
      FROM tenant_tables t
      JOIN pg_class c ON c.oid = t.oid
     WHERE c.relrowsecurity = false
        OR NOT EXISTS (SELECT 1 FROM pg_policies p
                        WHERE p.schemaname = 'public' AND p.tablename = t.relname)

    UNION ALL

    SELECT 'policy_ungated'::text,
           format('%s.%s', p.tablename, p.policyname)::text,
           format('cmd=%s', p.cmd)
      FROM pg_policies p
      JOIN tenant_tables t ON t.relname = p.tablename
     WHERE p.schemaname = 'public'
       AND p.permissive = 'PERMISSIVE'
       AND coalesce(p.qual, '') || coalesce(p.with_check, '') NOT LIKE '%caller_company%'

    UNION ALL

    -- The tenant test must BIND: followed by AND, or by nothing.
    SELECT 'tenant_test_not_binding'::text,
           format('%s.%s', p.tablename, p.policyname)::text,
           format('cmd=%s expr=%s', p.cmd, left(e.flat, 90))
      FROM pg_policies p
      JOIN tenant_tables t ON t.relname = p.tablename
      CROSS JOIN LATERAL (
          SELECT coalesce(p.qual, p.with_check, '') AS expr,
                 btrim(regexp_replace(
                     regexp_replace(coalesce(p.qual, p.with_check, ''), '[()]', '', 'g'),
                     '\s+', ' ', 'g')) AS flat
      ) AS e
     WHERE p.schemaname = 'public'
       AND p.permissive = 'PERMISSIVE'
       AND e.expr LIKE '%caller_company%'
       AND e.flat !~ ('^company_id = SELECT caller_company AS caller_company( AND |$)'
                      '|^company_id IS NULL OR company_id = SELECT caller_company AS caller_company( AND |$)')

    UNION ALL

    SELECT 'view_unfiltered'::text, c.relname::text,
           'definer view, no caller_company() filter'::text
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'v'
       AND coalesce((SELECT option_value FROM pg_options_to_table(c.reloptions)
                      WHERE option_name = 'security_invoker'), 'false') <> 'true'
       AND pg_get_viewdef(c.oid, true) NOT LIKE '%caller_company%';
$$;

COMMENT ON FUNCTION public.tenancy_policy_gaps() IS
    'Static proof that the tenant boundary is complete AND enforcing. RLS on, every permissive policy carries a tenant test, that test BINDS (followed by AND or end-of-expression, so no OR branch can satisfy the policy without it), and no DEFINER view reads past RLS. Two shapes allowed: the plain equality, and the 0267 config form that also serves global rows where company_id IS NULL. Gate G4 — tests/rls/tenant-completeness.mjs.';

REVOKE ALL ON FUNCTION public.tenancy_policy_gaps() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenancy_policy_gaps() TO service_role;

-- ── The matcher must be right in BOTH directions ───────────────────────────
-- Quiet on 480 known-good policies, and loud on each shape it exists to catch.
-- Checked here, in the migration, because a checker that has only ever been
-- observed staying silent has not been observed working.
DO $$
DECLARE n int; sample text;
BEGIN
    SELECT count(*), min(object_name) INTO n, sample
      FROM public.tenancy_policy_gaps() WHERE kind = 'tenant_test_not_binding';
    IF n > 0 THEN
        RAISE EXCEPTION 'binding check flags % existing policy(ies), e.g. % — the matcher is wrong, not the schema', n, sample;
    END IF;

    -- OR-defeated, the shape 0269 let through.
    CREATE POLICY _probe_bind ON public.work_orders FOR SELECT TO authenticated
        USING (company_id = (SELECT public.caller_company()) OR true);
    IF NOT EXISTS (SELECT 1 FROM public.tenancy_policy_gaps()
                    WHERE object_name = 'work_orders._probe_bind') THEN
        DROP POLICY _probe_bind ON public.work_orders;
        RAISE EXCEPTION 'matcher still misses `tenant OR true` — the whole point of this migration';
    END IF;
    DROP POLICY _probe_bind ON public.work_orders;

    -- Tenant test behind a role escape.
    CREATE POLICY _probe_bind ON public.work_orders FOR SELECT TO authenticated
        USING ((SELECT public.is_admin()) OR company_id = (SELECT public.caller_company()));
    IF NOT EXISTS (SELECT 1 FROM public.tenancy_policy_gaps()
                    WHERE object_name = 'work_orders._probe_bind') THEN
        DROP POLICY _probe_bind ON public.work_orders;
        RAISE EXCEPTION 'matcher misses an admin OR-escape';
    END IF;
    DROP POLICY _probe_bind ON public.work_orders;

    SELECT count(*) INTO n FROM public.tenancy_policy_gaps();
    IF n > 0 THEN
        RAISE EXCEPTION 'tenancy incomplete after probes: % gap(s)', n;
    END IF;
    RAISE NOTICE 'binding check verified in both directions, 0 gaps';
END $$;
