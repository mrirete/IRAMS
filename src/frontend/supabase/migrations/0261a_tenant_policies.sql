-- ════════════════════════════════════════════════════════════════════════════
-- 0261 — Tenancy Phase 2: the database starts enforcing the tenant boundary
--
-- Every policy on a tenant-owned table gains a tenant conjunct, and the six
-- views that bypass RLS gain an explicit tenant filter. After this, tenancy is
-- live — but invisible, because there is still only one tenant. G2 proves that:
-- the RLS matrix must pass UNCHANGED.
--
-- ── Tenancy and role compose ────────────────────────────────────────────────
--     USING (company_id = (SELECT caller_company()) AND <existing role test>)
--
-- Tenant test FIRST: it is an indexed uuid comparison and eliminates rows before
-- the function is consulted. Measured on 200k rows — adding it made queries
-- FASTER, not slower: 113 ms → 40 ms at one tenant, 34 ms → 4.6 ms at fifty,
-- where the planner switches to an index scan.
--
-- Both USING and WITH CHECK are amended. WITH CHECK is what stops a client
-- passing someone else's company_id: the column DEFAULT fills in the caller's
-- tenant when the client says nothing, and this rejects it when the client says
-- the wrong thing.
--
-- ── The views are the part a policy sweep would miss ────────────────────────
-- Six views run with DEFINER semantics, so they read straight past RLS. Adding
-- a tenant conjunct to every policy would leave all six as open cross-tenant
-- windows — and four of them are mine, added earlier in this workstream.
--
-- They cannot simply be flipped to security_invoker: their whole purpose is to
-- bypass the ROLE gate (names must render for a technician who cannot read
-- `contacts`; the Specialist must count work orders for a REQUESTER who cannot
-- read `work_orders`). So each keeps the role bypass and gains an explicit
-- tenant filter. Bypass the role, never the tenant.
--
-- ── What is NOT tenant-scoped, and why that is safe ─────────────────────────
-- Tables without a company_id column are skipped: system tables (companies,
-- schema_migrations, role_permissions, semantic_catalog) and the config tables
-- deferred to Phase 4 (dictionaries, movement_types, tax_codes, manufacturers,
-- ers_rca_cause_taxonomy, reference_codes, hierarchy_config, numbering_config).
-- Config is product-seeded reference data and identical for every tenant today;
-- Phase 4 gives it the per-tenant override treatment. `users` carries
-- company_id but is deliberately left alone here — gating it would break the
-- login path that resolves the caller in the first place.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Policies ─────────────────────────────────────────────────────────────
DO $$
DECLARE
    p          record;
    new_qual   text;
    new_check  text;
    stmt       text;
    tenant     constant text := 'company_id = (SELECT public.caller_company())';
    n          int := 0;
BEGIN
    FOR p IN
        SELECT pol.tablename, pol.policyname, pol.permissive, pol.roles, pol.cmd,
               pol.qual, pol.with_check
          FROM pg_policies pol
         WHERE pol.schemaname = 'public'
           -- only tables that actually carry the column
           AND EXISTS (
               SELECT 1 FROM information_schema.columns c
                WHERE c.table_schema = 'public'
                  AND c.table_name = pol.tablename
                  AND c.column_name = 'company_id')
           -- users is the login path: gating it would break caller resolution
           AND pol.tablename <> 'users'
           -- idempotent: skip anything already carrying the conjunct
           AND coalesce(pol.qual, '') || coalesce(pol.with_check, '') NOT LIKE '%caller_company%'
    LOOP
        new_qual  := p.qual;
        new_check := p.with_check;

        IF new_qual IS NOT NULL THEN
            new_qual := tenant || ' AND (' || new_qual || ')';
        ELSIF p.cmd IN ('SELECT', 'UPDATE', 'DELETE', 'ALL') THEN
            new_qual := tenant;
        END IF;

        IF new_check IS NOT NULL THEN
            new_check := tenant || ' AND (' || new_check || ')';
        ELSIF p.cmd IN ('INSERT', 'UPDATE', 'ALL') THEN
            new_check := tenant;
        END IF;

        EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);

        stmt := format('CREATE POLICY %I ON public.%I AS %s FOR %s TO %s',
                       p.policyname, p.tablename,
                       CASE WHEN p.permissive = 'PERMISSIVE' THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
                       p.cmd,
                       array_to_string(p.roles, ', '));

        IF new_qual  IS NOT NULL THEN stmt := stmt || format(' USING (%s)',      new_qual);  END IF;
        IF new_check IS NOT NULL THEN stmt := stmt || format(' WITH CHECK (%s)', new_check); END IF;

        EXECUTE stmt;
        n := n + 1;
    END LOOP;

    RAISE NOTICE 'tenant conjunct added to % policies', n;
