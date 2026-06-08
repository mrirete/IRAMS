-- ============================================================
-- SEED: ERS Asset Hierarchy (ISO 14224)
-- Plain SQL INSERTs — no DO blocks, no uuid_generate_v5
-- Parent references via subquery on tag
-- ============================================================

-- L1 – SITE
INSERT INTO assets (tag, name, hierarchy_level, criticality, status_code)
VALUES ('SITE-HOU', 'Houston Refinery Complex', 'SITE', 'A', 'OPERATING')
ON CONFLICT (tag) DO NOTHING;

-- L2 – UNITS
INSERT INTO assets (tag, name, hierarchy_level, criticality, status_code, parent_id)
VALUES
  ('UNIT-100', 'Crude Distillation Unit', 'UNIT', 'A', 'OPERATING',
    (SELECT id FROM assets WHERE tag = 'SITE-HOU')),
  ('UNIT-200', 'Compression & Gas Processing', 'UNIT', 'A', 'OPERATING',
    (SELECT id FROM assets WHERE tag = 'SITE-HOU')),
  ('UNIT-300', 'Power Generation', 'UNIT', 'A', 'OPERATING',
    (SELECT id FROM assets WHERE tag = 'SITE-HOU')),
  ('UNIT-400', 'Utilities & Offsites', 'UNIT', 'B', 'OPERATING',
    (SELECT id FROM assets WHERE tag = 'SITE-HOU')),
  ('UNIT-500', 'Water Injection', 'UNIT', 'B', 'OPERATING',
    (SELECT id FROM assets WHERE tag = 'SITE-HOU')),
  ('UNIT-600', 'Material Handling', 'UNIT', 'C', 'OPERATING',
    (SELECT id FROM assets WHERE tag = 'SITE-HOU'))
ON CONFLICT (tag) DO NOTHING;

-- L3 – SYSTEMS (Unit 100)
INSERT INTO assets (tag, name, hierarchy_level, criticality, status_code, parent_id)
VALUES
  ('SYS-100-FEED', 'Feed Pumping System', 'SYSTEM', 'A', 'OPERATING',
    (SELECT id FROM assets WHERE tag = 'UNIT-100')),
  ('SYS-100-COOL', 'Overhead Cooling System', 'SYSTEM', 'B', 'OPERATING',
    (SELECT id FROM assets WHERE tag = 'UNIT-100'))
ON CONFLICT (tag) DO NOTHING;

-- L3 – SYSTEMS (Unit 200)
INSERT INTO assets (tag, name, hierarchy_level, criticality, status_code, parent_id)
VALUES
  ('SYS-200-COMP', 'Compression Train A', 'SYSTEM', 'A', 'OPERATING',
    (SELECT id FROM assets WHERE tag = 'UNIT-200')),
  ('SYS-200-SEPN', 'Gas Separation System', 'SYSTEM', 'B', 'OPERATING',
    (SELECT id FROM assets WHERE tag = 'UNIT-200'))
ON CONFLICT (tag) DO NOTHING;

-- L3 – SYSTEMS (Unit 300)
INSERT INTO assets (tag, name, hierarchy_level, criticality, status_code, parent_id)
VALUES
  ('SYS-300-GTG', 'Gas Turbine Generator Train', 'SYSTEM', 'A', 'OPERATING',
    (SELECT id FROM assets WHERE tag = 'UNIT-300'))
ON CONFLICT (tag) DO NOTHING;

-- L3 – SYSTEMS (Unit 400)
INSERT INTO assets (tag, name, hierarchy_level, criticality, status_code, parent_id)
VALUES
  ('SYS-400-AIR', 'Instrument Air System', 'SYSTEM', 'A', 'OPERATING',
    (SELECT id FROM assets WHERE tag = 'UNIT-400')),
  ('SYS-400-STM', 'Steam Generation System', 'SYSTEM', 'B', 'OPERATING',
    (SELECT id FROM assets WHERE tag = 'UNIT-400')),
  ('SYS-400-SLOP', 'Slop System', 'SYSTEM', 'C', 'OPERATING',
    (SELECT id FROM assets WHERE tag = 'UNIT-400'))
ON CONFLICT (tag) DO NOTHING;

-- L3 – SYSTEMS (Unit 500)
INSERT INTO assets (tag, name, hierarchy_level, criticality, status_code, parent_id)
VALUES
  ('SYS-500-WI', 'Water Injection Pumping', 'SYSTEM', 'B', 'OPERATING',
    (SELECT id FROM assets WHERE tag = 'UNIT-500'))
ON CONFLICT (tag) DO NOTHING;

-- L3 – SYSTEMS (Unit 600)
INSERT INTO assets (tag, name, hierarchy_level, criticality, status_code, parent_id)
VALUES
  ('SYS-600-CONV', 'Conveyor System', 'SYSTEM', 'C', 'OPERATING',
    (SELECT id FROM assets WHERE tag = 'UNIT-600'))
