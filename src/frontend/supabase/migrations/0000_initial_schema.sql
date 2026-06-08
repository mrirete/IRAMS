-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- --- ENUMS ---
CREATE TYPE hierarchy_level AS ENUM ('SITE', 'UNIT', 'SYSTEM', 'EQUIPMENT', 'COMPONENT');
CREATE TYPE criticality AS ENUM ('A', 'B', 'C');
CREATE TYPE wo_status AS ENUM ('OPEN', 'WIP', 'CLOSED', 'TECO', 'CANCELLED');
CREATE TYPE request_status AS ENUM ('NEW', 'REVIEW', 'AUTHORIZED', 'APPROVED', 'REJECTED', 'CONVERTED');
CREATE TYPE transaction_type AS ENUM ('ISSUE', 'RECEIPT', 'ADJUST', 'RETURN');

-- --- AUDIT LOGGING (Must be defined first for triggers) ---
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    table_name TEXT NOT NULL,
    record_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
    changed_by UUID, -- References users.id (nullable if system action)
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    changes JSONB NOT NULL -- Stores {old: ..., new: ...}
);

-- Audit Trigger Function
CREATE OR REPLACE FUNCTION log_audit_event()
RETURNS TRIGGER AS $$
DECLARE
    user_id UUID;
    old_data JSONB;
    new_data JSONB;
    changes_json JSONB;
BEGIN
    -- Try to get the current user ID from Supabase auth (or app context)
    -- This often depends on how auth is handled; defaulting to NULL if not found
    BEGIN
        user_id := auth.uid();
    EXCEPTION WHEN OTHERS THEN
        user_id := NULL;
    END;

    IF (TG_OP = 'DELETE') THEN
        old_data := to_jsonb(OLD);
        changes_json := jsonb_build_object('old', old_data);
        INSERT INTO audit_logs (table_name, record_id, action, changed_by, changes)
        VALUES (TG_TABLE_NAME, OLD.id::TEXT, 'DELETE', user_id, changes_json);
        RETURN OLD;
    ELSIF (TG_OP = 'UPDATE') THEN
        old_data := to_jsonb(OLD);
        new_data := to_jsonb(NEW);
        changes_json := jsonb_build_object('old', old_data, 'new', new_data);
        INSERT INTO audit_logs (table_name, record_id, action, changed_by, changes)
        VALUES (TG_TABLE_NAME, NEW.id::TEXT, 'UPDATE', user_id, changes_json);
        RETURN NEW;
    ELSIF (TG_OP = 'INSERT') THEN
        new_data := to_jsonb(NEW);
        changes_json := jsonb_build_object('new', new_data);
        INSERT INTO audit_logs (table_name, record_id, action, changed_by, changes)
        VALUES (TG_TABLE_NAME, NEW.id::TEXT, 'INSERT', user_id, changes_json);
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- --- TABLE: users ---
-- NOTE: In Supabase, usually we link this to auth.users. 
-- For this schema, we treat it as an application table that might sync or reference auth.
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    contact_id UUID, -- Placeholder for future contacts table FK
    status TEXT CHECK (status IN ('active', 'suspended')) DEFAULT 'active',
    roles JSONB DEFAULT '[]'::JSONB,
    mfa_enabled BOOLEAN DEFAULT FALSE,
    permission_overrides JSONB,
    data_scope_overrides JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- --- TABLE: dictionaries (Governance) ---
CREATE TABLE dictionaries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type TEXT NOT NULL, -- e.g., 'FAILURE_MODE', 'COST_CENTER'
    code TEXT NOT NULL,
    description TEXT NOT NULL,
    is_locked BOOLEAN DEFAULT FALSE, -- Governance Lock
    active BOOLEAN DEFAULT TRUE,
    
    -- Extended Attributes (stored as JSONB for flexibility across types)
    properties JSONB DEFAULT '{}'::JSONB, 
    
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE (type, code) -- Prevent duplicate codes within a type
);

-- --- TABLE: assets (ISO 14224) ---
CREATE TABLE assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tag TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    parent_id UUID REFERENCES assets(id), -- Recursive Hierarchy
    hierarchy_level hierarchy_level NOT NULL,
    criticality criticality NOT NULL,
    
    status_code TEXT NOT NULL, -- Logical FK to dictionaries(code)
    
    location_id UUID,
    cost_center_id UUID,
    
    manufacturer TEXT,
    model TEXT,
    serial_number TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- --- TABLE: service_requests ---
CREATE TABLE service_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_number TEXT UNIQUE NOT NULL, -- Could use a sequence or generator function
    status request_status DEFAULT 'NEW',
    description TEXT NOT NULL,
    
    asset_id UUID NOT NULL REFERENCES assets(id),
    requester_id UUID NOT NULL REFERENCES users(id),
    functional_failure_id UUID, -- Logical FK to dictionaries(id)
    
    risk_score INTEGER DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- --- TABLE: work_orders ---
CREATE TABLE work_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wo_number TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    status wo_status DEFAULT 'OPEN',
    type TEXT NOT NULL,
    priority_code TEXT, -- Logical FK
    
    asset_id UUID NOT NULL REFERENCES assets(id),
    request_id UUID REFERENCES service_requests(id), -- Origin Request
    parent_wo_id UUID REFERENCES work_orders(id),
    
    -- Financial Locking
    cost_frozen BOOLEAN DEFAULT FALSE,
    frozen_labor_cost NUMERIC(10, 2),
    frozen_material_cost NUMERIC(10, 2),
    
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    closed_at TIMESTAMP WITH TIME ZONE
);

