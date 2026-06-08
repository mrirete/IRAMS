-- Migration: Normalize asset status_code from OPERATING to ACTIVE
-- Per ISO 14224, the canonical asset lifecycle status for "in service" is ACTIVE.
-- OPERATING was used inconsistently; this migration consolidates all to ACTIVE.

UPDATE assets
SET status_code = 'ACTIVE'
WHERE status_code = 'OPERATING';

-- Also ensure any NULL status_code defaults to ACTIVE
UPDATE assets
SET status_code = 'ACTIVE'
WHERE status_code IS NULL;

-- Add ACTIVE as a STATUS_CODE dictionary entry if it doesn't already exist
INSERT INTO dictionaries (type, code, description, active)
SELECT 'STATUS_CODE', 'ACTIVE', 'Active (In Service)', true
WHERE NOT EXISTS (
    SELECT 1 FROM dictionaries WHERE type = 'STATUS_CODE' AND code = 'ACTIVE'
);

-- Add asset-specific lifecycle statuses
INSERT INTO dictionaries (type, code, description, active)
SELECT 'STATUS_CODE', 'STANDBY', 'Standby (Available, Not Running)', true
WHERE NOT EXISTS (
    SELECT 1 FROM dictionaries WHERE type = 'STATUS_CODE' AND code = 'STANDBY'
);

INSERT INTO dictionaries (type, code, description, active)
SELECT 'STATUS_CODE', 'DECOMMISSIONED', 'Decommissioned (Permanently Out of Service)', true
WHERE NOT EXISTS (
    SELECT 1 FROM dictionaries WHERE type = 'STATUS_CODE' AND code = 'DECOMMISSIONED'
);