ON CONFLICT (tag) DO NOTHING;

-- L4 – EQUIPMENT
-- EAM Mock: Primary Feed Pump
INSERT INTO assets (tag, name, hierarchy_level, criticality, status_code, parent_id, manufacturer, model, serial_number)
VALUES ('P-101-A', 'Primary Feed Pump A', 'EQUIPMENT', 'A', 'OPERATING',
  (SELECT id FROM assets WHERE tag = 'SYS-100-FEED'),
  'Flowserve', 'HPX', 'SN-2023-001-A')
ON CONFLICT (tag) DO NOTHING;

-- EAM Mock: Pump Motor
INSERT INTO assets (tag, name, hierarchy_level, criticality, status_code, parent_id, manufacturer, model, serial_number)
VALUES ('M-101-A', 'Pump Motor A', 'EQUIPMENT', 'B', 'OPERATING',
  (SELECT id FROM assets WHERE tag = 'SYS-100-FEED'),
  'Siemens', '1LA7', 'M-998877')
ON CONFLICT (tag) DO NOTHING;

-- Predict: Gas Compressor K-601
INSERT INTO assets (tag, name, hierarchy_level, criticality, status_code, parent_id, manufacturer, model, serial_number)
VALUES ('K-601', 'Gas Compressor K-601', 'EQUIPMENT', 'A', 'OPERATING',
  (SELECT id FROM assets WHERE tag = 'SYS-200-COMP'),
  'MAN Energy Solutions', 'RB 36-6', 'K601-2019-0042')
ON CONFLICT (tag) DO NOTHING;

-- Predict: Knockout Drum V-602
INSERT INTO assets (tag, name, hierarchy_level, criticality, status_code, parent_id, manufacturer, serial_number)
VALUES ('V-602', 'Knockout Drum V-602', 'EQUIPMENT', 'C', 'OPERATING',
  (SELECT id FROM assets WHERE tag = 'SYS-200-SEPN'),
  NULL, 'V602-2018-1001')
ON CONFLICT (tag) DO NOTHING;

-- Predict: Overhead Condenser HX-105
INSERT INTO assets (tag, name, hierarchy_level, criticality, status_code, parent_id, manufacturer, model, serial_number)
VALUES ('HX-105', 'Overhead Condenser HX-105', 'EQUIPMENT', 'B', 'OPERATING',
  (SELECT id FROM assets WHERE tag = 'SYS-100-COOL'),
  'Alfa Laval', 'M15-BFG', 'HX105-2020-0701')
ON CONFLICT (tag) DO NOTHING;

-- Predict: Gas Turbine GT-301
INSERT INTO assets (tag, name, hierarchy_level, criticality, status_code, parent_id, manufacturer, model, serial_number)
VALUES ('GT-301', 'Gas Turbine GT-301', 'EQUIPMENT', 'A', 'OPERATING',
  (SELECT id FROM assets WHERE tag = 'SYS-300-GTG'),
  'GE Vernova', 'LM2500+', 'GT301-2017-5501')
ON CONFLICT (tag) DO NOTHING;

-- Predict: Booster Pump P-102
INSERT INTO assets (tag, name, hierarchy_level, criticality, status_code, parent_id, manufacturer, model, serial_number)
VALUES ('P-102', 'Booster Pump P-102', 'EQUIPMENT', 'B', 'OPERATING',
  (SELECT id FROM assets WHERE tag = 'SYS-500-WI'),
  'Sulzer', 'MSD-RO', 'P102-2021-0301')
ON CONFLICT (tag) DO NOTHING;

-- Bad Actor: Boiler Feed Pump B
INSERT INTO assets (tag, name, hierarchy_level, criticality, status_code, parent_id, manufacturer, model, serial_number)
VALUES ('PMP-411', 'Boiler Feed Pump B', 'EQUIPMENT', 'A', 'OPERATING',
  (SELECT id FROM assets WHERE tag = 'SYS-400-STM'),
  'KSB', 'CHTC', 'PMP411-2016-0881')
ON CONFLICT (tag) DO NOTHING;

-- Bad Actor: Main Air Compressor
INSERT INTO assets (tag, name, hierarchy_level, criticality, status_code, parent_id, manufacturer, model, serial_number)
VALUES ('CMP-201', 'Main Air Compressor', 'EQUIPMENT', 'A', 'OPERATING',
  (SELECT id FROM assets WHERE tag = 'SYS-400-AIR'),
  'Atlas Copco', 'ZR 500', 'CMP201-2018-0445')
ON CONFLICT (tag) DO NOTHING;

