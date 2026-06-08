-- Add cost_center_id to work_orders
ALTER TABLE work_orders 
ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES cost_centers(id);

-- Add cost_center_id to inventory_items
ALTER TABLE inventory_items 
ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES cost_centers(id);

-- Add cost_center_id to contacts (People)
ALTER TABLE contacts 
ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES cost_centers(id);

-- Add cost_center_id to assets
ALTER TABLE assets 
ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES cost_centers(id);

-- DATA MIGRATION: Move legacy COST_CENTRE entries from 'dictionaries' to 'cost_centers'
INSERT INTO cost_centers (
    id, code, name, description,
    company_code, controlling_area, profit_center, cost_center_type,
    responsible_person_id, valid_from, valid_to, active
)
SELECT
    id, 
    code, 
    description as name, 
    description,
    COALESCE(properties->>'companyCode', 'CORP'),
    COALESCE(properties->>'controllingArea', '1000'),
    properties->>'profitCenter',
    COALESCE(properties->>'costCenterType', 'MAINTENANCE'),
    NULLIF(properties->>'responsiblePersonId', '')::uuid,
    COALESCE(NULLIF(properties->>'validFrom', ''), CURRENT_DATE::text)::date,
    NULLIF(properties->>'validTo', '')::date,
    active
FROM dictionaries
WHERE type = 'COST_CENTRE'
ON CONFLICT (id) DO NOTHING;

-- Remove migrated entries from dictionaries to prevent duplicates (federation handles fetching from cost_centers)
DELETE FROM dictionaries WHERE type = 'COST_CENTRE';
