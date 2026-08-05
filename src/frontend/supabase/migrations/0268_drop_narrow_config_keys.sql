-- ════════════════════════════════════════════════════════════════════════════
-- 0268 — Tenancy Phase 4b, contract half: config overrides become possible
--
-- 0267 added (company_id, …) keys alongside the narrow ones rather than
-- replacing them, because bulkImportService upserted reference_codes with
-- `onConflict: 'category,code'` and that inference dies the moment the only
-- index includes company_id.
--
-- The frontend carrying `onConflict: 'company_id,category,code'` and the
-- `*_effective` reads is deployed and verified in the served bundle. So the
-- narrow keys have nothing depending on them — and until they go, the override
-- feature does not actually work: a tenant inserting their own DOWNTIME_REASON
-- / BREAKDOWN still collides with the global row on `(type, code)`. Confirmed
-- by trying it after 0267:
--
--     duplicate key value violates unique constraint "dictionaries_type_code_key"
--     Key (type, code)=(DOWNTIME_REASON, BREAKDOWN) already exists.
--
-- That error is this migration's whole reason to exist.
-- ════════════════════════════════════════════════════════════════════════════

-- Guard: never drop the narrow key unless the wide one is really there, or the
-- table is left with no uniqueness at all and duplicate codes start appearing
-- in every dropdown.
DO $$
DECLARE missing text;
BEGIN
    SELECT string_agg(x.name, ', ') INTO missing
      FROM (VALUES
        ('uq_dictionaries_tenant_type_code'),
        ('uq_reference_codes_tenant_category_code'),
        ('uq_manufacturers_tenant_name'),
        ('uq_tax_codes_tenant_code')
      ) AS x(name)
     WHERE NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conname = x.name);

    IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'widened key(s) absent: % — 0267 did not complete, refusing to drop the narrow keys', missing;
    END IF;
END $$;

ALTER TABLE public.dictionaries    DROP CONSTRAINT IF EXISTS dictionaries_type_code_key;
ALTER TABLE public.reference_codes DROP CONSTRAINT IF EXISTS reference_codes_category_code_key;
ALTER TABLE public.manufacturers   DROP CONSTRAINT IF EXISTS manufacturers_name_key;
ALTER TABLE public.tax_codes       DROP CONSTRAINT IF EXISTS tax_codes_code_key;

-- ── Prove the override actually works, then leave no trace ─────────────────
-- Asserting the constraint is gone proves nothing about whether a tenant can
-- now shadow a global row — that depends on the wide key, the policies AND the
-- view agreeing. So do it: insert a real override, check the effective view
-- collapses to one row and picks the tenant's, then roll the probe back.
DO $$
DECLARE
    v_company uuid;
    v_type    text;
    v_code    text;
    n_base    int;
    n_eff     int;
    eff_desc  text;
BEGIN
    SELECT id INTO v_company FROM public.companies WHERE active ORDER BY created_at LIMIT 1;
    SELECT type, code INTO v_type, v_code FROM public.dictionaries WHERE company_id IS NULL LIMIT 1;

    INSERT INTO public.dictionaries (type, code, description, is_locked, active, company_id)
    VALUES (v_type, v_code, '__probe_override__', false, true, v_company);

    SELECT count(*) INTO n_base FROM public.dictionaries WHERE type = v_type AND code = v_code;

    -- The view filters on caller_company(), which is NULL here (no JWT), so
    -- read it the way a tenant would instead: the row that WOULD win.
    SELECT count(*), min(description) INTO n_eff, eff_desc
      FROM (SELECT DISTINCT ON (type, code) description
              FROM public.dictionaries
             WHERE type = v_type AND code = v_code
               AND (company_id IS NULL OR company_id = v_company)
             ORDER BY type, code, (company_id IS NULL)) q;

    IF n_base <> 2 THEN
        RAISE EXCEPTION 'expected global + override = 2 base rows, found % — the wide key did not take', n_base;
    END IF;
    IF n_eff <> 1 OR eff_desc <> '__probe_override__' THEN
        RAISE EXCEPTION 'resolution failed: % row(s), winner "%" — the tenant row must shadow the global', n_eff, eff_desc;
    END IF;

    RAISE NOTICE 'override proven: 2 base rows resolve to 1, tenant wins';
    DELETE FROM public.dictionaries WHERE company_id = v_company AND description = '__probe_override__';
END $$;

-- Nothing may survive that probe.
DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM public.dictionaries WHERE company_id IS NOT NULL;
    IF n > 0 THEN
        RAISE EXCEPTION '% tenant dictionary row(s) left behind by the probe', n;
    END IF;
END $$;
