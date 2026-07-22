-- 0215: Diagnosis layer on prediction alerts (Predict gap-closeout slice 3).
--
-- ers_prediction_alerts gains structured diagnosis: ranked failure-mode
-- hypotheses with evidence citations, produced by the deterministic rules
-- engine (lib/predict/diagnosisRules.ts) at alert-creation time. Until now
-- diagnosis existed only as free text inside description.
--
--   diagnosis           JSONB   { engine, hypotheses: [{ failure_mode_code,
--                               failure_mode_label, confidence, basis,
--                               evidence[], recommended_action }] }
--   failure_mode_code   TEXT    top hypothesis — denormalized for filtering
--                               and rollups (reference_codes FAILURE_MODE)

ALTER TABLE ers_prediction_alerts
    ADD COLUMN IF NOT EXISTS diagnosis JSONB,
    ADD COLUMN IF NOT EXISTS failure_mode_code TEXT;

COMMENT ON COLUMN ers_prediction_alerts.diagnosis IS
    'Ranked failure-mode hypotheses + evidence from lib/predict/diagnosisRules.ts (diagnosis-rules-v1)';
COMMENT ON COLUMN ers_prediction_alerts.failure_mode_code IS
    'Top hypothesis failure mode (reference_codes category FAILURE_MODE) — denormalized from diagnosis';

CREATE INDEX IF NOT EXISTS idx_pred_alerts_failure_mode
    ON ers_prediction_alerts (failure_mode_code) WHERE failure_mode_code IS NOT NULL;
