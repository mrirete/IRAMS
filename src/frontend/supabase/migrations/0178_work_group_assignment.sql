-- 0178 — Assign a work group (work center) to requests, work orders, and PMs.
-- Routes work to a responsible crew/team, not just an individual (assigned_to).
-- Mirrors the existing job_tasks.work_center_id. ON DELETE SET NULL so retiring a
-- work centre never orphans history. Nullable → backwards compatible.
-- Atomic: Supabase's SQL editor runs statements individually, so wrap in a txn.
BEGIN;

ALTER TABLE service_requests
    ADD COLUMN IF NOT EXISTS work_center_id UUID REFERENCES work_centers(id) ON DELETE SET NULL;
ALTER TABLE work_orders
    ADD COLUMN IF NOT EXISTS work_center_id UUID REFERENCES work_centers(id) ON DELETE SET NULL;
ALTER TABLE recurring_work
    ADD COLUMN IF NOT EXISTS work_center_id UUID REFERENCES work_centers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_service_requests_work_center ON service_requests(work_center_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_work_center ON work_orders(work_center_id);
CREATE INDEX IF NOT EXISTS idx_recurring_work_work_center ON recurring_work(work_center_id);

COMMENT ON COLUMN service_requests.work_center_id IS 'Responsible work group (work_centers.id). NULL = unassigned.';
COMMENT ON COLUMN work_orders.work_center_id IS 'Responsible work group (work_centers.id). NULL = unassigned.';
COMMENT ON COLUMN recurring_work.work_center_id IS 'Responsible work group (work_centers.id). NULL = unassigned.';

COMMIT;
