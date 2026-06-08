-- Create job_tasks table to persist Work Order assignments and steps
CREATE TABLE job_tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wo_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL DEFAULT 0,
    description TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
    
    -- Estimations
    est_hours NUMERIC(5, 2) DEFAULT 0,
    est_start_date DATE,
    est_finish_date DATE,
    est_start_time TIME,
    est_finish_time TIME,

    -- Actuals
    actual_hours NUMERIC(5, 2),
    actual_start_date DATE,
    actual_finish_date DATE,
    actual_start_time TIME,
    actual_finish_time TIME,

    -- Instructions (JSON array of {id, type, label, required, value})
    instructions JSONB DEFAULT '[]'::JSONB,

    -- Assignments (Arrays of UUIDs)
    assigned_user_ids JSONB DEFAULT '[]'::JSONB,
    assigned_org_unit_ids JSONB DEFAULT '[]'::JSONB,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS Policies
ALTER TABLE job_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable all for authenticated" ON job_tasks
    FOR ALL USING (auth.role() = 'authenticated');

-- Audit Trigger
CREATE TRIGGER audit_job_tasks_changes
    AFTER INSERT OR UPDATE OR DELETE ON job_tasks
    FOR EACH ROW EXECUTE FUNCTION log_audit_event();
