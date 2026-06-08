-- ============================================================
-- SEED: ERS Asset Hierarchy (ISO 14224)
-- Enterprise → Site → Unit → System → Equipment → Component
-- All IDs are deterministic UUIDs (uuid_generate_v5) so the
-- migration is idempotent and can be cross-referenced by other
-- ERS modules (Predict, Analyze, bad-actor Pareto, etc.)
-- ============================================================

-- Helper: Use ns UUID for deterministic generation
DO $$
DECLARE
  ns UUID := '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; -- DNS namespace
BEGIN

-- =======================
-- L1 – SITE
-- =======================
INSERT INTO assets (id, tag, name, hierarchy_level, criticality, status_code, manufacturer, model, serial_number)
VALUES (
  uuid_generate_v5(ns, 'SITE-HOUSTON'),
  'SITE-HOU',
  'Houston Refinery Complex',
  'SITE', 'A', 'OPERATING', NULL, NULL, NULL
) ON CONFLICT (tag) DO NOTHING;

-- =======================
-- L2 – UNITS (Process Areas)
-- =======================
INSERT INTO assets (id, tag, name, hierarchy_level, criticality, status_code, parent_id)
VALUES
  (uuid_generate_v5(ns, 'UNIT-100'), 'UNIT-100', 'Crude Distillation Unit',
   'UNIT', 'A', 'OPERATING', uuid_generate_v5(ns, 'SITE-HOUSTON')),

  (uuid_generate_v5(ns, 'UNIT-200'), 'UNIT-200', 'Compression & Gas Processing',
   'UNIT', 'A', 'OPERATING', uuid_generate_v5(ns, 'SITE-HOUSTON')),

  (uuid_generate_v5(ns, 'UNIT-300'), 'UNIT-300', 'Power Generation',
   'UNIT', 'A', 'OPERATING', uuid_generate_v5(ns, 'SITE-HOUSTON')),

  (uuid_generate_v5(ns, 'UNIT-400'), 'UNIT-400', 'Utilities & Offsites',
   'UNIT', 'B', 'OPERATING', uuid_generate_v5(ns, 'SITE-HOUSTON')),

  (uuid_generate_v5(ns, 'UNIT-500'), 'UNIT-500', 'Water Injection',
   'UNIT', 'B', 'OPERATING', uuid_generate_v5(ns, 'SITE-HOUSTON')),

  (uuid_generate_v5(ns, 'UNIT-600'), 'UNIT-600', 'Material Handling',
   'UNIT', 'C', 'OPERATING', uuid_generate_v5(ns, 'SITE-HOUSTON'))
ON CONFLICT (tag) DO NOTHING;

-- =======================
-- L3 – SYSTEMS
-- =======================
INSERT INTO assets (id, tag, name, hierarchy_level, criticality, status_code, parent_id)
VALUES
  -- Unit 100 Systems
  (uuid_generate_v5(ns, 'SYS-100-FEED'), 'SYS-100-FEED', 'Feed Pumping System',
   'SYSTEM', 'A', 'OPERATING', uuid_generate_v5(ns, 'UNIT-100')),

  (uuid_generate_v5(ns, 'SYS-100-COOL'), 'SYS-100-COOL', 'Overhead Cooling System',
   'SYSTEM', 'B', 'OPERATING', uuid_generate_v5(ns, 'UNIT-100')),

  -- Unit 200 Systems
  (uuid_generate_v5(ns, 'SYS-200-COMP'), 'SYS-200-COMP', 'Compression Train A',
   'SYSTEM', 'A', 'OPERATING', uuid_generate_v5(ns, 'UNIT-200')),

  (uuid_generate_v5(ns, 'SYS-200-SEPN'), 'SYS-200-SEPN', 'Gas Separation System',
   'SYSTEM', 'B', 'OPERATING', uuid_generate_v5(ns, 'UNIT-200')),

  -- Unit 300 Systems
  (uuid_generate_v5(ns, 'SYS-300-GTG'), 'SYS-300-GTG', 'Gas Turbine Generator Train',
   'SYSTEM', 'A', 'OPERATING', uuid_generate_v5(ns, 'UNIT-300')),

  -- Unit 400 Systems
  (uuid_generate_v5(ns, 'SYS-400-AIR'), 'SYS-400-AIR', 'Instrument Air System',
   'SYSTEM', 'A', 'OPERATING', uuid_generate_v5(ns, 'UNIT-400')),

  (uuid_generate_v5(ns, 'SYS-400-STM'), 'SYS-400-STM', 'Steam Generation System',
   'SYSTEM', 'B', 'OPERATING', uuid_generate_v5(ns, 'UNIT-400')),

  (uuid_generate_v5(ns, 'SYS-400-SLOP'), 'SYS-400-SLOP', 'Slop System',
   'SYSTEM', 'C', 'OPERATING', uuid_generate_v5(ns, 'UNIT-400')),

  -- Unit 500 Systems
  (uuid_generate_v5(ns, 'SYS-500-WI'), 'SYS-500-WI', 'Water Injection Pumping',
   'SYSTEM', 'B', 'OPERATING', uuid_generate_v5(ns, 'UNIT-500')),

  -- Unit 600 Systems
  (uuid_generate_v5(ns, 'SYS-600-CONV'), 'SYS-600-CONV', 'Conveyor System',
   'SYSTEM', 'C', 'OPERATING', uuid_generate_v5(ns, 'UNIT-600'))
