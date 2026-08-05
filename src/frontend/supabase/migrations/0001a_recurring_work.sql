-- Recurring Work / Preventive Maintenance Strategies
-- Relaxed Schema: Uses TEXT for IDs to support Mock Data (Hybrid Mode)
CREATE TABLE IF NOT EXISTS recurring_work (
    id TEXT PRIMARY KEY, -- Supports UUID or Mock IDs (e.g. 'pm-1')
    code TEXT UNIQUE NOT NULL, -- e.g. PM-1001
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'ACTIVE', -- ACTIVE, INACTIVE, DRAFT
    
    -- Linkage (No FK constraints to allow Mock Assets)
    asset_id TEXT NOT NULL,
    
    -- Schedule
    schedule_type TEXT NOT NULL, -- TIME, READING
    frequency_interval INTEGER NOT NULL,
    frequency_unit TEXT NOT NULL, -- Days, Weeks, Months, Hours, km
    lead_time_days INTEGER DEFAULT 7,
    
    -- Job Template Data
    job_type TEXT NOT NULL, -- PM, INSPECTION, CM
    priority_code TEXT NOT NULL,
    est_duration INTEGER DEFAULT 0,
    est_downtime INTEGER DEFAULT 0,
    
    -- Execution
    last_generated_date TIMESTAMP WITH TIME ZONE,
    next_due_date TIMESTAMP WITH TIME ZONE,
    
    active BOOLEAN DEFAULT TRUE,
    created_by TEXT, -- UUID or Username
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for efficient scheduling queries
CREATE INDEX IF NOT EXISTS idx_recurring_next_due ON recurring_work(next_due_date) WHERE active = TRUE;