-- Bad Actor: Inlet Block Valve
INSERT INTO assets (tag, name, hierarchy_level, criticality, status_code, parent_id, manufacturer, model, serial_number)
VALUES ('MV-881', 'Inlet Block Valve MV-881', 'EQUIPMENT', 'B', 'OPERATING',
  (SELECT id FROM assets WHERE tag = 'SYS-200-COMP'),
  'Velan', 'F12-2036C-S2', 'MV881-2019-0099')
ON CONFLICT (tag) DO NOTHING;

-- Bad Actor: Slop Oil Tank
INSERT INTO assets (tag, name, hierarchy_level, criticality, status_code, parent_id, serial_number)
VALUES ('TK-005', 'Slop Oil Tank TK-005', 'EQUIPMENT', 'C', 'OPERATING',
  (SELECT id FROM assets WHERE tag = 'SYS-400-SLOP'),
  'TK005-2010-0022')
ON CONFLICT (tag) DO NOTHING;

-- Bad Actor: Conveyor Belt
INSERT INTO assets (tag, name, hierarchy_level, criticality, status_code, parent_id, manufacturer, model, serial_number)
VALUES ('C-902', 'Conveyor Belt C-902', 'EQUIPMENT', 'B', 'OPERATING',
  (SELECT id FROM assets WHERE tag = 'SYS-600-CONV'),
  'Continental', 'Contitech EP400', 'CV902-2022-0110')
ON CONFLICT (tag) DO NOTHING;

-- Additional: Discharge Cooler
INSERT INTO assets (tag, name, hierarchy_level, criticality, status_code, parent_id, manufacturer, model, serial_number)
VALUES ('E-605', 'Discharge Cooler E-605', 'EQUIPMENT', 'B', 'OPERATING',
  (SELECT id FROM assets WHERE tag = 'SYS-200-COMP'),
  'Alfa Laval', 'T20-BFG', 'E605-2019-0310')
ON CONFLICT (tag) DO NOTHING;

-- L5 – COMPONENTS (P-101-A)
INSERT INTO assets (tag, name, hierarchy_level, criticality, status_code, parent_id, manufacturer, model)
VALUES
  ('P-101-A-SEAL', 'Mechanical Seal (P-101-A)', 'COMPONENT', 'A', 'OPERATING',
    (SELECT id FROM assets WHERE tag = 'P-101-A'), 'Flowserve', 'ISC2 API 53'),
  ('P-101-A-BRG-DE', 'Drive End Bearing (P-101-A)', 'COMPONENT', 'B', 'OPERATING',
    (SELECT id FROM assets WHERE tag = 'P-101-A'), 'SKF', '6309-2RS'),
  ('P-101-A-BRG-NDE', 'Non-Drive End Bearing (P-101-A)', 'COMPONENT', 'B', 'OPERATING',
    (SELECT id FROM assets WHERE tag = 'P-101-A'), 'SKF', '6205-2RS'),
  ('P-101-A-IMPEL', 'Impeller (P-101-A)', 'COMPONENT', 'A', 'OPERATING',
    (SELECT id FROM assets WHERE tag = 'P-101-A'), 'Flowserve', 'HPX Impeller SS316')
ON CONFLICT (tag) DO NOTHING;

-- L5 – COMPONENTS (K-601)
INSERT INTO assets (tag, name, hierarchy_level, criticality, status_code, parent_id, manufacturer, model)
VALUES
  ('K-601-DGS', 'Dry Gas Seal (K-601)', 'COMPONENT', 'A', 'OPERATING',
    (SELECT id FROM assets WHERE tag = 'K-601'), 'John Crane', 'Type 28AT'),
  ('K-601-RADBRG', 'Radial Bearing (K-601)', 'COMPONENT', 'A', 'OPERATING',
    (SELECT id FROM assets WHERE tag = 'K-601'), 'Kingsbury', 'LEG Tilting Pad'),
  ('K-601-AXBRG', 'Thrust Bearing (K-601)', 'COMPONENT', 'A', 'OPERATING',
    (SELECT id FROM assets WHERE tag = 'K-601'), 'Kingsbury', 'LEG Thrust')
ON CONFLICT (tag) DO NOTHING;

-- L5 – COMPONENTS (GT-301)
INSERT INTO assets (tag, name, hierarchy_level, criticality, status_code, parent_id, manufacturer, model)
VALUES
  ('GT-301-COMB', 'Combustion Liner Set (GT-301)', 'COMPONENT', 'A', 'OPERATING',
    (SELECT id FROM assets WHERE tag = 'GT-301'), 'GE Vernova', 'DLN 2.0'),
  ('GT-301-HPT', 'HP Turbine Blades (GT-301)', 'COMPONENT', 'A', 'OPERATING',
    (SELECT id FROM assets WHERE tag = 'GT-301'), 'GE Vernova', 'Stage 1 Blade Set')
ON CONFLICT (tag) DO NOTHING;

-- Verify
SELECT count(*) AS total_assets FROM assets;
