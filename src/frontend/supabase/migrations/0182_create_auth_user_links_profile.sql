-- 0182 — create_auth_user creates the public.users profile itself (the link).
-- New logins were left "not linked to a person": the function created auth.users
-- but relied on a handle_new_user trigger to create the bridging public.users row
-- (which carries contact_id), and that trigger isn't firing. Fold the profile
-- insert into the function so every created user is linked atomically — no trigger
-- dependency. ON CONFLICT so it also repairs a bare row if the trigger DID fire.
-- Keeps the 0181 admin guard. Atomic: wrap in a txn.
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
  -- Only administrators may provision accounts (0181).
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

  -- The link: app-user profile tying this login to its person (contact_id).
  -- Idempotent so it repairs a row if the handle_new_user trigger also fired.
  INSERT INTO public.users (id, username, email, contact_id, status, roles)
  VALUES (new_user_id, p_username, p_email, p_contact_id, 'active',
          jsonb_build_array(coalesce(p_role, 'GUEST')))
  ON CONFLICT (id) DO UPDATE SET
    username   = EXCLUDED.username,
    email      = EXCLUDED.email,
    contact_id = EXCLUDED.contact_id,
    roles      = EXCLUDED.roles;

  RETURN new_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
