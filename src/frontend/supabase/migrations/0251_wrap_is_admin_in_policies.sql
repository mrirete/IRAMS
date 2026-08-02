-- ════════════════════════════════════════════════════════════════════════════
-- 0251 — Wrap every bare is_admin() in a policy (the per-row landmine)
--
-- A STABLE function called bare in an RLS qual is evaluated ONCE PER ROW.
-- Postgres does not hoist it, even with constant arguments. Wrapped in an
-- uncorrelated scalar subquery it becomes an InitPlan, evaluated once per
-- statement. Measured on 200,000 rows with RLS active as `authenticated` (0243):
--
--     USING (is_admin())           3,013 ms    68,706 buffers
--     USING ((SELECT is_admin()))     20 ms     2,041 buffers
--
-- 82 policies carried the bare form, dating back to 0171 and generated across
-- dozens of tables by 0186's loop. It is invisible today because the largest
-- table here holds 1,965 rows; it becomes an outage on a real tenant. This is
-- the class of defect that gets worse precisely as the product succeeds.
--
-- Behaviour is identical. Only the query plan changes. The policies are
-- rebuilt from pg_policies — same name, same permissive/restrictive, same
-- command, same roles, same expression apart from the wrap — so nothing is
-- re-decided as a side effect.
--
-- ── One policy is deliberately excluded ─────────────────────────────────────
-- scope_select_service_requests (0197) contains:
--     work_center_id = ANY (caller_work_centers())
-- caller_work_centers() returns uuid[], and `x = ANY(array)` is array
-- membership. Wrapping it as `ANY((SELECT …))` makes Postgres read the
-- parenthesised SELECT as a subquery, and `x = ANY(subquery)` is row-set
-- membership — a different construct, and a type error here. A blanket
-- regex would have silently rewritten a security policy into something else.
-- It is handled by hand below: the two scalar calls are wrapped, the array
-- test is left exactly as it was.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    p         record;
    new_qual  text;
    new_check text;
    stmt      text;
BEGIN
    FOR p IN
        SELECT tablename, policyname, permissive, roles, cmd, qual, with_check
        FROM pg_policies
        WHERE schemaname = 'public'
          AND policyname <> 'scope_select_service_requests'
          AND (
                (qual       IS NOT NULL AND qual       ~ 'is_admin\(\)' AND qual       !~ 'SELECT\s+(public\.)?is_admin')
             OR (with_check IS NOT NULL AND with_check ~ 'is_admin\(\)' AND with_check !~ 'SELECT\s+(public\.)?is_admin')
              )
    LOOP
        new_qual  := regexp_replace(coalesce(p.qual, ''),       '(public\.)?is_admin\(\)', '(SELECT public.is_admin())', 'g');
        new_check := regexp_replace(coalesce(p.with_check, ''), '(public\.)?is_admin\(\)', '(SELECT public.is_admin())', 'g');

        EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);

        stmt := format('CREATE POLICY %I ON public.%I AS %s FOR %s TO %s',
                       p.policyname, p.tablename,
                       CASE WHEN p.permissive = 'PERMISSIVE' THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
                       p.cmd,
                       array_to_string(p.roles, ', '));

        IF p.qual       IS NOT NULL THEN stmt := stmt || format(' USING (%s)',      new_qual);  END IF;
        IF p.with_check IS NOT NULL THEN stmt := stmt || format(' WITH CHECK (%s)', new_check); END IF;

        EXECUTE stmt;
    END LOOP;
END $$;

-- ── The excluded one, by hand ───────────────────────────────────────────────
-- Both scalar calls wrapped; ANY(caller_work_centers()) untouched, because
-- array membership and subquery membership are not the same thing.
DROP POLICY IF EXISTS scope_select_service_requests ON public.service_requests;
CREATE POLICY scope_select_service_requests ON public.service_requests
    FOR SELECT TO authenticated
    USING (
        (SELECT public.caller_can_view_all_requests())
        OR (requester_id = (SELECT public.caller_user_id()))
        OR (requester_id = auth.uid())
        OR (work_center_id IS NOT NULL AND work_center_id = ANY (public.caller_work_centers()))
    );
