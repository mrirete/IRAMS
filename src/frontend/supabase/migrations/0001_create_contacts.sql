-- --- TABLE: contacts ---
CREATE TABLE contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id), -- Link to User (if applicable)
    
    code TEXT UNIQUE NOT NULL, -- Employee ID / Vendor Code
    name TEXT NOT NULL, -- Display Name
    first_name TEXT,
    last_name TEXT,
    
    email TEXT,
    phone TEXT,
    mobile TEXT,
    
    title TEXT, -- Job Title
    
    -- Organization
    company_name TEXT, -- For Vendors
    department TEXT,
    cost_center TEXT,
    
    -- Attributes
    is_active BOOLEAN DEFAULT TRUE,
    is_vendor BOOLEAN DEFAULT FALSE,
    is_employee BOOLEAN DEFAULT TRUE,
    
    -- Roles (Array of Dictionary Codes)
    roles TEXT[] DEFAULT '{}',
    
    -- Financials for Labor
    hourly_rate NUMERIC(10, 2) DEFAULT 0,
    currency TEXT DEFAULT 'USD',
    
    address JSONB,
    billing_address JSONB,
    
    image_url TEXT,
    comments TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Audit Trigger
CREATE TRIGGER audit_contacts_changes
AFTER INSERT OR UPDATE OR DELETE ON contacts
FOR EACH ROW EXECUTE FUNCTION log_audit_event();

-- RLS
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all for authenticated" ON contacts FOR ALL USING (auth.role() = 'authenticated');

-- --- UPDATE: users ---
-- Add FK constraint now that table exists (if not already there)
-- ALTER TABLE users ADD CONSTRAINT fk_user_contact FOREIGN KEY (contact_id) REFERENCES contacts(id);
-- (Supabase might have issues with circular deps if we enforce strict FK right away without careful ordering, strictly simpler to keep soft link or alter later)

-- --- TABLE: journal_entries (Generic for History) ---
CREATE TABLE journal_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_id UUID NOT NULL, -- Polymorphic Link (Asset ID, Contact ID, etc)
    entity_type TEXT NOT NULL, -- 'ASSET', 'CONTACT', 'WO'
    
    entry_type TEXT NOT NULL, -- 'NOTE', 'HISTORY', 'STATUS'
    entry TEXT NOT NULL,
    
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_system BOOLEAN DEFAULT FALSE
);

ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all for authenticated" ON journal_entries FOR ALL USING (auth.role() = 'authenticated');
