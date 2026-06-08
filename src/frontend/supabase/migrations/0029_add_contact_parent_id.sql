-- 0029_ensure_contacts_columns.sql
-- Consolidated fix to ensure all required columns exist for the contacts table

ALTER TABLE contacts
ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES contacts(id),
ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS labor_rules JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS can_login BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS can_submit_requests BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS can_log_time BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS has_qualifications BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS organization_unit_id UUID REFERENCES organization_units(id);
