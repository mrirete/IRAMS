-- ════════════════════════════════════════════════════════════════════════════
-- 0278 — Phase 6b (first half): the pricing tier becomes server truth
--
-- Module licensing today lives in localStorage, defaulting to everything —
-- which is fine for a single-tenant enterprise deployment and decorative for
-- a paid SMB tier: any customer can open devtools and enable every module.
--
-- companies.tier is the server-side ceiling. The client (LicenseContext)
-- reads it from the caller's own company row — which since 0273 is the ONLY
-- row it can see — and clamps the module set to the tier's families. The
-- localStorage toggles remain, demoted to what they honestly are: an admin
-- choosing to HIDE licensed modules, never to exceed the licence.
--
-- Worth stating plainly: ModuleGate is a UX boundary, not a security one.
-- The data behind every module is protected by RLS and caller_can()
-- regardless of what the sidebar shows. The tier decides what a customer is
-- SOLD, not what an attacker can reach.
--
-- Origin defaults to 'enterprise': nothing changes for current users.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.companies
    ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'enterprise'
        CONSTRAINT companies_tier_check CHECK (tier IN ('starter', 'professional', 'enterprise'));

COMMENT ON COLUMN public.companies.tier IS
    'Pricing tier — the server-side module ceiling. The family→tier mapping lives in src/config/tierMap.ts (a product decision, edit there). Changed only by migration or the service role; tenants cannot raise their own tier: the companies UPDATE policy (0273) lets an admin edit their row, so a trigger below pins this column.';

-- A tenant admin CAN update their companies row (app_settings — 0273). They
-- must not be able to raise their own tier through the same door.
CREATE OR REPLACE FUNCTION public.companies_tier_is_pinned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
    -- Sessionless (service role / migrations): may change the tier.
    IF auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;
    IF NEW.tier IS DISTINCT FROM OLD.tier THEN
        RAISE EXCEPTION 'tier is set by your plan, not by the application'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS aa_tier_pinned ON public.companies;
CREATE TRIGGER aa_tier_pinned BEFORE UPDATE ON public.companies
    FOR EACH ROW EXECUTE FUNCTION public.companies_tier_is_pinned();

-- provision_tenant learns the tier. CREATE OR REPLACE with a different arg
-- list would create an OVERLOAD beside the old signature, not replace it —
-- so the old function is dropped explicitly first.
DROP FUNCTION IF EXISTS public.provision_tenant(text, text, uuid[], text, text);
CREATE OR REPLACE FUNCTION public.provision_tenant(
    p_name      text,
    p_code      text,
    p_seed_ids  uuid[],
    p_currency  text DEFAULT NULL,
    p_country   text DEFAULT NULL,
    p_tier      text DEFAULT 'starter'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
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
    IF p_tier NOT IN ('starter', 'professional', 'enterprise') THEN
        RAISE EXCEPTION 'provision_tenant: unknown tier %', p_tier;
    END IF;
    IF EXISTS (SELECT 1 FROM public.companies WHERE code = p_code) THEN
        RAISE EXCEPTION 'provision_tenant: company code % already exists', p_code;
    END IF;

    SELECT id INTO v_origin FROM public.companies WHERE active IS TRUE ORDER BY created_at ASC LIMIT 1;
    IF v_origin IS NULL THEN
        RAISE EXCEPTION 'provision_tenant: no active origin company to clone seeds from';
    END IF;

    INSERT INTO public.companies (id, code, name, active, edition, currency, country, tier)
    SELECT v_new, p_code, p_name, true, edition, coalesce(p_currency, currency), coalesce(p_country, country), p_tier
      FROM public.companies WHERE id = v_origin;

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

    IF v_cloned <> v_expected THEN
        RAISE EXCEPTION 'provision_tenant: % seed id(s) passed but % row(s) cloned — the id list does not match the live seed rows',
            v_expected, v_cloned;
    END IF;

    RETURN v_new;
END $$;

COMMENT ON FUNCTION public.provision_tenant(text, text, uuid[], text, text, text) IS
    'Creates an SMB tenant in the shared database: company row (with pricing tier) + fresh-uuid clones of the product seed rows. Seed ids come from baseline/seed.sql via create-tenant.mjs. Service-role only.';
REVOKE ALL ON FUNCTION public.provision_tenant(text, text, uuid[], text, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_tenant(text, text, uuid[], text, text, text) TO service_role;

-- ── prove the pin, both directions ──────────────────────────────────────────
DO $$
DECLARE v_admin uuid; v_co uuid; n int;
BEGIN
    SELECT id INTO v_admin FROM public.users WHERE email = 'admin001@cainergy.com';
    SELECT id INTO v_co   FROM public.companies WHERE active ORDER BY created_at LIMIT 1;

    -- an admin request context may edit their row but NOT the tier
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_admin, 'email', 'admin001@cainergy.com', 'app_metadata', json_build_object('company_id', v_co))::text, true);
    PERFORM set_config('role', 'authenticated', true);
    BEGIN
        UPDATE public.companies SET tier = 'starter' WHERE id = v_co;
        PERFORM set_config('role', 'postgres', true);
        RAISE EXCEPTION 'an admin raised/lowered their own tier — the pin is not holding';
    EXCEPTION WHEN insufficient_privilege THEN
        PERFORM set_config('role', 'postgres', true);
    END;
    -- …while a non-tier update still succeeds
    PERFORM set_config('role', 'authenticated', true);
    UPDATE public.companies SET updated_at = now() WHERE id = v_co;
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM set_config('role', 'postgres', true);
    PERFORM set_config('request.jwt.claims', NULL, true);
    IF n <> 1 THEN
        RAISE EXCEPTION 'the pin broke ordinary company updates (rows=%)', n;
    END IF;

    -- and the sessionless context can set it (that is how plans change)
    UPDATE public.companies SET tier = tier WHERE id = v_co;

    RAISE NOTICE 'tier pinned: app cannot change it, service can, ordinary updates intact';
END $$;
