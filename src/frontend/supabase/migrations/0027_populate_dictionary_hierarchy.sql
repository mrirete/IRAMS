-- Populate Asset Categories
INSERT INTO dictionaries (type, code, description, active) VALUES
    ('ASSET_CATEGORY', 'ROTATING', 'Rotating Equipment', true),
    ('ASSET_CATEGORY', 'STATIC', 'Static Equipment', true),
    ('ASSET_CATEGORY', 'ELECTRICAL', 'Electrical', true),
    ('ASSET_CATEGORY', 'INSTRUMENTATION', 'Instrumentation', true)
ON CONFLICT (type, code) DO NOTHING;

-- Populate/Update Asset Types with Category References
INSERT INTO dictionaries (type, code, description, category_ref, active) VALUES
    ('ASSET_TYPE', 'PUMP', 'Pump', 'ROTATING', true),
    ('ASSET_TYPE', 'MOTOR', 'Electric Motor', 'ELECTRICAL', true),
    ('ASSET_TYPE', 'VALVE', 'Valve', 'STATIC', true),
    ('ASSET_TYPE', 'TANK', 'Storage Tank', 'STATIC', true),
    ('ASSET_TYPE', 'COMPRESSOR', 'Compressor', 'ROTATING', true),
    ('ASSET_TYPE', 'FAN', 'Fan / Blower', 'ROTATING', true),
    ('ASSET_TYPE', 'CONVEYOR', 'Conveyor Belt', 'ROTATING', true),
    
    -- Locations
    ('ASSET_TYPE', 'SITE', 'Site / Plant', NULL, true),
    ('ASSET_TYPE', 'AREA', 'Area / Zone', NULL, true),
    ('ASSET_TYPE', 'UNIT', 'Process Unit', NULL, true),
    ('ASSET_TYPE', 'SYSTEM', 'System', NULL, true)
ON CONFLICT (type, code) 
DO UPDATE SET category_ref = EXCLUDED.category_ref;


-- Populate/Update Asset Classes with Type References
INSERT INTO dictionaries (type, code, description, category_ref, active) VALUES
    ('ASSET_CLASS', 'CENTRIFUGAL_PUMP', 'Centrifugal Pump', 'PUMP', true),
    ('ASSET_CLASS', 'RECIPROCATING_PUMP', 'Reciprocating Pump', 'PUMP', true),
    ('ASSET_CLASS', 'SCREW_COMPRESSOR', 'Screw Compressor', 'COMPRESSOR', true),
    ('ASSET_CLASS', 'RECIPROCATING_COMPRESSOR', 'Reciprocating Compressor', 'COMPRESSOR', true),
    ('ASSET_CLASS', 'PRESSURE_VESSEL', 'Pressure Vessel', 'TANK', true),
    ('ASSET_CLASS', 'STORAGE_TANK', 'Storage Tank', 'TANK', true),
    ('ASSET_CLASS', 'HEAT_EXCHANGER', 'Heat Exchanger', 'TANK', true),
    ('ASSET_CLASS', 'GATE_VALVE', 'Gate Valve', 'VALVE', true),
    ('ASSET_CLASS', 'BALL_VALVE', 'Ball Valve', 'VALVE', true)
ON CONFLICT (type, code) 
DO UPDATE SET category_ref = EXCLUDED.category_ref;
