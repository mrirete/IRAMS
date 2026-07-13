-- 0190 — Invite colleagues by email/phone (token link, no mail server needed).
--
-- Flow: an admin creates an invite (email and/or phone + role) → gets a
-- one-time link (/invite/<token>) to share via email, SMS or WhatsApp → the
-- invitee opens it, picks a username + password, and accept_invite() creates
-- the person (contact) + auth account + app profile atomically — the same
-- trio create_auth_user (0182) provisions, but guarded by the invite token
-- instead of an admin session, so the accept page works signed-out (anon).
--
-- Launch alignment: invited accounts are registered under the invitee's REAL
-- email (company email at launch), not the legacy username@cainergy.com
-- virtual address. Login accepts either form.
--
-- RLS: reads for authenticated, writes admin-only (0186 posture); anon never
-- touches the table directly — only via the token-guarded RPCs.
-- Atomic: wrap in a txn.
BEGIN;

CREATE TABLE IF NOT EXISTS public.user_invites (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Two UUIDs' worth of entropy, hex, no dashes — the capability in the link.
  token            TEXT NOT NULL UNIQUE,
  email            TEXT,
  phone            TEXT,
  invited_name     TEXT,
  role             TEXT NOT NULL DEFAULT 'TECHNICIAN',
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','accepted','revoked','expired')),
  invited_by       UUID,
  expires_at       TIMESTAMPTZ NOT NULL DEFAULT now() + interval '7 days',
  accepted_user_id UUID,
  accepted_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- An invite must be deliverable somewhere.
  CONSTRAINT user_invites_contactable CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_user_invites_status ON public.user_invites(status);

ALTER TABLE public.user_invites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sel_user_invites ON public.user_invites;
CREATE POLICY sel_user_invites ON public.user_invites
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS adm_ins_user_invites ON public.user_invites;
CREATE POLICY adm_ins_user_invites ON public.user_invites
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS adm_upd_user_invites ON public.user_invites;
CREATE POLICY adm_upd_user_invites ON public.user_invites
  FOR UPDATE TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS adm_del_user_invites ON public.user_invites;
CREATE POLICY adm_del_user_invites ON public.user_invites
  FOR DELETE TO authenticated USING (public.is_admin());

-- ── create_user_invite — admin mints an invite, returns the row incl. token ──
CREATE OR REPLACE FUNCTION public.create_user_invite(
  p_email        text DEFAULT NULL,
  p_phone        text DEFAULT NULL,
  p_name         text DEFAULT NULL,
  p_role         text DEFAULT 'TECHNICIAN',
  p_expires_days integer DEFAULT 7
) RETURNS jsonb AS $$
DECLARE
  v_email text := lower(nullif(trim(coalesce(p_email, '')), ''));
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_invite public.user_invites;
BEGIN
  -- Only administrators may invite (same guard as create_auth_user / 0181).
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized: administrators only';
  END IF;

  IF v_email IS NULL AND v_phone IS NULL THEN
    RAISE EXCEPTION 'Provide an email address or a phone number';
  END IF;
  IF v_email IS NOT NULL AND v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Invalid email address: %', v_email;
  END IF;
  -- SUPER_ADMIN is deliberately not invitable — promote explicitly instead.
  IF p_role NOT IN ('TECHNICIAN','REQUESTER','PLANNER','SUPERVISOR',
                    'RELIABILITY_ENG','MANAGER','EXECUTIVE','SYS_ADMIN','INTERNAL') THEN
    RAISE EXCEPTION 'Invalid role: %', p_role;
  END IF;
  -- One live invite per email — surface the existing one instead of stacking.
  IF v_email IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_invites
    WHERE lower(email) = v_email AND status = 'pending' AND expires_at > now()
  ) THEN
    RAISE EXCEPTION 'A pending invite already exists for % — revoke it first to reissue', v_email;
  END IF;

  INSERT INTO public.user_invites (token, email, phone, invited_name, role, invited_by, expires_at)
  VALUES (
    replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
    v_email, v_phone, nullif(trim(coalesce(p_name, '')), ''), p_role, auth.uid(),
    now() + make_interval(days => greatest(1, least(coalesce(p_expires_days, 7), 30)))
  )
  RETURNING * INTO v_invite;

  RETURN jsonb_build_object(
    'id', v_invite.id, 'token', v_invite.token, 'email', v_invite.email,
    'phone', v_invite.phone, 'invited_name', v_invite.invited_name,
    'role', v_invite.role, 'expires_at', v_invite.expires_at
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── get_invite — anon-safe lookup for the accept page (no token, no data) ──
CREATE OR REPLACE FUNCTION public.get_invite(p_token text)
RETURNS jsonb AS $$
DECLARE
  v public.user_invites;
  v_inviter text;
BEGIN
  SELECT * INTO v FROM public.user_invites WHERE token = p_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT u.username INTO v_inviter FROM public.users u WHERE u.id = v.invited_by;

  RETURN jsonb_build_object(
    'found', true,
    -- Effective status: an overdue pending invite reads as expired.
    'status', CASE WHEN v.status = 'pending' AND v.expires_at <= now()
                   THEN 'expired' ELSE v.status END,
    'email', v.email,
    'phone', v.phone,
    'invited_name', v.invited_name,
    'role', v.role,
    'invited_by', coalesce(v_inviter, 'your administrator'),
    'expires_at', v.expires_at
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- ── accept_invite — token-guarded provisioning: contact + auth + profile ──
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
  v_contact_id uuid := gen_random_uuid();
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
    -- No status write here: RAISE would roll it back anyway. get_invite and
    -- the admin list both compute effective status from expires_at.
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

  -- Collision checks across every namespace a login can resolve through:
  -- real email, app username, contact code, and the legacy virtual email.
  IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) IN (v_email, v_username || '@cainergy.com')) THEN
    RAISE EXCEPTION 'An account already exists for this email or username';
  END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE lower(username) = v_username) THEN
    RAISE EXCEPTION 'Username "%" is already taken', v_username;
  END IF;
  IF EXISTS (SELECT 1 FROM public.contacts WHERE lower(code) = v_username) THEN
    RAISE EXCEPTION 'Username "%" is already taken', v_username;
  END IF;

  -- 1. The person record.
  INSERT INTO public.contacts (
    id, code, name, email, phone, title, roles,
    is_active, is_employee, can_login, can_submit_requests, can_log_time
  ) VALUES (
    v_contact_id, v_username, v_full_name, v_email, v_invite.phone, NULL,
    ARRAY[v_invite.role], true, true, true, true, true
  );

  -- 2. The auth account — same body as create_auth_user (0182), registered
  --    under the invitee's REAL email.
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

  -- 3. The app profile. Upsert because the handle_new_user trigger (0070) may
  --    have already inserted a bare row during the auth insert above.
  INSERT INTO public.users (id, username, email, contact_id, status, roles)
  VALUES (new_user_id, v_username, v_email, v_contact_id, 'active',
          jsonb_build_array(v_invite.role))
  ON CONFLICT (id) DO UPDATE SET
    username   = EXCLUDED.username,
    email      = EXCLUDED.email,
    contact_id = EXCLUDED.contact_id,
    roles      = EXCLUDED.roles;

  -- 4. Burn the invite.
  UPDATE public.user_invites
  SET status = 'accepted', accepted_user_id = new_user_id,
      accepted_at = now(), updated_at = now()
  WHERE id = v_invite.id;

  RETURN jsonb_build_object('user_id', new_user_id, 'email', v_email);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── Harden handle_new_user (0070) for the accept path ──
