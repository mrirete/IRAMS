-- 0377a — a store row that still holds stock cannot be deleted
--
-- WHAT WAS WRONG
--   inventory_stock is the only record of how much of an item sits in a
--   store. Nothing at the database level stopped a row from being deleted
--   with quantity in it: the parts vanished from on-hand with no movement to
--   say where they went, and the item's stock_on_hand (kept by
--   tr_sync_stock_on_hand) simply dropped.
--
--   The client now refuses this (deleteStockLocation / deleteInventoryItem),
--   but a client check is advice, not a rule. Two tabs, a stale page, or any
--   other caller with the anon key and a session can still send the DELETE.
--
-- WHAT THIS DOES
--   BEFORE DELETE trigger: refuse while quantity <> 0 or qty_on_order > 0.
--   Zero-quantity rows delete as before. Movement history is not keyed by the
--   row and is untouched either way.
--
-- SAFE TO RE-RUN.

BEGIN;

CREATE OR REPLACE FUNCTION public.guard_inventory_stock_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
    IF coalesce(OLD.quantity, 0) <> 0 THEN
        RAISE EXCEPTION 'Store row still holds % on hand — adjust it to zero before removing the location', OLD.quantity
            USING ERRCODE = '23514';
    END IF;
    IF coalesce(OLD.qty_on_order, 0) > 0 THEN
        RAISE EXCEPTION 'Store row has % on order — receive or cancel the order before removing the location', OLD.qty_on_order
            USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS aa_guard_inventory_stock_delete ON public.inventory_stock;
CREATE TRIGGER aa_guard_inventory_stock_delete
    BEFORE DELETE ON public.inventory_stock
    FOR EACH ROW EXECUTE FUNCTION public.guard_inventory_stock_delete();

COMMENT ON FUNCTION public.guard_inventory_stock_delete() IS
    'Refuses to delete an inventory_stock row while it holds stock or has quantity on order (0377a). The client checks first; this makes it a rule.';

COMMIT;

-- VERIFY
--   SELECT tgname FROM pg_trigger WHERE tgrelid = 'inventory_stock'::regclass AND tgname = 'aa_guard_inventory_stock_delete';
--   -- expect: one row
--   BEGIN; DELETE FROM inventory_stock WHERE id = (SELECT id FROM inventory_stock WHERE quantity <> 0 LIMIT 1); ROLLBACK;
--   -- expect: ERROR 23514 "Store row still holds … on hand"
