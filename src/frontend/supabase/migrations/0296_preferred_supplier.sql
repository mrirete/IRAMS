-- ============================================================================
-- 0296 — Preferred supplier becomes real (SAP source-list equivalent)
--
-- The inventory Details tab has had a "Preferred Supplier" picker for a long
-- time, and the import template a preferredSupplier column — but neither ever
-- persisted anywhere: the save mapping dropped the field and no column
-- existed. This is the minimal source-list analog: ONE preferred vendor per
-- material. Deliberately NOT modeled (dedicated-ERP boundary): purchasing
-- info records, validity windows, per-plant source lists, fixed-vendor flags.
--
-- Client counterpart (same commit): save/load mapping carries the field, and
-- the inventory importer resolves preferredSupplier (vendor name or code,
-- creating unknown vendors as SUPPLIER) — which also makes SAP Source List
-- sheets (MATNR + LIFNR) importable.
-- ============================================================================

ALTER TABLE public.inventory_items
    ADD COLUMN IF NOT EXISTS preferred_vendor_id uuid REFERENCES public.vendors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_items_preferred_vendor
    ON public.inventory_items (preferred_vendor_id)
    WHERE preferred_vendor_id IS NOT NULL;

COMMENT ON COLUMN public.inventory_items.preferred_vendor_id
    IS 'Preferred supplier for this material (SAP source-list analog, one per material). Set via the item Details tab or import (vendor name/code/LIFNR).';
