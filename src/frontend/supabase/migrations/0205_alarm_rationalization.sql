-- ============================================================
-- 0205: Alarm rationalization-lite (ISA-18.2) — Predict plan 1.5.5.
-- Per-definition alarm hygiene + operator guidance:
--   alarm_deadband_pct  approach/clear margin as % of the limit
--                       (null = engine default 10%)
--   alarm_persistence   consecutive breaching readings required before an
--                       alert fires (null = engine default 2)
--   operator_action     what to DO when this point alarms — carried into
--                       every alert raised from the point (the AG layer's
--                       advisory text)
-- ============================================================

ALTER TABLE reading_definitions
    ADD COLUMN IF NOT EXISTS alarm_deadband_pct NUMERIC,
    ADD COLUMN IF NOT EXISTS alarm_persistence  SMALLINT,
    ADD COLUMN IF NOT EXISTS operator_action    TEXT;

COMMENT ON COLUMN reading_definitions.operator_action IS
    'ISA-18.2 rationalization: operator response guidance shown on alerts raised from this point.';
