-- ─────────────────────────────────────────────────────────────────────────────
-- 0226 — accept_invite links an EXISTING contact instead of duplicating it.
--
-- Why: a CMMS migration imports the people register first (Admin › Migration
-- Center → People), then invites those people to log in. accept_invite (0190)
-- unconditionally INSERTed a fresh contacts row, so every accepted invite
-- produced a SECOND person record for someone already in the register — one
-- carrying their imported department/rate/qualifications, one carrying their
-- login. Work assigned to the imported contact never reached the logged-in user.
--
-- Fix: match an existing contact on email, and adopt it. Only insert when no
-- match exists. Everything else in the function is unchanged from 0190.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.accept_invite(
  p_token     text,
  p_username  text,
  p_password  text,
  p_full_name text,
  p_email     text DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
  v_invite     public.user_invites;
  v_username   text := lower(trim(coalesce(p_username, '')));
  v_full_name  text := trim(coalesce(p_full_name, ''));
  v_email      text;
  v_contact_id uuid;
  v_matched    boolean := false;
  new_user_id  uuid := gen_random_uuid();
  encrypted_pw text;
BEGIN
  -- The token IS the authorization: single-use, unexpired, unrevoked.
  SELECT * INTO v_invite FROM public.user_invites WHERE token = p_token FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This invite link is not valid';
  END IF;
  IF v_invite.status = 'accepted' THEN
    RAISE EXCEPTION 'This invite has already been used';
  END IF;
  IF v_invite.status <> 'pending' THEN
    RAISE EXCEPTION 'This invite is no longer active — ask your administrator for a new one';
  END IF;
  IF v_invite.expires_at <= now() THEN
    RAISE EXCEPTION 'This invite has expired — ask your administrator for a new one';
  END IF;

  -- The invite's email is binding when set; phone-only invites collect one here.
  v_email := lower(coalesce(nullif(v_invite.email, ''), nullif(trim(coalesce(p_email, '')), '')));
  IF v_email IS NULL OR v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'A valid email address is required';
  END IF;
  IF v_full_name = '' THEN
    RAISE EXCEPTION 'Your full name is required';
  END IF;
  IF v_username !~ '^[a-z0-9][a-z0-9._-]{2,31}$' THEN
    RAISE EXCEPTION 'Username must be 3-32 characters: letters, numbers, dots, dashes';
  END IF;
  IF length(coalesce(p_password, '')) < 6 THEN
    RAISE EXCEPTION 'Password must be at least 6 characters';
  END IF;

  -- ── NEW: adopt the person record this invite belongs to, if it exists. ──
  -- Oldest match wins, so a register imported before any hand-created stub is
  -- the one that gains the login.
  SELECT id INTO v_contact_id
  FROM public.contacts
  WHERE lower(email) = v_email
  ORDER BY created_at NULLS LAST
  LIMIT 1;

  v_matched := v_contact_id IS NOT NULL;
  IF NOT v_matched THEN
    v_contact_id := gen_random_uuid();
  END IF;

  -- Collision checks across every namespace a login can resolve through.
  IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) IN (v_email, v_username || '@cainergy.com')) THEN
    RAISE EXCEPTION 'An account already exists for this email or username';
  END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE lower(username) = v_username) THEN
    RAISE EXCEPTION 'Username "%" is already taken', v_username;
  END IF;
  -- The adopted contact is allowed to own the code being claimed.
  IF EXISTS (
    SELECT 1 FROM public.contacts
    WHERE lower(code) = v_username AND (NOT v_matched OR id <> v_contact_id)
  ) THEN
    RAISE EXCEPTION 'Username "%" is already taken', v_username;
  END IF;

  -- 1. The person record — adopt or create.
  IF v_matched THEN
    -- Keep the imported code, department, rate and qualifications; grant access
    -- and fill only what the register could not know.
    UPDATE public.contacts SET
      name                = COALESCE(NULLIF(v_full_name, ''), name),
      phone               = COALESCE(NULLIF(v_invite.phone, ''), phone),
      roles               = CASE
                              WHEN roles IS NULL OR roles = '{}' THEN ARRAY[v_invite.role]
                              WHEN v_invite.role = ANY(roles) THEN roles
                              ELSE array_append(roles, v_invite.role)
                            END,
      is_active           = true,
      can_login           = true,
      can_submit_requests = true,
      can_log_time        = true
    WHERE id = v_contact_id;
  ELSE
    INSERT INTO public.contacts (
      id, code, name, email, phone, title, roles,
      is_active, is_employee, can_login, can_submit_requests, can_log_time
    ) VALUES (
      v_contact_id, v_username, v_full_name, v_email, v_invite.phone, NULL,
      ARRAY[v_invite.role], true, true, true, true, true
    );
  END IF;

  -- 2. The auth account — registered under the invitee's REAL email.
  encrypted_pw := extensions.crypt(p_password, extensions.gen_salt('bf'));

  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    new_user_id, 'authenticated', 'authenticated',
    v_email, encrypted_pw, now(),
    '{"provider":"email","providers":["email"]}',
    json_build_object('username', v_username, 'role', v_invite.role,
                      'contact_id', v_contact_id, 'full_name', v_full_name),
    now(), now(), '', '', '', ''
  );

  INSERT INTO auth.identities (
    id, user_id, provider_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), new_user_id, new_user_id::text,
    jsonb_build_object('sub', new_user_id::text, 'email', v_email),
    'email', now(), now(), now()
  );

  -- 3. The app profile.
  INSERT INTO public.users (id, username, email, contact_id, status, roles)
  VALUES (new_user_id, v_username, v_email, v_contact_id, 'active',
          jsonb_build_array(v_invite.role))
  ON CONFLICT (id) DO UPDATE SET
    username   = EXCLUDED.username,
    email      = EXCLUDED.email,
    contact_id = EXCLUDED.contact_id,
    roles      = EXCLUDED.roles;

  -- 3b. Close the loop the other way: the contact now points at its login.
  UPDATE public.contacts SET user_id = new_user_id WHERE id = v_contact_id;

  -- 4. Burn the invite.
  UPDATE public.user_invites
  SET status = 'accepted', accepted_user_id = new_user_id,
      accepted_at = now(), updated_at = now()
  WHERE id = v_invite.id;

  RETURN jsonb_build_object(
    'user_id', new_user_id,
    'email', v_email,
    'contact_id', v_contact_id,
    'contact_linked', v_matched
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.accept_invite(text, text, text, text, text) TO anon, authenticated;
