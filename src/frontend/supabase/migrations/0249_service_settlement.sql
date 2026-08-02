-- ═══════════════════════════════════════════════════════════════
-- 0249 — SERVICE joins LABOR and MATERIAL. The spine is whole.
--
-- The order-to-cost diagram has always had three inputs:
--
--   confirmations ──▶ actual labour    (0244)
--   goods issues  ──▶ actual material  (0244 + 0245)
--   services/PO   ──▶ actual service   ← this migration
--
-- Contractor and service-PO cost was the missing third. It could not be
-- modelled before 0248 because a service was an entry in a JSONB array
-- with nothing to reference and no type to distinguish it.
--
-- RECOGNITION POINT — the part worth getting right:
-- A SERVICE line never passes through stock, so no goods issue will ever
-- pick it up. Receiving the service IS the consumption — the same event
-- SAP records as a service entry sheet. So actual service cost is
-- qty_received x unit_cost, not qty_ordered: ordering a contractor is a
-- commitment, and the order-to-cost spine only ever posts what happened.
--
-- WHY A MATERIAL LINE ON THE SAME ORDER POSTS NOTHING HERE:
-- A material PO line is received into stock (101), then issued to the
-- order (261), and the issue is what makes it cost. Posting the PO line
-- as well would charge the order twice for one part. The guard is the
-- line_type filter — the same shape as the fi_posting guard in 0245.
--
--   MATERIAL line → stock → goods issue → work_order_parts → settles
--   SERVICE  line → straight to the order, on receipt → settles here
--
-- Rollback: restore the 0245 body of sem_wo_actual_lines.
-- ═══════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE VIEW public.sem_wo_actual_lines AS
SELECT s.work_order_id,
       s.cost_type,
       s.cost_center_id,
       ROUND(SUM(s.amount), 2)              AS amount,
       NULLIF(ROUND(SUM(s.quantity), 3), 0) AS quantity,
       MAX(s.unit)                          AS unit
FROM (
    -- ── LABOR confirmed against an operation → the operation's own receiver
    SELECT l.wo_id                                           AS work_order_id,
           'LABOR'::TEXT                                     AS cost_type,
           COALESCE(wc.cost_center_id, r.cost_center_id)     AS cost_center_id,
           SUM(COALESCE(l.hours_worked, 0)
               * COALESCE(NULLIF(l.rate_per_hour, 0), t.planned_rate, wc.activity_rate, 0)) AS amount,
           SUM(COALESCE(l.hours_worked, 0))                  AS quantity,
           'H'::TEXT                                         AS unit
    FROM public.work_order_labor l
    JOIN public.job_tasks       t ON t.id = l.job_task_id
    JOIN public.sem_wo_receiver r ON r.work_order_id = l.wo_id
    LEFT JOIN public.work_centers wc ON wc.id = t.work_center_id
    GROUP BY l.wo_id, COALESCE(wc.cost_center_id, r.cost_center_id)

    UNION ALL

    -- ── LABOR with no operation link → the order receiver, own rate only
    SELECT l.wo_id,
           'LABOR'::TEXT,
           r.cost_center_id,
           SUM(COALESCE(l.hours_worked, 0) * COALESCE(l.rate_per_hour, 0)),
           SUM(COALESCE(l.hours_worked, 0)),
           'H'::TEXT
    FROM public.work_order_labor l
    JOIN public.sem_wo_receiver r ON r.work_order_id = l.wo_id
    WHERE l.job_task_id IS NULL
    GROUP BY l.wo_id, r.cost_center_id

    UNION ALL

    -- ── MATERIAL: issued parts only (0245). A planned part is a commitment.
    SELECT p.wo_id,
           'MATERIAL'::TEXT,
           r.cost_center_id,
           SUM(COALESCE(p.quantity, 0) * COALESCE(p.unit_cost, 0)),
           NULL::NUMERIC,
           NULL::TEXT
    FROM public.work_order_parts p
    JOIN public.sem_wo_receiver r ON r.work_order_id = p.wo_id
    WHERE p.is_planned IS DISTINCT FROM TRUE
    GROUP BY p.wo_id, r.cost_center_id

    UNION ALL

    -- ── SERVICE: received service-PO lines carrying this order (0249).
    -- The line's own cost centre wins when it has one — a service can be
    -- charged somewhere other than the order's default receiver, which is
    -- precisely why the column exists on the line.
    SELECT pol.work_order_id,
           'SERVICE'::TEXT,
           COALESCE(pol.cost_center_id, r.cost_center_id),
           SUM(COALESCE(pol.qty_received, 0) * COALESCE(pol.unit_cost, 0)),
           SUM(COALESCE(pol.qty_received, 0)),
           MAX(pol.uom)
    FROM public.purchase_order_lines pol
    JOIN public.sem_wo_receiver r ON r.work_order_id = pol.work_order_id
    WHERE pol.work_order_id IS NOT NULL
      AND pol.line_type = 'SERVICE'
      AND COALESCE(pol.qty_received, 0) > 0
    GROUP BY pol.work_order_id, COALESCE(pol.cost_center_id, r.cost_center_id)
) s
GROUP BY s.work_order_id, s.cost_type, s.cost_center_id
HAVING ROUND(SUM(s.amount), 2) <> 0;

COMMENT ON VIEW public.sem_wo_actual_lines IS
    'Canonical actual cost per (work order, cost type, receiving cost center). LABOR = confirmed hours x posted rate. MATERIAL = ISSUED parts only. SERVICE = RECEIVED service-PO lines (0249) — ordering is a commitment, receipt is the cost. Mirrors DatabaseService.getOrderActuals; change both together.';

-- The catalog entry described a two-part definition. Keep it honest.
UPDATE public.semantic_catalog
   SET description = 'Confirmed labour (hours x the rate posted with the confirmation), issued parts (quantity x unit cost), and received service-PO lines. The settlement basis — the same definition the work order Cost tab displays. Ordering a part or a service is a commitment and is excluded; only issue and receipt are cost.'
 WHERE object_name = 'sem_wo_settlement'
   AND column_name = 'actual_cost';

COMMIT;
