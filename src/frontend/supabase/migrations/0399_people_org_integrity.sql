-- 0399 — People & Org: writes that lost data, and writes anyone could make.
--
-- From the 2026-10-01 People & Org audit. Each block is something a user could
-- see go wrong:
--
--   1. Vendors: insert/update/delete policies checked only the tenant, and the
--      page never consulted permissions, so any signed-in role could delete a
--      supplier. purchase_orders.supplier_id and warranties.vendor_id are
--      ON DELETE SET NULL and invoice_matches.vendor_id has no FK, so the
--      delete silently stripped the supplier off every PO, warranty and
--      invoice match. Writes now consult caller_can('vendors', …), and a
--      supplier with purchasing history cannot be deleted at all — deactivate
--      it (vendors.active) instead.
--   2. contacts INSERT checked only the tenant; it now needs contacts.create.
--   3. organization_units / organization_unit_members had a blanket
--      "authenticated_access" FOR ALL policy beside the per-command ones, so
--      anyone could restructure the org chart. Writes now need contacts.edit.
--   4. Org membership writes were delete-all then insert, from the browser,
--      unchecked: a failed insert left the person in no unit while the page
--      said "saved"; a move in the org chart wiped every secondary membership;
--      deleting a unit with members failed on the members FK. Three RPCs do
--      these in one transaction and raise on failure:
--        set_contact_org_units   — the person's full unit list (Details tab)
--        set_primary_org_unit    — move/assign/unassign (org chart), keeps
--                                  secondary memberships
--        delete_org_unit         — refuses while sub-units or work centres
--                                  hang off it; removes memberships with it
--   5. Deleting a person removed the login first, then the contact delete
--      failed on qualifications / memberships / reporting lines — login gone,
--      person still there. delete_directory_person checks everything first
--      and does all of it or none of it.
--
-- Rollback: DROP the five functions and the vendors trigger; recreate the
-- 0296-baseline policies (supabase/baseline/schema.sql).

-- ── 1. vendors ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "auth_insert_vendors" ON public.vendors;
CREATE POLICY "auth_insert_vendors" ON public.vendors FOR INSERT TO authenticated
    WITH CHECK (company_id = (SELECT public.caller_company()) AND (SELECT public.caller_can('vendors', 'create')));
DROP POLICY IF EXISTS "auth_update_vendors" ON public.vendors;
CREATE POLICY "auth_update_vendors" ON public.vendors FOR UPDATE TO authenticated
    USING      (company_id = (SELECT public.caller_company()) AND (SELECT public.caller_can('vendors', 'edit')))
    WITH CHECK (company_id = (SELECT public.caller_company()) AND (SELECT public.caller_can('vendors', 'edit')));
DROP POLICY IF EXISTS "auth_delete_vendors" ON public.vendors;
CREATE POLICY "auth_delete_vendors" ON public.vendors FOR DELETE TO authenticated
    USING (company_id = (SELECT public.caller_company()) AND (SELECT public.caller_can('vendors', 'delete')));

CREATE OR REPLACE FUNCTION public.refuse_delete_vendor_with_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_po int := 0; v_inv int := 0; v_war int := 0;
    v_parts text[] := '{}';
BEGIN
    SELECT count(*) INTO v_po  FROM public.purchase_orders WHERE supplier_id = OLD.id;
    IF to_regclass('public.invoice_matches') IS NOT NULL THEN
        EXECUTE 'SELECT count(*) FROM public.invoice_matches WHERE vendor_id = $1' INTO v_inv USING OLD.id;
    END IF;
    SELECT count(*) INTO v_war FROM public.warranties WHERE vendor_id = OLD.id;
    IF v_po  > 0 THEN v_parts := v_parts || (v_po  || ' purchase order' || CASE WHEN v_po  > 1 THEN 's' ELSE '' END); END IF;
    IF v_inv > 0 THEN v_parts := v_parts || (v_inv || ' invoice match' || CASE WHEN v_inv > 1 THEN 'es' ELSE '' END); END IF;
    IF v_war > 0 THEN v_parts := v_parts || (v_war || ' warrant' || CASE WHEN v_war > 1 THEN 'ies' ELSE 'y' END); END IF;
    IF array_length(v_parts, 1) > 0 THEN
        RAISE EXCEPTION '% has % and cannot be deleted — deleting it would strip the supplier from them. Deactivate it instead.',
            coalesce(OLD.name, 'This vendor'), array_to_string(v_parts, ', ')
            USING ERRCODE = '23503';
    END IF;
    RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS aa_refuse_delete_vendor_with_history ON public.vendors;
CREATE TRIGGER aa_refuse_delete_vendor_with_history BEFORE DELETE ON public.vendors
    FOR EACH ROW EXECUTE FUNCTION public.refuse_delete_vendor_with_history();

