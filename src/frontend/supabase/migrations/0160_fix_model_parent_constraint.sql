-- ============================================================================
-- Migration: 0160_fix_model_parent_constraint
-- Fixes: "new row for relation manufacturer_models violates check constraint
--         chk_model_has_parent"
--
-- Root cause: Migration 0087 added the constraint
--   CHECK (contact_id IS NOT NULL OR vendor_id IS NOT NULL)
-- but migration 0158 introduced a third parent — manufacturer_id — without
-- widening the check.  Models created from the Assets → Manufacturer master
-- only supply manufacturer_id, so the old constraint rejects them.
--
-- Fix: DROP + re-CREATE the constraint to accept any of the three parents.
-- ADDITIVE & NON-BREAKING — existing rows with contact_id or vendor_id
-- satisfy the new check unchanged.
-- ============================================================================

ALTER TABLE manufacturer_models
  DROP CONSTRAINT IF EXISTS chk_model_has_parent;

ALTER TABLE manufacturer_models
  ADD CONSTRAINT chk_model_has_parent
  CHECK (contact_id IS NOT NULL OR vendor_id IS NOT NULL OR manufacturer_id IS NOT NULL);
