-- ============================================================
-- 0204: Reliability study lifecycle — studies stop being folders.
-- Adds a review workflow (active → in_review → approved → archived),
-- a findings summary (the study's deliverable), and approval stamps.
-- Mirrors the RCM module's draft→review→approved pattern so both
-- study types govern the same way.
-- ============================================================

ALTER TABLE ers_reliability_studies
    DROP CONSTRAINT IF EXISTS ers_reliability_studies_status_check;

ALTER TABLE ers_reliability_studies
    ADD CONSTRAINT ers_reliability_studies_status_check
    CHECK (status IN ('active', 'in_review', 'approved', 'archived'));

ALTER TABLE ers_reliability_studies
    ADD COLUMN IF NOT EXISTS findings    TEXT,
    ADD COLUMN IF NOT EXISTS approved_by TEXT,
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
