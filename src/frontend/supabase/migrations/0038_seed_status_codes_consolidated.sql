-- Seed Consolidated Status Codes
-- Merging Work Order, Request, and Recurring Job statuses into single STATUS_CODE dictionary

INSERT INTO dictionaries (type, code, description, active) VALUES
    -- Work Order Statuses
    ('STATUS_CODE', 'OPEN', 'Open', true),
    ('STATUS_CODE', 'PLAN', 'Planning', true),
    ('STATUS_CODE', 'SCHED', 'Scheduled', true),
    ('STATUS_CODE', 'WIP', 'Work In Progress', true),
    ('STATUS_CODE', 'WAIT', 'Waiting for Parts/Access', true),
    ('STATUS_CODE', 'TECO', 'Technically Complete', true),
    ('STATUS_CODE', 'CLOSED', 'Closed (Financial)', true),
    ('STATUS_CODE', 'CANC', 'Cancelled', true),
    
    -- Request Statuses
    ('STATUS_CODE', 'NEW', 'New / Draft', true),
    ('STATUS_CODE', 'REVIEW', 'Under Review', true),
    ('STATUS_CODE', 'AUTHORIZED', 'Authorized (Budget)', true),
    ('STATUS_CODE', 'APPROVED', 'Approved (Technical)', true),
    ('STATUS_CODE', 'REJECTED', 'Rejected', true),
    ('STATUS_CODE', 'CONVERTED', 'Converted to Work Order', true),
    
    -- Recurring Job Statuses
    ('STATUS_CODE', 'ACTIVE', 'Active', true),
    ('STATUS_CODE', 'PAUSED', 'Paused', true)
ON CONFLICT (type, code) DO UPDATE 
SET description = EXCLUDED.description, active = EXCLUDED.active;
