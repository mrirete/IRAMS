-- =====================================================
-- WARRANTY ↔ WORK ORDER INTEGRATION
-- Gaps closed: G1 (WO warranty flag), foundation for G2-G14
-- =====================================================

-- Add warranty tracking columns to work_orders
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS warranty_flag BOOLEAN DEFAULT FALSE;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS warranty_id UUID;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS warranty_claim_id UUID;

-- Add comments for documentation
COMMENT ON COLUMN work_orders.warranty_flag IS 'TRUE if asset had active warranty at WO creation time';
COMMENT ON COLUMN work_orders.warranty_id IS 'FK to the active warranty at WO creation time';
COMMENT ON COLUMN work_orders.warranty_claim_id IS 'FK to the warranty_claim generated on TECO';
