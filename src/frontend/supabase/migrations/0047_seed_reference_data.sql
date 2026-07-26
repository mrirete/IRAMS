-- Seed Reference Codes (Aligned with constants.ts MOCK_DICTIONARIES)

-- FIXED 2026-07-25: reference_codes is not created until 0071, so on a fresh
-- replay this seed — and the seven migrations after it that touch the table
-- (0049, 0050, 0054, 0060, 0061, 0062, 0064) — all failed. The table is now
-- created here if missing, using 0071's exact definition, so 0071's own
-- CREATE TABLE IF NOT EXISTS becomes a harmless no-op and nothing diverges.
CREATE TABLE IF NOT EXISTS reference_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category TEXT NOT NULL,
    code TEXT NOT NULL,
    description TEXT NOT NULL,
    is_locked BOOLEAN DEFAULT FALSE,
    active BOOLEAN DEFAULT TRUE,
    properties JSONB DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    category_ref TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    color_code TEXT,
    sort_order INTEGER
);

-- The seed below uses ON CONFLICT (category, code), which needs this unique
-- index to exist. It matches reference_codes_category_code_key on the origin.
CREATE UNIQUE INDEX IF NOT EXISTS reference_codes_category_code_key
    ON reference_codes (category, code);

-- 0. Ensure 'active' column exists (Missing in original schema but required by app)
ALTER TABLE reference_codes ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE;

-- 1. Clean up existing data for categories we are about to strictly enforce
DELETE FROM reference_codes WHERE category IN (
    'CONTACT_TYPE', 'STATUS_CODE', 'READING_TYPE', 'UOM', 'INVENTORY_TYPE', 
    'PRIORITY', 'WORK_TYPE', 'ASSET_TYPE', 'ASSET_CATEGORY', 'ASSET_CLASS', 
    'COST_CENTRE', 'FAULT_TYPE', 'FAILURE_MODE', 'REMEDY_CODE'
);

