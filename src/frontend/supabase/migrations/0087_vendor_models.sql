-- ═══════════════════════════════════════════════════════════════
-- 0087: Vendor Models Support
-- Purpose: Allow manufacturer_models to be linked to vendors
--          (in addition to contacts) so models created in the
--          Vendor module sync to Assets manufacturer/model.
-- ═══════════════════════════════════════════════════════════════

-- Add vendor_id column (nullable, since existing rows use contact_id)
ALTER TABLE manufacturer_models
ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES vendors(id) ON DELETE CASCADE;

-- Make contact_id nullable for vendor-sourced models
ALTER TABLE manufacturer_models
ALTER COLUMN contact_id DROP NOT NULL;

-- Index for vendor_id lookups
CREATE INDEX IF NOT EXISTS idx_manufacturer_models_vendor_id
ON manufacturer_models (vendor_id);

-- Add check constraint: at least one of contact_id or vendor_id must be set
ALTER TABLE manufacturer_models
ADD CONSTRAINT chk_model_has_parent
CHECK (contact_id IS NOT NULL OR vendor_id IS NOT NULL);
