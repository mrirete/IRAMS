-- ============================================================
-- 0117 — Make RCA asset_id nullable
-- Allows creating RCA investigations before linking to a
-- specific asset (e.g. quick-entry from the Analyze page).
-- ============================================================

ALTER TABLE ers_rca_investigations
  ALTER COLUMN asset_id DROP NOT NULL;
