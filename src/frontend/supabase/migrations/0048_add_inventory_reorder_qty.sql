-- Add reorder_qty to inventory_stock
ALTER TABLE inventory_stock ADD COLUMN IF NOT EXISTS reorder_qty NUMERIC(10, 2) DEFAULT 0;
