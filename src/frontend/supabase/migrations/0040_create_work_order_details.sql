-- Create work_order_labor table
CREATE TABLE IF NOT EXISTS work_order_labor (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wo_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    contact_id TEXT, -- References users(id) or legacy mock ID
    contact_type_code TEXT NOT NULL, -- FK to dictionaries technically
    est_hours NUMERIC(5, 2) DEFAULT 0,
    est_rate NUMERIC(10, 2) DEFAULT 0,
    act_hours NUMERIC(5, 2) DEFAULT 0,
    cost_center_id TEXT,
    date_performed TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create work_order_parts table
CREATE TABLE IF NOT EXISTS work_order_parts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wo_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    item_id TEXT, -- References inventory_items(id) or legacy mock ID
    description TEXT, -- Fallback or override
    quantity_est NUMERIC(10, 2) DEFAULT 0,
    quantity_act NUMERIC(10, 2) DEFAULT 0,
    unit_cost NUMERIC(10, 2) DEFAULT 0,
    date_used TIMESTAMP WITH TIME ZONE,
    cost_center TEXT, -- Storing as text based on code usage, or UUID if valid FK
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE work_order_labor ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_parts ENABLE ROW LEVEL SECURITY;

-- Policies (Idempotent)
DROP POLICY IF EXISTS "Enable all for authenticated" ON work_order_labor;
CREATE POLICY "Enable all for authenticated" ON work_order_labor FOR ALL USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Enable all for authenticated" ON work_order_parts;
CREATE POLICY "Enable all for authenticated" ON work_order_parts FOR ALL USING (auth.role() = 'authenticated');

-- Audit Triggers
CREATE TRIGGER audit_wo_labor_changes
    AFTER INSERT OR UPDATE OR DELETE ON work_order_labor
    FOR EACH ROW EXECUTE FUNCTION log_audit_event();

CREATE TRIGGER audit_wo_parts_changes
    AFTER INSERT OR UPDATE OR DELETE ON work_order_parts
    FOR EACH ROW EXECUTE FUNCTION log_audit_event();