-- 2. Insert MOCK_DICTIONARIES Values
INSERT INTO reference_codes (category, code, description, is_locked, active) VALUES

    -- CONTACT_TYPE (Roles)
    ('CONTACT_TYPE', 'TECHNICIAN', 'Maintenance Technician', false, true),
    ('CONTACT_TYPE', 'PLANNER', 'Maintenance Planner', false, true),
    ('CONTACT_TYPE', 'SUPERVISOR', 'Maintenance Supervisor', false, true),
    ('CONTACT_TYPE', 'VENDOR', 'External Vendor', true, true), -- locked
    ('CONTACT_TYPE', 'MANUFACTURER', 'Equipment Manufacturer', true, true), -- locked
    ('CONTACT_TYPE', 'INTERNAL', 'Internal Employee', false, true),
    ('CONTACT_TYPE', 'RELIABILITY_ENG', 'Reliability Engineer', false, true),
    ('CONTACT_TYPE', 'REQUESTER', 'Service Requester', false, true),
    ('CONTACT_TYPE', 'SYS_ADMIN', 'System Administrator', true, true), -- locked

    -- STATUS_CODE
    ('STATUS_CODE', 'OPEN', 'Open / New', false, true),
    ('STATUS_CODE', 'PLAN', 'Planning', false, true),
    ('STATUS_CODE', 'SCHED', 'Scheduled', false, true),
    ('STATUS_CODE', 'WIP', 'Work In Progress', false, true),
    ('STATUS_CODE', 'WAIT', 'Waiting for Parts/Access', false, true),
    ('STATUS_CODE', 'TECO', 'Technically Complete', false, true),
    ('STATUS_CODE', 'CLOSED', 'Closed (Financial)', false, true),
    ('STATUS_CODE', 'CANC', 'Cancelled', false, true),
    ('STATUS_CODE', 'REJECTED', 'Rejected', false, true),

    -- READING_TYPE
    ('READING_TYPE', 'Hours', 'Running Hours', true, true),
    ('READING_TYPE', 'KM', 'Kilometres', true, true),
    ('READING_TYPE', 'Temperature', 'Temperature (C)', false, true),
    ('READING_TYPE', 'Vibration', 'Vibration (mm/s)', false, true),
    ('READING_TYPE', 'Pressure', 'Pressure (Bar)', false, true),

    -- UOM
    ('UOM', 'EA', 'Each', false, true),
    ('UOM', 'KG', 'Kilogram', false, true),
    ('UOM', 'LTR', 'Litre', false, true),
    ('UOM', 'M', 'Metre', false, true),
    ('UOM', 'BOX', 'Box', false, true),
    ('UOM', 'SET', 'Set', false, true),
    ('UOM', 'HR', 'Hour', false, true),

    -- INVENTORY_TYPE
    ('INVENTORY_TYPE', 'SPARE', 'Spare Part', false, true),
    ('INVENTORY_TYPE', 'CONSUMABLE', 'Consumable / Expense', false, true),
    ('INVENTORY_TYPE', 'RAW', 'Raw Material', false, true),
    ('INVENTORY_TYPE', 'ROTABLE', 'Rotable Asset', false, true),
    ('INVENTORY_TYPE', 'SERVICE', 'Service / Labor', false, true),
    ('INVENTORY_TYPE', 'TOOL', 'Tooling', false, true),

    -- PRIORITY
    ('PRIORITY', 'HIGH', 'Immediate Action Required', false, true),
    ('PRIORITY', 'MEDIUM', 'Schedule within 7 days', false, true),
    ('PRIORITY', 'LOW', 'Schedule when resources available', false, true),

    -- WORK_TYPE
    ('WORK_TYPE', 'CM', 'Corrective Maintenance', false, true),
    ('WORK_TYPE', 'PM', 'Preventive Maintenance', false, true),

    -- ASSET_TYPE
    ('ASSET_TYPE', 'PUMP', 'Pump', false, true),
    ('ASSET_TYPE', 'MOTOR', 'Electric Motor', false, true),
    ('ASSET_TYPE', 'VALVE', 'Valve', false, true),
    ('ASSET_TYPE', 'TANK', 'Storage Tank', false, true),
    ('ASSET_TYPE', 'COMPRESSOR', 'Compressor', false, true),
    ('ASSET_TYPE', 'FAN', 'Fan / Blower', false, true),
    ('ASSET_TYPE', 'CONVEYOR', 'Conveyor Belt', false, true),
    ('ASSET_TYPE', 'SITE', 'Site / Plant', false, true),
    ('ASSET_TYPE', 'AREA', 'Area / Zone', false, true),
    ('ASSET_TYPE', 'UNIT', 'Process Unit', false, true),
    ('ASSET_TYPE', 'SYSTEM', 'System', false, true),

    -- ASSET_CATEGORY
    ('ASSET_CATEGORY', 'ROTATING', 'Rotating Equipment', false, true),
    ('ASSET_CATEGORY', 'STATIC', 'Static Equipment', false, true),
    ('ASSET_CATEGORY', 'ELECTRICAL', 'Electrical', false, true),
    ('ASSET_CATEGORY', 'INSTRUMENTATION', 'Instrumentation', false, true),

    -- ASSET_CLASS
    ('ASSET_CLASS', 'CENTRIFUGAL_PUMP', 'Centrifugal Pump', false, true),
    ('ASSET_CLASS', 'RECIPROCATING_PUMP', 'Reciprocating Pump', false, true),
    ('ASSET_CLASS', 'SCREW_COMPRESSOR', 'Screw Compressor', false, true),
    ('ASSET_CLASS', 'RECIPROCATING_COMPRESSOR', 'Reciprocating Compressor', false, true),
    ('ASSET_CLASS', 'PRESSURE_VESSEL', 'Pressure Vessel', false, true),
    ('ASSET_CLASS', 'STORAGE_TANK', 'Storage Tank', false, true),
    ('ASSET_CLASS', 'HEAT_EXCHANGER', 'Heat Exchanger', false, true),
    ('ASSET_CLASS', 'GATE_VALVE', 'Gate Valve', false, true),
    ('ASSET_CLASS', 'BALL_VALVE', 'Ball Valve', false, true),

    -- COST_CENTRE
    ('COST_CENTRE', 'CC-M100', 'Main Maintenance', false, true),

    -- FAULT_TYPE (Functional Failures)
    ('FAULT_TYPE', 'FAIL_START', 'Failure to Start on Demand', false, true),
    ('FAULT_TYPE', 'FAIL_STOP', 'Failure to Stop on Demand', false, true),
    ('FAULT_TYPE', 'FAIL_RUN', 'Stops Running (Spurious Trip)', false, true),
    ('FAULT_TYPE', 'LEAK_EXT', 'External Leakage - Process Medium', false, true),
    ('FAULT_TYPE', 'LEAK_INT', 'Internal Leakage (Passing)', false, true),
    ('FAULT_TYPE', 'VIBRATION', 'Vibration / Noise High', false, true),
    ('FAULT_TYPE', 'OVERHEAT', 'High Temperature / Overheating', false, true),
    ('FAULT_TYPE', 'LOW_OUTPUT', 'Low Output / Pressure / Flow', false, true),
    ('FAULT_TYPE', 'HIGH_OUTPUT', 'High Output / Pressure / Flow', false, true),
    ('FAULT_TYPE', 'PARAM_DEV', 'Parameter Deviation (Control)', false, true),
    ('FAULT_TYPE', 'STRUCTURAL', 'Structural Deficiency / Damage', false, true),
    ('FAULT_TYPE', 'OTHER', 'Other Functional Failure', false, true),

    -- FAILURE_MODE (Observed Manner)
    ('FAILURE_MODE', 'AIR', 'Abnormal Instrument Reading', false, true),
    ('FAILURE_MODE', 'BRD', 'Breakdown', false, true),
    ('FAILURE_MODE', 'ELP', 'External Leakage - Process Medium', false, true),
    ('FAILURE_MODE', 'ELU', 'External Leakage - Utility Medium', false, true),
    ('FAILURE_MODE', 'ERO', 'Erratic Output', false, true),
    ('FAILURE_MODE', 'FTO', 'Fail to Open', false, true),
    ('FAILURE_MODE', 'FTC', 'Fail to Close', false, true),
    ('FAILURE_MODE', 'FTS', 'Fail to Start', false, true),
    ('FAILURE_MODE', 'STP', 'Fail to Stop', false, true),
    ('FAILURE_MODE', 'INL', 'Internal Leakage', false, true),
    ('FAILURE_MODE', 'LCP', 'Leakage through casing', false, true),
    ('FAILURE_MODE', 'NOI', 'Noise', false, true),
    ('FAILURE_MODE', 'OHE', 'Overheating', false, true),
    ('FAILURE_MODE', 'PLU', 'Plugged/Choked', false, true),
    ('FAILURE_MODE', 'STD', 'Structural Deficiency', false, true),
    ('FAILURE_MODE', 'VIB', 'Vibration', false, true)

