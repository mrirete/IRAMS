-- 0353 — Deleting a person from the directory never reported what happened.
--
-- The browser ran two writes and ignored both results: the delete_auth_user RPC
-- (warn only) and `DELETE FROM users` with return=minimal, where an RLS refusal
-- and a 0-row delete look identical to success. When a login had history
-- (work_order_labor.contact_id → users.id is NO ACTION) the users row survived,
-- the contact row was then deleted anyway, and the person reappeared in the
-- directory as an orphan "SYS-USER / System Account" that could not be removed
-- either — the Main Company tenant had five of these (alex, bea, charlie, dana,
-- efosa01) on 2026-09-09.
--
-- One SECURITY DEFINER RPC now owns the removal and says exactly what it did:
--   • admin only, own tenant only, never yourself;
--   • history check across every NO ACTION / RESTRICT FK that points at
--     users.id or auth.users.id — a person with postings is not deletable
--     (SAP does not delete personnel with postings either); the caller gets
--     {deleted:false, reason:'has_history', refs:[…]} and can retire the login
--     with set_user_login_active(id, false) instead;
--   • contacts.user_id is a link, not history: it is unlinked;
--   • profile row + login go together, atomically, with an audit row.
--
-- Rollback: DROP FUNCTION public.delete_directory_user(uuid);

CREATE OR REPLACE FUNCTION public.delete_directory_user(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_target    record;
    v_fk        record;
    v_n         bigint;
    v_refs      jsonb := '[]'::jsonb;
    v_company   uuid;
    v_had_auth  boolean := false;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Only an administrator can delete people.' USING ERRCODE = '42501';
    END IF;
    IF p_user_id = auth.uid() THEN
        RAISE EXCEPTION 'You cannot delete your own account.' USING ERRCODE = '42501';
    END IF;

    SELECT id, username, email, company_id INTO v_target
      FROM public.users WHERE id = p_user_id;

    IF NOT FOUND THEN
        -- No profile row. A half-created login may still exist; remove it if it
        -- belongs to nobody else's tenant (no profile ⇒ no tenant to check).
        DELETE FROM auth.users WHERE id = p_user_id;
        v_had_auth := FOUND;
        RETURN jsonb_build_object(
            'deleted', v_had_auth, 'user_id', p_user_id,
            'reason', CASE WHEN v_had_auth THEN NULL ELSE 'not_found' END,
            'login_removed', v_had_auth);
    END IF;

    -- Same rule as p2_admin_delete_users: your own tenant, or an orphan row
    -- with no tenant at all (repairable from the app).
    IF v_target.company_id IS NOT NULL
       AND v_target.company_id IS DISTINCT FROM (SELECT public.caller_company()) THEN
        RAISE EXCEPTION 'This person belongs to another tenant.' USING ERRCODE = '42501';
    END IF;
    v_company := coalesce(v_target.company_id, (SELECT public.caller_company()));

    -- A contact pointing at this login is a link, not history — unlink it so
    -- "remove the login, keep the person" works.
    UPDATE public.contacts SET user_id = NULL WHERE user_id = p_user_id;

    -- Anything else that would block the delete is operational history.
    FOR v_fk IN
        SELECT c.conrelid::regclass AS tbl, a.attname AS col
          FROM pg_constraint c
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
         WHERE c.contype = 'f'
           AND c.confrelid IN ('public.users'::regclass, 'auth.users'::regclass)
           AND c.connamespace = 'public'::regnamespace
           AND c.confdeltype IN ('a', 'r')          -- NO ACTION / RESTRICT
           AND NOT (c.conrelid = 'public.contacts'::regclass AND a.attname = 'user_id')
    LOOP
        EXECUTE format('SELECT count(*) FROM %s WHERE %I = $1', v_fk.tbl, v_fk.col)
           INTO v_n USING p_user_id;
        IF v_n > 0 THEN
            v_refs := v_refs || jsonb_build_object(
                'table', v_fk.tbl::text, 'column', v_fk.col, 'rows', v_n);
        END IF;
    END LOOP;

    IF jsonb_array_length(v_refs) > 0 THEN
        RETURN jsonb_build_object(
            'deleted', false, 'user_id', p_user_id, 'username', v_target.username,
            'reason', 'has_history', 'refs', v_refs);
    END IF;

    DELETE FROM public.users WHERE id = p_user_id;
    DELETE FROM auth.users  WHERE id = p_user_id;   -- cascades to auth.identities
    v_had_auth := FOUND;

    IF v_company IS NOT NULL THEN
        INSERT INTO public.audit_logs (table_name, record_id, action, changed_by, changes, company_id)
        VALUES ('users', p_user_id::text, 'DELETE', auth.uid(),
                jsonb_build_object('username', v_target.username, 'email', v_target.email,
                                   'login_removed', v_had_auth),
                v_company);
    END IF;

    RETURN jsonb_build_object(
        'deleted', true, 'user_id', p_user_id, 'username', v_target.username,
        'login_removed', v_had_auth);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_directory_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_directory_user(uuid) TO authenticated;

COMMENT ON FUNCTION public.delete_directory_user(uuid) IS
  'Admin-only, tenant-scoped removal of a directory login (profile + auth). Refuses people with operational history: {deleted:false, reason:has_history, refs}.';
