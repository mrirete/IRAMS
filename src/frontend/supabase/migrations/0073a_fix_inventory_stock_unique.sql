-- 0073_fix_inventory_stock_unique.sql
-- ============================================================
-- FIX: Add missing UNIQUE constraint on inventory_stock(item_id, location_id)
--
-- Root cause: Migration 0071 recreated inventory_stock via
-- CREATE TABLE IF NOT EXISTS without the UNIQUE(item_id, location_id)
-- constraint that was present in the original 0007 migration.
--
-- The DatabaseService.updateInventoryItem() uses:
--   .upsert(stockUpserts, { onConflict: 'item_id,location_id' })
-- which requires this unique constraint to exist.
-- ============================================================

-- Add the unique constraint if it doesn't already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'inventory_stock'::regclass
      AND contype = 'u'
      AND conname = 'inventory_stock_item_id_location_id_key'
  ) THEN
    ALTER TABLE inventory_stock
      ADD CONSTRAINT inventory_stock_item_id_location_id_key
      UNIQUE (item_id, location_id);
  END IF;
END $$;
