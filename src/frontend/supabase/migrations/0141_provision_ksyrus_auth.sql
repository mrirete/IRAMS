-- Provision Supabase Auth accounts for all seed users
-- These users exist in public.contacts but lack Supabase Auth entries.
-- All use the standard test password: Password123!

-- Ensure pgcrypto is available
CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions;

-- Drop and recreate with explicit schema-qualified crypto calls
-- (Supabase installs pgcrypto in the 'extensions' schema, not 'public')
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

-- Now provision auth accounts for all active @cainergy.com contacts
DO $$
DECLARE
  r RECORD;
  auth_uid uuid;
BEGIN
  FOR r IN
    SELECT c.id, c.code, c.name, c.email, c.roles[1] as primary_role
    FROM public.contacts c
    WHERE c.email LIKE '%@cainergy.com'
      AND c.is_active = true
      AND NOT EXISTS (
        SELECT 1 FROM auth.users au WHERE au.email = c.email
      )
    ORDER BY c.code
  LOOP
    auth_uid := public.create_auth_user(
      r.email,
      'Password123!',
      split_part(r.email, '@', 1),
      COALESCE(r.primary_role, 'VIEWER'),
      r.id
    );
    RAISE NOTICE 'Created auth account for % (%) -> %', r.name, r.email, auth_uid;
  END LOOP;
END $$;

-- Re-sync public.users to pick up the new auth accounts
INSERT INTO public.users (id, username, email, contact_id, status, roles)
SELECT DISTINCT ON (au.id)
    au.id,
    split_part(au.email, '@', 1) as username,
    au.email,
    c.id as contact_id,
    'active',
    to_jsonb(c.roles) as roles
FROM auth.users au
JOIN public.contacts c ON c.email = au.email
WHERE NOT EXISTS (SELECT 1 FROM public.users pu WHERE pu.id = au.id)
ORDER BY au.id, c.created_at DESC
ON CONFLICT (id) DO UPDATE
SET
  contact_id = EXCLUDED.contact_id,
  roles = EXCLUDED.roles,
  status = 'active',
  username = EXCLUDED.username;
