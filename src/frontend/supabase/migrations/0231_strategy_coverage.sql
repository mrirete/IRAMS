-- ═══════════════════════════════════════════════════════════════
-- 0231 — Phase D2: strategy-coverage KPI on assessment snapshots
--
-- "% of A/B-criticality assets with a maintenance strategy in place"
-- (an active programme or condition monitoring) — the number that shows
-- the Specialist BUILDING a plan, not just flagging problems. Scalar
-- column so trending never parses `findings`; world-class ≥95%.
-- ═══════════════════════════════════════════════════════════════
BEGIN;

ALTER TABLE ers_assessment_snapshots
    ADD COLUMN IF NOT EXISTS strategy_coverage_pct INTEGER;

COMMIT;
