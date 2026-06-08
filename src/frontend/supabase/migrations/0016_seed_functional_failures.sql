-- Seed ISO 14224 Functional Failures
-- These are required for the "New Service Request" form to work correctly with real UUIDs.

INSERT INTO dictionaries (type, code, description, active)
VALUES
    ('FAULT_TYPE', 'FAIL_START', 'Failure to Start on Demand', true),
    ('FAULT_TYPE', 'FAIL_STOP', 'Failure to Stop on Demand', true),
    ('FAULT_TYPE', 'FAIL_RUN', 'Stops Running (Spurious Trip)', true),
    ('FAULT_TYPE', 'LEAK_EXT', 'External Leakage - Process Medium', true),
    ('FAULT_TYPE', 'LEAK_INT', 'Internal Leakage (Passing)', true),
    ('FAULT_TYPE', 'VIBRATION', 'Vibration / Noise High', true),
    ('FAULT_TYPE', 'OVERHEAT', 'High Temperature / Overheating', true),
    ('FAULT_TYPE', 'LOW_OUTPUT', 'Low Output / Pressure / Flow', true),
    ('FAULT_TYPE', 'HIGH_OUTPUT', 'High Output / Pressure / Flow', true),
    ('FAULT_TYPE', 'PARAM_DEV', 'Parameter Deviation (Control)', true),
    ('FAULT_TYPE', 'STRUCTURAL', 'Structural Deficiency / Damage', true),
    ('FAULT_TYPE', 'OTHER', 'Other Functional Failure', true)
ON CONFLICT (type, code) DO NOTHING;
