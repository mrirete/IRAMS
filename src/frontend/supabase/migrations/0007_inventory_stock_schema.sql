-- --- TABLE: inventory_locations ---
-- Stores definitions of physical places where stock is held (e.g. "Main Store", "Van 1")
CREATE TABLE inventory_locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- --- TABLE: inventory_stock ---
-- Junction details: Item X at Location Y has Qty Z
CREATE TABLE inventory_stock (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
    location_id UUID NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
    quantity NUMERIC(10, 2) NOT NULL DEFAULT 0,
    bin_location TEXT, -- Specific shelf/bin code at this location
    min_level NUMERIC(10, 2), -- Optional override for reorder properties per location
    max_level NUMERIC(10, 2),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(item_id, location_id)
);

-- Audit
CREATE TRIGGER audit_inventory_stock_changes
AFTER INSERT OR UPDATE OR DELETE ON inventory_stock
FOR EACH ROW EXECUTE FUNCTION log_audit_event();

-- Initial Seed for Locations (Optional, but helpful)
INSERT INTO inventory_locations (name, description) VALUES ('Main Store', 'Central Warehouse');
INSERT INTO inventory_locations (name, description) VALUES ('Spares Container A', 'On-site container');