-- ── 2. contacts insert ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "p2_insert_contacts" ON public.contacts;
CREATE POLICY "p2_insert_contacts" ON public.contacts FOR INSERT TO authenticated
    WITH CHECK (company_id = (SELECT public.caller_company()) AND (SELECT public.caller_can('contacts', 'create')));

-- ── 3. org structure writes ───────────────────────────────────────────────
DROP POLICY IF EXISTS "authenticated_access" ON public.organization_units;
DROP POLICY IF EXISTS "authenticated_access" ON public.organization_unit_members;

DROP POLICY IF EXISTS "auth_insert_organization_units" ON public.organization_units;
CREATE POLICY "auth_insert_organization_units" ON public.organization_units FOR INSERT TO authenticated
    WITH CHECK (company_id = (SELECT public.caller_company()) AND (SELECT public.caller_can('contacts', 'edit')));
DROP POLICY IF EXISTS "auth_update_organization_units" ON public.organization_units;
CREATE POLICY "auth_update_organization_units" ON public.organization_units FOR UPDATE TO authenticated
    USING      (company_id = (SELECT public.caller_company()) AND (SELECT public.caller_can('contacts', 'edit')))
    WITH CHECK (company_id = (SELECT public.caller_company()) AND (SELECT public.caller_can('contacts', 'edit')));
DROP POLICY IF EXISTS "auth_delete_organization_units" ON public.organization_units;
CREATE POLICY "auth_delete_organization_units" ON public.organization_units FOR DELETE TO authenticated
    USING (company_id = (SELECT public.caller_company()) AND (SELECT public.caller_can('contacts', 'edit')));

-- Membership: a person being created (contacts.create) is placed in units by
-- the same person who creates them, so create OR edit.
DROP POLICY IF EXISTS "auth_insert_organization_unit_members" ON public.organization_unit_members;
CREATE POLICY "auth_insert_organization_unit_members" ON public.organization_unit_members FOR INSERT TO authenticated
    WITH CHECK (company_id = (SELECT public.caller_company())
                AND ((SELECT public.caller_can('contacts', 'edit')) OR (SELECT public.caller_can('contacts', 'create'))));
DROP POLICY IF EXISTS "auth_update_organization_unit_members" ON public.organization_unit_members;
CREATE POLICY "auth_update_organization_unit_members" ON public.organization_unit_members FOR UPDATE TO authenticated
    USING      (company_id = (SELECT public.caller_company()) AND (SELECT public.caller_can('contacts', 'edit')))
    WITH CHECK (company_id = (SELECT public.caller_company()) AND (SELECT public.caller_can('contacts', 'edit')));
DROP POLICY IF EXISTS "auth_delete_organization_unit_members" ON public.organization_unit_members;
CREATE POLICY "auth_delete_organization_unit_members" ON public.organization_unit_members FOR DELETE TO authenticated
    USING ((company_id = (SELECT public.caller_company())
           AND ((SELECT public.caller_can('contacts', 'edit')) OR (SELECT public.caller_can('contacts', 'create')))));

-- ── 4a. a person's full unit list ─────────────────────────────────────────
-- SECURITY INVOKER: the policies above decide; this only makes it atomic and
-- loud. First id in the list is the primary unit (contacts.organization_unit_id).
CREATE OR REPLACE FUNCTION public.set_contact_org_units(p_contact_id uuid, p_unit_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_ids     uuid[] := ARRAY(SELECT DISTINCT unnest(coalesce(p_unit_ids, '{}'::uuid[])));
    v_primary uuid   := (coalesce(p_unit_ids, '{}'::uuid[]))[1];
    v_n       int;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.contacts WHERE id = p_contact_id) THEN
        RAISE EXCEPTION 'Person not found, or not visible to you.' USING ERRCODE = 'P0002';
    END IF;
    SELECT count(*) INTO v_n FROM public.organization_units WHERE id = ANY (v_ids);
    IF v_n <> coalesce(array_length(v_ids, 1), 0) THEN
        RAISE EXCEPTION 'One of the organisation units no longer exists.' USING ERRCODE = '23503';
    END IF;

    DELETE FROM public.organization_unit_members
     WHERE contact_id = p_contact_id AND NOT (organization_unit_id = ANY (v_ids));

    UPDATE public.organization_unit_members
       SET is_primary = (organization_unit_id = v_primary)
     WHERE contact_id = p_contact_id
       AND is_primary IS DISTINCT FROM (organization_unit_id = v_primary);

    INSERT INTO public.organization_unit_members (contact_id, organization_unit_id, is_primary)
    SELECT p_contact_id, u, u = v_primary
      FROM unnest(v_ids) AS u
     WHERE NOT EXISTS (SELECT 1 FROM public.organization_unit_members m
                        WHERE m.contact_id = p_contact_id AND m.organization_unit_id = u);

    UPDATE public.contacts SET organization_unit_id = v_primary
     WHERE id = p_contact_id AND organization_unit_id IS DISTINCT FROM v_primary;
