-- ════════════════════════════════════════════════════════════════════════════
-- 0321 — Every account-creation path stamps the tenant; users are tenant-scoped
--
-- Found 2026-09-06: J.tech and J.Supeervisor (both created through Add Person)
-- could open the Asset Register and see nothing. Their role templates were
-- fine. Their users.company_id was NULL, so custom_access_token_hook (0258)
-- minted a JWT with no app_metadata.company_id, caller_company() returned
-- NULL, and all 167 tenant-scoped policies denied — 0 of 69 assets, 0 of 50
-- work orders, and not even their own company row.
--
-- Why it was NULL: the only paths that ever set users.company_id were the
-- signup-tenant function and the provisioning script. Everything an admin
-- uses day to day — create_auth_user (Add Person, Grant System Access),
-- accept_invite (invite links), and the handle_new_user trigger — inserted the
-- users row without it. contacts got `NOT NULL DEFAULT caller_company()` in
-- 0276; users got neither.
--
-- This migration:
--   1. users.company_id DEFAULT caller_company(), and a backfill from the
--      linked contact for any row still NULL (idempotent — the three known
--      rows were repaired by hand the same day).
--   2. create_auth_user stamps company_id from the contact, else the caller's
--      tenant, and back-links contacts.user_id (it never did; 9 of 14 logins
--      were unlinked — the comm-loop "misaddressed notification" class).
--   3. accept_invite stamps company_id from the invite (or the inviter). It
--      also fixes a latent break: the anon caller has no tenant claim, so the
--      contacts DEFAULT was NULL and a brand-new invitee hit the 0276 NOT NULL.
--   4. handle_new_user stamps from the email-matched contact when there is one.
--   5. users SELECT was `true` — every authenticated user in any tenant could
--      read every users row (emails, permission overrides). Now: own row, own
--      tenant, or (admin) orphans with no tenant so they can be repaired.
--   6. ops_health() reports users_without_tenant and contacts_unlinked so the
--      condition is visible on Admin → Ops Health instead of in a console log.
--   7. Legacy role codes: R-ENG (unused duplicate of RELIABILITY_ENG) is
--      deactivated; ELEC (a trade, not a role — no template, one contact)
--      is remapped to TECHNICIAN and deactivated.
--
-- NOT NULL is deliberately NOT added to users.company_id: the 0272/0314
-- sessionless probes and GoTrue-driven signups (handle_new_user → signup-tenant
-- PATCH) legitimately insert before a tenant is known. ops_health surfaces any
-- row that stays NULL.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Default + backfill ───────────────────────────────────────────────────
ALTER TABLE public.users ALTER COLUMN company_id SET DEFAULT public.caller_company();

UPDATE public.users u
   SET company_id = c.company_id, updated_at = now()
  FROM public.contacts c
 WHERE c.id = u.contact_id
   AND u.company_id IS NULL
   AND c.company_id IS NOT NULL;

-- Back-link contacts → users where the login exists but the contact never
-- learned about it (create_auth_user never wrote it; accept_invite did).
UPDATE public.contacts c
   SET user_id = u.id
  FROM public.users u
 WHERE u.contact_id = c.id
   AND c.user_id IS NULL;

