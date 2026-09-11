-- ============================================================
-- 0359: a study outcome is recorded by whoever DID the thing.
--
-- 0357 gated ers_reliability_study_outcomes on reliability.edit/create, which
-- reads sensibly until you look at who actually actualises a recommendation:
--
--   STOREKEEPER  inventory.edit + reliability.VIEW   ← applies the min level
--   SUPERVISOR   inventory.edit + reliability.VIEW   ← same
--   RELIABILITY_ENG  reliability.edit + inventory.VIEW ← cannot apply it at all
--
-- So the one role that can change the stock level was the one role forbidden
-- from recording that it had. Verified on this tenant as J.Supervisor after
-- 0358: inventory_items UPDATE 200 (1 row), ers_agent_actions INSERT 201,
-- ers_reliability_study_outcomes INSERT **403**. The min level moved, the ROI
-- ledger logged it, and the study still read "no work produced yet" — the
-- exact dead-end the outcomes table exists to prevent. Worse, the client
-- swallowed the 403, so the person saw "Min level set ✓" and nothing else.
--
-- The rule below follows the work: you may record an outcome if you may do the
-- thing the outcome describes. Reliability editors keep blanket access; the
-- study must still be in the caller's tenant (unchanged from 0357).
-- ============================================================

BEGIN;

DROP POLICY IF EXISTS rel_outcome_insert ON public.ers_reliability_study_outcomes;

CREATE POLICY rel_outcome_insert ON public.ers_reliability_study_outcomes
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.ers_reliability_studies s
            WHERE s.id = study_id AND s.company_id = (SELECT public.caller_company())
        )
        AND (
            public.is_admin()
            -- Reliability editors own the study, so they may record anything on it.
            OR public.caller_can('reliability', 'edit')
            OR public.caller_can('reliability', 'create')
            -- …or you may record the outcome of work you are entitled to perform.
            OR (kind = 'spares' AND public.caller_can('inventory', 'edit'))
            OR (kind = 'pm'     AND (public.caller_can('pm', 'create') OR public.caller_can('pm', 'edit')))
            OR (kind = 'wo'     AND (public.caller_can('workOrders', 'create') OR public.caller_can('workOrders', 'edit')))
        )
    );

COMMENT ON POLICY rel_outcome_insert ON public.ers_reliability_study_outcomes IS
    '0359: an outcome may be recorded by a reliability editor, or by whoever holds the right to perform that kind of work (inventory.edit for a stock level, pm.create/edit for a PM, workOrders.create/edit for a work order). 0357''s reliability-only gate locked out the storekeeper, i.e. the only role that can actually apply a spares recommendation.';

COMMIT;
