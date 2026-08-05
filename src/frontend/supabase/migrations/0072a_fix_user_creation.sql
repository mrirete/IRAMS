-- Enable pgcrypto for password hashing if not already enabled
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Create a secure function to bypass RLS and insert into auth.users
-- Must be SECURITY DEFINER to run with elevated privileges
CREATE OR REPLACE FUNCTION public.create_auth_user(
  email text,
  password text,
  username text,
  role text,
  contact_id uuid DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
  new_user_id uuid;
  encrypted_pw text;
BEGIN
  -- Generate a new UUID for the user
  new_user_id := gen_random_uuid();
  
  -- Hash password securely
  encrypted_pw := crypt(password, gen_salt('bf'));

  -- Insert the user into the Supabase auth schema
  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    recovery_sent_at,
    last_sign_in_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    email_change,
    email_change_token_new,
    recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', -- standard instance ID
    new_user_id,
    'authenticated',
    'authenticated', 
    email,
    encrypted_pw,
    now(), -- Auto-confirm email
    NULL,
    NULL,
    '{"provider":"email","providers":["email"]}',
    json_build_object('username', username, 'role', role, 'contact_id', contact_id), -- Store metadata
    now(),
    now(),
    '',
    '',
    '',
    ''
  );

  INSERT INTO auth.identities (
    id,
    user_id,
    provider_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  ) VALUES (
    gen_random_uuid(),
    new_user_id,
    new_user_id::text,
    jsonb_build_object('sub', new_user_id::text, 'email', email),
    'email',
    now(),
    now(),
    now()
  );

  RETURN new_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Clean up any orphaned admin001 data from public.users and public.contacts
DO $$
BEGIN
    -- Delete from public.users first (match by email OR username)
    DELETE FROM public.users WHERE email = 'admin001@cainergy.com' OR username = 'admin001';
    
    -- Delete from public.contacts (match by email OR code)
    DELETE FROM public.contacts WHERE email = 'admin001@cainergy.com' OR code = 'admin001';
    
    -- Ensure it's not in auth.users either
    DELETE FROM auth.users WHERE email = 'admin001@cainergy.com';
END $$;

-- 3. Re-seed admin001 properly using our new function and the DB triggers

-- A. Insert admin001 into public.contacts first
INSERT INTO public.contacts (id, code, name, first_name, last_name, email, roles, is_active)
VALUES (
    gen_random_uuid(), -- A new clean ID
    'admin001',
    'System Admin',
    'System',
    'Admin',
    'admin001@cainergy.com',
    ARRAY['SYS_ADMIN'],
    true
);

-- B. Use the new function to create the auth.users record.
-- The existing `handle_new_user` trigger will automatically fire and create the public.users record
-- and link it to the contact we just created!
SELECT public.create_auth_user(
  'admin001@cainergy.com', 
  'Password123!', 
  'admin001', 
  'SYS_ADMIN'
);
