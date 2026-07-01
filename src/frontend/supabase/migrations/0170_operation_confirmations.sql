-- ============================================================================
-- Migration: 0170_operation_confirmations
-- WM-2c (SAP IW41/CO11) — operation-linked partial/final time confirmations.
--
-- The operation link already exists: work_order_labor.job_task_id -> job_tasks(id)
-- (added in 0071, indexed in 0113). This migration only adds the confirmation
-- semantics on top of it, additive/nullable:
--
--   is_final         a final confirmation closes the operation — its posting rolls
--                    the summed confirmed hours into job_tasks.actual_hours and sets
--                    the operation status = COMPLETED (done in the service layer).
--   confirmation_no  1,2,3… per operation (partial postings before the final).
--   remaining_hours  optional forecast-to-complete captured at confirmation time.
--
-- Existing labour rows are unaffected: is_final defaults false, the other two stay
-- null (an order-level labour line with no job_task_id, exactly as today).
--
-- Actual labour cost per operation = Σ(hours_worked × rate), where rate resolves
-- job_tasks.planned_rate ?? work_centers.activity_rate ?? work_order_labor.rate_per_hour.
-- ============================================================================

ALTER TABLE work_order_labor
  ADD COLUMN IF NOT EXISTS is_final        BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS confirmation_no INTEGER,
  ADD COLUMN IF NOT EXISTS remaining_hours NUMERIC(6, 2);

COMMENT ON COLUMN work_order_labor.is_final        IS 'Final confirmation — closes the linked operation and rolls summed hours into actual_hours';
COMMENT ON COLUMN work_order_labor.confirmation_no IS 'Sequential confirmation number per operation (1,2,3…)';
COMMENT ON COLUMN work_order_labor.remaining_hours IS 'Optional forecast-to-complete captured at confirmation time';

-- Rollback:
--   ALTER TABLE work_order_labor
--     DROP COLUMN IF EXISTS is_final,
--     DROP COLUMN IF EXISTS confirmation_no,
--     DROP COLUMN IF EXISTS remaining_hours;
