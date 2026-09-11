-- ============================================================
-- 0360: an outcome must point at a record that exists.
--
-- 0359 let people record the outcome of work they are entitled to perform,
-- which fixed the storekeeper being locked out of their own spares decision.
-- A negative test then showed the cost of that rule taken alone: a TECHNICIAN
-- holds workOrders.create, so they could POST a kind='wo' outcome — with any
-- ref_label and no ref_id at all — onto ANY study in the tenant. A study could
-- be made to display "→ WO-1234 raised" for work that never existed, and that
-- same row silences the workspace's "nothing has left this study as work yet"
-- warning ahead of review.
--
-- RLS cannot prove the caller performed the work. It CAN insist the outcome
-- names a real record the caller is allowed to see — which is how the client
-- always writes it (a confirmed inventory_items id, a created recurring_work
-- id), and which turns a free-text claim into a checkable reference. The
-- subqueries run under the caller's own RLS, so a reference to another
-- tenant's record does not resolve either.
--
-- Outcomes that legitimately have no id — "sent to an RCM study", "raised an
-- investigation" — stay open only to reliability editors, who own the study.
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
            -- The study's own editors may record anything on it, ref or no ref.
            OR public.caller_can('reliability', 'edit')
            OR public.caller_can('reliability', 'create')
            -- Otherwise: you may record the outcome of work you are entitled to
            -- perform, AND the outcome must name a record that really exists
            -- and that you can see.
            OR (
                kind = 'spares'
                AND public.caller_can('inventory', 'edit')
                AND ref_id IS NOT NULL
                AND EXISTS (SELECT 1 FROM public.inventory_items i WHERE i.id::text = ref_id)
            )
            OR (
                kind = 'pm'
                AND (public.caller_can('pm', 'create') OR public.caller_can('pm', 'edit'))
                AND ref_id IS NOT NULL
                AND EXISTS (SELECT 1 FROM public.recurring_work rw WHERE rw.id::text = ref_id)
            )
            OR (
                kind = 'wo'
                AND (public.caller_can('workOrders', 'create') OR public.caller_can('workOrders', 'edit'))
                AND ref_id IS NOT NULL
                AND EXISTS (SELECT 1 FROM public.work_orders w WHERE w.id::text = ref_id)
            )
        )
    );

COMMENT ON POLICY rel_outcome_insert ON public.ers_reliability_study_outcomes IS
    '0360: a study outcome is recorded by a reliability editor, or by whoever may perform that kind of work AND names a real, visible record of it (inventory_items / recurring_work / work_orders). Reference-less outcomes (rcm, rca) stay with reliability editors — 0359 alone let any workOrders.create holder post a label-only "wo" outcome onto any study.';

COMMIT;
