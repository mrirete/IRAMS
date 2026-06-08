-- ============================================================================
-- Migration 0137: Expand Failure Modes — ISO 14224 Full Asset Class Coverage
-- ============================================================================
-- Replaces the original 16 generic failure modes with a comprehensive 70+ mode
-- taxonomy grouped by asset class using category_ref.
-- 
-- Groups: GENERAL, ROTATING, STATIC_PRESSURE, ELECTRICAL, INSTRUMENT,
--         PIPING, SAFETY_SYSTEM, HEAT_TRANSFER, STRUCTURAL
-- ============================================================================

-- 0. Ensure unique constraint exists on (category, code) for ON CONFLICT
--    First, remove any duplicate (category, code) rows that would block the index
DELETE FROM reference_codes a
  USING reference_codes b
  WHERE a.ctid < b.ctid
    AND a.category = b.category
    AND a.code = b.code;

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

-- 1. Remove existing FAILURE_MODE entries (dictionary data, not transactional — safe to replace)
--    Existing wo_failure_data records use TEXT codes, so historical data is preserved.
DELETE FROM reference_codes WHERE category = 'FAILURE_MODE';

-- 2. Insert comprehensive ISO 14224 Failure Modes grouped by asset class
INSERT INTO reference_codes (category, code, description, is_locked, active, category_ref) VALUES

    -- ═══════════════════════════════════════════════════════════════════════
    -- GENERAL — Applicable to ALL asset types (no category_ref filter)
    -- ═══════════════════════════════════════════════════════════════════════
    ('FAILURE_MODE', 'BRD',  'Breakdown (Complete Loss of Function)',   false, true, NULL),
    ('FAILURE_MODE', 'ERO',  'Erratic / Irregular Output',             false, true, NULL),
    ('FAILURE_MODE', 'NOI',  'Abnormal Noise',                         false, true, NULL),
    ('FAILURE_MODE', 'VIB',  'Abnormal Vibration',                     false, true, NULL),
    ('FAILURE_MODE', 'OHE',  'Overheating',                            false, true, NULL),
    ('FAILURE_MODE', 'ELP',  'External Leakage — Process Medium',      false, true, NULL),
    ('FAILURE_MODE', 'ELU',  'External Leakage — Utility Medium',      false, true, NULL),
    ('FAILURE_MODE', 'INL',  'Internal Leakage / Passing',             false, true, NULL),
    ('FAILURE_MODE', 'STD',  'Structural Deficiency / Deformation',    false, true, NULL),
    ('FAILURE_MODE', 'PLU',  'Plugged / Choked / Fouled',              false, true, NULL),
    ('FAILURE_MODE', 'LOO',  'Low Output / Reduced Performance',       false, true, NULL),
    ('FAILURE_MODE', 'HIO',  'High Output / Overspeed',                false, true, NULL),
    ('FAILURE_MODE', 'SLF',  'Spurious / False Activation',            false, true, NULL),
    ('FAILURE_MODE', 'MNR',  'Minor In-Service Problem (Degraded)',    false, true, NULL),
    ('FAILURE_MODE', 'UNK',  'Unknown / Other',                        false, true, NULL),

    -- ═══════════════════════════════════════════════════════════════════════
    -- ROTATING — Pumps, Compressors, Turbines, Fans, Blowers
    -- ═══════════════════════════════════════════════════════════════════════
    ('FAILURE_MODE', 'FTS',  'Fail to Start',                          false, true, 'ROTATING'),
    ('FAILURE_MODE', 'STP',  'Fail to Stop / Overspeed',               false, true, 'ROTATING'),
    ('FAILURE_MODE', 'SEL',  'Seal Failure / Seal Leakage',            false, true, 'ROTATING'),
    ('FAILURE_MODE', 'BRG',  'Bearing Failure',                        false, true, 'ROTATING'),
    ('FAILURE_MODE', 'IMP',  'Impeller / Rotor Damage',                false, true, 'ROTATING'),
    ('FAILURE_MODE', 'CVT',  'Cavitation',                             false, true, 'ROTATING'),
    ('FAILURE_MODE', 'SRG',  'Surge (Compressor)',                     false, true, 'ROTATING'),
    ('FAILURE_MODE', 'MIS',  'Misalignment / Shaft Deflection',        false, true, 'ROTATING'),
    ('FAILURE_MODE', 'LUB',  'Lubrication Failure / Oil Contamination',false, true, 'ROTATING'),
    ('FAILURE_MODE', 'COU',  'Coupling Failure',                       false, true, 'ROTATING'),
    ('FAILURE_MODE', 'BAL',  'Imbalance / Out of Balance',             false, true, 'ROTATING'),

    -- ═══════════════════════════════════════════════════════════════════════
    -- STATIC_PRESSURE — Vessels, Tanks, Separators, Columns
    -- ═══════════════════════════════════════════════════════════════════════
    ('FAILURE_MODE', 'COR',  'Corrosion (Internal / External)',        false, true, 'STATIC_PRESSURE'),
    ('FAILURE_MODE', 'ERN',  'Erosion',                                false, true, 'STATIC_PRESSURE'),
    ('FAILURE_MODE', 'CRK',  'Cracking / Fatigue',                    false, true, 'STATIC_PRESSURE'),
    ('FAILURE_MODE', 'BLG',  'Bulging / Deformation',                 false, true, 'STATIC_PRESSURE'),
    ('FAILURE_MODE', 'LVL',  'Level Control Failure',                  false, true, 'STATIC_PRESSURE'),
    ('FAILURE_MODE', 'PRO',  'Pressure Relief Malfunction',            false, true, 'STATIC_PRESSURE'),
    ('FAILURE_MODE', 'FOL',  'Fouling / Scaling',                      false, true, 'STATIC_PRESSURE'),
    ('FAILURE_MODE', 'LCK',  'Leak at Connection / Flange',           false, true, 'STATIC_PRESSURE'),

    -- ═══════════════════════════════════════════════════════════════════════
    -- ELECTRICAL — Motors, Generators, Switchgear, Transformers, VSD
    -- ═══════════════════════════════════════════════════════════════════════
    ('FAILURE_MODE', 'INS',  'Insulation Failure / Breakdown',         false, true, 'ELECTRICAL'),
    ('FAILURE_MODE', 'WDG',  'Winding Failure (Open / Short)',         false, true, 'ELECTRICAL'),
    ('FAILURE_MODE', 'OVL',  'Overload / Overcurrent Trip',           false, true, 'ELECTRICAL'),
    ('FAILURE_MODE', 'GRD',  'Earth / Ground Fault',                   false, true, 'ELECTRICAL'),
    ('FAILURE_MODE', 'ARC',  'Arcing / Flashover',                     false, true, 'ELECTRICAL'),
    ('FAILURE_MODE', 'CTF',  'Contactor / Breaker Failure',           false, true, 'ELECTRICAL'),
    ('FAILURE_MODE', 'PWR',  'Power Supply Failure',                   false, true, 'ELECTRICAL'),
    ('FAILURE_MODE', 'PHS',  'Phase Imbalance / Loss of Phase',       false, true, 'ELECTRICAL'),
    ('FAILURE_MODE', 'OVV',  'Overvoltage / Undervoltage',            false, true, 'ELECTRICAL'),
    ('FAILURE_MODE', 'COL',  'Cooling Failure (Transformer / Motor)', false, true, 'ELECTRICAL'),

    -- ═══════════════════════════════════════════════════════════════════════
    -- INSTRUMENT — Transmitters, Analyzers, Control Valves, Meters
    -- ═══════════════════════════════════════════════════════════════════════
    ('FAILURE_MODE', 'AIR',  'Abnormal Instrument Reading',            false, true, 'INSTRUMENT'),
    ('FAILURE_MODE', 'FTC',  'Fail to Close',                          false, true, 'INSTRUMENT'),
    ('FAILURE_MODE', 'FTO',  'Fail to Open',                           false, true, 'INSTRUMENT'),
    ('FAILURE_MODE', 'FTR',  'Fail to Regulate / Control',            false, true, 'INSTRUMENT'),
    ('FAILURE_MODE', 'DFT',  'Signal Drift / Calibration Shift',      false, true, 'INSTRUMENT'),
    ('FAILURE_MODE', 'SIG',  'Signal Loss / Communication Failure',   false, true, 'INSTRUMENT'),
    ('FAILURE_MODE', 'STK',  'Sticking / Seized',                     false, true, 'INSTRUMENT'),
    ('FAILURE_MODE', 'SPO',  'Spurious Operation / False Trip',       false, true, 'INSTRUMENT'),
    ('FAILURE_MODE', 'SET',  'Setpoint Error',                         false, true, 'INSTRUMENT'),
    ('FAILURE_MODE', 'SEN',  'Sensor Failure / Probe Degraded',       false, true, 'INSTRUMENT'),

    -- ═══════════════════════════════════════════════════════════════════════
    -- PIPING — Process Piping, Fittings, Flanges
    -- ═══════════════════════════════════════════════════════════════════════
    ('FAILURE_MODE', 'LCP',  'Leakage through Pipe Wall / Casing',    false, true, 'PIPING'),
    ('FAILURE_MODE', 'PCR',  'Pipe Corrosion (Internal / External)',   false, true, 'PIPING'),
    ('FAILURE_MODE', 'PER',  'Pipe Erosion',                           false, true, 'PIPING'),
    ('FAILURE_MODE', 'FLG',  'Flange Leak / Gasket Failure',          false, true, 'PIPING'),
    ('FAILURE_MODE', 'WLD',  'Weld Defect / Weld Failure',            false, true, 'PIPING'),
    ('FAILURE_MODE', 'SUP',  'Support / Hanger Failure',               false, true, 'PIPING'),
    ('FAILURE_MODE', 'THM',  'Thermal Expansion Damage',               false, true, 'PIPING'),

    -- ═══════════════════════════════════════════════════════════════════════
    -- SAFETY_SYSTEM — F&G, ESD, PSV, Deluge, SIS
    -- ═══════════════════════════════════════════════════════════════════════
    ('FAILURE_MODE', 'FTF',  'Fail to Function on Demand (Dangerous)', false, true, 'SAFETY_SYSTEM'),
    ('FAILURE_MODE', 'SPT',  'Spurious Trip (Nuisance)',               false, true, 'SAFETY_SYSTEM'),
    ('FAILURE_MODE', 'SLK',  'Safety Valve Seat Leakage',              false, true, 'SAFETY_SYSTEM'),
    ('FAILURE_MODE', 'SOV',  'Solenoid Valve Failure',                 false, true, 'SAFETY_SYSTEM'),
    ('FAILURE_MODE', 'DET',  'Detector Failure / False Alarm',         false, true, 'SAFETY_SYSTEM'),
    ('FAILURE_MODE', 'LGC',  'Logic Solver / PLC Fault',               false, true, 'SAFETY_SYSTEM'),

    -- ═══════════════════════════════════════════════════════════════════════
    -- HEAT_TRANSFER — Heat Exchangers, Air Coolers, Boilers
    -- ═══════════════════════════════════════════════════════════════════════
    ('FAILURE_MODE', 'TBL',  'Tube Leak / Tube Bundle Failure',        false, true, 'HEAT_TRANSFER'),
    ('FAILURE_MODE', 'TBP',  'Tube Plugging / Fouling',                false, true, 'HEAT_TRANSFER'),
    ('FAILURE_MODE', 'BFL',  'Baffle / Internal Damage',               false, true, 'HEAT_TRANSFER'),
    ('FAILURE_MODE', 'FNF',  'Fan Failure (Air Cooler)',               false, true, 'HEAT_TRANSFER'),
    ('FAILURE_MODE', 'FRZ',  'Freezing / Winterization Failure',       false, true, 'HEAT_TRANSFER'),
    ('FAILURE_MODE', 'RDT',  'Reduced Thermal Performance',            false, true, 'HEAT_TRANSFER')

ON CONFLICT (category, code) DO UPDATE
SET description  = EXCLUDED.description,
    is_locked    = EXCLUDED.is_locked,
    active       = EXCLUDED.active,
    category_ref = EXCLUDED.category_ref;
