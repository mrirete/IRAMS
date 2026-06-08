-- =====================================================
-- Capital Events — IAS 16 Subsequent Expenditure Audit Log
-- Tracks overhauls, component replacements, upgrades &
-- life extension programs that modify asset carrying
-- amounts and useful lives.
-- =====================================================

CREATE TABLE IF NOT EXISTS capital_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_financial_id UUID NOT NULL REFERENCES asset_financials(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL,  -- Soft FK to assets (denormalized for quick queries)

    -- Event Classification
    event_type VARCHAR(30) NOT NULL,  -- MAJOR_OVERHAUL, COMPONENT_REPLACEMENT, UPGRADE, LIFE_EXTENSION

    -- Financial Impact
    capital_amount DECIMAL(15,2) NOT NULL,
    previous_carrying_amount DECIMAL(15,2) NOT NULL,
    new_carrying_amount DECIMAL(15,2) NOT NULL,

    -- Useful Life Impact
    previous_useful_life_months INTEGER NOT NULL,
    new_useful_life_months INTEGER NOT NULL,

    -- Salvage Value Impact
    previous_salvage_value DECIMAL(15,2) NOT NULL DEFAULT 0,
    new_salvage_value DECIMAL(15,2) NOT NULL DEFAULT 0,

    -- Effective Date & Traceability
    effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
    work_order_id UUID,         -- Soft FK to work_orders
    work_order_number VARCHAR(30),
    description TEXT NOT NULL,

    -- Approval (HITL gate for Criticality A assets)
    approved_by UUID,           -- Soft FK to auth.users
    approved_at TIMESTAMPTZ,

    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- INDEXES
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_capital_events_asset
    ON capital_events(asset_id);
CREATE INDEX IF NOT EXISTS idx_capital_events_financial
    ON capital_events(asset_financial_id);
CREATE INDEX IF NOT EXISTS idx_capital_events_type
    ON capital_events(event_type);
CREATE INDEX IF NOT EXISTS idx_capital_events_date
    ON capital_events(effective_date);

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================
ALTER TABLE capital_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view capital_events" ON capital_events;
CREATE POLICY "Authenticated users can view capital_events"
    ON capital_events FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can manage capital_events" ON capital_events;
CREATE POLICY "Authenticated users can manage capital_events"
    ON capital_events FOR ALL TO authenticated USING (true) WITH CHECK (true);
