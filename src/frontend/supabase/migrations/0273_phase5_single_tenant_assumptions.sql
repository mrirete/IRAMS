-- ════════════════════════════════════════════════════════════════════════════
-- 0273 — Tenancy Phase 5 (expand): the database stops indulging the
--        single-tenant assumptions
--
-- Three client patterns assume one tenant:
--   • "the oldest active company" — SettingsContext, useEdition,
--     ErpExportService.tenantCurrency
--   • hierarchy_config `.eq('id', 1)` — the level model editor
--   • numbering_config `.eq('id', 1)` — the numbering defaults editor
--
-- And one policy hole that is worse than any of them, found while checking:
-- companies' UPDATE policy is `USING (is_admin())` with NO tenant test,
-- because companies was exempted from the 0261 sweep alongside users. That
-- exemption was justified for SELECT (the login path) and never re-examined
-- for UPDATE. Since Phase 6a made a second tenant real, tenant B's admin
-- could have UPDATED origin's app_settings — a cross-tenant WRITE. The
-- create-tenant verification gains a probe for exactly this.
--
-- ── companies: your row is the only row ─────────────────────────────────────
-- SELECT was USING (true) — that is how tenant B read origin's app_settings
-- JSONB. Scoping it to `id = caller_company()` fixes every "oldest active
-- company" reader with ZERO client changes: the caller's row becomes the only
-- visible row, so "the first one" is finally the right one. Same trick as the
-- 478 call sites in Phase 1.
--
-- anon is unaffected because it never had access: the old policy's role list
-- was {authenticated}. The login page resolves the tenant DB-side via the
-- access-token hook, not by reading companies.
--
-- ── the singletons get the 0267 config treatment ────────────────────────────
-- company_id NULL = the product's global default; a tenant row shadows it.
-- One row per tenant enforced by UNIQUE NULLS NOT DISTINCT (company_id).
-- Reads move to *_effective views (tenant row first, else global). Writes
-- become copy-on-write in the client.
--
-- The global rows deliberately stay company_id = NULL — stamping them with
-- the origin's id would convert product defaults into origin's private
-- config, exactly the mistake 0267's "no backfill" note warns about.
--
-- ── the transitional UPDATE branch, and why it is shaped that way ───────────
-- The DEPLOYED frontend still writes `upsert({id: 1, …})`. Scoping UPDATE to
-- own-row-only right now would make the origin admin's save button silently
-- update zero rows — the exact silent-success bug this workstream opened
-- with, shipped deliberately. So UPDATE keeps a `company_id IS NULL OR` branch
-- until the new frontend deploys; 0274 contracts it away.
--
-- The branch is written as `company_id IS NULL OR company_id = caller … AND
-- admin` — the same leading shape G4's binding check explicitly allows for
-- config tables — so the gate stays green through the window BY DESIGN, not
-- because the checker missed it. Today the window is safe in substance too:
-- the origin is the only real tenant, so "any admin may write the global row"
-- describes exactly the people who could already write it.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. companies ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS p2_select_companies ON public.companies;
CREATE POLICY p2_select_companies ON public.companies
    FOR SELECT TO authenticated
    USING (id = (SELECT public.caller_company()));

DROP POLICY IF EXISTS p2_admin_update_companies ON public.companies;
CREATE POLICY p2_admin_update_companies ON public.companies
    FOR UPDATE TO authenticated
    USING      (id = (SELECT public.caller_company()) AND (SELECT public.is_admin()))
    WITH CHECK (id = (SELECT public.caller_company()) AND (SELECT public.is_admin()));

-- No INSERT/DELETE policies existed and none are added: tenants are created by
-- provision_tenant() over the service role, never through PostgREST.

