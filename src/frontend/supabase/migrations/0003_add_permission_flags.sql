-- Add missing permission columns to contacts table
ALTER TABLE contacts
ADD COLUMN IF NOT EXISTS can_login BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS can_submit_requests BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS can_log_time BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS has_qualifications BOOLEAN DEFAULT FALSE;

-- Backfill existing records
-- Assume existing employees can log time and submit requests
UPDATE contacts 
SET 
  can_submit_requests = TRUE,
  can_log_time = TRUE
WHERE is_employee = TRUE;

-- Assume everyone can at least login if they have a user account (handled by user link, but flag is good)
UPDATE contacts
SET can_login = TRUE
WHERE id IN (SELECT contact_id FROM users);
