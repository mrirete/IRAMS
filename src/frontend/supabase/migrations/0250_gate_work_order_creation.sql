-- ════════════════════════════════════════════════════════════════════════════
-- 0250 — Who may create a work order
--
-- Completes the Notification → Order split. 0249 stopped condition alarms
-- raising orders and 9dbc240 stopped the raise-work selector offering them, so
-- nothing on a technician surface creates an order ad hoc any more. This makes
-- the database say so.
--
-- ── Why it is not simply caller_can('workOrders','create') ──────────────────
-- The writer sweep found generateWOFromPM called from Readings.tsx:396 and
-- Assets.tsx:3593 — both technician surfaces. A meter-based PM comes due while
-- someone is recording a reading, and the schedule raises its order there.
-- TECHNICIAN holds workOrders.edit but not create, so the obvious policy would
-- have broken condition-based maintenance.
--
-- That is not a permission problem, it is a question of who is acting. In SAP a
-- maintenance plan's scheduling call generates the order; the technician
-- recording the measurement is not creating work, they are tripping a due date.
-- The row records the difference — generateWOFromPM sets recurring_work_id —
-- so the policy can ask the question directly:
--
--     you may create a work order if your role allows it,
--     OR if the order comes from a maintenance schedule and you may see schedules.
--
-- Which lands where it should:
--     PLANNER / SUPERVISOR / MANAGER / RELIABILITY_ENG / admins  create anything
--     TECHNICIAN   schedule-raised orders only (pm.view, no workOrders.create)
--     EXECUTIVE    schedule-raised only — harmless, and honest
--     REQUESTER    nothing (pm: NO_ACCESS) — they raise requests, which is the point
--     INTERNAL     nothing
--
-- The alternative was moving PM generation into a SECURITY DEFINER RPC so it
-- runs as the system rather than the user. That is the cleaner long-term shape
-- and worth doing when PM scheduling becomes a background job, but it is a code
-- change; this expresses the same rule with the data already on the row.
--
-- ── UPDATE is unaffected ────────────────────────────────────────────────────
-- 0248 already gates it on workOrders.edit, which technicians hold — executing
-- and completing a job is their work and stays untouched.
-- ════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS p2_insert_work_orders   ON public.work_orders;
DROP POLICY IF EXISTS auth_insert_work_orders ON public.work_orders;
DROP POLICY IF EXISTS rbac_insert_work_orders ON public.work_orders;

CREATE POLICY rbac_insert_work_orders ON public.work_orders
    FOR INSERT TO authenticated
    WITH CHECK (
        (SELECT public.caller_can('workOrders', 'create'))
        OR (
            recurring_work_id IS NOT NULL
            AND (SELECT public.caller_can('pm', 'view'))
        )
    );

COMMENT ON TABLE public.work_orders IS
    'Orders. INSERT requires workOrders.create, OR pm.view when recurring_work_id is set — a maintenance schedule raising its own order is the system acting on a due date, not a person creating work (0250). UPDATE requires workOrders.edit (0248).';
