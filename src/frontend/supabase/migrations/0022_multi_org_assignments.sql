-- 0022_multi_org_assignments.sql

-- 1. Create Organization Unit Members Table (Many-to-Many)
CREATE TABLE organization_unit_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_unit_id UUID NOT NULL REFERENCES organization_units(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    is_primary BOOLEAN DEFAULT false,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure unique pair to prevent duplicates
    UNIQUE(organization_unit_id, contact_id)
);

-- 2. RLS Policies
ALTER TABLE organization_unit_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable all for authenticated" ON organization_unit_members 
    FOR ALL USING (auth.role() = 'authenticated');

-- 3. Audit Trigger
CREATE TRIGGER audit_org_members_changes
AFTER INSERT OR UPDATE OR DELETE ON organization_unit_members
FOR EACH ROW EXECUTE FUNCTION log_audit_event();

-- 4. Backfill existing data
-- Migrate data from the single 'organization_unit_id' column in 'contacts' to this new table
INSERT INTO organization_unit_members (organization_unit_id, contact_id, is_primary)
SELECT organization_unit_id, id, true
FROM contacts
WHERE organization_unit_id IS NOT NULL;
