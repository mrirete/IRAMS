-- =====================================================
-- Asset Valuation Breakdown (IAS 16 / SAP AA)
-- Separates original acquisition cost from subsequent
-- capitalizations for proper asset accounting.
-- =====================================================

-- Add original acquisition cost (immutable after first set)
ALTER TABLE asset_financials
    ADD COLUMN IF NOT EXISTS original_acquisition_cost DECIMAL(15,2);

-- Add subsequent capitalizations tracker
ALTER TABLE asset_financials
    ADD COLUMN IF NOT EXISTS subsequent_capitalizations DECIMAL(15,2) DEFAULT 0;

-- Backfill: for all existing records, original = current acquisition cost
UPDATE asset_financials
SET original_acquisition_cost = acquisition_cost,
    subsequent_capitalizations = 0
WHERE original_acquisition_cost IS NULL;

-- Now make it NOT NULL (safe after backfill)
ALTER TABLE asset_financials
    ALTER COLUMN original_acquisition_cost SET NOT NULL;

-- Add a comment for clarity
COMMENT ON COLUMN asset_financials.acquisition_cost IS 'Gross Asset Value (GAV) = original + subsequent capitalizations';
COMMENT ON COLUMN asset_financials.original_acquisition_cost IS 'Original purchase price — immutable after initial capitalization';
COMMENT ON COLUMN asset_financials.subsequent_capitalizations IS 'Sum of all subsequent capitalized expenditure (IAS 16)';
