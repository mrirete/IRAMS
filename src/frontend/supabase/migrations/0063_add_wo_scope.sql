-- Add scope column to work_orders for STANDARD vs PROJECT differentiation
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'STANDARD';

-- Add predecessor_task_id to job_tasks for PROJECT-scope dependency tracking
ALTER TABLE job_tasks ADD COLUMN IF NOT EXISTS predecessor_task_id UUID REFERENCES job_tasks(id) ON DELETE SET NULL;

-- Comment for auditability
COMMENT ON COLUMN work_orders.scope IS 'Work Order scope: STANDARD (simple sequential tasks) or PROJECT (shutdown/turnaround with task-level scheduling and dependencies)';
COMMENT ON COLUMN job_tasks.predecessor_task_id IS 'For PROJECT-scope WOs: the task that must complete before this one starts';