-- ── 2. the two singletons become per-tenant config ──────────────────────────
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['hierarchy_config', 'numbering_config'] LOOP
        EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS company_id uuid', t);
        EXECUTE format('ALTER TABLE public.%I ALTER COLUMN company_id SET DEFAULT public.caller_company()', t);
        BEGIN
            EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE',
                           t, 'fk_' || t || '_company');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
        -- one row per tenant, one global
        BEGIN
            EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE NULLS NOT DISTINCT (company_id)',
                           t, 'uq_' || t || '_tenant');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
        -- tenant inserts need an id the client does not supply: attach a
        -- sequence seeded past the existing global row's id.
        EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %I OWNED BY public.%I.id', t || '_id_seq', t);
        EXECUTE format('SELECT setval(%L, coalesce((SELECT max(id) FROM public.%I), 0) + 1, false)', t || '_id_seq', t);
        EXECUTE format('ALTER TABLE public.%I ALTER COLUMN id SET DEFAULT nextval(%L)', t, t || '_id_seq');

        -- clean slate on policies (the p2_* set predates tenancy)
        DECLARE p record;
        BEGIN
            FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
                EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
            END LOOP;
        END;

        EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
                        USING (company_id IS NULL OR company_id = (SELECT public.caller_company()))',
                       t || '_read_global_or_own', t);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated
                        WITH CHECK (company_id = (SELECT public.caller_company()) AND (SELECT public.is_admin()))',
                       t || '_insert_own', t);
        -- TRANSITIONAL: the IS NULL branch keeps the deployed upsert({id:1})
        -- working until the copy-on-write frontend ships. 0274 removes it.
        EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated
                        USING      ((company_id IS NULL OR company_id = (SELECT public.caller_company())) AND (SELECT public.is_admin()))
                        WITH CHECK ((company_id IS NULL OR company_id = (SELECT public.caller_company())) AND (SELECT public.is_admin()))',
                       t || '_update_own', t);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated
                        USING (company_id = (SELECT public.caller_company()) AND (SELECT public.is_admin()))',
                       t || '_delete_own', t);
    END LOOP;
END $$;

-- ── 3. resolving views: the tenant's row, else the global ───────────────────
CREATE OR REPLACE VIEW public.hierarchy_config_effective WITH (security_invoker = true) AS
    SELECT * FROM public.hierarchy_config
     WHERE company_id IS NULL OR company_id = (SELECT public.caller_company())
     ORDER BY (company_id IS NULL)
     LIMIT 1;

CREATE OR REPLACE VIEW public.numbering_config_effective WITH (security_invoker = true) AS
    SELECT * FROM public.numbering_config
     WHERE company_id IS NULL OR company_id = (SELECT public.caller_company())
     ORDER BY (company_id IS NULL)
     LIMIT 1;

GRANT SELECT ON public.hierarchy_config_effective, public.numbering_config_effective
    TO authenticated, service_role;

COMMENT ON VIEW public.hierarchy_config_effective IS
    'The one hierarchy level model that applies to the caller: their own row if they have customised it, else the product global (company_id IS NULL). Read this, never `.eq(''id'', 1)` — id 1 is the single-tenant assumption Phase 5 removed.';

-- ── 4. prove the shape ──────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
    -- the global rows must still be global
    SELECT count(*) INTO n FROM public.hierarchy_config WHERE company_id IS NOT NULL;
    n := n + (SELECT count(*) FROM public.numbering_config WHERE company_id IS NOT NULL);
    IF n > 0 THEN
        RAISE EXCEPTION '% singleton row(s) acquired a tenant — product defaults must stay NULL', n;
    END IF;
    -- and the structural gate must still be green, including on the two tables
    -- that just entered its scope
    SELECT count(*) INTO n FROM public.tenancy_policy_gaps();
    IF n > 0 THEN
        RAISE EXCEPTION 'tenancy_policy_gaps() reports % gap(s) after 0273 — %',
            n, (SELECT string_agg(kind || ':' || object_name, ', ') FROM public.tenancy_policy_gaps());
    END IF;
    RAISE NOTICE 'phase 5 expand: globals still global, G4 clean';
END $$;
