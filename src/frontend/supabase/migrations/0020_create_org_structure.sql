-- 0020_create_org_structure.sql

-- 1. Create Organization Units Table
CREATE TABLE organization_units (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('DIVISION', 'GROUP', 'TEAM')),
    parent_id UUID REFERENCES organization_units(id) ON DELETE CASCADE,
    manager_id UUID, -- Circular FK to contacts, added later to avoid issues or loose coupling
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS
ALTER TABLE organization_units ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all for authenticated" ON organization_units FOR ALL USING (auth.role() = 'authenticated');

-- Audit
CREATE TRIGGER audit_org_units_changes
AFTER INSERT OR UPDATE OR DELETE ON organization_units
FOR EACH ROW EXECUTE FUNCTION log_audit_event();

-- 2. Update Contacts to link to Organization Unit
ALTER TABLE contacts
ADD COLUMN organization_unit_id UUID REFERENCES organization_units(id);

-- Optional: Migrate existing 'department' string to new structure?
-- For now, we keep the string column as legacy/fallback until full cutover.

-- 3. Update dictionary permissions (if needed) - typically handled in constants/seed
-- But we might want to ensure 'manager_id' can be linked.
-- FK constraint for manager_id added safely (nullable)
-- ALTER TABLE organization_units ADD CONSTRAINT fk_org_manager FOREIGN KEY (manager_id) REFERENCES contacts(id);
