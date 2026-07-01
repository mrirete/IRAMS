-- ============================================================================
-- Migration: 0164_user_admin_rpcs
-- User management from the app: the browser can't touch the auth schema, so these
-- SECURITY DEFINER helpers let the People module fully remove a login and
-- enable/disable one without deleting the profile.
--
--   • delete_auth_user     — remove the login (auth.users) so a deleted directory
--                            user can no longer sign in (fixes "deleted but still logs in").
--   • set_user_login_active — ban/unban the login (disable without deleting).
--
-- NOTE: granted to `authenticated`, consistent with create_auth_user; the app gates
-- these by role in the UI (canDelete/canEdit). Role-hardening these RPCs belongs with
-- the project-wide RLS/permissions phase.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.delete_auth_user(p_user_id uuid)
RETURNS void AS $$
BEGIN
  DELETE FROM auth.users WHERE id = p_user_id;  -- cascades to auth.identities
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.set_user_login_active(p_user_id uuid, p_active boolean)
RETURNS void AS $$
BEGIN
  UPDATE auth.users
  SET banned_until = CASE WHEN p_active THEN NULL ELSE '2999-12-31 00:00:00+00'::timestamptz END
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.delete_auth_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_login_active(uuid, boolean) TO authenticated;

-- Rollback (manual):
--   DROP FUNCTION IF EXISTS public.delete_auth_user(uuid);
--   DROP FUNCTION IF EXISTS public.set_user_login_active(uuid, boolean);
