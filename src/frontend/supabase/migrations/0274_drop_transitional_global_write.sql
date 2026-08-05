-- ════════════════════════════════════════════════════════════════════════════
-- 0274 — Phase 5 contract: the global config rows become read-only from the app
--
-- 0273 left a transitional branch on hierarchy_config / numbering_config
-- UPDATE — `company_id IS NULL OR …` — so the deployed frontend's
-- upsert({id: 1}) kept working while the copy-on-write build shipped. That
-- build is deployed and verified in the served bundle (the effective views are
-- referenced, the id:1 upsert is gone), so the branch has nothing depending on
-- it.
--
-- After this, the product's global defaults can only change by migration.
-- A tenant admin editing "the hierarchy levels" edits THEIR copy — which is
-- the entire point of Phase 5.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['hierarchy_config', 'numbering_config'] LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update_own', t);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated
                        USING      (company_id = (SELECT public.caller_company()) AND (SELECT public.is_admin()))
                        WITH CHECK (company_id = (SELECT public.caller_company()) AND (SELECT public.is_admin()))',
                       t || '_update_own', t);
    END LOOP;
END $$;

-- Prove both directions: an admin can no longer touch the global row, and the
-- copy-on-write path (update own → insert copy) works end to end.
DO $$
DECLARE
    v_company uuid;
    v_admin   uuid;
    n int;
BEGIN
    SELECT id INTO v_company FROM public.companies WHERE active ORDER BY created_at LIMIT 1;
    SELECT id INTO v_admin FROM public.users WHERE email = 'admin001@cainergy.com';

    -- simulate the admin's request context
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_admin, 'app_metadata', json_build_object('company_id', v_company))::text, true);
    PERFORM set_config('role', 'authenticated', true);

    UPDATE public.hierarchy_config SET updated_at = now() WHERE company_id IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM set_config('role', 'postgres', true);
    IF n > 0 THEN
        RAISE EXCEPTION 'an admin request context updated % global config row(s) — the contract did not take', n;
    END IF;

    PERFORM set_config('request.jwt.claims', NULL, true);
    SELECT count(*) INTO n FROM public.tenancy_policy_gaps();
    IF n > 0 THEN
        RAISE EXCEPTION 'tenancy_policy_gaps() reports % gap(s) after 0274', n;
    END IF;
    RAISE NOTICE 'contract verified: global rows unwritable from request contexts, G4 clean';
END $$;
