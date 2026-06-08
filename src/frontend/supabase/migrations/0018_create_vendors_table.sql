-- Create Vendors Table
CREATE TABLE IF NOT EXISTS vendors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('VENDOR', 'MANUFACTURER', 'SUPPLIER')),
    active BOOLEAN DEFAULT true,
    
    -- Financials
    payment_terms TEXT,
    currency TEXT DEFAULT 'USD',
    hourly_rate NUMERIC(10, 2),
    
    -- Contact Details (JSONB for flexibility: address, phone, email, etc.)
    contact_details JSONB,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;

-- Create Policies (Mirroring Contacts for now, strictly controlled via application logic usually, but good to have DB level)
CREATE POLICY "Enable read access for authenticated users" ON vendors
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Enable all access for valid users" ON vendors
    FOR ALL USING (auth.role() = 'authenticated');

-- Data Migration: Move existing VENDOR/MANUFACTURER contacts to vendors table
-- Note: This is a one-time operation.
INSERT INTO vendors (id, name, code, type, active, hourly_rate, contact_details)
SELECT 
    id,
    name,
    code,
    'VENDOR', -- Default mapping, or logic below
    is_active,
    hourly_rate,
    jsonb_build_object(
        'email', email,
        'phone', phone,
        'mobile', mobile,
        'title', title,
        'address', address
    )
FROM contacts
WHERE 'VENDOR' = ANY(roles) OR 'MANUFACTURER' = ANY(roles);

-- Update the type correctly based on the array
UPDATE vendors
SET type = 'MANUFACTURER'
WHERE id IN (
    SELECT id FROM contacts WHERE 'MANUFACTURER' = ANY(roles)
);

-- NOTE: We are NOT deleting from contacts yet to prevent breaking FKs in other tables (PO, Inventory).
-- In a real scenario, we would update foreign keys in purchase_orders and inventory_suppliers to point to vendors.id or use a polymorphic relation.
-- For this step, we establish the table. The application will need to handle the duality or switch to using this table.
