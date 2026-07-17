-- 0201: Reservation netting / ATP (IN-1).
--
-- Planned parts on open work orders already act as the reservation source of
-- truth — checkMaterialAvailability derives "reserved by other WOs" from
-- work_order_parts on every call. This materializes that number per item as
-- inventory_items.stock_reserved, kept correct by triggers (the same pattern
-- 0049 uses for stock_on_hand), so Available-to-Promise = stock_on_hand −
-- stock_reserved is readable everywhere without per-item subqueries.
--
-- Open = any work order whose status is not CLOSED/CANC/CANCELLED/TECO
-- (mirrors the committed derived logic). Reservations release automatically
-- when the WO reaches a closed status or the part row is removed.

ALTER TABLE inventory_items
    ADD COLUMN IF NOT EXISTS stock_reserved NUMERIC NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION sync_stock_reserved()
RETURNS TRIGGER AS $$
DECLARE
    v_item_ids UUID[];
BEGIN
    IF TG_TABLE_NAME = 'work_order_parts' THEN
        IF TG_OP = 'INSERT' THEN
            v_item_ids := ARRAY[NEW.item_id];
        ELSIF TG_OP = 'DELETE' THEN
            v_item_ids := ARRAY[OLD.item_id];
        ELSE
            v_item_ids := ARRAY[NEW.item_id, OLD.item_id];
        END IF;
    ELSE
        -- work_orders status change: refresh every item on that order
        SELECT COALESCE(array_agg(DISTINCT item_id), '{}') INTO v_item_ids
        FROM work_order_parts WHERE wo_id = NEW.id;
    END IF;

    UPDATE inventory_items i
       SET stock_reserved = COALESCE((
               SELECT SUM(wop.quantity)
                 FROM work_order_parts wop
                 JOIN work_orders wo ON wo.id = wop.wo_id
                WHERE wop.item_id = i.id
                  -- status is enum wo_status: compare as text (NULL = open,
                  -- matching the client-side derivation)
                  AND (wo.status IS NULL
                       OR wo.status::text NOT IN ('CLOSED', 'CANC', 'CANCELLED', 'TECO'))
           ), 0)
     WHERE i.id = ANY(v_item_ids) AND i.id IS NOT NULL;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_stock_reserved_parts ON work_order_parts;
CREATE TRIGGER trg_sync_stock_reserved_parts
    AFTER INSERT OR UPDATE OR DELETE ON work_order_parts
    FOR EACH ROW EXECUTE FUNCTION sync_stock_reserved();

DROP TRIGGER IF EXISTS trg_sync_stock_reserved_wo ON work_orders;
CREATE TRIGGER trg_sync_stock_reserved_wo
    AFTER UPDATE OF status ON work_orders
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION sync_stock_reserved();

-- Backfill from current open orders.
UPDATE inventory_items i
   SET stock_reserved = COALESCE((
           SELECT SUM(wop.quantity)
             FROM work_order_parts wop
             JOIN work_orders wo ON wo.id = wop.wo_id
            WHERE wop.item_id = i.id
              AND (wo.status IS NULL
                   OR wo.status::text NOT IN ('CLOSED', 'CANC', 'CANCELLED', 'TECO'))
       ), 0);
