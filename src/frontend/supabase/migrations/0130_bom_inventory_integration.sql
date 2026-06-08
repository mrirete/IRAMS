-- ============================================================================
-- Migration: 0130_bom_inventory_integration
-- Purpose:   SAP Material Master parity for BOM ↔ Inventory integration
--
-- Three-Tier Material Taxonomy:
--   STOCK      → MAT-NNNNNN, full stock tracking (SPARE, CONSUMABLE, etc.)
--   NON-STOCK  → MAT-NNNNNN, cost tracking only (SERVICE, NLAG)
--   TEXT BOM   → No material record, real component, promotable to material
--
-- Changes:
--   1. Add material_number sequence + column + trigger to inventory_items
--   2. Create asset_bom junction table (nullable FK for Text BOM items)
--   3. Migrate JSONB bomItems → asset_bom table
--   4. Seed NLAG dictionary entry
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════
-- 1. MATERIAL NUMBER — Auto-generated MAT-NNNNNN for inventory_items
-- ═══════════════════════════════════════════════════════════════════════

-- 1a. Create the sequence for material numbers
CREATE SEQUENCE IF NOT EXISTS material_number_seq START WITH 1 INCREMENT BY 1;

-- 1b. Add material_number column to inventory_items
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS material_number TEXT UNIQUE;

-- 1c. Trigger function: auto-populate material_number on INSERT
CREATE OR REPLACE FUNCTION generate_material_number()
RETURNS TRIGGER AS $$
BEGIN
  -- Only generate if not explicitly provided (allows manual override)
  IF NEW.material_number IS NULL THEN
    NEW.material_number := 'MAT-' || LPAD(nextval('material_number_seq')::TEXT, 6, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists (idempotent)
DROP TRIGGER IF EXISTS auto_material_number ON inventory_items;

CREATE TRIGGER auto_material_number
  BEFORE INSERT ON inventory_items
  FOR EACH ROW
  EXECUTE FUNCTION generate_material_number();

-- 1d. Backfill existing inventory items with MAT-NNNNNN
DO $$
DECLARE
  r RECORD;
  next_num TEXT;
BEGIN
  FOR r IN
    SELECT id FROM inventory_items
    WHERE material_number IS NULL
    ORDER BY created_at ASC
  LOOP
    next_num := 'MAT-' || LPAD(nextval('material_number_seq')::TEXT, 6, '0');
    UPDATE inventory_items SET material_number = next_num WHERE id = r.id;
  END LOOP;
END $$;


-- ═══════════════════════════════════════════════════════════════════════
-- 2. ASSET_BOM — Junction table linking assets to materials
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS asset_bom (
    id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id                  UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,

    -- NULL = Text BOM item (real component, not individually purchased)
    -- NOT NULL = linked Material (Stock or Non-Stock, per INVENTORY_TYPE)
    inventory_item_id         UUID REFERENCES inventory_items(id),

    -- Always populated (from material master if linked, manual if Text BOM)
    part_number               TEXT,
    description               TEXT NOT NULL,

    -- BOM entry data
    quantity                  NUMERIC(10,2) NOT NULL DEFAULT 1,
    uom                       TEXT NOT NULL DEFAULT 'EA',
    is_critical               BOOLEAN DEFAULT FALSE,
    estimated_cost            NUMERIC(12,2) DEFAULT 0,
    replacement_interval_days INTEGER,
    notes                     TEXT,

    created_at                TIMESTAMPTZ DEFAULT NOW(),
    updated_at                TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_asset_bom_asset ON asset_bom(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_bom_item  ON asset_bom(inventory_item_id);

-- RLS
ALTER TABLE asset_bom ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all for authenticated" ON asset_bom
  FOR ALL USING (auth.role() = 'authenticated');

-- Audit trail trigger (uses existing log_audit_event function)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'log_audit_event') THEN
    CREATE TRIGGER audit_asset_bom_changes
      AFTER INSERT OR UPDATE OR DELETE ON asset_bom
      FOR EACH ROW EXECUTE FUNCTION log_audit_event();
  END IF;
EXCEPTION WHEN duplicate_object THEN
  NULL; -- trigger already exists
END $$;


-- ═══════════════════════════════════════════════════════════════════════
-- 3. DATA MIGRATION — JSONB bomItems → asset_bom rows
-- ═══════════════════════════════════════════════════════════════════════

-- Migrate existing JSONB bomItems into the asset_bom relational table.
-- Items matching inventory_items.part_number → linked (inventory_item_id SET)
-- Items NOT matching → Text BOM (inventory_item_id NULL)
INSERT INTO asset_bom (
    asset_id, inventory_item_id, part_number, description,
    quantity, uom, is_critical, estimated_cost
)
SELECT
    a.id,
    inv.id,  -- NULL if no match = Text BOM
    bom->>'inventoryCode',
    COALESCE(bom->>'description', 'No Description'),
    COALESCE((bom->>'quantity')::numeric, 1),
    COALESCE(bom->>'uom', 'EA'),
    COALESCE((bom->>'critical')::boolean, false),
    COALESCE(inv.unit_cost, 0)
FROM assets a,
     jsonb_array_elements(a.properties->'bomItems') AS bom
LEFT JOIN inventory_items inv ON inv.part_number = bom->>'inventoryCode'
WHERE a.properties->'bomItems' IS NOT NULL
  AND jsonb_typeof(a.properties->'bomItems') = 'array'
  AND jsonb_array_length(a.properties->'bomItems') > 0
ON CONFLICT DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════
-- 4. SEED — Add NLAG (Non-Valuated Material) dictionary entry
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO dictionaries (id, type, code, description, active)
VALUES (
    uuid_generate_v4(),
    'INVENTORY_TYPE',
    'NLAG',
    'Non-Valuated Material',
    true
)
ON CONFLICT (type, code) DO NOTHING;
