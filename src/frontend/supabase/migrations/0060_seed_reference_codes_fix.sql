-- Seed reference_codes for Service Request UI fixes
-- Includes STATUS_CODE and FAULT_TYPE

INSERT INTO reference_codes (category, code, description, active) VALUES
    -- Status Codes
    ('STATUS_CODE', 'OPEN', 'Open', true),
    ('STATUS_CODE', 'PLAN', 'Planning', true),
    ('STATUS_CODE', 'SCHED', 'Scheduled', true),
    ('STATUS_CODE', 'WIP', 'Work In Progress', true),
    ('STATUS_CODE', 'WAIT', 'Waiting for Parts/Access', true),
    ('STATUS_CODE', 'TECO', 'Technically Complete', true),
    ('STATUS_CODE', 'CLOSED', 'Closed (Financial)', true),
    ('STATUS_CODE', 'CANC', 'Cancelled', true),
    ('STATUS_CODE', 'NEW', 'New / Draft', true),
    ('STATUS_CODE', 'REVIEW', 'Under Review', true),
    ('STATUS_CODE', 'AUTHORIZED', 'Authorized (Budget)', true),
    ('STATUS_CODE', 'APPROVED', 'Approved (Technical)', true),
    ('STATUS_CODE', 'REJECTED', 'Rejected', true),
    ('STATUS_CODE', 'CONVERTED', 'Converted to Work Order', true),

    -- Usage Decisions (Gatekeeper)
    ('USAGE_DECISION', 'APPROVED', 'Approved', true),
    ('USAGE_DECISION', 'REJECTED', 'Rejected', true),
    ('USAGE_DECISION', 'CANCELLED', 'Cancelled', true),

    -- Fault Types (ISO 14224)
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

ON CONFLICT (category, code) DO UPDATE 
SET description = EXCLUDED.description, active = EXCLUDED.active;
