-- ============================================================
-- 0152: Snapshots / version history for reliability studies
-- Each saved run becomes an immutable, dated version within a
-- lineage identified by root_id. Re-running a study appends a new
-- version instead of overwriting prior results (enables trending).
-- ============================================================

ALTER TABLE ers_reliability_analyses
    ADD COLUMN IF NOT EXISTS root_id UUID,
    ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- Existing rows each become version 1 and the root of their own lineage.
UPDATE ers_reliability_analyses SET root_id = id WHERE root_id IS NULL;

-- Lineage lookups (all versions of a study)
CREATE INDEX IF NOT EXISTS idx_reliability_analyses_root
    ON ers_reliability_analyses(root_id);
