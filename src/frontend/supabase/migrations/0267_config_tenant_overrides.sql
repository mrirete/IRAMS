-- ════════════════════════════════════════════════════════════════════════════
-- 0267 — Tenancy Phase 4b: config gets a tenant dimension
--
-- 0259 deliberately left eight tables out of tenancy as "product-seeded
-- reference data, identical for every tenant". That was right at the time and
-- is wrong now, for two reasons — one a feature, one a defect.
--
-- ── The feature: customers have their own codes ─────────────────────────────
-- `dictionaries` holds fault codes, work order types, org levels. Customers
-- absolutely do have their own — that is the whole premise of ISO 14224 being a
-- starting point rather than a straitjacket. Today a customer cannot add one
-- without adding it for everybody.
--
-- ── The defect: any tenant could edit everybody's config ────────────────────
-- Measured, not assumed. Signed in as a TECHNICIAN (bea@, lowest privilege) and
-- wrote to each config table:
--
--     tax_codes         HTTP 200, 1 row affected   ❌  policy was ALL USING(true)
--     movement_types    0 rows                     ✅
--     reference_codes   0 rows                     ✅
--     dictionaries      0 rows                     ✅
--     manufacturers     0 rows                     ✅
--
-- One row affected means a technician at customer A could rewrite a tax code
-- that customer B reads. G4 never saw it: these tables have no company_id, so
-- they are outside its scope entirely. A whole class of table sitting in the
-- blind spot of the check built to find blind spots.
--
-- ── The shape: NULL means global ───────────────────────────────────────────
-- `company_id IS NULL` is the product's default, shared by everyone. A non-null
-- company_id is that tenant's own row, and it SHADOWS the global one with the
-- same key. No second table, no join at every call site — the same row shape,
-- one extra column.
--
--   read   company_id IS NULL OR company_id = caller_company()
--   write  company_id = caller_company()          ← never NULL, so a tenant can
--                                                   add and edit their own rows
--                                                   and can never touch a global
--
-- The DEFAULT does the rest: `caller_company()` returns the caller's tenant, so
-- an app insert is automatically tenant-scoped, while a migration running as
-- postgres has no JWT, gets NULL, and creates a global row. The two cases that
-- must differ do so by construction rather than by remembering.
--
-- ── NULLS NOT DISTINCT, the exact opposite of 0265 ─────────────────────────
-- 0265 chose plain UNIQUE because NULL there meant "absent" — 27 assets have no
-- equipment_number and must not collide with each other. Here NULL is a VALUE
-- meaning "global", and there must be exactly one global row per key, so NULLS
-- NOT DISTINCT is correct. Same keyword, opposite reasoning, because the NULL
-- means something different. Worth stating so a later sweep does not "fix" one
-- into the other.
--
-- ── Four tables, not eight ──────────────────────────────────────────────────
-- Applied to the four with surrogate primary keys, where widening the natural
-- key is a local change: dictionaries, reference_codes, manufacturers,
-- tax_codes.
--
-- NOT applied, with reasons rather than silence:
--   movement_types, ers_rca_cause_taxonomy — their PRIMARY KEY *is* the natural
--       key (`code`) and is referenced by foreign keys, including
--       movement_type_gl_overrides.code. Widening means FK surgery. And
--       movement_types already has the override pattern for the part customers
--       actually change: the G/L account (0262).
--   hierarchy_config, numbering_config — single-row singletons the client reads
--       with `.eq('id', 1)`. That literal is the Phase 5 single-tenant
--       assumption; giving them a tenant column here would half-fix it and make
--       Phase 5 harder to reason about. numbering_config already has
--       numbering_config_overrides.
--
-- Their write gates are still tightened below — that part is not deferred.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. The tenant dimension ─────────────────────────────────────────────────
DO $$
DECLARE
    t         text;
    targets   constant text[] := ARRAY['dictionaries', 'reference_codes', 'manufacturers', 'tax_codes'];
