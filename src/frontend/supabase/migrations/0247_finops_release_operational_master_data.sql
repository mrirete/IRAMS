-- ════════════════════════════════════════════════════════════════════════════
-- 0247 — Release cost_centers and cost_allocations from the finops read gate
--
-- 0246 gated nine finance tables on caller_can('finops','view'). Two of them
-- are not finance-module data at all — they are operational master data
-- referenced from work management:
--
--   cost_centers      WorkOrders.tsx (FinOpsService.getCostCenters) and
--                     WorkCentersPage.tsx. A planner assigns a cost centre to a
--                     work order; that is costing work, not finance-module
--                     access.
--   cost_allocations  WorkOrders.tsx (getCostAllocations, settleWorkOrder) —
--                     the settlement lines added by 0244.
--
-- PLANNER, SUPERVISOR and TECHNICIAN all hold workOrders access and finops:
-- NO_ACCESS, so 0246 emptied their cost-centre dropdown with no message. The
-- database is shared with the deployed app, so that was live the moment the
-- migration ran.
--
-- This is the failure mode the plan's reader sweep exists to prevent, and it is
-- the second time in one migration: the same sweep is why purchase_orders and
-- vendors were already held back. The lesson is that "sounds like finance" is
-- not a reader analysis. `depreciation_books`, `capital_events`, `budgets`,
-- `budget_blocks`, `depreciation_schedules`, `journal_entries` and
-- `wbs_elements` are only ever read from the FinOps page and the asset
-- Financials tab, so those stay gated.
--
-- Gating cost_centers properly means a separate permission (it is referenced by
-- work management, so it belongs to that surface) — deferred rather than
-- guessed at.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['cost_centers', 'cost_allocations'] LOOP
        EXECUTE format('DROP POLICY IF EXISTS finops_select_%s ON public.%I', t, t);
        -- Back to what it was before 0246: readable by any authenticated user.
        EXECUTE format($p$
            CREATE POLICY finops_select_%s ON public.%I
            FOR SELECT TO authenticated USING (true)$p$, t, t);
    END LOOP;
END $$;

COMMENT ON TABLE public.cost_centers IS
    'Operational master data, referenced from work orders and work centres — NOT gated on finops (0247, reverting 0246). Gating it needs a work-management permission, not a finance one.';

COMMENT ON TABLE public.cost_allocations IS
    'Work-order settlement lines, read and written from the work-order page — not gated on finops (0247, reverting 0246).';
