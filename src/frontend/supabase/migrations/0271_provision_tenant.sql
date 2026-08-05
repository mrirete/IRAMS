-- ════════════════════════════════════════════════════════════════════════════
-- 0271 — Tenancy Phase 6 groundwork: a second tenant becomes possible
--
-- Every phase so far ENFORCES the tenant boundary. None of them can CREATE a
-- tenant. The only provisioning path in the repo is the baseline load
-- (runbook §3.2), and it is deployment-per-tenant by construction: seed.sql
-- hardcodes the origin company's uuid and creates that company row. Run it at
-- a shared database and tenant #2 collides with tenant #1 on the company id —
-- and every PK in the seed set, since those uuids already exist in the shared
-- tables. The SMB tier, the thing this whole workstream exists to sell, had no
-- way to onboard its first customer.
--
-- Two functions, because provisioning without deprovisioning leaves every
-- failed experiment in the database forever:
--
--   provision_tenant(name, code, seed_ids[], …) → uuid
--   deprovision_tenant(company_id)
--
-- ── Why the seed rows are cloned BY ID LIST, not "whatever origin has" ──────
-- A new tenant needs its own copies of the tenant-owned reference data: audit
-- templates (3), their sections (27) and questions (68), notification rules
-- (14), channels (5), message templates (1). The obvious source is the origin
-- company's rows — but origin is a REAL OPERATING TENANT, the product owner's
-- own. The day they author a private audit template, "clone everything origin
-- has" would hand it to every new customer.
--
-- So the caller passes the uuid list of the product seed rows, extracted from
-- baseline/seed.sql — which is regenerated after every migration, verified by
-- verify-baseline.mjs, and stable (its INSERTs are ON CONFLICT DO NOTHING, so
-- ids never churn). The function clones exactly those rows and RAISES if any
-- id in the list is missing live: a stale list fails loudly instead of quietly
-- provisioning a subset.
--
-- ── Why every cloned row gets a fresh uuid ──────────────────────────────────
-- These are shared tables; the PK is globally unique across tenants. Tenant #2
-- cannot reuse the seed uuids — they are taken, by tenant #1. So each table is
-- cloned through a mapping table (old id → gen_random_uuid()) and FK columns
-- are remapped through it: sections point at the NEW template ids, questions
-- at the NEW section ids, and sections' self-referencing parent_section_id at
-- their own map. created_by is set NULL — verified NULL on all seed rows
-- anyway, and a user uuid must never leak across the tenant boundary.
--
-- Column lists are built from information_schema AT RUNTIME, not written out —
-- transcribing 20-column lists by hand is how sem_work_orders nearly lost
-- columns in 0261, and a future ALTER TABLE would silently drop the new column
-- from every clone.
--
-- ── What this deliberately does NOT do ──────────────────────────────────────
--   • auth: creating the admin user stays in create-tenant.mjs via
--     create_auth_user() — auth.users is GoTrue's table and the writes belong
--     in one place.
--   • self-serve signup: this is the building block Phase 6 will call, not the
--     product feature. Hence service_role only, revoked from everything else.
--   • per-tenant app_settings/edition/tier: companies.edition is copied from
--     origin; the pricing-tier column is Phase 6 scope.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.provision_tenant(
    p_name      text,
    p_code      text,
    p_seed_ids  uuid[],
    p_currency  text DEFAULT NULL,
    p_country   text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
-- pg_temp is in the path (last, per the SECURITY DEFINER guidance) because the
-- clone works through a temp mapping table; without it, a pinned search_path
-- makes every unqualified reference to _map fail to resolve.
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
    v_origin   uuid;
    v_new      uuid := gen_random_uuid();
    v_expected int  := coalesce(array_length(p_seed_ids, 1), 0);
    v_cloned   int  := 0;
    v_n        int;
    t          text;
    cols       text;
    exprs      text;
BEGIN
    IF p_code IS NULL OR btrim(p_code) = '' OR p_name IS NULL OR btrim(p_name) = '' THEN
        RAISE EXCEPTION 'provision_tenant: name and code are required';
    END IF;
    IF EXISTS (SELECT 1 FROM public.companies WHERE code = p_code) THEN
        RAISE EXCEPTION 'provision_tenant: company code % already exists', p_code;
    END IF;

    -- The clone source: the product owner's company, oldest active — the same
    -- row every seed and backfill in this repo treats as "the" company.
    SELECT id INTO v_origin FROM public.companies WHERE active IS TRUE ORDER BY created_at ASC LIMIT 1;
    IF v_origin IS NULL THEN
        RAISE EXCEPTION 'provision_tenant: no active origin company to clone seeds from';
    END IF;

    INSERT INTO public.companies (id, code, name, active, edition, currency, country)
    SELECT v_new, p_code, p_name, true, edition, coalesce(p_currency, currency), coalesce(p_country, country)
      FROM public.companies WHERE id = v_origin;

    -- ── id maps, built up front so self- and cross-references both resolve ──
    CREATE TEMP TABLE _map (old_id uuid PRIMARY KEY, new_id uuid NOT NULL) ON COMMIT DROP;
    INSERT INTO _map
    SELECT id, gen_random_uuid() FROM public.audit_templates          WHERE company_id = v_origin AND id = ANY (p_seed_ids)
    UNION ALL
    SELECT id, gen_random_uuid() FROM public.audit_template_sections  WHERE company_id = v_origin AND id = ANY (p_seed_ids)
    UNION ALL
    SELECT id, gen_random_uuid() FROM public.audit_template_questions WHERE company_id = v_origin AND id = ANY (p_seed_ids)
    UNION ALL
    SELECT id, gen_random_uuid() FROM public.notification_rules       WHERE company_id = v_origin AND id = ANY (p_seed_ids)
    UNION ALL
    SELECT id, gen_random_uuid() FROM public.notification_channels    WHERE company_id = v_origin AND id = ANY (p_seed_ids)
    UNION ALL
    SELECT id, gen_random_uuid() FROM public.message_templates        WHERE company_id = v_origin AND id = ANY (p_seed_ids);

    -- ── clone, in FK dependency order ───────────────────────────────────────
    -- Every column comes from information_schema; the overridden ones are the
    -- id (remapped), company_id (the new tenant), uuid FKs (remapped through
    -- _map, LEFT JOIN semantics via scalar subquery so NULLs stay NULL), and
    -- created_by (NULL — never leak a user across the boundary).
    FOREACH t IN ARRAY ARRAY['audit_templates', 'audit_template_sections',
                             'audit_template_questions', 'notification_rules',
                             'notification_channels', 'message_templates'] LOOP
        SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position),
               string_agg(
                   CASE column_name
                       WHEN 'id'                THEN 'm.new_id'
                       WHEN 'company_id'        THEN '$1'
                       WHEN 'created_by'        THEN 'NULL'
                       WHEN 'template_id'       THEN '(SELECT new_id FROM _map WHERE old_id = s.template_id)'
                       WHEN 'section_id'        THEN '(SELECT new_id FROM _map WHERE old_id = s.section_id)'
                       WHEN 'parent_section_id' THEN '(SELECT new_id FROM _map WHERE old_id = s.parent_section_id)'
                       ELSE 's.' || quote_ident(column_name)
                   END, ', ' ORDER BY ordinal_position)
          INTO cols, exprs
          FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = t AND is_generated = 'NEVER';

        EXECUTE format(
            'INSERT INTO public.%I (%s)
             SELECT %s FROM public.%I s JOIN _map m ON m.old_id = s.id
              WHERE s.company_id = $2 AND s.id = ANY ($3)',
            t, cols, exprs, t)
        USING v_new, v_origin, p_seed_ids;

        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_cloned := v_cloned + v_n;
    END LOOP;

    -- A stale id list must fail loudly, not provision a subset. If this fires,
    -- regenerate baseline/seed.sql and re-extract the ids.
    IF v_cloned <> v_expected THEN
        RAISE EXCEPTION 'provision_tenant: % seed id(s) passed but % row(s) cloned — the id list does not match the live seed rows',
            v_expected, v_cloned;
    END IF;

    RETURN v_new;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.deprovision_tenant(p_company uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_origin    uuid;
    t           record;
    v_pass      int := 0;
    v_deleted   int;
    v_progress  boolean := true;
BEGIN
    SELECT id INTO v_origin FROM public.companies WHERE active IS TRUE ORDER BY created_at ASC LIMIT 1;
    IF p_company = v_origin THEN
        RAISE EXCEPTION 'deprovision_tenant: refusing to destroy the origin company';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_company) THEN
        RAISE EXCEPTION 'deprovision_tenant: company % does not exist', p_company;
    END IF;

    -- Auth first: identities cascade from auth.users (verified 'c'), and
    -- public.users carries the company FK.
    DELETE FROM auth.users   WHERE id IN (SELECT id FROM public.users WHERE company_id = p_company);
    DELETE FROM public.users WHERE company_id = p_company;

    -- Sweep every tenant-owned table. FKs between them (work_orders → assets…)
    -- make single-pass ordering fragile, so loop until a pass deletes nothing.
    WHILE v_progress AND v_pass < 6 LOOP
        v_progress := false;
        v_pass := v_pass + 1;
        FOR t IN
            SELECT c.relname FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'r'
              AND c.relname NOT IN ('companies', 'users')
              AND EXISTS (SELECT 1 FROM information_schema.columns col
                           WHERE col.table_schema = 'public'
                             AND col.table_name = c.relname
                             AND col.column_name = 'company_id')
        LOOP
            BEGIN
                EXECUTE format('DELETE FROM public.%I WHERE company_id = $1', t.relname) USING p_company;
                GET DIAGNOSTICS v_deleted = ROW_COUNT;
                IF v_deleted > 0 THEN v_progress := true; END IF;
            EXCEPTION WHEN foreign_key_violation THEN
                v_progress := true;   -- children remain; a later pass clears them
            END;
        END LOOP;
    END LOOP;

    -- If anything still references the company, this DELETE raises a foreign
    -- key violation — loud and specific, which is exactly what we want. It only
    -- succeeds when the sweep genuinely got everything.
    DELETE FROM public.companies WHERE id = p_company;
END $$;

COMMENT ON FUNCTION public.provision_tenant(text, text, uuid[], text, text) IS
    'Creates an SMB tenant in the shared database: company row + fresh-uuid clones of the product seed rows (audit templates/sections/questions, notification rules/channels, message templates). Seed ids come from baseline/seed.sql via create-tenant.mjs — cloning "whatever origin has" would leak the origin tenant''s own authored rows to every new customer. Service-role only; the Phase 6 self-serve flow calls this, end users never do.';
COMMENT ON FUNCTION public.deprovision_tenant(uuid) IS
    'Removes a tenant completely: auth users, public.users, every row in every company_id table (multi-pass for FK ordering), then the company row. Refuses the origin company unconditionally. Service-role only.';

REVOKE ALL ON FUNCTION public.provision_tenant(text, text, uuid[], text, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.deprovision_tenant(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_tenant(text, text, uuid[], text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.deprovision_tenant(uuid) TO service_role;
