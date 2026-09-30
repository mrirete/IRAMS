-- ════════════════════════════════════════════════════════════════════════════
-- 0394 — FinOps integrity: the finance tables answer to the matrix for WRITES,
--        the five ungated tables join the read gate, the one DEFINER that
--        trusted its tenant argument stops, and the ledger gets the keys and
--        guards the service layer had been assuming were there.
--
-- Found by a three-way audit of the asset Financials tab, the FinOps page and
-- this schema (2026-09-30). The headline: the data model is SAP-shaped and the
-- service layer was written against a model it never checked. Several money
-- paths have never worked in production and fail silently.
--
-- ── 1. Writes were never gated ──────────────────────────────────────────────
-- 0246 gated SELECT on nine finops tables and, deliberately, left every write
-- policy at `true` "pending its own reader sweep". That sweep is this file.
-- Every write policy below consults caller_can('finops', <create|edit|delete>).
-- The two flows that write finance rows from outside Finance keep working:
--   • work-order completion drafts a warranty claim and advances the hours
--     counter (DatabaseService TECO hook → warranty_claims INSERT, warranties
--     UPDATE) → also allowed on caller_can('workOrders','edit');
--   • asset creation stamps a default asset_financials row carrying the cost
--     centre (DatabaseService.addAsset) → INSERT also allowed on
--     caller_can('assets','create').
-- Settlement, stock-movement and PO-commitment postings run inside DEFINER
-- functions owned by postgres and are not affected.
--
-- ── 2. Five tables never joined the read gate ───────────────────────────────
-- warranties, warranty_claims, asset_insurance, insurance_incidents and
-- asset_financials each still carried one `authenticated_access FOR ALL`
-- tenant-only policy: any tenant user could read acquisition cost, insured
-- value and claim amounts, and approve a claim. They get the same
-- per-command policies as the rest.
--
-- ── 3. ers_refresh_budget_committed trusted p_company ───────────────────────
-- SECURITY DEFINER, granted to authenticated, no caller check: any user could
-- recompute and UPDATE another tenant's budgets.committed and read back that
-- tenant's open-PO total. The tenant is now derived from the cost centre row
-- and a caller from another tenant is refused — the same shape as
-- ers_refresh_budget_actual (0244). The trigger path is unchanged.
--
-- ── 4. Keys the service assumed ─────────────────────────────────────────────
-- getAssetFinancial() uses .maybeSingle() (one row per asset); the depreciation
-- run is "idempotent per book/period" client-side only; getBudget() uses
-- .single(). None of those had a unique key. They do now. Existing duplicates
-- fail this migration LOUDLY with the offending ids — resolve them by hand;
-- nothing here deletes financial rows.
--
-- ── 5. Posted depreciation is immutable ─────────────────────────────────────
-- recapitalizeAsset deleted every schedule row for a book (posted included)
-- before re-projecting — and the re-projection insert had always failed on a
-- column that does not exist, so a capital event silently wiped history. A
-- trigger now refuses UPDATE/DELETE of a posted row, and deleting an asset or
-- its financial record that carries posted depreciation is refused
-- ("deactivate instead").
--
-- ── 6. Backfill ──────────────────────────────────────────────────────────────
-- Only one writer of depreciation_schedules ever succeeded (the monthly run),
-- and it left posted=false (the default) and never updated the book: it
-- assigned a query builder to accumulated_depreciation. So: every existing
-- schedule row IS a posting → posted=true; every book's accumulated
-- depreciation and carrying value are recomputed from its rows.
--
-- ── 7. Audit ────────────────────────────────────────────────────────────────
-- 0373's audit trigger covered admin tables only. Budget edits, claim
-- approvals and capital events now leave a trail (log_admin_audit_event is
-- generic: it redacts credentials and derives a key).
--
-- Also: warranties.warranty_number (text) is added — the service already
-- selects it in getExpiringWarranties/updateWarrantyCounters, and its absence
-- is why "expiring warranties" was always empty and hour counters never moved.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 0. Column the service already reads ──────────────────────────────────────
ALTER TABLE public.warranties ADD COLUMN IF NOT EXISTS warranty_number text;

