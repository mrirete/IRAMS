-- NUCLEAR RESET SCRIPT for Recurring Work
-- This will DROP the existing table and recreate it fresh to ensure NO SCHEMA MISMATCH exists.

-- 1. Drop existing table (and any dependent constraints)
DROP TABLE IF EXISTS recurring_work CASCADE;

-- 2. Create Table with Hybrid/Mock Support (TEXT IDs)
CREATE TABLE recurring_work (
    id TEXT PRIMARY KEY,               -- Supports 'PM-1', 'uuid', etc.
    code TEXT UNIQUE NOT NULL,         -- 'PM-1001'
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'ACTIVE',
    
    -- Relaxed Foreign Keys (Mock Data Support)
    asset_id TEXT NOT NULL,            -- Can be 'a1' or real UUID
    
    -- Schedule
    schedule_type TEXT NOT NULL,       -- 'TIME', 'READING'
    frequency_interval INTEGER NOT NULL,
    frequency_unit TEXT NOT NULL,      -- 'Months', 'Weeks'
    lead_time_days INTEGER DEFAULT 7,
    
    -- Job Details
    job_type TEXT NOT NULL,            -- 'PM', 'CM'
    priority_code TEXT NOT NULL,
    est_duration INTEGER DEFAULT 0,
    est_downtime INTEGER DEFAULT 0,
    
    -- System
    last_generated_date TIMESTAMP WITH TIME ZONE,
    next_due_date TIMESTAMP WITH TIME ZONE,
    active BOOLEAN DEFAULT TRUE,
    created_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Indexes
CREATE INDEX idx_recurring_next_due ON recurring_work(next_due_date) WHERE active = TRUE;

-- 4. PERMISSIONS & SECURITY (Fixes 42501 or silent permission failures)
ALTER TABLE recurring_work ENABLE ROW LEVEL SECURITY;

-- Allow ALL operations for authenticated/anon users (MVP Public Mode)
-- In production, restrict this. For now, we just want it to WORK.
CREATE POLICY "Allow All Access" ON recurring_work
    FOR ALL
    USING (true)
    WITH CHECK (true);
