-- Add Financial & Lifecycle fields to Inventory Items (SKUs)

ALTER TABLE inventory_items 
ADD COLUMN IF NOT EXISTS default_warranty_months INTEGER,
ADD COLUMN IF NOT EXISTS warranty_from_install BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS is_capital_spare BOOLEAN DEFAULT FALSE, -- Triggers serialization logic
ADD COLUMN IF NOT EXISTS shelf_life_days INTEGER, -- For perishables
ADD COLUMN IF NOT EXISTS depreciation_method TEXT, -- 'SL', 'DB', etc.
ADD COLUMN IF NOT EXISTS salvage_value NUMERIC DEFAULT 0;

-- Comment on columns for clarity
COMMENT ON COLUMN inventory_items.warranty_from_install IS 'If true, warranty starts when item is installed on an asset, not purchase date.';
COMMENT ON COLUMN inventory_items.is_capital_spare IS 'If true, individual items of this SKU must be serialized assets (Rotables).';
