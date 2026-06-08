-- ============================================================================
-- Migration 0139: Structural Failure Modes + Failure Effects Dictionary
-- ============================================================================
-- 1. Adds STRUCTURAL asset class failure modes (ISO 14224 §B.2)
-- 2. Creates FAILURE_EFFECT_LOCAL and FAILURE_EFFECT_PLANT dictionaries
--    for standardized effect selection across PM, WO, and FMEA modules.
--
-- Reference: ISO 14224:2016 §B.2.5 — Failure Effect Classification
-- ============================================================================

-- 0. Ensure unique constraint exists
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'reference_codes'
      AND indexname = 'reference_codes_category_code_key'
  ) THEN
    CREATE UNIQUE INDEX reference_codes_category_code_key
      ON reference_codes (category, code);
  END IF;
END $$;

-- ══════════════════════════════════════════════════════════════════════════
-- PART 1: STRUCTURAL Failure Modes (ISO 14224 — Civil / Structural)
-- ══════════════════════════════════════════════════════════════════════════
INSERT INTO reference_codes (category, code, description, is_locked, active, category_ref) VALUES
    ('FAILURE_MODE', 'FCR', 'Foundation Crack / Settlement',        false, true, 'STRUCTURAL'),
    ('FAILURE_MODE', 'SCR', 'Structural Corrosion / Rust',          false, true, 'STRUCTURAL'),
    ('FAILURE_MODE', 'DFM', 'Deformation / Buckling',               false, true, 'STRUCTURAL'),
    ('FAILURE_MODE', 'CTG', 'Coating / Paint Degradation',          false, true, 'STRUCTURAL'),
    ('FAILURE_MODE', 'FTG', 'Fatigue Cracking (Structural)',        false, true, 'STRUCTURAL'),
    ('FAILURE_MODE', 'GRT', 'Grating / Platform Damage',            false, true, 'STRUCTURAL'),
    ('FAILURE_MODE', 'ANB', 'Anchor Bolt Failure / Loosening',      false, true, 'STRUCTURAL'),
    ('FAILURE_MODE', 'WTD', 'Water / Weather Damage',               false, true, 'STRUCTURAL')
ON CONFLICT (category, code) DO UPDATE
SET description  = EXCLUDED.description,
    is_locked    = EXCLUDED.is_locked,
    active       = EXCLUDED.active,
    category_ref = EXCLUDED.category_ref;

-- ══════════════════════════════════════════════════════════════════════════
-- PART 2: FAILURE_EFFECT_LOCAL — Equipment-level consequences
-- ══════════════════════════════════════════════════════════════════════════
DELETE FROM reference_codes WHERE category = 'FAILURE_EFFECT_LOCAL';

INSERT INTO reference_codes (category, code, description, is_locked, active, category_ref) VALUES
    -- Equipment Performance
    ('FAILURE_EFFECT_LOCAL', 'LOF',  'Complete Loss of Function',                     false, true, 'PERFORMANCE'),
    ('FAILURE_EFFECT_LOCAL', 'DEG',  'Degraded Performance / Reduced Output',         false, true, 'PERFORMANCE'),
    ('FAILURE_EFFECT_LOCAL', 'INT',  'Intermittent Operation',                        false, true, 'PERFORMANCE'),
    ('FAILURE_EFFECT_LOCAL', 'RES',  'Restricted Operation (Derated)',                false, true, 'PERFORMANCE'),

    -- Secondary Damage
    ('FAILURE_EFFECT_LOCAL', 'SDM',  'Secondary Damage to Adjacent Components',       false, true, 'DAMAGE'),
    ('FAILURE_EFFECT_LOCAL', 'OVH',  'Overheating of Equipment',                      false, true, 'DAMAGE'),
    ('FAILURE_EFFECT_LOCAL', 'VIB',  'Excessive Vibration / Noise',                   false, true, 'DAMAGE'),
    ('FAILURE_EFFECT_LOCAL', 'CTM',  'Contamination of Process Medium',               false, true, 'DAMAGE'),
    ('FAILURE_EFFECT_LOCAL', 'COR',  'Accelerated Corrosion / Erosion',               false, true, 'DAMAGE'),

    -- Containment
    ('FAILURE_EFFECT_LOCAL', 'LOC',  'Loss of Containment (Leak)',                    false, true, 'CONTAINMENT'),
    ('FAILURE_EFFECT_LOCAL', 'PRB',  'Pressure Boundary Breach',                      false, true, 'CONTAINMENT'),
    ('FAILURE_EFFECT_LOCAL', 'FLD',  'Fluid Loss / Inventory Reduction',              false, true, 'CONTAINMENT'),

    -- Control / Protection
    ('FAILURE_EFFECT_LOCAL', 'LPC',  'Loss of Process Control',                       false, true, 'CONTROL'),
    ('FAILURE_EFFECT_LOCAL', 'SPR',  'Spurious Protection Trip',                      false, true, 'CONTROL'),
    ('FAILURE_EFFECT_LOCAL', 'LMO',  'Loss of Monitoring / Indication',               false, true, 'CONTROL'),
    ('FAILURE_EFFECT_LOCAL', 'HDF',  'Hidden Failure (No Immediate Symptom)',          false, true, 'CONTROL'),

    -- Structural
    ('FAILURE_EFFECT_LOCAL', 'STR',  'Structural Integrity Compromise',               false, true, 'STRUCTURAL'),
    ('FAILURE_EFFECT_LOCAL', 'MSA',  'Misalignment of Connected Equipment',           false, true, 'STRUCTURAL'),
    ('FAILURE_EFFECT_LOCAL', 'NOE',  'No Observable Effect (Redundancy Active)',       false, true, 'NONE')