-- --- TABLE: wo_failure_data (Technically Complete Requirement) ---
CREATE TABLE wo_failure_data (
    wo_id UUID PRIMARY KEY REFERENCES work_orders(id) ON DELETE CASCADE,
    failure_mode_code TEXT NOT NULL,
    failure_cause_code TEXT NOT NULL,
    remedy_code TEXT NOT NULL,
    comments TEXT
);

-- --- TABLE: inventory_items ---
CREATE TABLE inventory_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    part_number TEXT UNIQUE NOT NULL,
    description TEXT NOT NULL,
    unit_cost NUMERIC(10, 2) NOT NULL DEFAULT 0, -- Moving Average
    stock_on_hand INTEGER DEFAULT 0,
    min_level INTEGER DEFAULT 0,
    max_level INTEGER DEFAULT 100
);

-- --- TABLE: inventory_transactions ---
CREATE TABLE inventory_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    item_id UUID NOT NULL REFERENCES inventory_items(id),
    transaction_type transaction_type NOT NULL,
    quantity INTEGER NOT NULL,
    cost_at_time NUMERIC(10, 2) NOT NULL,
    wo_id UUID REFERENCES work_orders(id),
    po_id UUID, -- Purchase Order placeholder
    performed_by UUID REFERENCES users(id),
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- --- TRIGGERS & POLICIES ---

-- 1. Apply Audit Logging to critical tables
CREATE TRIGGER audit_assets_changes
AFTER INSERT OR UPDATE OR DELETE ON assets
FOR EACH ROW EXECUTE FUNCTION log_audit_event();

CREATE TRIGGER audit_wo_changes
AFTER INSERT OR UPDATE OR DELETE ON work_orders
FOR EACH ROW EXECUTE FUNCTION log_audit_event();

CREATE TRIGGER audit_dictionaries_changes
AFTER INSERT OR UPDATE OR DELETE ON dictionaries
FOR EACH ROW EXECUTE FUNCTION log_audit_event();

CREATE TRIGGER audit_inventory_changes
AFTER INSERT OR UPDATE OR DELETE ON inventory_items
FOR EACH ROW EXECUTE FUNCTION log_audit_event();

-- 2. Governance Trigger: Freeze Cost on Close
CREATE OR REPLACE FUNCTION freeze_costs_on_close()
RETURNS TRIGGER AS $$
BEGIN
    -- If status is changing to CLOSED or TECO and wasn't before
    IF (NEW.status IN ('CLOSED', 'TECO') AND OLD.status NOT IN ('CLOSED', 'TECO')) THEN
        NEW.cost_frozen := TRUE;
        -- In a real app, we would sum up labor/materials from sub-tables here.
        -- Usage: NEW.frozen_labor_cost := (SELECT sum(...) FROM ... WHERE wo_id = NEW.id)
        -- For now, we assume these values might be calculated or passed in, or we just lock the current state.
        
        -- Defaulting snapshots if NULL to ensure they are fixed at 0 if no cost exists
        IF NEW.frozen_labor_cost IS NULL THEN NEW.frozen_labor_cost := 0; END IF;
        IF NEW.frozen_material_cost IS NULL THEN NEW.frozen_material_cost := 0; END IF;
        
        NEW.closed_at := NOW();
    END IF;

    -- Prevent Un-Freezing or Modification of Frozen Costs
    IF (OLD.cost_frozen = TRUE) THEN
        IF (NEW.cost_frozen = FALSE) THEN
             RAISE EXCEPTION 'Governance Rule: Cannot un-freeze a Work Order.';
        END IF;
        
        IF (NEW.frozen_labor_cost != OLD.frozen_labor_cost OR NEW.frozen_material_cost != OLD.frozen_material_cost) THEN
             RAISE EXCEPTION 'Governance Rule: Cannot modify costs after they are frozen.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_cost_freezing
BEFORE UPDATE ON work_orders
FOR EACH ROW EXECUTE FUNCTION freeze_costs_on_close();


-- 3. Row Level Security (Basics)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE dictionaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE wo_failure_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Allow full access to authenticated users (Placeholder for granular RBAC)
-- NOTE: In production, these would be strictly scoped by 'permission_overrides'
CREATE POLICY "Enable read access for authenticated users" ON users FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Enable write access for authenticated users" ON users FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Enable all for authenticated" ON assets FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Enable all for authenticated" ON dictionaries FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Enable all for authenticated" ON work_orders FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Enable all for authenticated" ON service_requests FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Enable all for authenticated" ON wo_failure_data FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Enable all for authenticated" ON inventory_items FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Enable all for authenticated" ON inventory_transactions FOR ALL USING (auth.role() = 'authenticated');

-- Audit Logs should be read-only for most, but insertable by system/trigger
-- Triggers bypass RLS, so we just need read policies allowing admins to see logs
CREATE POLICY "Admins view audit logs" ON audit_logs FOR SELECT USING (auth.role() = 'authenticated');

