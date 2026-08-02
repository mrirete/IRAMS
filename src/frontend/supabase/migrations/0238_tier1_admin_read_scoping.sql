-- ════════════════════════════════════════════════════════════════════════════
-- 0238 — Tier 1: stop every logged-in user reading the operational record
--
-- Found by tests/rls/rls-matrix.mjs. Companion to 0237 (invite tokens).
--
-- Scope was chosen by checking who actually READS each table, not by how
-- sensitive the name sounds. Two tables that looked like obvious admin-only
-- locks are deliberately NOT locked that way, because doing so would have
-- broken the app for exactly the users the change was meant to protect:
--
--   users     AuthContext resolves your own profile from it at login, and
--             DatabaseService looks up OTHER users' names to render "assigned
--             to …". Admin-only breaks login; self-or-admin breaks every
--             assignee label. The real fix is column-level — a directory view
--             exposing (id, username) with the base table restricted — and that
--             needs a code change, so it is not in this migration.
--
--   companies useEdition and SettingsContext read it on EVERY page load for
--             every user; it carries the edition and app_settings. Locking it
--             breaks routing and settings for everyone. It is infrastructure,
--             not an admin module — the harness flagged it only because the UI
--             matrix is the wrong yardstick for it.
--
-- ── error_logs ──────────────────────────────────────────────────────────────
-- 0134 granted authenticated SELECT and UPDATE with USING (true). Error rows
-- carry `technical_detail` — payloads, record ids, whatever the failing call
-- was holding — so this was the most content-rich table any role could read.
-- Only ErrorLogsPage (admin-gated) reads or resolves them; Assets.tsx merely
-- WRITES via errorLog.apiError. INSERT therefore stays open to authenticated,
-- because fire-and-forget logging must never depend on the reporter's role.
--
-- ── audit_logs ──────────────────────────────────────────────────────────────
-- 0114 granted SELECT USING (true). Blanket admin-only was tempting and wrong:
-- Assets.tsx reads this for the per-asset Audit Trail tab, which TECHNICIAN and
-- REQUESTER can open (assets: VIEW_ONLY). Removing it would delete a feature to
-- close a leak.
--
-- So the row is filtered by WHAT it audits. Change history on business records
-- stays visible to staff; audit rows about identity, tenancy and invitations —
-- the ones that would let someone watch permissions being granted — become
-- admin-only. That keeps the audit trail useful without leaving governance
-- activity on display, which is the point of NIST 800-53 AC-6 that
-- rolePermissions.ts already claims to follow.
-- ════════════════════════════════════════════════════════════════════════════

-- ── error_logs: read/resolve becomes admin-only; insert stays open ──────────
DROP POLICY IF EXISTS "Allow authenticated read"   ON public.error_logs;
DROP POLICY IF EXISTS "Allow authenticated update" ON public.error_logs;

CREATE POLICY admin_select_error_logs ON public.error_logs
    FOR SELECT TO authenticated USING (public.is_admin());

CREATE POLICY admin_update_error_logs ON public.error_logs
    FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- "Allow authenticated insert" is intentionally left in place.

-- ── audit_logs: business history stays readable, governance history does not ─
DROP POLICY IF EXISTS auth_select_audit_logs ON public.audit_logs;

CREATE POLICY scoped_select_audit_logs ON public.audit_logs
    FOR SELECT TO authenticated
    USING (
        public.is_admin()
        OR table_name NOT IN ('users', 'companies', 'user_invites', 'contacts')
    );

COMMENT ON TABLE public.audit_logs IS
    'Change history. Readable by any authenticated user EXCEPT rows auditing users / companies / user_invites / contacts, which are admin-only (0238) so permission and tenancy changes are not on display. Assets.tsx reads this for the per-asset Audit Trail tab — do not restrict it to admins without removing that feature.';
