-- ═══════════════════════════════════════════════════════════════
-- 0232 — Phase E1: fleet Success Rate on assessment snapshots
--
-- SR = MTOP/(MTOP+MTTRg) per the PSC framework (Olorunfemi 2026), mean
-- across assets with banded reading points. ≥90 target, ≥95 world-class.
-- Scalar so the success layer trends without parsing `findings`.
-- ═══════════════════════════════════════════════════════════════
BEGIN;

ALTER TABLE ers_assessment_snapshots
    ADD COLUMN IF NOT EXISTS success_rate_pct NUMERIC;

COMMIT;