-- The trigger fires inside accept_invite's auth.users INSERT and inserts a
-- users row with username = email prefix. users.username is UNIQUE, so an
-- invitee whose email prefix matches an existing username would abort the
-- whole accept. Bare ON CONFLICT DO NOTHING tolerates ANY unique collision —
-- accept_invite's own upsert then writes the authoritative row.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  linked_contact_id UUID;
  user_role text[];
  contact_username text;
BEGIN
  BEGIN
    SELECT id, roles INTO linked_contact_id, user_role
    FROM public.contacts
    WHERE email = NEW.email
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    linked_contact_id := NULL;
    user_role := NULL;
  END;

  contact_username := split_part(NEW.email, '@', 1);

  INSERT INTO public.users (id, username, email, contact_id, status, roles)
  VALUES (
    NEW.id,
    contact_username,
    NEW.email,
    linked_contact_id,
    'active',
    to_jsonb(COALESCE(user_role, ARRAY['TECHNICIAN']))
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grants: minting is admin-session-only; lookup + accept must work signed-out
-- (the token inside is the credential).
REVOKE ALL ON FUNCTION public.create_user_invite(text, text, text, text, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_user_invite(text, text, text, text, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.get_invite(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_invite(text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.accept_invite(text, text, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.accept_invite(text, text, text, text, text) TO anon, authenticated;

COMMIT;
