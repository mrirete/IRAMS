-- ════════════════════════════════════════════════════════════════════════
-- 0197 — Request visibility scoping (launch-fit slice)
-- ════════════════════════════════════════════════════════════════════════
-- Design: docs/Request-Visibility-Scoping-Design.md  (first executed table of
-- the multi-tenancy phase's T-3; forward-compatible with site scoping).
--
-- Today: service_requests SELECT is `USING (true)` (0186) — every authenticated
-- user reads EVERY request across all plants. This replaces that read policy
-- with an enforced boundary:
--
--     read a request IF  can_view_all_requests()          -- admins + triage/oversight roles
--                     OR requester_id = <you>              -- your own requests
--                     OR work_center_id ∈ <your crews>     -- your crew's queue
--
-- Triage/oversight roles (PLANNER, SUPERVISOR, MANAGER, EXECUTIVE,
-- RELIABILITY_ENG) + admins keep full read: they triage INCOMING requests,
-- which may be unrouted (work_center_id NULL) or routed to another crew, so
-- scoping them to own+crew would black-hole untriaged work. The real
-- restriction lands on rank-and-file (TECHNICIAN / REQUESTER / INTERNAL):
-- they see only their own requests plus their crew's queue.
--
-- Writes (INSERT/UPDATE/DELETE) are UNCHANGED — already hardened in 0186.
-- Reversible: R-1 rollback at the foot of this file restores `USING (true)`.
--
-- Scope sources all exist: is_admin() (0171), users.roles, requester_id →
-- users(id), work_center_id (0178) and work_center_members (0191).
-- ════════════════════════════════════════════════════════════════════════

-- ── R-0 · Caller resolution helpers ─────────────────────────────────────
-- The app writes requester_id = the Supabase auth user id, and `users.id`
-- normally equals auth.uid(). But the rest of the codebase (is_admin, the
-- AuthContext profile lookup) resolves the users row by JWT email/username to
-- tolerate legacy rows where that isn't true. We mirror that here so a scoped
-- policy can NEVER lock out a legitimately-linked user. SECURITY DEFINER lets
-- these read `users`/`work_center_members` regardless of the caller's own RLS.

CREATE OR REPLACE FUNCTION public.caller_user_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT u.id
    FROM users u
    WHERE u.id = auth.uid()
       OR lower(coalesce(u.email, ''))    = lower(coalesce(auth.jwt() ->> 'email', ''))
       OR lower(coalesce(u.username, '')) = lower(split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1))
    ORDER BY (u.id = auth.uid()) DESC   -- prefer the exact auth-id match
    LIMIT 1
$$;

-- Work centers the caller belongs to (via their linked contact). Returns an
-- empty array (never NULL) when the user has no contact / no crew — so the
-- `= ANY(...)` predicate is simply false, not an error.
CREATE OR REPLACE FUNCTION public.caller_work_centers()
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT coalesce(array_agg(m.work_center_id), '{}'::uuid[])
    FROM work_center_members m
    JOIN users u ON u.contact_id = m.contact_id
    WHERE u.id = public.caller_user_id()
$$;

-- Triage/oversight roles that must see the whole request queue (they triage
-- incoming, possibly-unrouted work). Mirrors is_admin()'s role-based approach.
-- NOTE: keyed on users.roles names — a *custom* role with request-oversight
-- rights isn't covered here; extend the array (or move to a permission-backed
-- check) if you introduce one.
CREATE OR REPLACE FUNCTION public.caller_can_view_all_requests()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.is_admin()
        OR EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = public.caller_user_id()
              AND coalesce(u.status, 'active') = 'active'
              AND u.roles ?| ARRAY['PLANNER','SUPERVISOR','MANAGER','EXECUTIVE','RELIABILITY_ENG']
        );
$$;

REVOKE ALL ON FUNCTION public.caller_user_id()             FROM public;
REVOKE ALL ON FUNCTION public.caller_work_centers()        FROM public;
REVOKE ALL ON FUNCTION public.caller_can_view_all_requests() FROM public;
GRANT EXECUTE ON FUNCTION public.caller_user_id()             TO authenticated;
GRANT EXECUTE ON FUNCTION public.caller_work_centers()        TO authenticated;
GRANT EXECUTE ON FUNCTION public.caller_can_view_all_requests() TO authenticated;


-- ── R-1 · Swap the SELECT policy (read visibility only) ─────────────────
-- Drop the permissive read policy (p2_select_* from 0186; auth_select_* from
-- 0150 if still around) and install the scoped one. Enabling RLS is a no-op if
-- already enabled (0186 did it).
ALTER TABLE public.service_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "p2_select_service_requests"   ON public.service_requests;
DROP POLICY IF EXISTS "auth_select_service_requests" ON public.service_requests;
DROP POLICY IF EXISTS "scope_select_service_requests" ON public.service_requests;

CREATE POLICY "scope_select_service_requests"
ON public.service_requests FOR SELECT TO authenticated
USING (
    public.caller_can_view_all_requests()
    OR requester_id  = public.caller_user_id()
    OR requester_id  = auth.uid()
    OR (work_center_id IS NOT NULL
        AND work_center_id = ANY (public.caller_work_centers()))
);

COMMENT ON POLICY "scope_select_service_requests" ON public.service_requests IS
  'Read scope: admin/triage roles see all; others see own request OR request routed '
  'to caller''s work center (0197). Add `OR site_id = ANY(user_site_scope())` when the '
  'org spine lands (T-3).';


-- ════════════════════════════════════════════════════════════════════════
-- R-1 ROLLBACK (keep for the cutover window; run to restore open reads):
--
--   DROP POLICY IF EXISTS "scope_select_service_requests" ON public.service_requests;
--   CREATE POLICY "p2_select_service_requests"
--     ON public.service_requests FOR SELECT TO authenticated USING (true);
-- ════════════════════════════════════════════════════════════════════════
