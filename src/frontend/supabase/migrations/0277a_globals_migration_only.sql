-- ════════════════════════════════════════════════════════════════════════════
-- 0277 — the last two globals become migration-only
--
-- movement_types (13 SAP codes) and ers_rca_cause_taxonomy (20 ISO failure
-- causes) were left admin-writable-globally by 0267, with a note that closing
-- them "needs FK surgery for the override pattern". Re-examined before doing
-- that surgery: NOTHING writes these tables. Not the frontend (one read of
-- the taxonomy, zero writes to either), not an edge function, not a cron. The
-- only customer-variable part of a movement type — which G/L account it posts
-- to — already has its per-tenant override table (0262).
--
-- Building copy-on-write machinery for tables with no writers would be
-- scaffolding for a demand that does not exist. The honest rule is the one
-- 0274 gave the config globals: product reference data changes by migration.
-- If a customer someday needs their own RCA causes, the 0267 pattern is
-- documented and proven — build it THEN, against a real requirement.
--
-- Until then: a tenant admin editing "101 Goods receipt for PO" for every
-- other tenant stops being possible, which closes the last known
-- cross-tenant write path.
-- ════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS movement_types_admin_write            ON public.movement_types;
DROP POLICY IF EXISTS ers_rca_cause_taxonomy_admin_write    ON public.ers_rca_cause_taxonomy;
-- reads stay exactly as they are: global product codes, every tenant needs them

COMMENT ON TABLE public.movement_types IS
    'SAP-style movement type codes. Product reference data: readable by every tenant, writable only by migration (0277). The per-tenant part — the G/L account a movement posts to — lives in movement_type_gl_overrides.';
COMMENT ON TABLE public.ers_rca_cause_taxonomy IS
    'ISO failure-cause taxonomy. Product reference data: readable by every tenant, writable only by migration (0277). If per-tenant causes become a real requirement, apply the 0267 config-override pattern.';

-- Prove it: an admin request context must no longer be able to write either.
DO $$
DECLARE v_admin uuid; v_co uuid; n int;
BEGIN
    SELECT id INTO v_admin FROM public.users WHERE email = 'admin001@cainergy.com';
    SELECT id INTO v_co   FROM public.companies WHERE active ORDER BY created_at LIMIT 1;

    PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_admin, 'app_metadata', json_build_object('company_id', v_co))::text, true);
    PERFORM set_config('role', 'authenticated', true);

    UPDATE public.movement_types SET description = description WHERE code = (SELECT code FROM public.movement_types LIMIT 1);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN
        PERFORM set_config('role', 'postgres', true);
        RAISE EXCEPTION 'an admin request context still updated % movement_types row(s)', n;
    END IF;

    UPDATE public.ers_rca_cause_taxonomy SET description = description WHERE code = (SELECT code FROM public.ers_rca_cause_taxonomy LIMIT 1);
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM set_config('role', 'postgres', true);
    PERFORM set_config('request.jwt.claims', NULL, true);
    IF n > 0 THEN
        RAISE EXCEPTION 'an admin request context still updated % taxonomy row(s)', n;
    END IF;

    -- and reads must still work for that same context
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_admin, 'app_metadata', json_build_object('company_id', v_co))::text, true);
    PERFORM set_config('role', 'authenticated', true);
    SELECT count(*) INTO n FROM public.movement_types;
    PERFORM set_config('role', 'postgres', true);
    PERFORM set_config('request.jwt.claims', NULL, true);
    IF n = 0 THEN
        RAISE EXCEPTION 'reads broke: authenticated context sees zero movement types';
    END IF;

    RAISE NOTICE 'globals are migration-only: writes refused, reads intact (% movement types visible)', n;
END $$;
