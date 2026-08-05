-- --- CONTACTS EXPANSION ---

-- 1. Add JSONB columns to existing contacts table
ALTER TABLE contacts 
ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS labor_rules JSONB DEFAULT '{}';

-- 2. Manufacturer Models Table
CREATE TABLE IF NOT EXISTS manufacturer_models (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    model_code TEXT NOT NULL,
    description TEXT,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS & Audit
ALTER TABLE manufacturer_models ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all for authenticated" ON manufacturer_models FOR ALL USING (auth.role() = 'authenticated');

CREATE TRIGGER audit_models_changes
AFTER INSERT OR UPDATE OR DELETE ON manufacturer_models
FOR EACH ROW EXECUTE FUNCTION log_audit_event();


-- 3. Qualifications Table
CREATE TABLE IF NOT EXISTS qualifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT, -- Dictionary Code (QUALIFICATION_TYPE)
    date_achieved DATE,
    date_expires DATE,
    status TEXT DEFAULT 'Active', -- Active, Expired, Pending
    image_url TEXT, -- Link to certificate scan
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS & Audit
ALTER TABLE qualifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all for authenticated" ON qualifications FOR ALL USING (auth.role() = 'authenticated');

CREATE TRIGGER audit_qualifications_changes
AFTER INSERT OR UPDATE OR DELETE ON qualifications
FOR EACH ROW EXECUTE FUNCTION log_audit_event();


-- 4. Entity Files (Polymorphic Attachment Table)
-- Can be used for Contacts, Assets, Work Orders, etc.
CREATE TABLE IF NOT EXISTS entity_files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_id UUID NOT NULL, -- Logical Link (Manual FK)
    entity_type TEXT NOT NULL, -- 'CONTACT', 'ASSET', 'WO', 'REQ'
    
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    type TEXT, -- MIME type or file extension
    size_bytes BIGINT,
    
    uploaded_by UUID REFERENCES users(id), -- Optional, if we track uploader
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS & Audit
ALTER TABLE entity_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all for authenticated" ON entity_files FOR ALL USING (auth.role() = 'authenticated');

CREATE TRIGGER audit_files_changes
AFTER INSERT OR UPDATE OR DELETE ON entity_files
FOR EACH ROW EXECUTE FUNCTION log_audit_event();