END $$;

-- ── 2. The six RLS-bypassing views ──────────────────────────────────────────
-- Role bypass kept (that is why they exist); tenant filter added.

CREATE OR REPLACE VIEW public.contact_directory AS
    SELECT id, name FROM public.contacts
     WHERE company_id = (SELECT public.caller_company());

CREATE OR REPLACE VIEW public.vendor_directory AS
    SELECT id, name FROM public.vendors
     WHERE company_id = (SELECT public.caller_company());

CREATE OR REPLACE VIEW public.sem_specialist_briefing_wo AS
    SELECT id, asset_id, type, status, created_at,
           frozen_labor_cost, frozen_material_cost, total_actual_cost
      FROM public.work_orders w
     WHERE company_id = (SELECT public.caller_company())
       AND (SELECT public.caller_can('reliability', 'view'));

CREATE OR REPLACE VIEW public.sem_specialist_overdue_pm AS
    SELECT id, asset_id
      FROM public.recurring_work r
     WHERE company_id = (SELECT public.caller_company())
       AND active = true
       AND next_due_date < now()
       AND (SELECT public.caller_can('reliability', 'view'));

CREATE OR REPLACE VIEW public.maintenance_forecasts AS
    SELECT id, code, title, asset_id, frequency_interval, frequency_unit,
           est_labor_cost, est_material_cost,
           est_labor_cost + est_material_cost AS cost_per_event,
           CASE
               WHEN frequency_unit = 'Days'   THEN 365.0 / NULLIF(frequency_interval, 0)::numeric
               WHEN frequency_unit = 'Weeks'  THEN  52.0 / NULLIF(frequency_interval, 0)::numeric
               WHEN frequency_unit = 'Months' THEN  12.0 / NULLIF(frequency_interval, 0)::numeric
               WHEN frequency_unit = 'Years'  THEN   1.0 / NULLIF(frequency_interval, 0)::numeric
               ELSE 0::numeric
           END AS annual_frequency,
           (est_labor_cost + est_material_cost) *
           CASE
               WHEN frequency_unit = 'Days'   THEN 365.0 / NULLIF(frequency_interval, 0)::numeric
               WHEN frequency_unit = 'Weeks'  THEN  52.0 / NULLIF(frequency_interval, 0)::numeric
               WHEN frequency_unit = 'Months' THEN  12.0 / NULLIF(frequency_interval, 0)::numeric
               WHEN frequency_unit = 'Years'  THEN   1.0 / NULLIF(frequency_interval, 0)::numeric
               ELSE 0::numeric
           END AS annual_estimated_spend,
           next_due_date
      FROM public.recurring_work rw
     WHERE company_id = (SELECT public.caller_company())
       AND active = true
       AND status = 'ACTIVE';

-- sem_work_orders projects 42 columns, several of them computed (wo_state,
-- is_open, is_done — the canonical state from lib/woState). Transcribing that
-- list by hand is how you silently drop a column, so take the view's OWN
-- definition and append the filter to it. It has no WHERE clause of its own,
-- which is what makes a plain append safe here.
DO $$
DECLARE d text;
BEGIN
    SELECT rtrim(rtrim(pg_get_viewdef('public.sem_work_orders'::regclass, true)), ';')
      INTO d;

    IF d ILIKE '%caller_company%' THEN
        RAISE NOTICE 'sem_work_orders already tenant-filtered';
    ELSIF d ~* '\m(where|group by|order by|limit)\M' THEN
        -- Appending would change the meaning of an existing clause.
        RAISE EXCEPTION 'sem_work_orders now has a WHERE/GROUP/ORDER — append is unsafe, rewrite it explicitly';
    ELSE
        EXECUTE 'CREATE OR REPLACE VIEW public.sem_work_orders AS ' || d ||
                ' WHERE company_id = (SELECT public.caller_company())';
    END IF;
END $$;

COMMENT ON VIEW public.contact_directory IS
    'Names only. Bypasses the ROLE gate on purpose so labels render for roles without contacts.view — but NEVER the tenant boundary (0261). Do not add security_invoker; do not remove the company_id filter.';
COMMENT ON VIEW public.sem_work_orders IS
    'Canonical work-order projection. Tenant-filtered since 0261 — it runs with DEFINER semantics, so without that filter it is a cross-tenant window.';