-- ── 1+2. Policies: reads on the five ungated tables, writes on all fourteen ──
DO $$
DECLARE
    t text;
    -- Tables whose SELECT is already gated by 0246 (and, for cost_centers /
    -- cost_allocations, deliberately re-opened by 0247 — their SELECT policies
    -- are NOT touched here; only writes are).
    gated_read text[] := ARRAY[
        'cost_centers', 'depreciation_books', 'depreciation_schedules',
        'capital_events', 'budgets', 'budget_blocks', 'cost_allocations',
        'journal_entries', 'wbs_elements'
    ];
    -- Tables that never joined the read gate.
    ungated_read text[] := ARRAY[
        'warranties', 'warranty_claims', 'asset_insurance',
        'insurance_incidents', 'asset_financials'
    ];
    all_tables text[];
    tenant  text := '(company_id = (SELECT public.caller_company()))';
    ins_extra text;
    upd_extra text;
BEGIN
    all_tables := gated_read || ungated_read;

    FOREACH t IN ARRAY all_tables LOOP
        IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
            RAISE NOTICE '0394: skipped % (table absent)', t;
            CONTINUE;
        END IF;

        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

        -- The blanket FOR ALL policy must go wherever it survives: RLS is OR-ed
        -- and a permissive FOR ALL beside a gate re-grants everything (0238).
        EXECUTE format('DROP POLICY IF EXISTS authenticated_access ON public.%I', t);
        EXECUTE format('DROP POLICY IF EXISTS finops_insert_%s ON public.%I', t, t);
        EXECUTE format('DROP POLICY IF EXISTS finops_update_%s ON public.%I', t, t);
        EXECUTE format('DROP POLICY IF EXISTS finops_delete_%s ON public.%I', t, t);

        -- READ gate only for the tables that never had one.
        IF t = ANY (ungated_read) THEN
            EXECUTE format('DROP POLICY IF EXISTS finops_select_%s ON public.%I', t, t);
            EXECUTE format($p$
                CREATE POLICY finops_select_%s ON public.%I
                FOR SELECT TO authenticated
                USING (%s AND (SELECT public.caller_can('finops', 'view')))$p$, t, t, tenant);
        END IF;

        -- Flows outside Finance that legitimately write these rows.
        ins_extra := '';
        upd_extra := '';
        IF t = 'warranty_claims' OR t = 'insurance_incidents' THEN
            ins_extra := ' OR (SELECT public.caller_can(''workOrders'', ''edit''))';
        ELSIF t = 'asset_financials' THEN
            ins_extra := ' OR (SELECT public.caller_can(''assets'', ''create''))';
        END IF;
        IF t = 'warranties' THEN
            upd_extra := ' OR (SELECT public.caller_can(''workOrders'', ''edit''))';
        END IF;

        EXECUTE format($p$
            CREATE POLICY finops_insert_%s ON public.%I
            FOR INSERT TO authenticated
            WITH CHECK (%s AND ((SELECT public.caller_can('finops', 'create'))%s))$p$, t, t, tenant, ins_extra);
        EXECUTE format($p$
            CREATE POLICY finops_update_%s ON public.%I
            FOR UPDATE TO authenticated
            USING (%s AND ((SELECT public.caller_can('finops', 'edit'))%s))
            WITH CHECK (%s AND ((SELECT public.caller_can('finops', 'edit'))%s))$p$, t, t, tenant, upd_extra, tenant, upd_extra);
        EXECUTE format($p$
            CREATE POLICY finops_delete_%s ON public.%I
            FOR DELETE TO authenticated
            USING (%s AND (SELECT public.caller_can('finops', 'delete')))$p$, t, t, tenant);

        RAISE NOTICE '0394: policies on %', t;
    END LOOP;
END $$;

COMMENT ON TABLE public.warranties IS
    'Asset warranties. SELECT gated on caller_can(''finops'',''view''), writes on finops create/edit/delete since 0394; work-order completion may UPDATE (hour counters).';
COMMENT ON TABLE public.warranty_claims IS
    'Warranty claims. Gated on the finops matrix since 0394; work-order completion may INSERT (auto-drafted claim).';

