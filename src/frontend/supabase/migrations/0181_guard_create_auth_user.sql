-- 0181 — Gate user provisioning to admins (server-side, defense in depth).
-- The UI permission matrix hides "Add Person" from non-admins, but that's
-- frontend-only: create_auth_user is a SECURITY DEFINER RPC any signed-in user
-- could call directly to mint an account with any role. Add an is_admin() guard
-- so the database enforces it too (same guard as admin_reset_password / 0180).
--
-- Body is byte-for-byte the deployed function (0141) plus the guard — nothing
-- else changes. Atomic: wrap in a txn.
BEGIN;

CREATE OR REPLACE FUNCTION public.create_auth_user(
  p_email text,
  p_password text,
  p_username text,
  p_role text,
  p_contact_id uuid DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
  new_user_id uuid;
  encrypted_pw text;
BEGIN
  -- Only administrators may provision accounts.
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized: administrators only';
  END IF;

  new_user_id := gen_random_uuid();
  encrypted_pw := extensions.crypt(p_password, extensions.gen_salt('bf'));

  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    new_user_id, 'authenticated', 'authenticated',
    p_email, encrypted_pw, now(),
    '{"provider":"email","providers":["email"]}',
    json_build_object('username', p_username, 'role', p_role, 'contact_id', p_contact_id),
    now(), now(), '', '', '', ''
  );

  INSERT INTO auth.identities (
    id, user_id, provider_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), new_user_id, new_user_id::text,
    jsonb_build_object('sub', new_user_id::text, 'email', p_email),
    'email', now(), now(), now()
  );

  RETURN new_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
