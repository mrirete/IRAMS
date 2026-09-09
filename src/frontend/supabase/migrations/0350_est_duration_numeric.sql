-- 0350 — est_duration was an integer: three steps at 1 + 4 + 1.5 h rolled up
-- to "7". Hours are decimal everywhere else on the order (actual_duration_hrs,
-- est_downtime_hrs, job_tasks.est_hours, work_order_labor.hours_worked).
-- sem_work_orders projects the column, so it is dropped and recreated
-- verbatim around the type change (security_invoker, comment and grants kept).

DROP VIEW IF EXISTS public.sem_work_orders;

ALTER TABLE public.work_orders
    ALTER COLUMN est_duration TYPE numeric(8,2) USING est_duration::numeric;

CREATE VIEW public.sem_work_orders WITH (security_invoker = true) AS
SELECT id,
    wo_number,
    title,
    status,
    type,
    priority_code,
    asset_id,
    request_id,
    parent_wo_id,
    cost_frozen,
    frozen_labor_cost,
    frozen_material_cost,
    created_by,
    created_at,
    updated_at,
    closed_at,
    description,
    cost_center,
    due_date,
    date_due_start,
    assigned_to,
    cost_center_id,
    properties,
    total_actual_cost,
    frozen_total_cost,
    reviewed_by,
    reviewed_at,
    review_notes,
    est_duration,
    scope,
    actual_downtime_hrs,
    failure_mode,
    failure_code,
    recurring_work_id,
    warranty_flag,
    warranty_id,
    warranty_claim_id,
    work_center_id,
    import_batch_id,
    ers_wo_state(status::text) AS wo_state,
    ers_wo_state(status::text) = ANY (ARRAY['open'::text, 'unknown'::text]) AS is_open,
    ers_wo_state(status::text) = 'done'::text AS is_done
   FROM work_orders w
  WHERE company_id = (( SELECT caller_company() AS caller_company));

COMMENT ON VIEW public.sem_work_orders IS 'Canonical work-order projection. Tenant-filtered since 0261 — it runs with DEFINER semantics, so without that filter it is a cross-tenant window.';
GRANT ALL ON public.sem_work_orders TO postgres, service_role;
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.sem_work_orders TO authenticated;

-- Re-run the 0349 estimate roll-up now that halves survive.
UPDATE public.work_orders w
   SET est_duration = s.h
  FROM (SELECT wo_id, sum(est_hours) h FROM public.job_tasks GROUP BY wo_id) s
 WHERE s.wo_id = w.id AND s.h > 0;
