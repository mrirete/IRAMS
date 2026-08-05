-- ════════════════════════════════════════════════════════════════════════════
-- 0259 — Tenancy Phase 1: company_id on every tenant-owned table
--
-- Adds the column, backfills it, defaults it from the caller's claim, indexes
-- and FKs it. Still inert: no policy references it (that is Phase 2), so
-- behaviour is unchanged and G1 can prove that.
--
-- ── Classification, and the rule behind it ──────────────────────────────────
-- 164 tables sorted into three buckets. The rule when a table was ambiguous:
-- **choose tenant-owned**, because the two mistakes are not symmetrical.
--
--   Wrongly tenant-owned → each tenant gets their own copy of something that
--                          could have been shared. Wasteful, recoverable.
--   Wrongly shared       → customer A reads customer B's rows. A breach, and
--                          not recoverable.
--
-- SYSTEM (never tenant-scoped):
--   companies          it IS the tenant
--   users              already carries company_id (0258)
--   schema_migrations  migration ledger
--   role_permissions   the PRODUCT's role model, not customer data — tenants
--                      customise via users.permission_overrides
--   semantic_catalog   the product's semantic-layer definitions
--
-- CONFIG — product-seeded reference data, deferred to Phase 4 where they get
-- the global-default + per-tenant-override treatment that
-- numbering_config_overrides already demonstrates. Classified by INSPECTION,
-- not by name:
--   movement_types           13 rows, SAP codes ("101 Goods receipt for PO")
--   tax_codes                 8 rows, "V0 Zero Rated VAT"
--   ers_rca_cause_taxonomy   20 rows, "DES-01 Design error/deficiency"
--   manufacturers            15 rows, "Caterpillar"
--   dictionaries, reference_codes, hierarchy_config, numbering_config
--   numbering_config_overrides  already tenant-keyed
--
-- TENANT-OWNED: everything else. Including some that look like reference data
-- but are not — audit_templates holds ISO 55001 content yet customers author
-- their own, and manufacturer_models holds customer equipment ("HUE_8465 HP
-- Pump"). Both fail safe as tenant-owned.
--
-- ── Deviation from the plan: the column stays NULLABLE ──────────────────────
-- The plan said nullable → backfill → NOT NULL → DEFAULT. NOT NULL is NOT
-- applied here, and that is deliberate.
--
-- caller_company() reads a JWT claim, and returns NULL when there is no JWT —
-- verified. Five cron jobs write to this database (detect-sweep-tick,
-- sensor-sync-tick, sensor-points-retention, specialist-monday-briefing,
-- specialist-nightly-watchdog), and they run without a user token. NOT NULL
-- plus a NULL-returning default would break every one of them, immediately and
-- on a schedule.
--
-- NOT NULL therefore waits until the service-role write paths pass company_id
-- explicitly — which is real work, because a cron job must decide WHICH tenant
-- it is acting for, and in a shared database that is no longer implicit. Until
-- then the enforcement that matters is the Phase 2 WITH CHECK, which stops a
-- user writing another tenant's id.
--
-- G1 asserts zero NULLs in existing data, so the backfill is still proven.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    t          text;
    v_company  uuid;
    skip       constant text[] := ARRAY[
        -- system
        'companies', 'users', 'schema_migrations', 'role_permissions', 'semantic_catalog',
        -- config → Phase 4
        'movement_types', 'tax_codes', 'ers_rca_cause_taxonomy', 'manufacturers',
        'dictionaries', 'reference_codes', 'hierarchy_config',
        'numbering_config', 'numbering_config_overrides'
    ];
BEGIN
    SELECT c.id INTO v_company
      FROM public.companies c
     WHERE c.active IS TRUE
     ORDER BY c.created_at ASC
     LIMIT 1;

    IF v_company IS NULL THEN
        RAISE EXCEPTION 'No active company — cannot backfill tenancy';
    END IF;

    FOR t IN
        SELECT c.relname
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relkind = 'r'
           AND NOT (c.relname = ANY (skip))
         ORDER BY c.relname
    LOOP
        EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS company_id uuid', t);

        -- Backfill. Also repairs assets.company_id, which has existed since an
        -- earlier migration and was NULL on every row — added and never used.
        EXECUTE format('UPDATE public.%I SET company_id = %L WHERE company_id IS NULL', t, v_company);

        -- The default is what spares the 478 client call sites: a write that
        -- never mentions company_id still lands in the caller's tenant.
        EXECUTE format('ALTER TABLE public.%I ALTER COLUMN company_id SET DEFAULT public.caller_company()', t);

        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (company_id)', 'idx_' || t || '_company_id', t);

        -- FK last: it fails loudly if the backfill missed anything.
        BEGIN
            EXECUTE format(
                'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (company_id) REFERENCES public.companies(id)',
                t, 'fk_' || t || '_company');
        EXCEPTION
            WHEN duplicate_object THEN NULL;   -- already constrained, fine
        END;
    END LOOP;
END $$;

COMMENT ON COLUMN public.assets.company_id IS
    'Owning tenant. Existed unused (NULL on every row) until 0259 backfilled it. Defaults from caller_company() so client writes need not set it.';