-- ── 3. ers_refresh_budget_committed: derive the tenant, refuse a stranger ────
CREATE OR REPLACE FUNCTION public.ers_refresh_budget_committed(p_company uuid, p_cost_center uuid, p_fiscal_year int)
RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v         numeric := 0;
    v_company uuid;
    v_caller  uuid;
BEGIN
    IF p_cost_center IS NULL OR p_fiscal_year IS NULL THEN RETURN 0; END IF;

    -- The tenant is the cost centre's, never the argument's (0261 rule). The
    -- argument is kept for the trigger path's signature; it must agree.
    SELECT cc.company_id INTO v_company FROM public.cost_centers cc WHERE cc.id = p_cost_center;
    IF v_company IS NULL THEN RETURN 0; END IF;
    IF p_company IS NOT NULL AND p_company <> v_company THEN
        RAISE EXCEPTION 'ers_refresh_budget_committed: cost centre belongs to another tenant'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    BEGIN v_caller := public.caller_company(); EXCEPTION WHEN OTHERS THEN v_caller := NULL; END;
    IF v_caller IS NOT NULL AND v_caller <> v_company THEN
        RAISE EXCEPTION 'ers_refresh_budget_committed: cost centre belongs to another tenant'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT COALESCE(SUM(GREATEST(COALESCE(l.qty_ordered,0) - COALESCE(l.qty_received,0), 0) * COALESCE(l.unit_cost,0)), 0)
      INTO v
      FROM public.purchase_order_lines l
      JOIN public.purchase_orders po ON po.id = l.po_id
      LEFT JOIN public.sem_wo_receiver r ON r.work_order_id = l.work_order_id
     WHERE po.company_id = v_company
       AND po.status IN ('OPEN', 'PART_RECEIVED')
       AND COALESCE(l.cost_center_id, r.cost_center_id, po.cost_center_id) = p_cost_center
       AND EXTRACT(YEAR FROM COALESCE(po.date_created, po.created_at::date))::int = p_fiscal_year;

    UPDATE public.budgets
       SET committed = ROUND(v, 2)
     WHERE company_id = v_company
       AND cost_center_id = p_cost_center
       AND fiscal_year = p_fiscal_year
       AND COALESCE(period, 'ANNUAL') IN ('ANNUAL', 'YEAR')
       AND committed IS DISTINCT FROM ROUND(v, 2);
    RETURN ROUND(v, 2);
