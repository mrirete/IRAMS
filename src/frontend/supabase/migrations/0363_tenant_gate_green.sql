-- 0363 — Close the 11 findings the G4 tenant-completeness gate reports
-- ═══════════════════════════════════════════════════════════════════════════
-- tests/rls/tenant-completeness.mjs (public.tenancy_policy_gaps(), 0264/0270)
-- was RED on 2026-09-15 with 11 gaps. Read verbatim, they are two things:
--
-- A. EIGHT policies written after 0270 as `company_id = caller_company()`
--    instead of the canonical `company_id = (SELECT caller_company())`:
--      asset_replacements        ar_insert, ar_select
--      audit_maturity_snapshots  ams_insert, ams_select, ams_delete
--      org_context               org_context_insert, _select, _update
--    Semantically they bind (a NULL tenant hides every row), so no data was
--    exposed — but the bare form is evaluated per row instead of once as an
--    InitPlan, and the gate only trusts the canonical shape. Rewritten.
--
-- B. THREE INSERT policies that check role/scope but never the row's own
--    company_id:
--      ers_rcm_breakdown_templates   rcm_insert_ers_rcm_breakdown_templates
--      ers_rcm_study_templates       rcm_insert_ers_rcm_study_templates
--      ers_reliability_study_outcomes rel_outcome_insert
--    stamp_tenant() fills company_id only when the client leaves it NULL; a
--    client that supplies another tenant's id keeps it. So an authenticated
--    user in tenant A could insert a template, or a study outcome, tagged to
--    tenant B — which B then sees. Not a read leak; cross-tenant data
--    poisoning, which is the door the gate exists to catch. The tenant test is
--    now the FIRST conjunct of each WITH CHECK; nothing else about them changed.
--
-- The migration ends by asking the gate itself, and refuses to commit while
-- it reports anything.

BEGIN;

-- ── A. Canonical form ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS ar_insert ON public.asset_replacements;
CREATE POLICY ar_insert ON public.asset_replacements
    FOR INSERT TO authenticated
    WITH CHECK (company_id = (SELECT public.caller_company()));

DROP POLICY IF EXISTS ar_select ON public.asset_replacements;
CREATE POLICY ar_select ON public.asset_replacements
    FOR SELECT TO authenticated
    USING (company_id = (SELECT public.caller_company()));

DROP POLICY IF EXISTS ams_insert ON public.audit_maturity_snapshots;
CREATE POLICY ams_insert ON public.audit_maturity_snapshots
    FOR INSERT TO authenticated
    WITH CHECK (company_id = (SELECT public.caller_company()));

DROP POLICY IF EXISTS ams_select ON public.audit_maturity_snapshots;
CREATE POLICY ams_select ON public.audit_maturity_snapshots
    FOR SELECT TO authenticated
    USING (company_id = (SELECT public.caller_company()));

DROP POLICY IF EXISTS ams_delete ON public.audit_maturity_snapshots;
CREATE POLICY ams_delete ON public.audit_maturity_snapshots
    FOR DELETE TO authenticated
    USING (company_id = (SELECT public.caller_company()) AND public.is_admin());

DROP POLICY IF EXISTS org_context_insert ON public.org_context;
CREATE POLICY org_context_insert ON public.org_context
    FOR INSERT TO authenticated
    WITH CHECK (company_id = (SELECT public.caller_company()));

DROP POLICY IF EXISTS org_context_select ON public.org_context;
CREATE POLICY org_context_select ON public.org_context
    FOR SELECT TO authenticated
    USING (company_id = (SELECT public.caller_company()));

DROP POLICY IF EXISTS org_context_update ON public.org_context;
CREATE POLICY org_context_update ON public.org_context
    FOR UPDATE TO authenticated
    USING (company_id = (SELECT public.caller_company()))
    WITH CHECK (company_id = (SELECT public.caller_company()));

-- ── B. The row must belong to the caller's tenant ─────────────────────────
DROP POLICY IF EXISTS rcm_insert_ers_rcm_breakdown_templates ON public.ers_rcm_breakdown_templates;
CREATE POLICY rcm_insert_ers_rcm_breakdown_templates ON public.ers_rcm_breakdown_templates
    FOR INSERT TO authenticated
    WITH CHECK (
        company_id = (SELECT public.caller_company())
        AND scope = 'tenant'
        AND (public.is_admin() OR public.caller_can('reliability', 'edit') OR public.caller_can('reliability', 'create'))
    );

DROP POLICY IF EXISTS rcm_insert_ers_rcm_study_templates ON public.ers_rcm_study_templates;
CREATE POLICY rcm_insert_ers_rcm_study_templates ON public.ers_rcm_study_templates
    FOR INSERT TO authenticated
    WITH CHECK (
        company_id = (SELECT public.caller_company())
        AND scope = 'tenant'
        AND (public.is_admin() OR public.caller_can('reliability', 'edit') OR public.caller_can('reliability', 'create'))
    );

DROP POLICY IF EXISTS rel_outcome_insert ON public.ers_reliability_study_outcomes;
CREATE POLICY rel_outcome_insert ON public.ers_reliability_study_outcomes
    FOR INSERT TO authenticated
    WITH CHECK (
        company_id = (SELECT public.caller_company())
        AND EXISTS (
            SELECT 1 FROM public.ers_reliability_studies s
             WHERE s.id = ers_reliability_study_outcomes.study_id
               AND s.company_id = (SELECT public.caller_company())
        )
        AND (
            public.is_admin()
            OR public.caller_can('reliability', 'edit')
            OR public.caller_can('reliability', 'create')
            OR (kind = 'spares' AND public.caller_can('inventory', 'edit') AND ref_id IS NOT NULL
                AND EXISTS (SELECT 1 FROM public.inventory_items i WHERE i.id::text = ers_reliability_study_outcomes.ref_id))
            OR (kind = 'pm' AND (public.caller_can('pm', 'create') OR public.caller_can('pm', 'edit')) AND ref_id IS NOT NULL
                AND EXISTS (SELECT 1 FROM public.recurring_work rw WHERE rw.id = ers_reliability_study_outcomes.ref_id))
            OR (kind = 'wo' AND (public.caller_can('workOrders', 'create') OR public.caller_can('workOrders', 'edit')) AND ref_id IS NOT NULL
                AND EXISTS (SELECT 1 FROM public.work_orders w WHERE w.id::text = ers_reliability_study_outcomes.ref_id))
        )
    );

-- ── Ask the gate ───────────────────────────────────────────────────────────
DO $$
DECLARE n int; sample text;
BEGIN
    SELECT count(*), min(object_name) INTO n, sample FROM public.tenancy_policy_gaps();
    IF n > 0 THEN
        RAISE EXCEPTION 'G4 still reports % gap(s), e.g. % — refusing to commit', n, sample;
    END IF;
END $$;

COMMIT;

-- VERIFY (after apply):
--   node tests/rls/tenant-completeness.mjs     -- expect "G4 GREEN"
