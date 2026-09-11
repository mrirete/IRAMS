-- ============================================================
-- 0361: close the anonymous RPC exposure (P0, found 2026-09-11)
--
-- Verified live on hacrebcfvyqdnjvilhqc with NO session — only the anon key
-- that ships in every browser bundle:
--
--   rpc/execute_readonly_sql  200  SELECT count(*) FROM auth.users            → 14
--   rpc/execute_readonly_sql  200  SELECT … FROM public.work_orders           → 58 rows, all tenants
--   rpc/execute_readonly_sql  200  SELECT count(*) FROM vault.decrypted_secrets → 2
--   rpc/delete_auth_user      204  (a nonexistent uuid; a real one would have gone)
--
-- Three functions are SECURITY DEFINER and executable by anon/authenticated:
--   execute_readonly_sql(text)          runs any SELECT as the table owner —
--                                        a complete RLS bypass, including auth
--                                        and vault.
--   delete_auth_user(uuid)              deletes any login.
--   set_user_login_active(uuid,bool)    bans/unbans any login — and any signed-in
--                                        user (a requester) can lock out their
--                                        admin, because the body has no check.
--
-- How it happened — the migrations were RIGHT and the live database drifted:
--   0149 / 0225 both `REVOKE ALL … FROM PUBLIC; GRANT … TO service_role` on
--   execute_readonly_sql, and 0337 does the same for rcm_implementation_sweep.
--   Live, all of them carry anon=X/authenticated=X again. The project's
--   ALTER DEFAULT PRIVILEGES (role postgres, schema public) grants EXECUTE on
--   every NEW function to anon, authenticated and service_role — so any
--   DROP+CREATE (a baseline load, a dashboard edit) silently re-opens what a
--   migration closed. That is why 90 of 111 SECURITY DEFINER functions here
--   are anon-callable. delete_auth_user / set_user_login_active were simply
--   granted to authenticated in 0164 and never gated; anon came free.
--
-- This migration:
--   (1) revokes the three, and re-revokes rcm_implementation_sweep, to the
--       grants the migrations always intended;
--   (2) gates set_user_login_active on is_admin() — it stays callable by the
--       People module, which is the one legitimate browser caller;
--   (3) stops the default privilege from re-arming anon on future functions;
--   (4) makes the three SECURITY DEFINER views with no tenant filter run as
--       the caller (security_invoker), so RLS on their base tables applies.
--
-- delete_directory_user (0353) still works: it is SECURITY DEFINER, owned by
-- postgres, and calls delete_auth_user from the owner's context. The Python
-- layer calls execute_readonly_sql with the service_role key — unaffected.
-- ============================================================

BEGIN;

-- ── (1) Functions: back to what the migrations intended ──────────────────
REVOKE ALL ON FUNCTION public.execute_readonly_sql(text)            FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.execute_readonly_sql(text)        TO service_role;

REVOKE ALL ON FUNCTION public.delete_auth_user(uuid)                FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.delete_auth_user(uuid)            TO service_role;

REVOKE ALL ON FUNCTION public.rcm_implementation_sweep()            FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.rcm_implementation_sweep()        TO service_role;

-- ── (2) set_user_login_active: keep the caller, add the gate ─────────────
-- Same body as 0164, with the check 0164 forgot. Pinned search_path closes
-- the function_search_path_mutable lint on it as well.
CREATE OR REPLACE FUNCTION public.set_user_login_active(p_user_id uuid, p_active boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Only an administrator can activate or deactivate a login'
            USING ERRCODE = '42501';
    END IF;
    UPDATE auth.users
    SET banned_until = CASE WHEN p_active THEN NULL ELSE '2999-12-31 00:00:00+00'::timestamptz END
    WHERE id = p_user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.set_user_login_active(uuid, boolean)  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_user_login_active(uuid, boolean) TO authenticated, service_role;

ALTER FUNCTION public.delete_auth_user(uuid) SET search_path = public;

-- ── (3) Stop the default privilege from re-arming anon ────────────────────
-- Affects functions created from now on; nothing existing changes. Any RPC a
-- signed-out visitor must reach (accept_invite, get_invite,
-- complete_email_verification, respond_to_assessment_invite) already holds an
-- explicit anon grant. New anon-facing RPCs must GRANT it deliberately.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE EXECUTE ON FUNCTIONS FROM anon;

-- ── (4) Unscoped SECURITY DEFINER views run as the caller ────────────────
-- These carry no caller_company() filter, so as definer views they handed
-- every tenant's PO commitments (and the bucket audit) to any signed-in user.
ALTER VIEW public.sem_po_commitments               SET (security_invoker = true);
ALTER VIEW public.sem_po_line_commitments          SET (security_invoker = true);
ALTER VIEW public.storage_bucket_visibility_audit  SET (security_invoker = true);

COMMIT;
