-- ============================================================
-- 0154: Action links — trace a reliability study to the PM it produced.
-- When a PM program is created from a Weibull fit, stamp the resulting
-- recurring_work id (and title) onto the analysis for end-to-end
-- traceability (reliability → maintenance). Soft link (no FK) so a
-- deleted PM simply leaves a dangling label rather than blocking.
-- ============================================================

ALTER TABLE ers_reliability_analyses
    ADD COLUMN IF NOT EXISTS linked_pm_id UUID,
    ADD COLUMN IF NOT EXISTS linked_pm_title TEXT;
