-- Change stock_on_hand to NUMERIC to match inventory_stock.quantity
ALTER TABLE inventory_items ALTER COLUMN stock_on_hand TYPE NUMERIC(10, 2);

-- Function to sync stock_on_hand
CREATE OR REPLACE FUNCTION sync_stock_on_hand()
RETURNS TRIGGER AS $$
BEGIN
    -- Update item for NEW record if it exists (INSERT / UPDATE)
    IF NEW.item_id IS NOT NULL THEN
        UPDATE inventory_items
        SET stock_on_hand = (
            SELECT COALESCE(SUM(quantity), 0)
            FROM inventory_stock
            WHERE item_id = NEW.item_id
        )
        WHERE id = NEW.item_id;
    END IF;

    -- Update item for OLD record if it exists and is different (DELETE / UPDATE item_id)
    IF OLD.item_id IS NOT NULL AND (NEW.item_id IS NULL OR NEW.item_id <> OLD.item_id) THEN
        UPDATE inventory_items
        SET stock_on_hand = (
            SELECT COALESCE(SUM(quantity), 0)
            FROM inventory_stock
            WHERE item_id = OLD.item_id
        )
        WHERE id = OLD.item_id;
    END IF;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger
DROP TRIGGER IF EXISTS tr_sync_stock_on_hand ON inventory_stock;
CREATE TRIGGER tr_sync_stock_on_hand
AFTER INSERT OR UPDATE OR DELETE ON inventory_stock
FOR EACH ROW EXECUTE FUNCTION sync_stock_on_hand();

-- Initial Sync
UPDATE inventory_items
SET stock_on_hand = (
    SELECT COALESCE(SUM(quantity), 0)
    FROM inventory_stock
    WHERE inventory_stock.item_id = inventory_items.id
);
