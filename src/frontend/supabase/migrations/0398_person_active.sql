-- 0398 — Deactivating a person did not show, and was not complete.
--
-- 2026-10-01: an admin pressed "Disable Login" on Stan.test; the directory went
-- on saying Active. Three faults stacked:
--   1. set_user_login_active (0361) banned the auth user and nothing else. The
--      browser then wrote users.status = 'inactive' in a second, unchecked
--      request — but users.status is CHECK (status IN ('active','suspended'))
--      (0000), so Postgres refused it and nobody looked. The login was blocked;
--      the profile still read active, so the button kept offering "Disable".
--   2. The directory's Status column reads contacts.is_active, which nothing in
--      the People module could ever change.
--   3. The RPC had no tenant check (an admin could ban another tenant's login),
--      no self guard (an admin could lock themselves out), and left the
--      target's sessions alive until their access token expired.
--
-- Now:
--   • set_person_active(id, active) — the one directory action. Takes a contact
--     id or a login (users) id, resolves the other side, and in one transaction
--     sets contacts.is_active, users.status, the auth ban, and on deactivation
--     ends every session. Admin only, own tenant only, never yourself. Returns
--     what it changed. Both tables carry audit triggers (contacts: log_audit_event,
--     users: 0373), so the change is on record without an extra insert.
--   • set_user_login_active(id, active) — login-only switch, same guards, now
--     writes users.status itself ('suspended', the value the CHECK allows).
--   • Backfill: logins already banned but still 'active' become 'suspended'.
--
-- "Last admin" needs no separate guard: the caller must be an active admin of
-- the same tenant and may not target themselves, so one always remains.
--
-- Rollback: DROP FUNCTION public.set_person_active(uuid, boolean);
--           re-run 0361's set_user_login_active.

-- ── shared guard ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._directory_login_switch(p_user_id uuid, p_active boolean)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sessions integer := 0;
BEGIN
    UPDATE public.users
       SET status = CASE WHEN p_active THEN 'active' ELSE 'suspended' END,
           updated_at = now()
     WHERE id = p_user_id
       AND status IS DISTINCT FROM CASE WHEN p_active THEN 'active' ELSE 'suspended' END;

    UPDATE auth.users
       SET banned_until = CASE WHEN p_active THEN NULL ELSE '2999-12-31 00:00:00+00'::timestamptz END
     WHERE id = p_user_id;

    IF NOT p_active THEN
        -- Refresh tokens hang off sessions (ON DELETE CASCADE); the explicit
        -- delete covers tokens issued before sessions existed.
        DELETE FROM auth.sessions WHERE user_id = p_user_id;
        GET DIAGNOSTICS v_sessions = ROW_COUNT;
        DELETE FROM auth.refresh_tokens WHERE user_id = p_user_id::text;
    END IF;
    RETURN v_sessions;
END;
$$;
REVOKE ALL ON FUNCTION public._directory_login_switch(uuid, boolean) FROM PUBLIC, anon, authenticated;

-- ── login only ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_user_login_active(p_user_id uuid, p_active boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company uuid;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Only an administrator can activate or deactivate a login'
            USING ERRCODE = '42501';
    END IF;
    IF p_user_id = auth.uid() AND NOT p_active THEN
        RAISE EXCEPTION 'You cannot disable your own login.' USING ERRCODE = '42501';
    END IF;
    SELECT company_id INTO v_company FROM public.users WHERE id = p_user_id;
    IF v_company IS NOT NULL AND v_company IS DISTINCT FROM (SELECT public.caller_company()) THEN
        RAISE EXCEPTION 'This login belongs to another tenant.' USING ERRCODE = '42501';
    END IF;
    PERFORM public._directory_login_switch(p_user_id, p_active);
END;
$$;
REVOKE ALL ON FUNCTION public.set_user_login_active(uuid, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_user_login_active(uuid, boolean) TO authenticated, service_role;

-- ── person (contact + login) ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_person_active(p_id uuid, p_active boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller    uuid := (SELECT public.caller_company());
    v_user      record;
    v_contact   record;
    v_sessions  integer := 0;
    v_contact_changed boolean := false;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Only an administrator can deactivate or reactivate people.'
            USING ERRCODE = '42501';
    END IF;

    -- p_id is a contact id (a person) or a users id (a login with no person
    -- record — the directory's "system account" rows).
    SELECT id, username, email, contact_id, company_id INTO v_user
      FROM public.users
     WHERE id = p_id OR contact_id = p_id
     ORDER BY (id = p_id) DESC
     LIMIT 1;

    SELECT id, name, company_id, is_active INTO v_contact
      FROM public.contacts
     WHERE id = p_id
        OR (v_user.contact_id IS NOT NULL AND id = v_user.contact_id)
        OR (v_user.id IS NOT NULL AND user_id = v_user.id)
     ORDER BY (id = p_id) DESC
     LIMIT 1;

    IF v_user.id IS NULL AND v_contact.id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_found', 'id', p_id);
    END IF;

    IF (v_user.company_id IS NOT NULL AND v_user.company_id IS DISTINCT FROM v_caller)
       OR (v_contact.company_id IS NOT NULL AND v_contact.company_id IS DISTINCT FROM v_caller) THEN
        RAISE EXCEPTION 'This person belongs to another tenant.' USING ERRCODE = '42501';
    END IF;

    IF NOT p_active AND v_user.id IS NOT NULL AND (
           v_user.id = auth.uid()
        OR lower(coalesce(v_user.email, '')) = lower(coalesce(auth.jwt() ->> 'email', '-'))) THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'self', 'id', p_id,
                                  'name', coalesce(v_contact.name, v_user.username));
    END IF;

    IF v_contact.id IS NOT NULL AND v_contact.is_active IS DISTINCT FROM p_active THEN
        UPDATE public.contacts SET is_active = p_active, updated_at = now() WHERE id = v_contact.id;
        v_contact_changed := true;
    END IF;

    IF v_user.id IS NOT NULL THEN
        v_sessions := public._directory_login_switch(v_user.id, p_active);
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'active', p_active,
        'name', coalesce(v_contact.name, v_user.username),
        'contact_id', v_contact.id,
        'user_id', v_user.id,
        'contact_changed', v_contact_changed,
        'login', v_user.id IS NOT NULL,
        'sessions_ended', v_sessions);
END;
$$;
REVOKE ALL ON FUNCTION public.set_person_active(uuid, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_person_active(uuid, boolean) TO authenticated, service_role;

COMMENT ON FUNCTION public.set_person_active(uuid, boolean) IS
  'Admin-only, tenant-scoped (de)activation of a directory entry: contacts.is_active + users.status + auth ban + session revocation, atomically. Refuses yourself ({ok:false, reason:self}).';

-- ── backfill: banned logins that still read active ────────────────────────
UPDATE public.users u
   SET status = 'suspended', updated_at = now()
  FROM auth.users a
 WHERE a.id = u.id
   AND a.banned_until > now()
   AND coalesce(u.status, 'active') = 'active';
