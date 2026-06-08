-- Add job_task_id to work_order_labor
ALTER TABLE work_order_labor 
ADD COLUMN IF NOT EXISTS job_task_id UUID REFERENCES job_tasks(id) ON DELETE SET NULL;

-- Add job_task_id to work_order_parts
ALTER TABLE work_order_parts 
ADD COLUMN IF NOT EXISTS job_task_id UUID REFERENCES job_tasks(id) ON DELETE SET NULL;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_wo_labor_task_id ON work_order_labor(job_task_id);
CREATE INDEX IF NOT EXISTS idx_wo_parts_task_id ON work_order_parts(job_task_id);
