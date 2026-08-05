-- ════════════════════════════════════════════════════════════════════════════
-- 0264 — Tenancy: close the post-sweep gap, and make the gap class detectable
--
-- 0261 added the tenant conjunct to every policy that existed WHEN IT RAN. That
-- is a one-shot sweep, and the schema kept moving: 0262 created
-- movement_type_gl_overrides afterwards, with `USING (true)` on its read policy.
-- The table's own comment says "the chart of accounts is the customer's", and
-- its primary key is (company_id, code) — so the design is tenant-correct and
-- only the policy was a placeholder. Left alone, every tenant would read every
-- other tenant's G/L account mapping the moment that table held data.
--
-- ── Why the cross-tenant probe could never have caught this ─────────────────
-- G3 borrows an existing row, reassigns it to a probe tenant, and asks whether
-- tenant A can still reach it. That design has two blind spots, and this table
-- sits in both:
--
--   1. it is EMPTY — no row to borrow, so no verdict (70 tables are here)
--   2. it has NO `id` column — its PK is composite, so the probe, which
--      addresses rows as `?id=eq.…`, cannot see it at all (6 tables are here)
--
-- An empirical probe can only ever prove the tables it can reach. The property
-- actually being claimed — "every tenant-owned table carries the conjunct" — is
-- STATIC. It is a fact about pg_policies, not about data, and checking it needs
-- no rows, covers all 152 tables, and cannot be defeated by an empty table.
--
-- So: fix the gap, then install the static check as a function that ships WITH
-- the schema, so it cannot drift away from the thing it checks.
--
-- ── Why PERMISSIVE is the thing to count ────────────────────────────────────
-- Policies of the same command OR together. One permissive policy without the
-- conjunct defeats every sibling that has it — no error, no warning, just a
-- wider door. That exact bug already shipped once here: 0238 made error_logs
-- admin-only and changed nothing, because the permissive p2_select_* policies
-- survived beside it and OR-ed the restriction away. 0239 had to drop them.
-- The check therefore asks "is EVERY permissive policy gated", not "is ANY".
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. The gap ──────────────────────────────────────────────────────────────
-- Tenant conjunct first (indexed uuid compare, eliminates rows before the
-- function runs), and is_admin() wrapped in a SELECT so it is an InitPlan
-- rather than a per-row call — the convention 0243 and 0251 established.

DROP POLICY IF EXISTS "mt_gl_overrides_read" ON public.movement_type_gl_overrides;
CREATE POLICY "mt_gl_overrides_read" ON public.movement_type_gl_overrides
    FOR SELECT TO authenticated
    USING (company_id = (SELECT public.caller_company()));

DROP POLICY IF EXISTS "mt_gl_overrides_admin_write" ON public.movement_type_gl_overrides;
CREATE POLICY "mt_gl_overrides_admin_write" ON public.movement_type_gl_overrides
    FOR ALL TO authenticated
    USING       (company_id = (SELECT public.caller_company()) AND (SELECT public.is_admin()))
    WITH CHECK  (company_id = (SELECT public.caller_company()) AND (SELECT public.is_admin()));

-- The read stays open to every role inside the tenant, exactly as 0262 intended.
-- Narrowing it to a finance role here would be scope this migration did not ask
-- for, and would break the FinOps surfaces that render the mapping.

-- ── 2. The check, as a function that lives with the schema ──────────────────
-- Returns one row per gap. Empty result = tenancy is structurally complete.
-- Deliberately NOT an event trigger: a trigger that rejects CREATE POLICY would
-- fire inside every future migration and inside Supabase's own tooling, and the
-- first false positive would be diagnosed by disabling it. A function that CI
-- calls fails loudly in the one place a human is already looking.

CREATE OR REPLACE FUNCTION public.tenancy_policy_gaps()
RETURNS TABLE (kind text, object_name text, detail text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
    -- (a) a tenant-owned table with RLS off, or with no policy at all.
    --     Nothing to OR against and nothing to inspect: wide open, silently.
    SELECT 'rls_disabled'::text,
           c.relname::text,
           format('rls_enabled=%s policies=%s', c.relrowsecurity,
                  (SELECT count(*) FROM pg_policies p
                    WHERE p.schemaname = 'public' AND p.tablename = c.relname))
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND EXISTS (SELECT 1 FROM information_schema.columns col
                    WHERE col.table_schema = 'public'
                      AND col.table_name = c.relname
                      AND col.column_name = 'company_id')
       AND c.relname NOT IN ('users', 'companies')
       AND (c.relrowsecurity = false
            OR NOT EXISTS (SELECT 1 FROM pg_policies p
                            WHERE p.schemaname = 'public' AND p.tablename = c.relname))

    UNION ALL

    -- (b) a PERMISSIVE policy on a tenant-owned table with no tenant test.
    --     Because permissive policies OR together, one of these defeats all of
    --     its siblings. `users` is exempt by design: gating it would break the
    --     login path that resolves the caller's tenant in the first place.
    SELECT 'policy_ungated'::text,
           format('%s.%s', p.tablename, p.policyname)::text,
           format('cmd=%s', p.cmd)
      FROM pg_policies p
     WHERE p.schemaname = 'public'
       AND p.permissive = 'PERMISSIVE'
       AND p.tablename NOT IN ('users', 'companies')
       AND EXISTS (SELECT 1 FROM information_schema.columns col
                    WHERE col.table_schema = 'public'
                      AND col.table_name = p.tablename
                      AND col.column_name = 'company_id')
       AND coalesce(p.qual, '') || coalesce(p.with_check, '') NOT LIKE '%caller_company%'

    UNION ALL

    -- (c) a view that reads past RLS (security_invoker off, the default) with no
    --     tenant filter of its own. Six such views exist on purpose — they
    --     bypass the ROLE gate so names render for roles that cannot read the
    --     base table — but bypassing the role must never bypass the tenant.
    SELECT 'view_unfiltered'::text,
           c.relname::text,
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
    'Static proof that the tenant boundary is complete. Returns one row per gap; empty means complete. Covers all tenant-owned tables including the empty ones and the six with no id column, which the G3 row-borrowing probe cannot reach. Called by tests/rls/tenant-completeness.mjs (gate G4) — keep that wiring.';

REVOKE ALL ON FUNCTION public.tenancy_policy_gaps() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenancy_policy_gaps() TO service_role;

-- ── 3. Prove it on the way in ───────────────────────────────────────────────
-- If this migration did not actually close everything, fail here rather than
-- reporting success and leaving the gap for CI to find later.
DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM public.tenancy_policy_gaps();
    IF n > 0 THEN
        RAISE EXCEPTION 'tenancy incomplete: % gap(s) remain — %',
            n, (SELECT string_agg(kind || ':' || object_name, ', ')
                  FROM public.tenancy_policy_gaps());
    END IF;
    RAISE NOTICE 'tenancy structurally complete: 0 gaps';
END $$;
