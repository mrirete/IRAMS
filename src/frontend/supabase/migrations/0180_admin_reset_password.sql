-- 0180 — Admin password reset RPC.
-- Lets an admin set another user's password from inside the app (users change
-- their own via Supabase auth.updateUser, which needs no server function).
-- SECURITY DEFINER so it can write auth.users; guarded by public.is_admin() so
-- only admins can reset others. Same bcrypt hashing as create_auth_user (0072/0141).
-- Atomic: Supabase's SQL editor runs statements individually, so wrap in a txn.
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_reset_password(p_user_id uuid, p_new_password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Not authorized: administrators only';
    END IF;
    IF length(coalesce(p_new_password, '')) < 8 THEN
        RAISE EXCEPTION 'Password must be at least 8 characters';
    END IF;

    UPDATE auth.users
    SET encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
        updated_at = now()
    WHERE id = p_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User not found';
    END IF;
END;
$$;

-- Only signed-in users may call it; the is_admin() check inside does the real gate.
REVOKE ALL ON FUNCTION public.admin_reset_password(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_reset_password(uuid, text) TO authenticated;

COMMIT;