ON CONFLICT (category, code) DO UPDATE
SET description  = EXCLUDED.description,
    active       = EXCLUDED.active,
    category_ref = EXCLUDED.category_ref;

-- ══════════════════════════════════════════════════════════════════════════
-- PART 3: FAILURE_EFFECT_PLANT — Plant-wide / systemic consequences
-- ══════════════════════════════════════════════════════════════════════════
DELETE FROM reference_codes WHERE category = 'FAILURE_EFFECT_PLANT';

INSERT INTO reference_codes (category, code, description, is_locked, active, category_ref) VALUES
    -- Production Impact
    ('FAILURE_EFFECT_PLANT', 'PSD',  'Partial Shutdown (Unit / Train)',               false, true, 'PRODUCTION'),
    ('FAILURE_EFFECT_PLANT', 'FSD',  'Full Plant Shutdown (ESD)',                     false, true, 'PRODUCTION'),
    ('FAILURE_EFFECT_PLANT', 'PLR',  'Production Loss / Throughput Reduction',        false, true, 'PRODUCTION'),
    ('FAILURE_EFFECT_PLANT', 'QTY',  'Quality Deviation / Off-Spec Product',          false, true, 'PRODUCTION'),
    ('FAILURE_EFFECT_PLANT', 'FLR',  'Flaring / Venting (Emissions)',                 false, true, 'PRODUCTION'),
    ('FAILURE_EFFECT_PLANT', 'RDN',  'Redundancy Consumed (No Backup)',               false, true, 'PRODUCTION'),

    -- Safety Impact
    ('FAILURE_EFFECT_PLANT', 'PIJ',  'Personnel Injury Risk',                         false, true, 'SAFETY'),
    ('FAILURE_EFFECT_PLANT', 'FIR',  'Fire / Explosion Hazard',                       false, true, 'SAFETY'),
    ('FAILURE_EFFECT_PLANT', 'TOX',  'Toxic Release / H₂S / Gas Exposure',            false, true, 'SAFETY'),
    ('FAILURE_EFFECT_PLANT', 'EVA',  'Evacuation / Muster Required',                  false, true, 'SAFETY'),
    ('FAILURE_EFFECT_PLANT', 'REG',  'Regulatory Non-Compliance',                     false, true, 'SAFETY'),

    -- Environmental
    ('FAILURE_EFFECT_PLANT', 'SPL',  'Spill / Release to Environment',                false, true, 'ENVIRONMENTAL'),
    ('FAILURE_EFFECT_PLANT', 'EMI',  'Emissions Exceedance',                           false, true, 'ENVIRONMENTAL'),
    ('FAILURE_EFFECT_PLANT', 'WCD',  'Water Contamination / Discharge',                false, true, 'ENVIRONMENTAL'),

    -- Financial
    ('FAILURE_EFFECT_PLANT', 'DEF',  'Deferred Production Revenue Loss',               false, true, 'FINANCIAL'),
    ('FAILURE_EFFECT_PLANT', 'PEN',  'Regulatory Penalty / Fine Risk',                 false, true, 'FINANCIAL'),
    ('FAILURE_EFFECT_PLANT', 'REP',  'Reputational / Stakeholder Impact',              false, true, 'FINANCIAL'),

    -- No Impact
    ('FAILURE_EFFECT_PLANT', 'NIL',  'No Plant-Wide Impact (Contained Locally)',        false, true, 'NONE')
ON CONFLICT (category, code) DO UPDATE
SET description  = EXCLUDED.description,
    active       = EXCLUDED.active,
    category_ref = EXCLUDED.category_ref;
