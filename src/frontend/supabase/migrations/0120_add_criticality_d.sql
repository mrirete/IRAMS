-- Migration: 0120 — Add Criticality 'D' to enum
-- Rationale: The system defines 4 criticality levels (A/B/C/D per ISO 14224),
-- but the original schema only created the enum with A/B/C.
-- 'D' = Low / Run-to-Failure (non-critical assets).

ALTER TYPE criticality ADD VALUE IF NOT EXISTS 'D';

COMMENT ON TYPE criticality IS 'ISO 14224 Asset Criticality: A=Safety, B=Production, C=General, D=Low/RTF';
