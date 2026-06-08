-- STEP 1: Fix the create_auth_user function (run this first)
-- Ensures pgcrypto calls use the correct 'extensions' schema

CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions;

DROP FUNCTION IF EXISTS public.create_auth_user(text,text,text,text,uuid);

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