BEGIN
    FOREACH t IN ARRAY targets LOOP
        EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS company_id uuid', t);

        -- No backfill. Existing rows are the product's seed data and must stay
        -- NULL — that is what makes them global. This is the opposite of 0259,
        -- where a NULL company_id would have been a bug.
        EXECUTE format('ALTER TABLE public.%I ALTER COLUMN company_id SET DEFAULT public.caller_company()', t);
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (company_id)', 'idx_' || t || '_company_id', t);

        BEGIN
            EXECUTE format(
                'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE',
                t, 'fk_' || t || '_company');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
    END LOOP;
END $$;

-- ── 2. Uniqueness per tenant, one global per key ────────────────────────────
-- ADDED ALONGSIDE the narrow keys, not replacing them — 0268 drops those once
-- the frontend ships. bulkImportService upserts reference_codes with
-- `onConflict: 'category,code'`, and that inference stops matching the moment
-- the only index includes company_id. Exactly the 0265/0266 sequence, for
-- exactly the same reason: migrating ahead of the deploy broke this app twice.
--
-- Keeping both is harmless while no tenant has overrides yet — the narrow key
-- is simply stricter than the wide one until then.
ALTER TABLE public.dictionaries    ADD CONSTRAINT uq_dictionaries_tenant_type_code
    UNIQUE NULLS NOT DISTINCT (company_id, type, code);

ALTER TABLE public.reference_codes ADD CONSTRAINT uq_reference_codes_tenant_category_code
    UNIQUE NULLS NOT DISTINCT (company_id, category, code);

ALTER TABLE public.manufacturers   ADD CONSTRAINT uq_manufacturers_tenant_name
    UNIQUE NULLS NOT DISTINCT (company_id, name);

ALTER TABLE public.tax_codes       ADD CONSTRAINT uq_tax_codes_tenant_code
    UNIQUE NULLS NOT DISTINCT (company_id, code);

-- ── 3. Policies: read global + own, write only own ──────────────────────────
DO $$
DECLARE
    t     text;
    p     record;
    write_gate constant text := 'company_id = (SELECT public.caller_company()) AND (SELECT public.is_admin())';
    read_gate  constant text := 'company_id IS NULL OR company_id = (SELECT public.caller_company())';
BEGIN
    FOREACH t IN ARRAY ARRAY['dictionaries', 'reference_codes', 'manufacturers', 'tax_codes'] LOOP
        -- Drop everything first. tax_codes carried `ALL USING (true)`, which
        -- OR-ed against any restriction added beside it — the 0238 lesson.
        FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
            EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
        END LOOP;

        EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (%s)',
                       t || '_read_global_or_own', t, read_gate);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (%s)',
                       t || '_insert_own', t, write_gate);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)',
                       t || '_update_own', t, write_gate, write_gate);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (%s)',
                       t || '_delete_own', t, write_gate);
    END LOOP;
END $$;

-- The deferred tables do not get a tenant column, but they DO get their write
-- gates tightened — a tenant editing global product data is the same defect
-- whether or not the table is ready for the override pattern.
--
-- ers_rca_cause_taxonomy was the worst of them and I would have missed it: I
-- tested five config tables by hand and found only tax_codes exploitable, but
-- the assertion at the bottom of this file swept all eight and turned up FOUR
-- ungated write policies here — auth_insert/auth_update/auth_delete each
-- USING (true), plus an `authenticated_access` ALL USING (true) OR-ing over the
-- top. Any authenticated user could rewrite the ISO failure-cause taxonomy.
DO $$
DECLARE p record;
BEGIN
    FOR p IN SELECT policyname, tablename FROM pg_policies
              WHERE schemaname = 'public'
                AND tablename IN ('movement_types', 'ers_rca_cause_taxonomy')
    LOOP
        EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
    END LOOP;
END $$;

-- Read stays open: these are global product codes and every tenant needs them.
-- Write becomes admin-only.
CREATE POLICY movement_types_read ON public.movement_types
    FOR SELECT TO authenticated USING (true);
CREATE POLICY movement_types_admin_write ON public.movement_types
    FOR ALL TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY ers_rca_cause_taxonomy_read ON public.ers_rca_cause_taxonomy
    FOR SELECT TO authenticated USING (true);
CREATE POLICY ers_rca_cause_taxonomy_admin_write ON public.ers_rca_cause_taxonomy
    FOR ALL TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

