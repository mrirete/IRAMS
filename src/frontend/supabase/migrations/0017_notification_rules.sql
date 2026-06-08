-- Create Notification Rules Table
CREATE TABLE IF NOT EXISTS notification_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    module TEXT NOT NULL, -- e.g. 'requests', 'workOrders'
    event_trigger TEXT NOT NULL, -- e.g. 'STATUS_CHANGE', 'STOCK_ZERO'
    is_active BOOLEAN DEFAULT true,
    severity TEXT NOT NULL CHECK (severity IN ('INFO', 'SUCCESS', 'WARNING', 'CRITICAL')),
    
    filters JSONB DEFAULT '[]'::jsonb, -- Array of { field, operator, value }
    recipients JSONB DEFAULT '[]'::jsonb, -- Array of { type, targetId }
    channels JSONB DEFAULT '[]'::jsonb, -- Array of strings ['IN_APP', 'EMAIL']
    
    escalation_timeout_minutes INTEGER DEFAULT 0,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS Policies (Simplified for now - authorized users can manage)
ALTER TABLE notification_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read/write for authenticated users" ON notification_rules
    FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');
