-- ════════════════════════════════════════════════════════════════════════════
-- 0237 — Stop every logged-in user from reading pending invite tokens
--
-- 0190 shipped user_invites with:
--     sel_user_invites  FOR SELECT TO authenticated USING (true)
-- while INSERT/UPDATE/DELETE were correctly restricted to public.is_admin().
-- The SELECT was the one policy that let everyone in.
--
-- The table stores the invite `token` and the `role` it grants, and
-- accept_invite() authenticates on nothing but that token. So any authenticated
-- account — including REQUESTER, the lowest-privilege role — could list pending
-- invites, read the token attached to a SYS_ADMIN invitation, and redeem it.
-- A read permission was effectively a role-escalation path.
--
-- Found by tests/rls/rls-matrix.mjs, which probes the DATABASE per role rather
-- than the UI. Verified from a real REQUESTER token: HTTP 200, both invite rows
-- returned with tokens and roles in plain text. (Anonymous was already refused
-- with 42501 — this was an authenticated-only exposure, which is exactly the
-- kind a UI-level test cannot see.)
--
-- Safe to tighten: nothing legitimate reads this table without admin rights.
--   • The invitee never queries it — AcceptInvite calls get_invite(p_token),
--     and both get_invite() and accept_invite() are SECURITY DEFINER and
--     granted to anon + authenticated, so they bypass RLS by design.
--   • The only direct readers are Admin › Invitations and Admin › Migration
--     Center, both behind PermissionGate module="admin".
-- ════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS sel_user_invites ON public.user_invites;
CREATE POLICY sel_user_invites ON public.user_invites
  FOR SELECT TO authenticated USING (public.is_admin());
