-- ════════════════════════════════════════════════════════════════════════════
-- 0243 — Wrap RLS function calls in a scalar subquery (Gate G2)
--
-- A STABLE function called bare in an RLS qual is evaluated ONCE PER ROW.
-- Postgres does not hoist it, even with constant arguments. Measured on a
-- 200,000-row table with RLS active as `authenticated`:
--
--     USING (true)                            265 ms
--     USING (caller_can('workOrders','view')) 18,969 ms   ← 72× , per-row
--     USING ((SELECT caller_can(...)))            33 ms   ← InitPlan, once
--     USING (is_admin())                       3,013 ms   ← 11× , per-row
--     USING ((SELECT is_admin()))                 20 ms   ← InitPlan, once
--
-- The bare form did 602,112 buffer hits against users and role_permissions for
-- a single count(*). Wrapped, it does 2,127 and the plan shows `InitPlan 1`
-- with the filter reading `(InitPlan 1).col1`.
--
-- An uncorrelated scalar subquery is what makes the difference: Postgres
-- evaluates it once and reuses the result for the scan.
--
-- This is NOT a caller_can() problem. is_admin() — used by policies since 0171
-- and generated across dozens of tables by 0186 — has exactly the same defect.
-- It is invisible today because the largest table here holds 1,965 rows, and it
-- would become an outage on a real tenant. This migration fixes the policies
-- written in this workstream; the generated ones from 0186 and the hand-written
-- ones elsewhere still need the same treatment, and
-- `scripts/provision/audit-policies.mjs` now reports them.
--
-- Behaviour is identical — only the plan changes.
-- ════════════════════════════════════════════════════════════════════════════

-- 0237 — invite tokens
DROP POLICY IF EXISTS sel_user_invites ON public.user_invites;
CREATE POLICY sel_user_invites ON public.user_invites
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));

-- 0238 — error logs
DROP POLICY IF EXISTS admin_select_error_logs ON public.error_logs;
CREATE POLICY admin_select_error_logs ON public.error_logs
    FOR SELECT TO authenticated USING ((SELECT public.is_admin()));

DROP POLICY IF EXISTS admin_update_error_logs ON public.error_logs;
CREATE POLICY admin_update_error_logs ON public.error_logs
    FOR UPDATE TO authenticated
    USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

-- 0238 — audit logs. The table_name test stays a plain per-row comparison: it is
-- a column filter, which is what a per-row qual is supposed to be.
DROP POLICY IF EXISTS scoped_select_audit_logs ON public.audit_logs;
CREATE POLICY scoped_select_audit_logs ON public.audit_logs
    FOR SELECT TO authenticated
    USING (
        (SELECT public.is_admin())
        OR table_name NOT IN ('users', 'companies', 'user_invites', 'contacts')
    );

-- 0241 — the permission mirror itself
DROP POLICY IF EXISTS admin_select_role_permissions ON public.role_permissions;
CREATE POLICY admin_select_role_permissions ON public.role_permissions
    FOR SELECT TO authenticated USING ((SELECT public.is_admin()));

COMMENT ON FUNCTION public.caller_can(text, text) IS
    'Does the CALLER hold module.action? ALWAYS call it wrapped in RLS: USING ((SELECT public.caller_can(''finops'',''view''))). Bare, it is evaluated once per row — 72x slower on 200k rows (0243). SECURITY DEFINER: it reads users, so never gate users/role_permissions with it (infinite recursion).';