ON CONFLICT (tag) DO NOTHING;

-- =======================
-- L4 – EQUIPMENT (Maintainable Items)
-- These map directly to ERS mock assets
-- =======================
INSERT INTO assets (id, tag, name, hierarchy_level, criticality, status_code, parent_id, manufacturer, model, serial_number)
VALUES
  -- ── EAM MOCK: Primary Feed Pump (P-101-A) ──
  (uuid_generate_v5(ns, 'P-101-A'), 'P-101-A', 'Primary Feed Pump A',
   'EQUIPMENT', 'A', 'OPERATING',
   uuid_generate_v5(ns, 'SYS-100-FEED'),
   'Flowserve', 'HPX', 'SN-2023-001-A'),

  -- ── EAM MOCK: Pump Motor (M-101-A) ──
  (uuid_generate_v5(ns, 'M-101-A'), 'M-101-A', 'Pump Motor A',
   'EQUIPMENT', 'B', 'OPERATING',
   uuid_generate_v5(ns, 'SYS-100-FEED'),
   'Siemens', '1LA7', 'M-998877'),

  -- ── PREDICT: Gas Compressor K-601 ──
  (uuid_generate_v5(ns, 'K-601'), 'K-601', 'Gas Compressor K-601',
   'EQUIPMENT', 'A', 'OPERATING',
   uuid_generate_v5(ns, 'SYS-200-COMP'),
   'MAN Energy Solutions', 'RB 36-6', 'K601-2019-0042'),

  -- ── PREDICT: Knockout Drum V-602 ──
  (uuid_generate_v5(ns, 'V-602'), 'V-602', 'Knockout Drum V-602',
   'EQUIPMENT', 'C', 'OPERATING',
   uuid_generate_v5(ns, 'SYS-200-SEPN'),
   NULL, NULL, 'V602-2018-1001'),

  -- ── PREDICT: Overhead Condenser HX-105 ──
  (uuid_generate_v5(ns, 'HX-105'), 'HX-105', 'Overhead Condenser HX-105',
   'EQUIPMENT', 'B', 'OPERATING',
   uuid_generate_v5(ns, 'SYS-100-COOL'),
   'Alfa Laval', 'M15-BFG', 'HX105-2020-0701'),

  -- ── PREDICT: Gas Turbine GT-301 ──
  (uuid_generate_v5(ns, 'GT-301'), 'GT-301', 'Gas Turbine GT-301',
   'EQUIPMENT', 'A', 'OPERATING',
   uuid_generate_v5(ns, 'SYS-300-GTG'),
   'GE Vernova', 'LM2500+', 'GT301-2017-5501'),

  -- ── PREDICT: Booster Pump P-102 ──
  (uuid_generate_v5(ns, 'P-102'), 'P-102', 'Booster Pump P-102',
   'EQUIPMENT', 'B', 'OPERATING',
   uuid_generate_v5(ns, 'SYS-500-WI'),
   'Sulzer', 'MSD-RO', 'P102-2021-0301'),

  -- ── BAD ACTOR: Boiler Feed Pump B (PMP-411) ──
  (uuid_generate_v5(ns, 'PMP-411'), 'PMP-411', 'Boiler Feed Pump B',
   'EQUIPMENT', 'A', 'OPERATING',
   uuid_generate_v5(ns, 'SYS-400-STM'),
   'KSB', 'CHTC', 'PMP411-2016-0881'),

  -- ── BAD ACTOR: Main Air Compressor (CMP-201) ──
  (uuid_generate_v5(ns, 'CMP-201'), 'CMP-201', 'Main Air Compressor',
   'EQUIPMENT', 'A', 'OPERATING',
   uuid_generate_v5(ns, 'SYS-400-AIR'),
   'Atlas Copco', 'ZR 500', 'CMP201-2018-0445'),

  -- ── BAD ACTOR: Inlet Block Valve (MV-881) ──
  (uuid_generate_v5(ns, 'MV-881'), 'MV-881', 'Inlet Block Valve MV-881',
   'EQUIPMENT', 'B', 'OPERATING',
   uuid_generate_v5(ns, 'SYS-200-COMP'),
   'Velan', 'F12-2036C-S2', 'MV881-2019-0099'),

  -- ── BAD ACTOR: Slop Oil Tank (TK-005) ──
  (uuid_generate_v5(ns, 'TK-005'), 'TK-005', 'Slop Oil Tank TK-005',
   'EQUIPMENT', 'C', 'OPERATING',
   uuid_generate_v5(ns, 'SYS-400-SLOP'),
   NULL, NULL, 'TK005-2010-0022'),

  -- ── BAD ACTOR: Conveyor Belt C-902 ──
  (uuid_generate_v5(ns, 'C-902'), 'C-902', 'Conveyor Belt C-902',
   'EQUIPMENT', 'B', 'OPERATING',
   uuid_generate_v5(ns, 'SYS-600-CONV'),
   'Continental', 'Contitech EP400', 'CV902-2022-0110'),

  -- ── ADDITIONAL EQUIPMENT: Discharge Cooler E-605 ──
  (uuid_generate_v5(ns, 'E-605'), 'E-605', 'Discharge Cooler E-605',
   'EQUIPMENT', 'B', 'OPERATING',
   uuid_generate_v5(ns, 'SYS-200-COMP'),
   'Alfa Laval', 'T20-BFG', 'E605-2019-0310')
