-- 0176 — Per-point monitoring frequency + P-F interval on reading definitions.
-- Lets each measuring point carry its own inspection cadence and P-F interval,
-- instead of every point inheriting the asset's criticality default. NULL means
-- "derive from criticality" (backwards compatible with existing rows).
-- Atomic: Supabase's SQL editor runs statements individually, so wrap in a txn.
BEGIN;

ALTER TABLE reading_definitions
    ADD COLUMN IF NOT EXISTS monitoring_frequency_days INTEGER,
    ADD COLUMN IF NOT EXISTS pf_interval_days INTEGER;

COMMENT ON COLUMN reading_definitions.monitoring_frequency_days IS
    'Per-point monitoring/inspection interval in days. Overrides the asset-criticality default. NULL = derive from criticality.';
COMMENT ON COLUMN reading_definitions.pf_interval_days IS
    'P-F interval in days (potential failure to functional failure). When set with no explicit frequency, cadence = half the P-F interval (RCM net-P-F rule), capped by criticality.';

COMMIT;