-- Note: REMEDY_CODE is explicitly removed (commented out in constants.ts)
ON CONFLICT (category, code) DO UPDATE 
SET description = EXCLUDED.description, 
    is_locked = EXCLUDED.is_locked, 
    active = EXCLUDED.active;

-- Seed Assets
--
-- GUARDED 2026-07-25: this writes assets.status, a column that does not exist
-- (the schema has status_code) — so the statement has always failed, aborting
-- the whole file and everything that follows it. It is also demo data in a
-- reference-data migration: two sample assets that no customer wants. Guarded
-- rather than repaired, so it skips everywhere while the reference seeds above
-- (which are wanted) still apply.
DO $$
BEGIN
IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'assets' AND column_name = 'status'
) THEN
    INSERT INTO assets (id, name, tag, status, criticality, hierarchy_level, site_id) VALUES
        ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Atlas Copco Compressor', 'AC-2024-01', 'OPERATIONAL', 'A', 'Equipment', 'MAIN-SITE'),
        ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', 'Cat Generator 3516', 'GEN-01', 'OPERATIONAL', 'A', 'Equipment', 'MAIN-SITE')
    ON CONFLICT (id) DO NOTHING;
ELSE
    RAISE NOTICE '0047: assets.status does not exist — skipping demo asset seed.';
END IF;
END $$;