ON CONFLICT (tag) DO NOTHING;

-- =======================
-- L5 – COMPONENTS (Sub-items of Equipment)
-- =======================
INSERT INTO assets (id, tag, name, hierarchy_level, criticality, status_code, parent_id, manufacturer, model)
VALUES
  -- P-101-A components
  (uuid_generate_v5(ns, 'P-101-A-SEAL'), 'P-101-A-SEAL', 'Mechanical Seal (P-101-A)',
   'COMPONENT', 'A', 'OPERATING',
   uuid_generate_v5(ns, 'P-101-A'),
   'Flowserve', 'ISC2 API 53'),

  (uuid_generate_v5(ns, 'P-101-A-BRG-DE'), 'P-101-A-BRG-DE', 'Drive End Bearing (P-101-A)',
   'COMPONENT', 'B', 'OPERATING',
   uuid_generate_v5(ns, 'P-101-A'),
   'SKF', '6309-2RS'),

  (uuid_generate_v5(ns, 'P-101-A-BRG-NDE'), 'P-101-A-BRG-NDE', 'Non-Drive End Bearing (P-101-A)',
   'COMPONENT', 'B', 'OPERATING',
   uuid_generate_v5(ns, 'P-101-A'),
   'SKF', '6205-2RS'),

  (uuid_generate_v5(ns, 'P-101-A-IMPEL'), 'P-101-A-IMPEL', 'Impeller (P-101-A)',
   'COMPONENT', 'A', 'OPERATING',
   uuid_generate_v5(ns, 'P-101-A'),
   'Flowserve', 'HPX Impeller SS316'),

  -- K-601 components
  (uuid_generate_v5(ns, 'K-601-DGS'), 'K-601-DGS', 'Dry Gas Seal (K-601)',
   'COMPONENT', 'A', 'OPERATING',
   uuid_generate_v5(ns, 'K-601'),
   'John Crane', 'Type 28AT'),

  (uuid_generate_v5(ns, 'K-601-RADBRG'), 'K-601-RADBRG', 'Radial Bearing (K-601)',
   'COMPONENT', 'A', 'OPERATING',
   uuid_generate_v5(ns, 'K-601'),
   'Kingsbury', 'LEG Tilting Pad'),

  (uuid_generate_v5(ns, 'K-601-AXBRG'), 'K-601-AXBRG', 'Thrust Bearing (K-601)',
   'COMPONENT', 'A', 'OPERATING',
   uuid_generate_v5(ns, 'K-601'),
   'Kingsbury', 'LEG Thrust'),

  -- GT-301 components
  (uuid_generate_v5(ns, 'GT-301-COMB'), 'GT-301-COMB', 'Combustion Liner Set (GT-301)',
   'COMPONENT', 'A', 'OPERATING',
   uuid_generate_v5(ns, 'GT-301'),
   'GE Vernova', 'DLN 2.0'),

  (uuid_generate_v5(ns, 'GT-301-HPT'), 'GT-301-HPT', 'HP Turbine Blades (GT-301)',
   'COMPONENT', 'A', 'OPERATING',
   uuid_generate_v5(ns, 'GT-301'),
   'GE Vernova', 'Stage 1 Blade Set')
ON CONFLICT (tag) DO NOTHING;

END $$;
