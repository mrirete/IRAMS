-- Seed Work Order Dictionaries (ISO 14224 & Standard Industry Values)

-- 1. WORK_TYPE
INSERT INTO dictionaries (type, code, description, active) VALUES
    ('WORK_TYPE', 'PM', 'Preventive Maintenance', true),
    ('WORK_TYPE', 'CM', 'Corrective Maintenance', true),
    ('WORK_TYPE', 'PdM', 'Predictive Maintenance', true),
    ('WORK_TYPE', 'EM', 'Emergency Maintenance', true),
    ('WORK_TYPE', 'MOD', 'Modification / Project', true),
    ('WORK_TYPE', 'REF', 'Refurbishment', true),
    ('WORK_TYPE', 'INSP', 'Inspection', true)
ON CONFLICT (type, code) DO NOTHING;

-- 2. PRIORITY
INSERT INTO dictionaries (type, code, description, active) VALUES
    ('PRIORITY', '1', 'Emergency (Immediate)', true),
    ('PRIORITY', '2', 'Urgent (24 Hours)', true),
    ('PRIORITY', '3', 'Routine (7 Days)', true),
    ('PRIORITY', '4', 'Scheduled (Next Shutdown)', true)
ON CONFLICT (type, code) DO NOTHING;

-- 3. STATUS_CODE (Work Order Status)
-- aligning with wo_status enum logic but providing descriptive text for UI
INSERT INTO dictionaries (type, code, description, active) VALUES
    ('STATUS_CODE', 'OPEN', 'Open', true),
    ('STATUS_CODE', 'PLAN', 'Planning', true),
    ('STATUS_CODE', 'SCHED', 'Scheduled', true),
    ('STATUS_CODE', 'WIP', 'Work In Progress', true),
    ('STATUS_CODE', 'WAIT', 'Waiting for Parts/Access', true),
    ('STATUS_CODE', 'TECO', 'Technically Complete', true),
    ('STATUS_CODE', 'CLOSED', 'Closed (Financial)', true),
    ('STATUS_CODE', 'CANC', 'Cancelled', true)
ON CONFLICT (type, code) DO NOTHING;

-- 4. COST_CENTER
INSERT INTO dictionaries (type, code, description, active) VALUES
    ('COST_CENTER', 'M-100', 'Mechanical Maintenance', true),
    ('COST_CENTER', 'E-200', 'Electrical Maintenance', true),
    ('COST_CENTER', 'I-300', 'Instrumentation', true),
    ('COST_CENTER', 'OPS-01', 'Operations - Unit 1', true),
    ('COST_CENTER', 'OPS-02', 'Operations - Unit 2', true),
    ('COST_CENTER', 'ADM-900', 'Plant Administration', true)
ON CONFLICT (type, code) DO NOTHING;

-- 5. FAILURE_MODE (ISO 14224 General)
-- Note: existing 0016 seeded FAULT_TYPE. We specifically need FAILURE_MODE for the UI tab.
-- We can alias or duplicate if FAULT_TYPE was intended for the same, but let's be explicit for the tab.
INSERT INTO dictionaries (type, code, description, active) VALUES
    ('FAILURE_MODE', 'F-ST', 'Fail to Start', true),
    ('FAILURE_MODE', 'F-RN', 'Fail to Run', true),
    ('FAILURE_MODE', 'F-STP', 'Fail to Stop', true),
    ('FAILURE_MODE', 'EL', 'External Leakage', true),
    ('FAILURE_MODE', 'IL', 'Internal Leakage', true),
    ('FAILURE_MODE', 'VIB', 'Vibration', true),
    ('FAILURE_MODE', 'OHT', 'Overheating', true),
    ('FAILURE_MODE', 'NOI', 'Noise', true),
    ('FAILURE_MODE', 'LO', 'Low Output', true),
    ('FAILURE_MODE', 'HO', 'High Output', true),
    ('FAILURE_MODE', 'UNK', 'Unknown / Other', true)
ON CONFLICT (type, code) DO NOTHING;

-- 6. REMEDY_CODE (Action Taken)
INSERT INTO dictionaries (type, code, description, active) VALUES
    ('REMEDY_CODE', 'REP', 'Repaired', true),
    ('REMEDY_CODE', 'RPL', 'Replaced', true),
    ('REMEDY_CODE', 'ADJ', 'Adjusted', true),
    ('REMEDY_CODE', 'CLN', 'Cleaned', true),
    ('REMEDY_CODE', 'INS', 'Inspected', true),
    ('REMEDY_CODE', 'MOD', 'Modified', true),
    ('REMEDY_CODE', 'OVR', 'Overhauled', true)
ON CONFLICT (type, code) DO NOTHING;
