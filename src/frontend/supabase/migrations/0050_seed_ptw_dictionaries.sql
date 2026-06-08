-- Seed Permit to Work (PTW) Dictionaries
-- Follows same pattern as 0031_seed_work_order_dictionaries.sql

-- 1. PERMIT_TYPE — Industry-standard permit classifications
INSERT INTO reference_codes (category, code, description, active, is_locked) VALUES
    ('PERMIT_TYPE', 'HOT_WORK', 'Hot Work (Welding, Cutting, Grinding)', true, false),
    ('PERMIT_TYPE', 'COLD_WORK', 'Cold Work (General Maintenance)', true, false),
    ('PERMIT_TYPE', 'CONFINED_SPACE', 'Confined Space Entry', true, false),
    ('PERMIT_TYPE', 'ELECTRICAL', 'Electrical Work (Live/Dead)', true, false),
    ('PERMIT_TYPE', 'HEIGHT', 'Work at Height', true, false),
    ('PERMIT_TYPE', 'CHEMICAL', 'Chemical Handling', true, false),
    ('PERMIT_TYPE', 'RADIATION', 'Radiography / Radiation', true, false),
    ('PERMIT_TYPE', 'EXCAVATION', 'Excavation / Ground Disturbance', true, false),
    ('PERMIT_TYPE', 'GENERAL', 'General Permit', true, false)
ON CONFLICT (category, code) DO NOTHING;

-- 2. PTW_STATUS — Permit lifecycle status codes
INSERT INTO reference_codes (category, code, description, active, is_locked) VALUES
    ('PTW_STATUS', 'DRAFT', 'Draft — Not yet submitted', true, false),
    ('PTW_STATUS', 'PENDING', 'Pending Approval', true, false),
    ('PTW_STATUS', 'APPROVED', 'Approved — Awaiting issuance', true, false),
    ('PTW_STATUS', 'ISSUED', 'Issued — Toolbox talk complete', true, false),
    ('PTW_STATUS', 'ACTIVE', 'Active — Work in progress', true, false),
    ('PTW_STATUS', 'SUSPENDED', 'Suspended — Safety concern', true, false),
    ('PTW_STATUS', 'RETURNED', 'Returned — Work complete', true, false),
    ('PTW_STATUS', 'CLOSED', 'Closed — All isolations de-isolated', true, false),
    ('PTW_STATUS', 'REJECTED', 'Rejected', true, false)
ON CONFLICT (category, code) DO NOTHING;

-- 3. ISOLATION_TYPE — LOTO isolation point classifications
INSERT INTO reference_codes (category, code, description, active, is_locked) VALUES
    ('ISOLATION_TYPE', 'ELECTRICAL', 'Electrical Isolation', true, false),
    ('ISOLATION_TYPE', 'MECHANICAL', 'Mechanical Isolation', true, false),
    ('ISOLATION_TYPE', 'PROCESS', 'Process Isolation (Valves/Blinds)', true, false),
    ('ISOLATION_TYPE', 'PNEUMATIC', 'Pneumatic Isolation', true, false),
    ('ISOLATION_TYPE', 'HYDRAULIC', 'Hydraulic Isolation', true, false),
    ('ISOLATION_TYPE', 'INSTRUMENT', 'Instrument Isolation', true, false),
    ('ISOLATION_TYPE', 'OTHER', 'Other Isolation', true, false)
ON CONFLICT (category, code) DO NOTHING;

-- 4. PPE_TYPE — Personal Protective Equipment
INSERT INTO reference_codes (category, code, description, active, is_locked) VALUES
    ('PPE_TYPE', 'HARD_HAT', 'Hard Hat / Safety Helmet', true, false),
    ('PPE_TYPE', 'SAFETY_GLASSES', 'Safety Glasses', true, false),
    ('PPE_TYPE', 'FACE_SHIELD', 'Face Shield', true, false),
    ('PPE_TYPE', 'HEARING', 'Hearing Protection (Ear Plugs/Muffs)', true, false),
    ('PPE_TYPE', 'RESPIRATOR', 'Respirator / Breathing Apparatus', true, false),
    ('PPE_TYPE', 'GLOVES', 'Protective Gloves', true, false),
    ('PPE_TYPE', 'FR_CLOTHING', 'Fire Resistant Clothing', true, false),
    ('PPE_TYPE', 'HARNESS', 'Fall Arrest Harness', true, false),
    ('PPE_TYPE', 'CHEMICAL_SUIT', 'Chemical Suit', true, false),
    ('PPE_TYPE', 'STEEL_TOES', 'Steel Toe Boots', true, false)
ON CONFLICT (category, code) DO NOTHING;
