-- GUARDED 2026-07-25: cost_centers is not created until 0034, so on a fresh
-- replay every statement here referenced a table that did not exist yet and the
-- run aborted. It only applied historically because the origin database was
-- built out of order. Skips cleanly when cost_centers is absent; migration 0224
-- re-applies the columns afterwards so a replayed database still ends up correct.
DO $$
BEGIN
IF to_regclass('public.cost_centers') IS NULL THEN
    RAISE NOTICE '0029: cost_centers does not exist yet — skipping (0224 re-applies).';
    RETURN;
END IF;

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

END $$;
