-- Migration: Make failure_cause_code and remedy_code nullable in wo_failure_data
-- Reason: Only Failure Mode is mandatory for CM/corrective work orders.
--   Failure Cause and Remedy are optional fields. The original schema had them as NOT NULL,
--   which silently blocks the upsert when only Failure Mode is provided.
-- Also adds updated_at column for tracking last modification.

ALTER TABLE wo_failure_data
    ALTER COLUMN failure_cause_code DROP NOT NULL,
    ALTER COLUMN remedy_code DROP NOT NULL;

-- Add updated_at column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'wo_failure_data' AND column_name = 'updated_at'
    ) THEN
        ALTER TABLE wo_failure_data ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
    END IF;
END $$;
