-- ============================================================================
-- Migration: 0169_operations_layer
-- WM-2b (SAP PM) — turn job_tasks into numbered operations on costed work centers.
--
-- Additive/nullable columns only; existing tasks keep working (they simply have
-- no work center / operation number until edited). Feeds the WM-2c confirmation
-- roll-up and, downstream, FI-1 settlement.
--
--   operation_no    SAP-style operation number ('0010','0020'…), display = sequence*10.
--   work_center_id  the costed, capacity-bearing resource the operation runs at (0168).
--   control_key     PM01 = internal labour, PM02 = external/service (SAP control key).
--   planned_rate    per-operation cost/hour override of the work-center activity_rate.
-- ============================================================================

ALTER TABLE job_tasks
  ADD COLUMN IF NOT EXISTS operation_no   TEXT,
  ADD COLUMN IF NOT EXISTS work_center_id UUID REFERENCES work_centers(id),
  ADD COLUMN IF NOT EXISTS control_key    TEXT NOT NULL DEFAULT 'PM01',
  ADD COLUMN IF NOT EXISTS planned_rate   NUMERIC(12, 2);

COMMENT ON COLUMN job_tasks.operation_no   IS 'SAP operation number (0010, 0020…); display = sequence*10, editable';
COMMENT ON COLUMN job_tasks.work_center_id IS 'Costed/capacity work center the operation is performed at (SAP CR, table work_centers)';
COMMENT ON COLUMN job_tasks.control_key    IS 'SAP control key: PM01 internal labour, PM02 external/service';
COMMENT ON COLUMN job_tasks.planned_rate   IS 'Per-operation planned cost/hour; overrides work-center activity_rate';

CREATE INDEX IF NOT EXISTS idx_job_tasks_work_center_id ON job_tasks(work_center_id);

-- Backfill operation numbers for existing tasks (idempotent — only fills nulls):
-- operation_no = zero-padded (sequence*10), so sequence 1 -> '0010', 2 -> '0020'.
UPDATE job_tasks
   SET operation_no = LPAD((GREATEST(sequence, 0) * 10)::text, 4, '0')
 WHERE operation_no IS NULL;

-- Rollback:
--   ALTER TABLE job_tasks
--     DROP COLUMN IF EXISTS operation_no,
--     DROP COLUMN IF EXISTS work_center_id,
--     DROP COLUMN IF EXISTS control_key,
--     DROP COLUMN IF EXISTS planned_rate;
