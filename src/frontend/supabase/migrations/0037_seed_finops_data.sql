-- Seed Data for FinOps Module

-- 1. Ensure basic Assets exist for linking
INSERT INTO assets (id, name, tag, status_code, criticality, hierarchy_level)
VALUES 
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Atlas Copco Compressor', 'AC-2024-01', 'OPERATIONAL', 'A', 'EQUIPMENT'),
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', 'Cat Generator 3516', 'GEN-01', 'OPERATIONAL', 'A', 'EQUIPMENT')
ON CONFLICT (id) DO NOTHING;

-- 2. Create Cost Centers
INSERT INTO cost_centers (id, code, name, cost_center_type, description, active)
VALUES
    ('c0cc4738-9c0b-4ef8-bb6d-6bb9bd380c01', 'CC-MNT-01', 'Plant Maintenance', 'MAINTENANCE', 'Core maintenance team budget', true),
    ('c0cc4738-9c0b-4ef8-bb6d-6bb9bd380c02', 'CC-OPS-01', 'Plant Operations', 'OPERATIONS', 'Production usage and consumables', true),
    ('c0cc4738-9c0b-4ef8-bb6d-6bb9bd380c03', 'CC-ADM-01', 'Corporate Admin', 'ADMINISTRATION', 'HQ Overhead and IT', true)
ON CONFLICT (code) DO NOTHING;

-- 3. Create Budgets for Current Year
INSERT INTO budgets (id, cost_center_id, fiscal_year, opex_budget, capex_budget)
VALUES
    ('b0d9e338-9c0b-4ef8-bb6d-6bb9bd380b01', 'c0cc4738-9c0b-4ef8-bb6d-6bb9bd380c01', 2024, 750000.00, 150000.00),
    ('b0d9e338-9c0b-4ef8-bb6d-6bb9bd380b02', 'c0cc4738-9c0b-4ef8-bb6d-6bb9bd380c02', 2024, 1200000.00, 50000.00)
ON CONFLICT (id) DO NOTHING;

-- 4. Create Warranties
INSERT INTO warranties (id, asset_id, warranty_type, coverage_scope, start_date, end_date, status)
VALUES
    ('40a77a99-9c0b-4ef8-bb6d-6bb9bd380001', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'MANUFACTURER', 'Full bumper-to-bumper coverage including parts and labor', CURRENT_DATE - INTERVAL '6 months', CURRENT_DATE + INTERVAL '18 months', 'ACTIVE'),
    ('40a77a99-9c0b-4ef8-bb6d-6bb9bd380002', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', 'EXTENDED', 'Powertrain only', CURRENT_DATE - INTERVAL '1 month', CURRENT_DATE + INTERVAL '3 years', 'ACTIVE')
ON CONFLICT (id) DO NOTHING;

-- 5. Create Insurance Policies
INSERT INTO asset_insurance (id, asset_id, policy_number, insurer_name, coverage_type, coverage_start, coverage_end, premium_annual, insured_value, replacement_value, status)
VALUES
    ('10550728-9c0b-4ef8-bb6d-6bb9bd380101', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'POL-998877', 'Allianz Industrial', 'COMPREHENSIVE', '2024-01-01', '2024-12-31', 45000.00, 5000000.00, 5500000.00, 'ACTIVE')
ON CONFLICT (id) DO NOTHING;

-- 6. Link Insurance (Already linked via INSERT above)
