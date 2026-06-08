-- 0022_update_org_unit_fields.sql

-- Add new columns for Org Unit Details
ALTER TABLE organization_units
ADD COLUMN IF NOT EXISTS description TEXT,
ADD COLUMN IF NOT EXISTS location TEXT,
ADD COLUMN IF NOT EXISTS email TEXT,
ADD COLUMN IF NOT EXISTS phone TEXT,
ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '[]'::JSONB;

-- Ideally we would have 'budget' or 'cost_center_ref' here too, 
-- but custom_fields can handle ad-hoc budget for now.
