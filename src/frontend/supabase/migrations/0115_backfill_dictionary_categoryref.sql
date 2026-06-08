-- Backfill categoryRef for ISO 14224 hierarchy: Category → Class → Type
-- This sets the parent-child relationships in the JSONB properties column
-- so that cascading dropdowns work correctly in the Asset Registry.

-- Step 1: Update ASSET_CLASS entries with their parent ASSET_CATEGORY code
-- Aligned with MOCK_DICTIONARIES in constants.ts

-- Rotating Equipment classes → MECHANICAL (or ROTATING depending on seed)
UPDATE reference_codes
SET properties = COALESCE(properties, '{}'::jsonb) || jsonb_build_object('categoryRef', 'MECHANICAL')
WHERE category = 'ASSET_CLASS' AND code IN ('ROTATING', 'STATIC_PRESSURE', 'HEAT_TRANSFER');

UPDATE reference_codes
SET properties = COALESCE(properties, '{}'::jsonb) || jsonb_build_object('categoryRef', 'ELECTRICAL')
WHERE category = 'ASSET_CLASS' AND code IN ('POWER_DISTRIBUTION', 'MOTORS_DRIVES', 'GENERATORS');

UPDATE reference_codes
SET properties = COALESCE(properties, '{}'::jsonb) || jsonb_build_object('categoryRef', 'INSTRUMENT')
WHERE category = 'ASSET_CLASS' AND code IN ('PROCESS_CONTROL', 'ANALYZERS');

UPDATE reference_codes
SET properties = COALESCE(properties, '{}'::jsonb) || jsonb_build_object('categoryRef', 'PIPING')
WHERE category = 'ASSET_CLASS' AND code IN ('PROCESS_PIPING');

UPDATE reference_codes
SET properties = COALESCE(properties, '{}'::jsonb) || jsonb_build_object('categoryRef', 'SAFETY_SYSTEM')
WHERE category = 'ASSET_CLASS' AND code IN ('FIRE_GAS', 'ESD', 'PSV');

-- Also handle legacy seed data from migration 0047 (ROTATING/STATIC/ELECTRICAL/INSTRUMENTATION categories)
UPDATE reference_codes
SET properties = COALESCE(properties, '{}'::jsonb) || jsonb_build_object('categoryRef', 'ROTATING')
WHERE category = 'ASSET_CLASS' AND code IN ('CENTRIFUGAL_PUMP', 'RECIPROCATING_PUMP', 'SCREW_COMPRESSOR', 'RECIPROCATING_COMPRESSOR')
  AND NOT EXISTS (SELECT 1 FROM jsonb_each_text(COALESCE(properties, '{}'::jsonb)) WHERE key = 'categoryRef');

UPDATE reference_codes
SET properties = COALESCE(properties, '{}'::jsonb) || jsonb_build_object('categoryRef', 'STATIC')
WHERE category = 'ASSET_CLASS' AND code IN ('PRESSURE_VESSEL', 'STORAGE_TANK', 'HEAT_EXCHANGER', 'GATE_VALVE', 'BALL_VALVE')
  AND NOT EXISTS (SELECT 1 FROM jsonb_each_text(COALESCE(properties, '{}'::jsonb)) WHERE key = 'categoryRef');


-- Step 2: Update ASSET_TYPE entries with their parent ASSET_CLASS code
UPDATE reference_codes
SET properties = COALESCE(properties, '{}'::jsonb) || jsonb_build_object('categoryRef', 'ROTATING')
WHERE category = 'ASSET_TYPE' AND code IN ('CENTRIFUGAL_PUMP', 'RECIPROCATING_PUMP', 'CENTRIFUGAL_COMPRESSOR', 'RECIPROCATING_COMPRESSOR', 'GAS_TURBINE', 'STEAM_TURBINE');

UPDATE reference_codes
SET properties = COALESCE(properties, '{}'::jsonb) || jsonb_build_object('categoryRef', 'MOTORS_DRIVES')
WHERE category = 'ASSET_TYPE' AND code IN ('ELECTRIC_MOTOR', 'VSD');

UPDATE reference_codes
SET properties = COALESCE(properties, '{}'::jsonb) || jsonb_build_object('categoryRef', 'STATIC_PRESSURE')
WHERE category = 'ASSET_TYPE' AND code IN ('PRESSURE_VESSEL', 'STORAGE_TANK', 'SEPARATOR');

UPDATE reference_codes
SET properties = COALESCE(properties, '{}'::jsonb) || jsonb_build_object('categoryRef', 'HEAT_TRANSFER')
WHERE category = 'ASSET_TYPE' AND code IN ('HEAT_EXCHANGER', 'AIR_COOLER');

UPDATE reference_codes
SET properties = COALESCE(properties, '{}'::jsonb) || jsonb_build_object('categoryRef', 'POWER_DISTRIBUTION')
WHERE category = 'ASSET_TYPE' AND code IN ('TRANSFORMER', 'SWITCHGEAR');

UPDATE reference_codes
SET properties = COALESCE(properties, '{}'::jsonb) || jsonb_build_object('categoryRef', 'PROCESS_CONTROL')
WHERE category = 'ASSET_TYPE' AND code IN ('FLOW_METER', 'CONTROL_VALVE', 'PRESSURE_TRANSMITTER');

UPDATE reference_codes
SET properties = COALESCE(properties, '{}'::jsonb) || jsonb_build_object('categoryRef', 'FIRE_GAS')
WHERE category = 'ASSET_TYPE' AND code IN ('GAS_DETECTOR', 'FIRE_DETECTOR');

-- Also handle legacy ASSET_TYPE entries from migration 0047 that have no parent link
-- Link them to a generic category if no categoryRef exists yet
UPDATE reference_codes
SET properties = COALESCE(properties, '{}'::jsonb) || jsonb_build_object('categoryRef', 'ROTATING')
WHERE category = 'ASSET_TYPE' AND code IN ('PUMP', 'MOTOR', 'COMPRESSOR', 'FAN')
  AND NOT EXISTS (SELECT 1 FROM jsonb_each_text(COALESCE(properties, '{}'::jsonb)) WHERE key = 'categoryRef');

UPDATE reference_codes
SET properties = COALESCE(properties, '{}'::jsonb) || jsonb_build_object('categoryRef', 'STATIC')
WHERE category = 'ASSET_TYPE' AND code IN ('VALVE', 'TANK', 'CONVEYOR')
  AND NOT EXISTS (SELECT 1 FROM jsonb_each_text(COALESCE(properties, '{}'::jsonb)) WHERE key = 'categoryRef');
