-- Create Warranties Table
CREATE TABLE IF NOT EXISTS warranties (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL, -- Optional link to vendor
    warranty_type TEXT NOT NULL, -- 'OEM', 'EXTENDED', 'SERVICE_CONTRACT'
    coverage_scope TEXT,
    start_date DATE NOT NULL,
    end_date DATE,
    max_hours NUMERIC,
    current_hours NUMERIC DEFAULT 0,
    status TEXT DEFAULT 'ACTIVE', -- 'ACTIVE', 'EXPIRED', 'voided'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create Warranty Claims Table
CREATE TABLE IF NOT EXISTS warranty_claims (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    claim_number TEXT NOT NULL,
    warranty_id UUID NOT NULL REFERENCES warranties(id) ON DELETE CASCADE,
    work_order_id UUID REFERENCES work_orders(id) ON DELETE SET NULL, -- Link to WO that generated the claim
    claim_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    failure_description TEXT,
    claim_type TEXT NOT NULL, -- 'REPAIR', 'REPLACEMENT', 'CREDIT'
    total_claim_amount NUMERIC DEFAULT 0,
    status TEXT DEFAULT 'DRAFT', -- 'DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create Asset Insurance Table
CREATE TABLE IF NOT EXISTS asset_insurance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    policy_number TEXT NOT NULL,
    provider TEXT NOT NULL,
    coverage_type TEXT, -- 'ALL_RISK', 'FIRE', 'THEFT', 'LIABILITY'
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    premium_amount NUMERIC DEFAULT 0,
    insured_value NUMERIC DEFAULT 0,
    deductible NUMERIC DEFAULT 0,
    status TEXT DEFAULT 'ACTIVE',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create Insurance Incidents Table
CREATE TABLE IF NOT EXISTS insurance_incidents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    incident_number TEXT NOT NULL,
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    insurance_policy_id UUID REFERENCES asset_insurance(id) ON DELETE SET NULL,
    work_order_id UUID REFERENCES work_orders(id) ON DELETE SET NULL,
    incident_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    incident_type TEXT NOT NULL, -- 'BREAKDOWN', 'FIRE', 'ACCIDENT'
    description TEXT,
    estimated_damage NUMERIC DEFAULT 0,
    labor_cost NUMERIC DEFAULT 0,
    material_cost NUMERIC DEFAULT 0,
    third_party_cost NUMERIC DEFAULT 0,
    total_cost NUMERIC DEFAULT 0,
    claim_status TEXT DEFAULT 'OPEN', -- 'OPEN', 'SUBMITTED', 'SETTLED', 'CLOSED'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE warranties ENABLE ROW LEVEL SECURITY;
ALTER TABLE warranty_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_insurance ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_incidents ENABLE ROW LEVEL SECURITY;

-- Create Policies (Open for now, similar to other tables in development)
CREATE POLICY "Enable all access for authenticated users" ON warranties FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Enable all access for authenticated users" ON warranty_claims FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Enable all access for authenticated users" ON asset_insurance FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Enable all access for authenticated users" ON insurance_incidents FOR ALL USING (auth.role() = 'authenticated');

-- Triggers for Updated At
--
-- FIXED 2026-07-25: update_modified_column() was never defined by any
-- migration, so all four triggers below silently failed to be created — on the
-- origin project as well as on replay — and updated_at never moved on these
-- tables. Defined here (idempotently; 0026 also defines it) so the file is
-- self-sufficient. Migration 0224 repairs already-deployed databases.
CREATE OR REPLACE FUNCTION public.update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_warranties_modtime ON warranties;
CREATE TRIGGER update_warranties_modtime BEFORE UPDATE ON warranties FOR EACH ROW EXECUTE PROCEDURE public.update_modified_column();
DROP TRIGGER IF EXISTS update_warranty_claims_modtime ON warranty_claims;
CREATE TRIGGER update_warranty_claims_modtime BEFORE UPDATE ON warranty_claims FOR EACH ROW EXECUTE PROCEDURE public.update_modified_column();
DROP TRIGGER IF EXISTS update_asset_insurance_modtime ON asset_insurance;
CREATE TRIGGER update_asset_insurance_modtime BEFORE UPDATE ON asset_insurance FOR EACH ROW EXECUTE PROCEDURE public.update_modified_column();
DROP TRIGGER IF EXISTS update_insurance_incidents_modtime ON insurance_incidents;
CREATE TRIGGER update_insurance_incidents_modtime BEFORE UPDATE ON insurance_incidents FOR EACH ROW EXECUTE PROCEDURE public.update_modified_column();
