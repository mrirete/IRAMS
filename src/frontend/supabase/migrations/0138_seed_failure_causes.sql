-- ============================================================================
-- Migration 0138: Seed Failure Causes — ISO 14224 Table B.7
-- ============================================================================
-- Populates the FAILURE_CAUSE dictionary with standardized root cause codes.
-- These codes are used in:
--   • Work Orders (wo_failure_data.failure_cause_code)
--   • FMEA Worksheets (ers_fmea_items.failure_cause)
--   • PM Strategies (for cause-based maintenance planning)
--
-- Reference: ISO 14224:2016 §B.2.5, Table B.7 — Failure Cause Classification
-- ============================================================================

-- 0. Ensure unique constraint exists on (category, code) for ON CONFLICT
--    (Safe to re-run if 0137 already created it)
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

-- 1. Clear any existing FAILURE_CAUSE entries (dictionary data, safe to replace)
DELETE FROM reference_codes WHERE category = 'FAILURE_CAUSE';

-- 2. Insert ISO 14224 Failure Cause Codes
INSERT INTO reference_codes (category, code, description, is_locked, active, category_ref) VALUES

    -- ═══════════════════════════════════════════════════════════════════════
    -- DESIGN & ENGINEERING
    -- ═══════════════════════════════════════════════════════════════════════
    ('FAILURE_CAUSE', 'DES',  'Design Error / Inadequate Design',              false, true, 'DESIGN'),
    ('FAILURE_CAUSE', 'MAT',  'Material Defect / Incorrect Material Selection',false, true, 'DESIGN'),
    ('FAILURE_CAUSE', 'SPE',  'Specification Error / Incorrect Sizing',        false, true, 'DESIGN'),
    ('FAILURE_CAUSE', 'SOF',  'Software / Firmware Bug',                       false, true, 'DESIGN'),

    -- ═══════════════════════════════════════════════════════════════════════
    -- FABRICATION & INSTALLATION
    -- ═══════════════════════════════════════════════════════════════════════
    ('FAILURE_CAUSE', 'FAB',  'Fabrication / Manufacturing Defect',            false, true, 'FABRICATION'),
    ('FAILURE_CAUSE', 'INE',  'Installation Error / Incorrect Assembly',       false, true, 'FABRICATION'),
    ('FAILURE_CAUSE', 'COM',  'Commissioning Error',                           false, true, 'FABRICATION'),

    -- ═══════════════════════════════════════════════════════════════════════
    -- OPERATION & HUMAN FACTORS
    -- ═══════════════════════════════════════════════════════════════════════
    ('FAILURE_CAUSE', 'OPE',  'Operating Error / Misuse / Abuse',              false, true, 'OPERATION'),
    ('FAILURE_CAUSE', 'OVL',  'Operating Beyond Design Limits / Overload',     false, true, 'OPERATION'),
    ('FAILURE_CAUSE', 'HUM',  'Human Error (General)',                         false, true, 'OPERATION'),
    ('FAILURE_CAUSE', 'PRO',  'Procedure Deficiency / Not Followed',           false, true, 'OPERATION'),
    ('FAILURE_CAUSE', 'TRN',  'Inadequate Training / Competency Gap',          false, true, 'OPERATION'),

    -- ═══════════════════════════════════════════════════════════════════════
    -- MAINTENANCE RELATED
    -- ═══════════════════════════════════════════════════════════════════════
    ('FAILURE_CAUSE', 'MNT',  'Inadequate Maintenance / Missed PM',            false, true, 'MAINTENANCE'),
    ('FAILURE_CAUSE', 'LUB',  'Lubrication Failure / Wrong Lubricant',         false, true, 'MAINTENANCE'),
    ('FAILURE_CAUSE', 'CAL',  'Calibration Error / Drift',                     false, true, 'MAINTENANCE'),
    ('FAILURE_CAUSE', 'SPR',  'Wrong / Substandard Spare Part',                false, true, 'MAINTENANCE'),
    ('FAILURE_CAUSE', 'RPR',  'Previous Repair Deficiency',                    false, true, 'MAINTENANCE'),

    -- ═══════════════════════════════════════════════════════════════════════
    -- DEGRADATION & AGEING
    -- ═══════════════════════════════════════════════════════════════════════
    ('FAILURE_CAUSE', 'AGE',  'Normal Wear / Ageing / End of Life',            false, true, 'DEGRADATION'),
    ('FAILURE_CAUSE', 'COR',  'Corrosion / Chemical Attack',                   false, true, 'DEGRADATION'),
    ('FAILURE_CAUSE', 'ERO',  'Erosion / Abrasion',                            false, true, 'DEGRADATION'),
    ('FAILURE_CAUSE', 'FAT',  'Fatigue (Mechanical / Thermal)',                false, true, 'DEGRADATION'),
    ('FAILURE_CAUSE', 'EMB',  'Embrittlement (Hydrogen / Temper)',             false, true, 'DEGRADATION'),
    ('FAILURE_CAUSE', 'FOU',  'Fouling / Scaling / Deposit Build-up',          false, true, 'DEGRADATION'),

    -- ═══════════════════════════════════════════════════════════════════════
    -- PROCESS & ENVIRONMENTAL
    -- ═══════════════════════════════════════════════════════════════════════
    ('FAILURE_CAUSE', 'CON',  'Contamination / Foreign Object Damage',         false, true, 'PROCESS'),
    ('FAILURE_CAUSE', 'PRC',  'Process Upset / Off-Spec Conditions',           false, true, 'PROCESS'),
    ('FAILURE_CAUSE', 'ENV',  'Environmental Conditions (Weather / Sand)',      false, true, 'PROCESS'),
    ('FAILURE_CAUSE', 'EXT',  'External Impact / Third-Party Damage',          false, true, 'PROCESS'),
    ('FAILURE_CAUSE', 'VIB',  'Excessive Vibration / Dynamic Loading',         false, true, 'PROCESS'),
    ('FAILURE_CAUSE', 'THM',  'Thermal Stress / Thermal Cycling',              false, true, 'PROCESS'),

    -- ═══════════════════════════════════════════════════════════════════════
    -- ELECTRICAL & CONTROL
    -- ═══════════════════════════════════════════════════════════════════════
    ('FAILURE_CAUSE', 'PWR',  'Power Supply Anomaly (Surge / Sag / Loss)',     false, true, 'ELECTRICAL'),
    ('FAILURE_CAUSE', 'ELC',  'Electrical Overload / Short Circuit',           false, true, 'ELECTRICAL'),
    ('FAILURE_CAUSE', 'CTL',  'Control System / Logic Error',                  false, true, 'ELECTRICAL'),

    -- ═══════════════════════════════════════════════════════════════════════
    -- MANAGEMENT / SYSTEMIC
    -- ═══════════════════════════════════════════════════════════════════════
    ('FAILURE_CAUSE', 'MOC',  'Management of Change Failure',                  false, true, 'MANAGEMENT'),
    ('FAILURE_CAUSE', 'SUP',  'Supply Chain / Counterfeit Part',               false, true, 'MANAGEMENT'),

    -- ═══════════════════════════════════════════════════════════════════════
    -- UNKNOWN / PENDING
    -- ═══════════════════════════════════════════════════════════════════════
    ('FAILURE_CAUSE', 'UNK',  'Unknown / Under Investigation',                false, true, NULL),
    ('FAILURE_CAUSE', 'OTH',  'Other (Specify in Comments)',                   false, true, NULL)

ON CONFLICT (category, code) DO UPDATE
SET description  = EXCLUDED.description,
    is_locked    = EXCLUDED.is_locked,
    active       = EXCLUDED.active,
    category_ref = EXCLUDED.category_ref;
