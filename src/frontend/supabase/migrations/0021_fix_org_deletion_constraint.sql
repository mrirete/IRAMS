-- 0021_fix_org_deletion_constraint.sql

-- Drop existing constraint
ALTER TABLE contacts
DROP CONSTRAINT IF EXISTS contacts_organization_unit_id_fkey;

-- Add new constraint with ON DELETE SET NULL
ALTER TABLE contacts
ADD CONSTRAINT contacts_organization_unit_id_fkey
FOREIGN KEY (organization_unit_id)
REFERENCES organization_units(id)
ON DELETE SET NULL;
