-- Migration: Add downtime cost and warranty dates to asset_financials
-- These columns support downtime costing and primary warranty tracking

ALTER TABLE asset_financials
ADD COLUMN IF NOT EXISTS downtime_cost_per_hour DECIMAL(12,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS warranty_start_date DATE,
ADD COLUMN IF NOT EXISTS warranty_end_date DATE;

COMMENT ON COLUMN asset_financials.downtime_cost_per_hour IS 'Hourly cost of asset downtime for TCO and reliability calculations';
COMMENT ON COLUMN asset_financials.warranty_start_date IS 'Start date of primary asset warranty';
COMMENT ON COLUMN asset_financials.warranty_end_date IS 'End date of primary asset warranty';