-- Residual, stated rather than left implicit: these two are still GLOBAL, so a
-- tenant admin editing them still changes what every other tenant reads. That
-- is a real remaining cross-tenant write, narrowed from "any user" to "any
-- admin". Closing it properly means the override treatment above, which needs
-- the FK surgery described in the header. Until then the exposure is bounded by
-- the admin role rather than eliminated.

-- ── 4. Resolving views: the tenant's row shadows the global one ────────────
-- security_invoker so base-table RLS still applies — 0259_sem_views taught that
-- a view defaults to DEFINER and reads straight past it.
--
-- DISTINCT ON keeps the first row per key; ORDER BY (company_id IS NULL) puts
-- tenant rows (false) before global rows (true), so an override wins.

CREATE OR REPLACE VIEW public.dictionaries_effective WITH (security_invoker = true) AS
    SELECT DISTINCT ON (type, code) *
      FROM public.dictionaries
     WHERE company_id IS NULL OR company_id = (SELECT public.caller_company())
     ORDER BY type, code, (company_id IS NULL);

CREATE OR REPLACE VIEW public.reference_codes_effective WITH (security_invoker = true) AS
    SELECT DISTINCT ON (category, code) *
      FROM public.reference_codes
     WHERE company_id IS NULL OR company_id = (SELECT public.caller_company())
     ORDER BY category, code, (company_id IS NULL);

CREATE OR REPLACE VIEW public.manufacturers_effective WITH (security_invoker = true) AS
    SELECT DISTINCT ON (name) *
      FROM public.manufacturers
     WHERE company_id IS NULL OR company_id = (SELECT public.caller_company())
     ORDER BY name, (company_id IS NULL);

CREATE OR REPLACE VIEW public.tax_codes_effective WITH (security_invoker = true) AS
    SELECT DISTINCT ON (code) *
      FROM public.tax_codes
     WHERE company_id IS NULL OR company_id = (SELECT public.caller_company())
     ORDER BY code, (company_id IS NULL);

GRANT SELECT ON public.dictionaries_effective, public.reference_codes_effective,
                public.manufacturers_effective, public.tax_codes_effective
    TO authenticated, service_role;

COMMENT ON VIEW public.dictionaries_effective IS
    'Global defaults with the caller tenant''s overrides shadowing them, one row per (type, code). Read this, not `dictionaries`, anywhere a list is rendered — the base table returns BOTH rows once an override exists. security_invoker, so RLS still applies.';

-- ── 5. Prove it ─────────────────────────────────────────────────────────────
DO $$
DECLARE
    n_global int;
    n_open   int;
BEGIN
    -- Every existing config row must still be global; a backfill here would
    -- silently hand the product's seed data to whichever tenant ran first.
    SELECT count(*) INTO n_global FROM public.dictionaries WHERE company_id IS NOT NULL;
    IF n_global > 0 THEN
        RAISE EXCEPTION '% dictionaries row(s) got a tenant — seed data must stay global', n_global;
    END IF;

    -- No permissive policy may allow an UNGATED WRITE. Reads are a different
    -- question: `movement_types_read` is SELECT USING (true) and stays that way
    -- on purpose — those are global SAP movement codes and every tenant needs
    -- them. An open read of product data is correct; an open write is the
    -- defect this migration exists to fix. The first version of this check
    -- conflated the two and failed the migration on its own correct policy.
    SELECT count(*) INTO n_open
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('dictionaries', 'reference_codes', 'manufacturers', 'tax_codes',
                         'movement_types', 'ers_rca_cause_taxonomy', 'hierarchy_config', 'numbering_config')
       AND permissive = 'PERMISSIVE'
       AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
       AND coalesce(qual, '') || coalesce(with_check, '') NOT LIKE '%caller_company%'
       AND coalesce(qual, '') || coalesce(with_check, '') NOT LIKE '%is_admin%';
    IF n_open > 0 THEN
        RAISE EXCEPTION '% ungated WRITE policy(ies) remain on config tables — a tenant could edit global product data', n_open;
    END IF;

    RAISE NOTICE 'config tenancy: seed data still global, no unconditional policies';
END $$;
