-- 0345 — the item master's on-hand figure follows the locations, whoever moved the stock.
--
-- sync_stock_on_hand() (trigger on inventory_stock) recomputes
-- inventory_items.stock_on_hand after every location movement. It ran with
-- the caller's rights, and the UPDATE on inventory_items is gated by
-- inventory.edit — so when a technician's completion issued the seal
-- (STR-MAIN 7 → 6, movement 261 written) the item still said 7. RLS filters
-- silently: no error, no sync (2026-09-08 assurance run). The trigger now
-- runs as definer; the caller's rights already decided the movement itself.

CREATE OR REPLACE FUNCTION public.sync_stock_on_hand()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF TG_OP <> 'DELETE' AND NEW.item_id IS NOT NULL THEN
        UPDATE public.inventory_items
           SET stock_on_hand = (SELECT COALESCE(SUM(quantity), 0) FROM public.inventory_stock WHERE item_id = NEW.item_id)
         WHERE id = NEW.item_id;
    END IF;
    IF TG_OP <> 'INSERT' AND OLD.item_id IS NOT NULL AND (TG_OP = 'DELETE' OR NEW.item_id IS DISTINCT FROM OLD.item_id) THEN
        UPDATE public.inventory_items
           SET stock_on_hand = (SELECT COALESCE(SUM(quantity), 0) FROM public.inventory_stock WHERE item_id = OLD.item_id)
         WHERE id = OLD.item_id;
    END IF;
    RETURN NULL;
END $$;

-- One-off resync for items that already drifted.
UPDATE public.inventory_items i
   SET stock_on_hand = s.total
  FROM (SELECT item_id, COALESCE(SUM(quantity), 0) AS total FROM public.inventory_stock GROUP BY item_id) s
 WHERE s.item_id = i.id AND i.stock_on_hand IS DISTINCT FROM s.total;