END;
$$;
REVOKE ALL ON FUNCTION public.set_contact_org_units(uuid, uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_contact_org_units(uuid, uuid[]) TO authenticated;

-- ── 4b. move / assign / unassign (org chart) ──────────────────────────────
-- Changes the PRIMARY unit only. p_unit_id NULL = take them out of their
-- primary unit. Secondary memberships are left alone.
CREATE OR REPLACE FUNCTION public.set_primary_org_unit(p_contact_ids uuid[], p_unit_id uuid)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_c   uuid;
    v_old uuid;
    v_n   int := 0;
BEGIN
    IF p_unit_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.organization_units WHERE id = p_unit_id) THEN
        RAISE EXCEPTION 'That organisation unit no longer exists.' USING ERRCODE = '23503';
    END IF;
    FOREACH v_c IN ARRAY coalesce(p_contact_ids, '{}'::uuid[]) LOOP
        SELECT organization_unit_id INTO v_old FROM public.contacts WHERE id = v_c;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Person not found, or not visible to you.' USING ERRCODE = 'P0002';
        END IF;

        UPDATE public.contacts SET organization_unit_id = p_unit_id WHERE id = v_c;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Your role cannot change people''s organisation unit.' USING ERRCODE = '42501';
        END IF;

        -- the old primary membership goes (it IS what is being moved) …
        DELETE FROM public.organization_unit_members
         WHERE contact_id = v_c
           AND (organization_unit_id = v_old OR is_primary)
           AND organization_unit_id IS DISTINCT FROM p_unit_id;
        -- … and the new unit becomes primary, whether or not they were already
        -- a secondary member of it.
        IF p_unit_id IS NOT NULL THEN
            UPDATE public.organization_unit_members SET is_primary = true
             WHERE contact_id = v_c AND organization_unit_id = p_unit_id;
            IF NOT FOUND THEN
                INSERT INTO public.organization_unit_members (contact_id, organization_unit_id, is_primary)
                VALUES (v_c, p_unit_id, true);
            END IF;
        END IF;
        v_n := v_n + 1;
    END LOOP;
    RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.set_primary_org_unit(uuid[], uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_primary_org_unit(uuid[], uuid) TO authenticated;

-- ── 4c. delete a unit ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_org_unit(p_unit_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_children int; v_wc int := 0; v_members int;
BEGIN
    SELECT count(*) INTO v_children FROM public.organization_units WHERE parent_id = p_unit_id;
    IF to_regclass('public.work_centers') IS NOT NULL THEN
        EXECUTE 'SELECT count(*) FROM public.work_centers WHERE site_id = $1' INTO v_wc USING p_unit_id;
    END IF;
    IF v_children > 0 OR v_wc > 0 THEN
        RETURN jsonb_build_object('deleted', false, 'children', v_children, 'work_centers', v_wc);
    END IF;

    DELETE FROM public.organization_unit_members WHERE organization_unit_id = p_unit_id;
    GET DIAGNOSTICS v_members = ROW_COUNT;
    UPDATE public.contacts SET organization_unit_id = NULL WHERE organization_unit_id = p_unit_id;
    DELETE FROM public.organization_units WHERE id = p_unit_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'The unit was not deleted — it no longer exists or your role cannot change the organisation.'
            USING ERRCODE = '42501';
    END IF;
    RETURN jsonb_build_object('deleted', true, 'members_removed', v_members);
END;
$$;
REVOKE ALL ON FUNCTION public.delete_org_unit(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.delete_org_unit(uuid) TO authenticated;

-- ── 5. delete a person (record + login), all or nothing ───────────────────
-- What still points at a login (users.id / auth.users.id) — 0353's loop, as a
-- read-only helper so it can be asked BEFORE anything is removed.
CREATE OR REPLACE FUNCTION public._user_history_refs(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_fk record; v_n bigint; v_refs jsonb := '[]'::jsonb;
BEGIN
    FOR v_fk IN
        SELECT c.conrelid::regclass AS tbl, a.attname AS col
          FROM pg_constraint c
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
         WHERE c.contype = 'f'
           AND c.confrelid IN ('public.users'::regclass, 'auth.users'::regclass)
           AND c.connamespace = 'public'::regnamespace
           AND c.confdeltype IN ('a', 'r')
           AND NOT (c.conrelid = 'public.contacts'::regclass AND a.attname = 'user_id')
    LOOP
        EXECUTE format('SELECT count(*) FROM %s WHERE %I = $1', v_fk.tbl, v_fk.col) INTO v_n USING p_user_id;
        IF v_n > 0 THEN
            v_refs := v_refs || jsonb_build_object('table', v_fk.tbl::text, 'column', v_fk.col, 'rows', v_n);
        END IF;
    END LOOP;
    RETURN v_refs;
END;
$$;
REVOKE ALL ON FUNCTION public._user_history_refs(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.delete_directory_person(p_contact_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_contact record;
    v_user    record;
    v_fk      record;
    v_n       bigint;
    v_refs    jsonb := '[]'::jsonb;
    v_res     jsonb;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Only an administrator can delete people.' USING ERRCODE = '42501';
    END IF;

    SELECT id, name, company_id INTO v_contact FROM public.contacts WHERE id = p_contact_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('deleted', false, 'reason', 'not_found');
    END IF;
    IF v_contact.company_id IS DISTINCT FROM (SELECT public.caller_company()) THEN
        RAISE EXCEPTION 'This person belongs to another tenant.' USING ERRCODE = '42501';
    END IF;

    -- What points at the person record. Memberships and reporting lines are
    -- links, not history: they go with the person.
    FOR v_fk IN
        SELECT c.conrelid::regclass AS tbl, a.attname AS col
          FROM pg_constraint c
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
         WHERE c.contype = 'f'
           AND c.confrelid = 'public.contacts'::regclass
           AND c.connamespace = 'public'::regnamespace
           AND c.confdeltype IN ('a', 'r')
           AND c.conrelid <> 'public.organization_unit_members'::regclass
           AND NOT (c.conrelid = 'public.contacts'::regclass AND a.attname = 'parent_id')
    LOOP
        EXECUTE format('SELECT count(*) FROM %s WHERE %I = $1', v_fk.tbl, v_fk.col) INTO v_n USING p_contact_id;
        IF v_n > 0 THEN
            v_refs := v_refs || jsonb_build_object('table', v_fk.tbl::text, 'column', v_fk.col, 'rows', v_n);
        END IF;
    END LOOP;
    -- work_orders.assigned_to carries a contact id; 0032 gave it an FK that the
    -- 0296 baseline no longer has. Count it here only when the loop above
    -- could not have.
    v_n := 0;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
         WHERE c.contype = 'f' AND c.conrelid = 'public.work_orders'::regclass
           AND c.confrelid = 'public.contacts'::regclass AND a.attname = 'assigned_to') THEN
        SELECT count(*) INTO v_n FROM public.work_orders WHERE assigned_to = p_contact_id;
    END IF;
    IF v_n > 0 THEN
        v_refs := v_refs || jsonb_build_object('table', 'public.work_orders', 'column', 'assigned_to', 'rows', v_n);
    END IF;

    FOR v_user IN
        SELECT id FROM public.users
         WHERE contact_id = p_contact_id
            OR id = (SELECT user_id FROM public.contacts WHERE id = p_contact_id)
    LOOP
        IF v_user.id = auth.uid() THEN
            RAISE EXCEPTION 'You cannot delete your own account.' USING ERRCODE = '42501';
        END IF;
        v_refs := v_refs || public._user_history_refs(v_user.id);
    END LOOP;

    IF jsonb_array_length(v_refs) > 0 THEN
        RETURN jsonb_build_object('deleted', false, 'reason', 'has_history',
                                  'name', v_contact.name, 'refs', v_refs);
    END IF;

    -- Nothing blocks: logins first (delete_directory_user re-checks and audits),
    -- then the links, then the person. Any failure rolls the lot back.
    FOR v_user IN
        SELECT id FROM public.users
         WHERE contact_id = p_contact_id
            OR id = (SELECT user_id FROM public.contacts WHERE id = p_contact_id)
    LOOP
        v_res := public.delete_directory_user(v_user.id);
        IF NOT coalesce((v_res ->> 'deleted')::boolean, false) AND v_res ->> 'reason' IS DISTINCT FROM 'not_found' THEN
            RAISE EXCEPTION 'The login could not be removed (%).', coalesce(v_res ->> 'reason', 'unknown');
        END IF;
    END LOOP;

    UPDATE public.contacts SET parent_id = NULL WHERE parent_id = p_contact_id;
    DELETE FROM public.organization_unit_members WHERE contact_id = p_contact_id;
    DELETE FROM public.contacts WHERE id = p_contact_id;

    RETURN jsonb_build_object('deleted', true, 'name', v_contact.name);
END;
$$;
REVOKE ALL ON FUNCTION public.delete_directory_person(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.delete_directory_person(uuid) TO authenticated;

COMMENT ON FUNCTION public.delete_directory_person(uuid) IS
  'Admin-only, tenant-scoped removal of a person record and any login, atomically. Refuses people with history ({deleted:false, reason:has_history, refs}) — deactivate them (set_person_active) instead.';
