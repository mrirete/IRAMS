-- 0341 — the cost ledger counts posted work, not planned work.
--
-- Found by the 2026-09-08 assurance run (P1-2): sem_wo_actual_lines summed
-- EVERY work_order_labor row — the planner's craft requirement lines
-- (headcount × est hours, no confirmation) and the technicians' posted
-- confirmations alike — so WO-2026-01001 froze 990.00 of labour against
-- 502.50 actually confirmed. Planned and posted rows share the table since
-- WM-2c; the confirmation number is what tells them apart.
--
-- • sem_wo_actual_lines: labour = rows WITH a confirmation_no only (same
--   columns, same receivers; sem_wo_settlement keeps working unchanged).
-- • sem_wo_planned_lines (new): the planner's basis — craft lines costed as
--   headcount × hours × rate, planned parts at planned quantity — for the
--   Cost tab's plan-vs-actual and for the readiness gates.

CREATE OR REPLACE VIEW public.sem_wo_actual_lines AS
 SELECT work_order_id,
    cost_type,
    cost_center_id,
    round(sum(amount), 2) AS amount,
    NULLIF(round(sum(quantity), 3), 0::numeric) AS quantity,
    max(unit) AS unit
   FROM ( SELECT l.wo_id AS work_order_id,
            'LABOR'::text AS cost_type,
            COALESCE(wc.cost_center_id, r.cost_center_id) AS cost_center_id,
            sum(COALESCE(l.hours_worked, 0::numeric) * COALESCE(NULLIF(l.rate_per_hour, 0::numeric), t.planned_rate, wc.activity_rate, 0::numeric)) AS amount,
            sum(COALESCE(l.hours_worked, 0::numeric)) AS quantity,
            'H'::text AS unit
           FROM work_order_labor l
             JOIN job_tasks t ON t.id = l.job_task_id
             JOIN sem_wo_receiver r ON r.work_order_id = l.wo_id
             LEFT JOIN work_centers wc ON wc.id = t.work_center_id
          WHERE l.confirmation_no IS NOT NULL
          GROUP BY l.wo_id, (COALESCE(wc.cost_center_id, r.cost_center_id))
        UNION ALL
         SELECT l.wo_id,
            'LABOR'::text,
            r.cost_center_id,
            sum(COALESCE(l.hours_worked, 0::numeric) * COALESCE(l.rate_per_hour, 0::numeric)),
            sum(COALESCE(l.hours_worked, 0::numeric)),
            'H'::text
           FROM work_order_labor l
             JOIN sem_wo_receiver r ON r.work_order_id = l.wo_id
          WHERE l.job_task_id IS NULL AND l.confirmation_no IS NOT NULL
          GROUP BY l.wo_id, r.cost_center_id
        UNION ALL
         SELECT p.wo_id,
            'MATERIAL'::text,
            r.cost_center_id,
            sum(COALESCE(p.quantity, 0::numeric) * COALESCE(p.unit_cost, 0::numeric)),
            NULL::numeric,
            NULL::text
           FROM work_order_parts p
             JOIN sem_wo_receiver r ON r.work_order_id = p.wo_id
          WHERE p.is_planned IS DISTINCT FROM true
          GROUP BY p.wo_id, r.cost_center_id
        UNION ALL
         SELECT pol.work_order_id,
            'SERVICE'::text,
            COALESCE(pol.cost_center_id, r.cost_center_id),
            sum(COALESCE(pol.qty_received, 0::numeric) * COALESCE(pol.unit_cost, 0::numeric)),
            sum(COALESCE(pol.qty_received, 0::numeric)),
            max(pol.uom)
           FROM purchase_order_lines pol
             JOIN sem_wo_receiver r ON r.work_order_id = pol.work_order_id
          WHERE pol.work_order_id IS NOT NULL AND pol.line_type = 'SERVICE'::text AND COALESCE(pol.qty_received, 0::numeric) > 0::numeric
          GROUP BY pol.work_order_id, (COALESCE(pol.cost_center_id, r.cost_center_id))) s
  GROUP BY work_order_id, cost_type, cost_center_id
 HAVING round(sum(amount), 2) <> 0::numeric;
ALTER VIEW public.sem_wo_actual_lines SET (security_invoker = true);

CREATE OR REPLACE VIEW public.sem_wo_planned_lines AS
 SELECT work_order_id, cost_type, round(sum(amount), 2) AS amount, NULLIF(round(sum(quantity), 3), 0::numeric) AS quantity, max(unit) AS unit
   FROM ( SELECT l.wo_id AS work_order_id,
            'LABOR'::text AS cost_type,
            sum(COALESCE(l.hours_worked, 0::numeric) * GREATEST(COALESCE(l.headcount, 1), 1)
                * COALESCE(NULLIF(l.rate_per_hour, 0::numeric), t.planned_rate, wc.activity_rate, 0::numeric)) AS amount,
            sum(COALESCE(l.hours_worked, 0::numeric) * GREATEST(COALESCE(l.headcount, 1), 1)) AS quantity,
            'H'::text AS unit
           FROM work_order_labor l
             LEFT JOIN job_tasks t ON t.id = l.job_task_id
             LEFT JOIN work_centers wc ON wc.id = t.work_center_id
          WHERE l.confirmation_no IS NULL
          GROUP BY l.wo_id
        UNION ALL
         SELECT p.wo_id, 'MATERIAL'::text,
            sum(COALESCE(p.quantity, 0::numeric) * COALESCE(p.unit_cost, 0::numeric)),
            sum(COALESCE(p.quantity, 0::numeric)),
            NULL::text
           FROM work_order_parts p
          WHERE p.is_planned IS NOT DISTINCT FROM true
          GROUP BY p.wo_id) s
  GROUP BY work_order_id, cost_type;
ALTER VIEW public.sem_wo_planned_lines SET (security_invoker = true);
GRANT SELECT ON public.sem_wo_planned_lines TO authenticated, service_role;

COMMENT ON VIEW public.sem_wo_actual_lines IS
    'Actual cost lines per work order and receiver. Labour = posted confirmations only (confirmation_no set); planned craft lines live in sem_wo_planned_lines (0341).';
COMMENT ON VIEW public.sem_wo_planned_lines IS
    'Planned cost basis per work order: craft lines as headcount × hours × rate, planned parts at planned quantity (0341).';

INSERT INTO public.semantic_catalog (object_name, column_name, title, description, tags, owner, source_tables, iso_standard)
VALUES ('sem_wo_planned_lines', NULL, 'Planned Work Order Cost',
        'The planner''s cost basis for a work order: craft requirement lines (headcount × estimated hours × resolved rate) and planned parts. Compare with sem_wo_actual_lines, which holds posted confirmations and issued materials only.',
        ARRAY['work_management','cost'], 'Maintenance', ARRAY['work_order_labor','work_order_parts'], 'SMRP 5.5')
ON CONFLICT DO NOTHING;