END $$;
REVOKE ALL ON FUNCTION public.ers_refresh_budget_committed(uuid, uuid, int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ers_refresh_budget_committed(uuid, uuid, int) TO authenticated, service_role;
COMMENT ON FUNCTION public.ers_refresh_budget_committed(uuid, uuid, int) IS
    'Recomputes budgets.committed from open PO lines. Tenant derived from the cost centre; a caller or argument from another tenant is refused (0394).';

-- ── 6. Backfill BEFORE the keys and guards, so they see a consistent ledger ──
DO $$
DECLARE n int;
BEGIN
    UPDATE public.depreciation_schedules SET posted = true WHERE posted IS DISTINCT FROM true;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE '0394: % schedule rows marked posted (the monthly run was the only writer that ever succeeded)', n;

    UPDATE public.depreciation_books b
       SET accumulated_depreciation = s.total,
           current_value = GREATEST(COALESCE(f.acquisition_cost, 0) - s.total, COALESCE(f.residual_value, 0)),
           last_depreciation_date = s.last_run,
           updated_at = now()
      FROM (
            SELECT book_id, SUM(depreciation_amount) AS total, MAX(COALESCE(run_date::timestamptz, created_at)) AS last_run
              FROM public.depreciation_schedules
             WHERE posted
             GROUP BY book_id
           ) s
      JOIN public.asset_financials f ON true
     WHERE b.id = s.book_id
       AND f.id = b.asset_financial_id
       AND (b.accumulated_depreciation IS DISTINCT FROM s.total
            OR b.current_value IS DISTINCT FROM GREATEST(COALESCE(f.acquisition_cost, 0) - s.total, COALESCE(f.residual_value, 0)));
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE '0394: % books re-derived from their posted schedule', n;
END $$;

-- ── 4. Unique keys, refusing loudly on duplicates ───────────────────────────
DO $$
DECLARE dups text;
BEGIN
    SELECT string_agg(asset_id::text, ', ') INTO dups
      FROM (SELECT asset_id FROM public.asset_financials GROUP BY asset_id HAVING COUNT(*) > 1) d;
    IF dups IS NOT NULL THEN
        RAISE EXCEPTION '0394: asset_financials has more than one row for asset(s) %. Merge or delete the extras by hand, then re-run.', dups;
    END IF;

    SELECT string_agg(format('%s/%s/%s', book_id, fiscal_year, period), ', ') INTO dups
      FROM (SELECT book_id, fiscal_year, period FROM public.depreciation_schedules GROUP BY 1,2,3 HAVING COUNT(*) > 1) d;
    IF dups IS NOT NULL THEN
        RAISE EXCEPTION '0394: depreciation_schedules has duplicate postings for book/year/period %. Remove the duplicates by hand, then re-run.', dups;
    END IF;

    SELECT string_agg(format('%s/%s/%s', cost_center_id, fiscal_year, COALESCE(period, 'ANNUAL')), ', ') INTO dups
      FROM (SELECT cost_center_id, fiscal_year, COALESCE(period, 'ANNUAL') AS period FROM public.budgets
             WHERE cost_center_id IS NOT NULL GROUP BY 1,2,3 HAVING COUNT(*) > 1) d;
    IF dups IS NOT NULL THEN
        RAISE EXCEPTION '0394: budgets has more than one row for cost centre/year/period %. Merge them by hand, then re-run.', dups;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_financials_asset
    ON public.asset_financials (asset_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_depreciation_schedules_book_period
    ON public.depreciation_schedules (book_id, fiscal_year, period);
CREATE UNIQUE INDEX IF NOT EXISTS uq_budgets_cost_center_period
    ON public.budgets (cost_center_id, fiscal_year, COALESCE(period, 'ANNUAL'))
    WHERE cost_center_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_budgets_wbs_period
    ON public.budgets (wbs_element_id, fiscal_year, COALESCE(period, 'ANNUAL'))
    WHERE wbs_element_id IS NOT NULL;

-- Claim approval bounds. NOT VALID so a historical row cannot block the
-- migration; new writes are checked. Validate later once history is clean.
ALTER TABLE public.warranty_claims DROP CONSTRAINT IF EXISTS chk_warranty_claim_approved_amount;
ALTER TABLE public.warranty_claims
    ADD CONSTRAINT chk_warranty_claim_approved_amount
    CHECK (approved_amount IS NULL OR (approved_amount >= 0 AND approved_amount <= COALESCE(total_claim_amount, approved_amount)))
    NOT VALID;

-- ── 5. Posted depreciation is immutable; assets with it cannot be deleted ────
CREATE OR REPLACE FUNCTION public.ers_guard_posted_depreciation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.posted THEN
            RAISE EXCEPTION 'Posted depreciation (book %, %/%) cannot be deleted. Reverse it with a new posting.',
                OLD.book_id, OLD.fiscal_year, OLD.period USING ERRCODE = 'restrict_violation';
        END IF;
        RETURN OLD;
    END IF;
    -- UPDATE: a posted row may only gain a posting document / run date.
    IF OLD.posted AND (
           NEW.posted IS DISTINCT FROM true
        OR NEW.depreciation_amount IS DISTINCT FROM OLD.depreciation_amount
        OR NEW.opening_value       IS DISTINCT FROM OLD.opening_value
        OR NEW.closing_value       IS DISTINCT FROM OLD.closing_value
        OR NEW.book_id             IS DISTINCT FROM OLD.book_id
        OR NEW.fiscal_year         IS DISTINCT FROM OLD.fiscal_year
        OR NEW.period              IS DISTINCT FROM OLD.period
    ) THEN
        RAISE EXCEPTION 'Posted depreciation (book %, %/%) is immutable. Reverse it with a new posting.',
            OLD.book_id, OLD.fiscal_year, OLD.period USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.ers_guard_posted_depreciation() FROM public, anon;
DROP TRIGGER IF EXISTS zz_guard_posted_depreciation ON public.depreciation_schedules;
CREATE TRIGGER zz_guard_posted_depreciation
    BEFORE UPDATE OR DELETE ON public.depreciation_schedules
    FOR EACH ROW EXECUTE FUNCTION public.ers_guard_posted_depreciation();

-- A book, a financial record or an asset that carries posted depreciation is
-- history, not a draft: refuse the delete before the cascade can reach it.
CREATE OR REPLACE FUNCTION public.ers_refuse_delete_with_posted_depreciation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
    IF TG_TABLE_NAME = 'depreciation_books' THEN
        SELECT COUNT(*) INTO n FROM public.depreciation_schedules s WHERE s.book_id = OLD.id AND s.posted;
    ELSIF TG_TABLE_NAME = 'asset_financials' THEN
        SELECT COUNT(*) INTO n FROM public.depreciation_schedules s
          JOIN public.depreciation_books b ON b.id = s.book_id
         WHERE b.asset_financial_id = OLD.id AND s.posted;
    ELSE -- assets
        SELECT COUNT(*) INTO n FROM public.depreciation_schedules s
          JOIN public.depreciation_books b ON b.id = s.book_id
          JOIN public.asset_financials f ON f.id = b.asset_financial_id
         WHERE f.asset_id = OLD.id AND s.posted;
    END IF;
    IF n > 0 THEN
        RAISE EXCEPTION '% carries % posted depreciation period(s) and cannot be deleted. Deactivate or dispose of the asset instead.',
            TG_TABLE_NAME, n USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.ers_refuse_delete_with_posted_depreciation() FROM public, anon;
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['depreciation_books', 'asset_financials', 'assets'] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS aa_refuse_delete_posted_depreciation ON public.%I', t);
        EXECUTE format('CREATE TRIGGER aa_refuse_delete_posted_depreciation BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.ers_refuse_delete_with_posted_depreciation()', t);
    END LOOP;
END $$;

-- ── 7. Audit trail on the finance tables ────────────────────────────────────
-- cost_allocations is left out: settlement and stock movements write it in
-- volume and the ledger is itself the record.
DO $$
DECLARE
    t text;
    targets text[] := ARRAY[
        'budgets', 'budget_blocks', 'cost_centers', 'wbs_elements', 'journal_entries',
        'asset_financials', 'depreciation_books', 'depreciation_schedules', 'capital_events',
        'warranties', 'warranty_claims', 'asset_insurance', 'insurance_incidents'
    ];
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'public' AND p.proname = 'log_admin_audit_event') THEN
        RAISE NOTICE '0394: log_admin_audit_event (0373) absent — audit triggers skipped';
        RETURN;
    END IF;
    FOREACH t IN ARRAY targets LOOP
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
            EXECUTE format('DROP TRIGGER IF EXISTS audit_%1$s_finops ON public.%1$I', t);
            EXECUTE format(
                'CREATE TRIGGER audit_%1$s_finops
                 AFTER INSERT OR UPDATE OR DELETE ON public.%1$I
                 FOR EACH ROW EXECUTE FUNCTION public.log_admin_audit_event()', t);
        END IF;
    END LOOP;
END $$;

COMMIT;

-- VERIFY (run as the service role)
--   SELECT tablename, policyname, cmd FROM pg_policies
--    WHERE tablename IN ('warranties','warranty_claims','asset_insurance','insurance_incidents','asset_financials')
--    ORDER BY 1, 3;                     -- 4 policies each, none named authenticated_access
--   SELECT indexname FROM pg_indexes WHERE indexname LIKE 'uq_%' AND tablename IN ('asset_financials','depreciation_schedules','budgets');
--   SELECT COUNT(*) FILTER (WHERE posted) AS posted, COUNT(*) AS total FROM depreciation_schedules;  -- equal
--   SELECT tgname FROM pg_trigger WHERE tgname LIKE 'audit_%_finops';                                -- 13 rows
--   SELECT public.ers_refresh_budget_committed('00000000-0000-0000-0000-000000000000', <a cost centre>, 2026);
--     -- as an authenticated user of that tenant: raises insufficient_privilege (argument disagrees)