-- ── 2. create_auth_user: stamp the tenant, close the contact link ───────────
-- Body is 0182's (+ the 0272 guard), with company_id and the back-link added.
CREATE OR REPLACE FUNCTION public.create_auth_user(
    p_email text, p_password text, p_username text, p_role text, p_contact_id uuid DEFAULT NULL::uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_user_id  uuid;
  encrypted_pw text;
  v_company    uuid;
BEGIN
  -- Request contexts must be an admin (0181); a sessionless DBA/migration
  -- context is allowed (0272) — it could already write auth.users directly.
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized: administrators only';
  END IF;

  -- The tenant: the person's, else the admin's. Either is authoritative; a
  -- login with no tenant sees nothing (0258 caller_company is fail-closed).
  IF p_contact_id IS NOT NULL THEN
    SELECT company_id INTO v_company FROM public.contacts WHERE id = p_contact_id;
  END IF;
  v_company := coalesce(v_company, public.caller_company());

  new_user_id  := gen_random_uuid();
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

  -- The app profile, tenant-stamped. (handle_new_user may already have
  -- inserted a row for this id from the auth.users trigger — merge into it.)
  INSERT INTO public.users (id, username, email, contact_id, status, roles, company_id)
  VALUES (new_user_id, p_username, p_email, p_contact_id, 'active',
          jsonb_build_array(coalesce(p_role, 'GUEST')), v_company)
  ON CONFLICT (id) DO UPDATE SET
    username   = EXCLUDED.username,
    email      = EXCLUDED.email,
    contact_id = EXCLUDED.contact_id,
    roles      = EXCLUDED.roles,
    company_id = coalesce(EXCLUDED.company_id, public.users.company_id);

  -- Close the loop the other way: the person record points at its login.
  IF p_contact_id IS NOT NULL THEN
    UPDATE public.contacts SET user_id = new_user_id
     WHERE id = p_contact_id AND user_id IS NULL;
  END IF;

  RETURN new_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_auth_user(text, text, text, text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_auth_user(text, text, text, text, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.create_auth_user(text, text, text, text, uuid) IS
    'Provisions an auth user + linked public.users row (0141/0181/0182/0272). Since 0321 it stamps users.company_id from the contact (else the caller''s tenant) and sets contacts.user_id — a login without a tenant claim sees no data at all.';

-- ── 3. accept_invite: stamp the tenant from the invite ──────────────────────
-- Body is 0226's, with company_id on both inserts. The anon caller carries no
-- tenant claim, so relying on column defaults here was never going to work.
CREATE OR REPLACE FUNCTION public.accept_invite(
    p_token text, p_username text, p_password text, p_full_name text, p_email text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite     public.user_invites;
  v_username   text := lower(trim(coalesce(p_username, '')));
  v_full_name  text := trim(coalesce(p_full_name, ''));
  v_email      text;
  v_contact_id uuid;
  v_company    uuid;
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

  -- The tenant the invite was issued for; pre-0276 invites fall back to the
  -- inviter's tenant. An invite that resolves to no tenant is refused rather
  -- than minting a login that can see nothing.
  v_company := v_invite.company_id;
  IF v_company IS NULL AND v_invite.invited_by IS NOT NULL THEN
    SELECT company_id INTO v_company FROM public.users WHERE id::text = v_invite.invited_by::text;
  END IF;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'This invite is not attached to a company — ask your administrator for a new one';
  END IF;

  -- Adopt the person record this invite belongs to, if it exists (0226).
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
    UPDATE public.contacts SET
      name                = COALESCE(NULLIF(v_full_name, ''), name),
      phone               = COALESCE(NULLIF(v_invite.phone, ''), phone),
      roles               = CASE
                              WHEN roles IS NULL OR roles = '{}' THEN ARRAY[v_invite.role]
                              WHEN v_invite.role = ANY(roles) THEN roles
                              ELSE array_append(roles, v_invite.role)
                            END,
      company_id          = COALESCE(company_id, v_company),
      is_active           = true,
      can_login           = true,
      can_submit_requests = true,
      can_log_time        = true
    WHERE id = v_contact_id;
  ELSE
    INSERT INTO public.contacts (
      id, code, name, email, phone, title, roles,
      is_active, is_employee, can_login, can_submit_requests, can_log_time,
      company_id
    ) VALUES (
      v_contact_id, v_username, v_full_name, v_email, v_invite.phone, NULL,
      ARRAY[v_invite.role], true, true, true, true, true,
      v_company
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

  -- 3. The app profile, tenant-stamped.
  INSERT INTO public.users (id, username, email, contact_id, status, roles, company_id)
  VALUES (new_user_id, v_username, v_email, v_contact_id, 'active',
          jsonb_build_array(v_invite.role), v_company)
  ON CONFLICT (id) DO UPDATE SET
    username   = EXCLUDED.username,
    email      = EXCLUDED.email,
    contact_id = EXCLUDED.contact_id,
    roles      = EXCLUDED.roles,
    company_id = coalesce(EXCLUDED.company_id, public.users.company_id);

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
$$;

COMMENT ON FUNCTION public.accept_invite(text, text, text, text, text) IS
    'Redeems an invite token: person (adopted or created) + auth account + app profile (0190/0226). Since 0321 every row is stamped with the invite''s tenant; an invite with no resolvable tenant is refused.';

-- ── 4. handle_new_user: stamp from the email-matched contact ────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  linked_contact_id uuid;
  linked_company    uuid;
  user_role         text[];
  contact_username  text;
BEGIN
  BEGIN
    SELECT id, roles, company_id INTO linked_contact_id, user_role, linked_company
    FROM public.contacts
    WHERE email = NEW.email
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    linked_contact_id := NULL;
    user_role := NULL;
    linked_company := NULL;
  END;

  contact_username := split_part(NEW.email, '@', 1);

  -- company_id may stay NULL here: signup-tenant PATCHes it once the company
  -- row exists. Every other path (create_auth_user, accept_invite) stamps it.
  INSERT INTO public.users (id, username, email, contact_id, status, roles, company_id)
  VALUES (
    NEW.id,
    contact_username,
    NEW.email,
    linked_contact_id,
    'active',
    to_jsonb(COALESCE(user_role, ARRAY['TECHNICIAN'])),
    linked_company
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

-- ── 5. users: tenant-scoped reads and admin writes ──────────────────────────
-- Own row always (AuthContext reads it before the tenant claim is even known),
-- own tenant, or — for admins — orphan rows with no tenant, so the condition
-- this migration fixes can be repaired from the app when it recurs.
-- caller_can() / is_admin() are SECURITY DEFINER and unaffected.
DROP POLICY IF EXISTS p2_select_users ON public.users;
CREATE POLICY p2_select_users ON public.users
    FOR SELECT TO authenticated
    USING (
        id = auth.uid()
        OR company_id = (SELECT public.caller_company())
        OR (company_id IS NULL AND (SELECT public.is_admin()))
    );

DROP POLICY IF EXISTS p2_admin_update_users ON public.users;
CREATE POLICY p2_admin_update_users ON public.users
    FOR UPDATE TO authenticated
    USING ((SELECT public.is_admin()) AND (company_id IS NULL OR company_id = (SELECT public.caller_company())))
    WITH CHECK ((SELECT public.is_admin()) AND (company_id IS NULL OR company_id = (SELECT public.caller_company())));

DROP POLICY IF EXISTS p2_admin_delete_users ON public.users;
CREATE POLICY p2_admin_delete_users ON public.users
    FOR DELETE TO authenticated
    USING ((SELECT public.is_admin()) AND (company_id IS NULL OR company_id = (SELECT public.caller_company())));

DROP POLICY IF EXISTS p2_admin_insert_users ON public.users;
CREATE POLICY p2_admin_insert_users ON public.users
    FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.is_admin()) AND company_id = (SELECT public.caller_company()));

-- ── 6. ops_health: make the condition visible ───────────────────────────────
CREATE OR REPLACE FUNCTION public.ops_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    crons        jsonb := '[]'::jsonb;
    has_cron     boolean;
    out_failed   integer := 0;
    out_pending  integer := 0;
    err_24h      integer := 0;
    err_7d       integer := 0;
    last_brief   timestamptz;
    last_watch   timestamptz;
    no_tenant    integer := 0;
    unlinked     integer := 0;
    no_tenant_names jsonb := '[]'::jsonb;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'ops_health: administrators only' USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') INTO has_cron;
    IF has_cron THEN
        SELECT coalesce(jsonb_agg(row_to_json(j)::jsonb ORDER BY j.jobname), '[]'::jsonb) INTO crons
          FROM (
            SELECT c.jobname, c.schedule, c.active,
                   r.status AS last_status, r.start_time AS last_run, r.return_message AS last_message
              FROM cron.job c
              LEFT JOIN LATERAL (
                    SELECT d.status, d.start_time, left(d.return_message, 300) AS return_message
                      FROM cron.job_run_details d
                     WHERE d.jobid = c.jobid
                     ORDER BY d.start_time DESC LIMIT 1
              ) r ON true
          ) j;
    END IF;

    BEGIN
        SELECT count(*) FILTER (WHERE status = 'FAILED'),
               count(*) FILTER (WHERE status = 'PENDING')
          INTO out_failed, out_pending
          FROM public.notification_outbox
         WHERE created_at > now() - interval '7 days';
    EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;

    BEGIN
        SELECT count(*) FILTER (WHERE created_at > now() - interval '24 hours'),
               count(*) FILTER (WHERE created_at > now() - interval '7 days')
          INTO err_24h, err_7d
          FROM public.error_logs
         WHERE severity IN ('error', 'critical');
    EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;

    BEGIN
        SELECT max(created_at) INTO last_brief FROM public.ers_ai_audit_log WHERE context_type = 'reliability_digest';
        SELECT max(created_at) INTO last_watch FROM public.ers_ai_audit_log WHERE username = 'specialist-watchdog' OR context_type = 'specialist_watchdog';
    EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;

    -- 0321: logins with no tenant see nothing; contacts with no user_id
    -- misroute notifications. Both are silent in the app without this.
    SELECT count(*), coalesce(jsonb_agg(username ORDER BY username), '[]'::jsonb)
      INTO no_tenant, no_tenant_names
      FROM public.users
     WHERE company_id IS NULL AND coalesce(status, 'active') = 'active';
    SELECT count(*) INTO unlinked
      FROM public.contacts c
      JOIN public.users u ON u.contact_id = c.id
     WHERE c.user_id IS NULL;

    RETURN jsonb_build_object(
        'checked_at',      now(),
        'pg_cron',         has_cron,
        'crons',           crons,
        'outbox_failed_7d', out_failed,
        'outbox_pending',  out_pending,
        'errors_24h',      err_24h,
        'errors_7d',       err_7d,
        'last_briefing',   last_brief,
        'last_watchdog',   last_watch,
        'users_without_tenant',       no_tenant,
        'users_without_tenant_names', no_tenant_names,
        'contacts_unlinked',          unlinked
    );
END $$;
REVOKE ALL ON FUNCTION public.ops_health() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ops_health() TO authenticated;

-- ── 7. Legacy role codes in the CONTACT_TYPE dictionary ─────────────────────
-- R-ENG duplicates RELIABILITY_ENG (same description, no template, no users);
-- the Admin role list de-duplicates by description, so either could win and
-- a person assigned R-ENG got the no-template defaults. ELEC is a trade, not
-- a role. Remap the one contact carrying it, then retire both codes.
UPDATE public.contacts
   SET roles = array_replace(roles, 'ELEC', 'TECHNICIAN')
 WHERE 'ELEC' = ANY (roles);
UPDATE public.users
   SET roles = (SELECT jsonb_agg(CASE r WHEN 'ELEC' THEN 'TECHNICIAN' WHEN 'R-ENG' THEN 'RELIABILITY_ENG' ELSE r END)
                  FROM jsonb_array_elements_text(roles) r)
 WHERE roles ?| ARRAY['ELEC', 'R-ENG'];
UPDATE public.reference_codes
   SET active = false, updated_at = now()
 WHERE category = 'CONTACT_TYPE' AND code IN ('ELEC', 'R-ENG') AND company_id IS NULL;

-- ── Prove it ────────────────────────────────────────────────────────────────
DO $$
DECLARE
    v_user    uuid;
    v_contact uuid := gen_random_uuid();
    v_co      uuid;
    v_stamped uuid;
    v_link    uuid;
BEGIN
    SELECT id INTO v_co FROM public.companies ORDER BY created_at LIMIT 1;
    IF v_co IS NULL THEN RAISE NOTICE '0321 probe skipped: no companies'; RETURN; END IF;

    -- A contact in the tenant, then a login for it from a sessionless context
    -- (no caller_company): the tenant must come from the contact.
    INSERT INTO public.contacts (id, code, name, email, roles, company_id, is_active)
    VALUES (v_contact, '__probe_0321__', '__probe_0321__', '', ARRAY['TECHNICIAN'], v_co, true);

    v_user := public.create_auth_user('__probe_0321__@internal.test', 'Probe-0321!xyz', '__probe_0321__', 'TECHNICIAN', v_contact);

    SELECT company_id INTO v_stamped FROM public.users WHERE id = v_user;
    SELECT user_id    INTO v_link    FROM public.contacts WHERE id = v_contact;

    -- contacts.user_id → users(id) → auth.users(id): unwind in that order.
    DELETE FROM public.contacts WHERE id = v_contact;
    DELETE FROM public.users    WHERE id = v_user;
    DELETE FROM auth.users      WHERE id = v_user;

    IF v_stamped IS DISTINCT FROM v_co THEN
        RAISE EXCEPTION '0321 FAILED: create_auth_user left users.company_id = % (expected %)', v_stamped, v_co;
    END IF;
    IF v_link IS DISTINCT FROM v_user THEN
        RAISE EXCEPTION '0321 FAILED: create_auth_user did not back-link contacts.user_id';
    END IF;
    RAISE NOTICE '0321 verified: tenant stamped from the contact, contact back-linked';
END $$;

COMMIT;

-- VERIFY (after apply):
--   SELECT username FROM public.users WHERE company_id IS NULL;            -- expect none active
--   SELECT count(*) FROM public.contacts c JOIN public.users u ON u.contact_id = c.id WHERE c.user_id IS NULL;  -- 0
--   SELECT public.ops_health() -> 'users_without_tenant';                  -- as an admin
--   Sign in as J.tech: Assets shows the full register.
