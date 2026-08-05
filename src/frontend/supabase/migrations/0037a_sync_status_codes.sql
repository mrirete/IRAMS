-- Seed Work Order Status Codes to match Admin Dictionaries
-- Ensure these match standard Work Management flows

INSERT INTO dictionaries (type, code, description, active) VALUES
    ('STATUS_CODE', 'OPEN', 'Open', true),
    ('STATUS_CODE', 'PLAN', 'Planning', true),
    ('STATUS_CODE', 'SCHED', 'Scheduled', true),
    ('STATUS_CODE', 'WIP', 'Work In Progress', true),
    ('STATUS_CODE', 'WAIT', 'Waiting', true),
    ('STATUS_CODE', 'TECO', 'Technically Complete', true),
    ('STATUS_CODE', 'CLOSED', 'Closed', true),
    ('STATUS_CODE', 'CANC', 'Cancelled', true)
ON CONFLICT (type, code) DO UPDATE 
SET description = EXCLUDED.description, active = EXCLUDED.active;
