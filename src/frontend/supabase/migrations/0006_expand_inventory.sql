-- Expand inventory_items table to match application types

ALTER TABLE inventory_items 
ADD COLUMN IF NOT EXISTS type TEXT, -- INVENTORY_TYPE
ADD COLUMN IF NOT EXISTS uom TEXT, -- UOM Code
ADD COLUMN IF NOT EXISTS manufacturer TEXT,
ADD COLUMN IF NOT EXISTS model TEXT,
ADD COLUMN IF NOT EXISTS barcode TEXT,
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS is_critical BOOLEAN DEFAULT FALSE,

-- Financials
ADD COLUMN IF NOT EXISTS cost_center_inbound TEXT,
ADD COLUMN IF NOT EXISTS cost_center_outbound TEXT,
ADD COLUMN IF NOT EXISTS tax_code TEXT,
ADD COLUMN IF NOT EXISTS markup_percentage NUMERIC(5,2),

-- Media & Meta
ADD COLUMN IF NOT EXISTS image_url TEXT,
ADD COLUMN IF NOT EXISTS comments TEXT,
ADD COLUMN IF NOT EXISTS properties JSONB DEFAULT '{}'::JSONB; -- Custom fields

-- Audit
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id);

-- Rename or Alias 'part_number' to 'code' if desired, but code handles mapping?
-- DB has 'part_number'. UI has 'code'.
-- We should probably stick to DB 'part_number' and ensure Service maps it.
