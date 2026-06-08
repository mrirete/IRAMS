-- =====================================================
-- FINOPS MASTER RECOVERY SCRIPT
-- RUN THIS IN SUPABASE SQL EDITOR TO FIX DATA GAPS
-- =====================================================

-- 1. Ensure recurring_work table has required columns for forecasting (from 0036)
ALTER TABLE recurring_work 
ADD COLUMN IF NOT EXISTS est_labor_cost DECIMAL(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS est_material_cost DECIMAL(10,2) DEFAULT 0;

-- 2. Create maintenance_forecasts view (from 0036)
-- Assumes recurring_work table exists
CREATE OR REPLACE VIEW maintenance_forecasts AS
SELECT 
    rw.id,
    rw.code,
    rw.title,
    rw.asset_id,
    rw.frequency_interval,
    rw.frequency_unit,
    rw.est_labor_cost,
    rw.est_material_cost,
    (rw.est_labor_cost + rw.est_material_cost) as cost_per_event,
    CASE 
        WHEN rw.frequency_unit = 'Days' THEN 365.0 / NULLIF(rw.frequency_interval, 0)
        WHEN rw.frequency_unit = 'Weeks' THEN 52.0 / NULLIF(rw.frequency_interval, 0)
        WHEN rw.frequency_unit = 'Months' THEN 12.0 / NULLIF(rw.frequency_interval, 0)
        WHEN rw.frequency_unit = 'Years' THEN 1.0 / NULLIF(rw.frequency_interval, 0)
        ELSE 0 
    END as annual_frequency,
    (
        (rw.est_labor_cost + rw.est_material_cost) * 
        CASE 
            WHEN rw.frequency_unit = 'Days' THEN 365.0 / NULLIF(rw.frequency_interval, 0)
            WHEN rw.frequency_unit = 'Weeks' THEN 52.0 / NULLIF(rw.frequency_interval, 0)
            WHEN rw.frequency_unit = 'Months' THEN 12.0 / NULLIF(rw.frequency_interval, 0)
            WHEN rw.frequency_unit = 'Years' THEN 1.0 / NULLIF(rw.frequency_interval, 0)
            ELSE 0 
        END
    ) as annual_estimated_spend,
    rw.next_due_date
FROM recurring_work rw
WHERE rw.active = true AND rw.status = 'ACTIVE';

-- 2. Master Seed Data with Valid Hex UUIDs
-- Using fixed hex-only IDs to avoid syntax errors

-- Ensure Assets
INSERT INTO assets (id, name, tag, status_code, criticality, hierarchy_level)
VALUES 
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Atlas Copco Compressor', 'AC-2024-01', 'OPERATIONAL', 'A', 'EQUIPMENT'),
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', 'Cat Generator 3516', 'GEN-01', 'OPERATIONAL', 'A', 'EQUIPMENT')
ON CONFLICT (id) DO NOTHING;

-- Cost Centers
INSERT INTO cost_centers (id, code, name, cost_center_type, description, active)
VALUES
    ('c0cc4738-9c0b-4ef8-bb6d-6bb9bd380c01', 'CC-MNT-01', 'Plant Maintenance', 'MAINTENANCE', 'Core maintenance team budget', true),
    ('c0cc4738-9c0b-4ef8-bb6d-6bb9bd380c02', 'CC-OPS-01', 'Plant Operations', 'OPERATIONS', 'Production usage and consumables', true),
    ('c0cc4738-9c0b-4ef8-bb6d-6bb9bd380c03', 'CC-ADM-01', 'Corporate Admin', 'ADMINISTRATION', 'HQ Overhead and IT', true)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, cost_center_type = EXCLUDED.cost_center_type;

-- Budgets
INSERT INTO budgets (id, cost_center_id, fiscal_year, opex_budget, capex_budget)
VALUES
    ('b0d9e338-9c0b-4ef8-bb6d-6bb9bd380b01', 'c0cc4738-9c0b-4ef8-bb6d-6bb9bd380c01', 2024, 750000.00, 150000.00),
    ('b0d9e338-9c0b-4ef8-bb6d-6bb9bd380b02', 'c0cc4738-9c0b-4ef8-bb6d-6bb9bd380c02', 2024, 1200000.00, 50000.00)
ON CONFLICT (id) DO UPDATE SET opex_budget = EXCLUDED.opex_budget;

-- Warranties
INSERT INTO warranties (id, asset_id, warranty_type, coverage_scope, start_date, end_date, status)
VALUES
    ('40a77a99-9c0b-4ef8-bb6d-6bb9bd380001', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'MANUFACTURER', 'Full coverage', CURRENT_DATE, CURRENT_DATE + INTERVAL '1 year', 'ACTIVE')
ON CONFLICT (id) DO NOTHING;

-- Insurance
INSERT INTO asset_insurance (id, asset_id, policy_number, insurer_name, coverage_type, coverage_start, coverage_end, premium_annual, insured_value, replacement_value, status)
VALUES
    ('10550728-9c0b-4ef8-bb6d-6bb9bd380101', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'POL-998877', 'Allianz', 'COMPREHENSIVE', CURRENT_DATE, CURRENT_DATE + INTERVAL '1 year', 45000, 5000000, 5500000, 'ACTIVE')
ON CONFLICT (id) DO NOTHING;
