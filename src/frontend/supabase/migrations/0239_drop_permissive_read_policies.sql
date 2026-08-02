-- ════════════════════════════════════════════════════════════════════════════
-- 0239 — Remove the permissive SELECT policies that made 0238 a no-op
--
-- 0238 added admin-only SELECT policies to error_logs and audit_logs and
-- reported success. It changed nothing. Postgres RLS is PERMISSIVE by default:
-- policies are OR-ed, so access is granted if ANY policy matches. Adding a
-- restrictive-looking policy beside an existing `USING (true)` grants exactly
-- what it granted before.
--
-- Two policies were doing that, and neither appears in any migration file:
--     p2_select_error_logs   SELECT  USING (true)
--     p2_select_audit_logs   SELECT  USING (true)
-- They were created out-of-band, so the repo never described the database's
-- real posture. Worth knowing generally: `DROP POLICY IF EXISTS <name>` only
-- removes the name you thought of, and a policy you have never heard of is
-- invisible to that statement.
--
-- The lesson is the same one this whole sweep keeps producing: the migration
-- applied cleanly, the log said ok, and the leak was still open. Only reading
-- pg_policies afterwards showed it.
--
-- Dropping these leaves the intended policies from 0238 in force:
--     error_logs  SELECT/UPDATE  is_admin()          — insert stays open
--     audit_logs  SELECT         is_admin() OR the row does not audit
--                                users/companies/user_invites/contacts
-- ════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS p2_select_error_logs ON public.error_logs;
DROP POLICY IF EXISTS p2_select_audit_logs ON public.audit_logs;

-- Belt and braces: any other permissive read policy on these two tables that
-- predates the scoped ones would reopen the hole just as quietly.
DROP POLICY IF EXISTS "Allow authenticated read" ON public.error_logs;
DROP POLICY IF EXISTS auth_select_audit_logs      ON public.audit_logs;
