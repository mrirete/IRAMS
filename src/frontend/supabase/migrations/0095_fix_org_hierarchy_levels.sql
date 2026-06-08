-- 0095_fix_org_hierarchy_levels.sql
-- ============================================================
-- Fix Organization Hierarchy: Clean stale ORG_LEVEL data,
-- seed 5 industry-standard levels (ISO 55000 / Oil & Gas)
-- ============================================================

-- STEP 0: Drop CHECK constraint on organization_units.type
-- The constraint from migration 0020 only allows ('DIVISION', 'GROUP', 'TEAM')
-- We need to allow any type code from our ORG_LEVEL config
DO $$
DECLARE
    constraint_name TEXT;
BEGIN
    FOR constraint_name IN
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
        WHERE rel.relname = 'organization_units'
          AND con.contype = 'c'
          AND nsp.nspname = 'public'
    LOOP
        EXECUTE format('ALTER TABLE organization_units DROP CONSTRAINT %I', constraint_name);
        RAISE NOTICE 'Dropped CHECK constraint: %', constraint_name;
    END LOOP;
END $$;

-- STEP 1: Delete ALL stale ORG_LEVEL entries
-- This removes LEVEL_1, LEVEL_2, GROUP, and any other leftover codes
DELETE FROM reference_codes WHERE category = 'ORG_LEVEL';

-- Also clean from legacy 'dictionaries' table if it exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'dictionaries') THEN
        DELETE FROM dictionaries WHERE type = 'ORG_LEVEL';
        RAISE NOTICE 'Cleaned ORG_LEVEL entries from legacy dictionaries table';
    END IF;
END $$;

-- STEP 2: Insert 5 industry-standard levels with strict child_type chain
-- Site → Division → Department → Section → Team
INSERT INTO reference_codes (category, code, description, active, is_locked, sort_order, metadata, color_code)
VALUES
    ('ORG_LEVEL', 'SITE', 'Site / Plant', true, false, 1,
     '{"sort_order": 1, "color": "#3b82f6", "child_type": "DIVISION", "child_label": "Add Division"}'::jsonb,
     '#3b82f6'),

    ('ORG_LEVEL', 'DIVISION', 'Division', true, false, 2,
     '{"sort_order": 2, "color": "#8b5cf6", "child_type": "DEPARTMENT", "child_label": "Add Department"}'::jsonb,
     '#8b5cf6'),

    ('ORG_LEVEL', 'DEPARTMENT', 'Department', true, false, 3,
     '{"sort_order": 3, "color": "#f59e0b", "child_type": "SECTION", "child_label": "Add Section"}'::jsonb,
     '#f59e0b'),

    ('ORG_LEVEL', 'SECTION', 'Section / Unit', true, false, 4,
     '{"sort_order": 4, "color": "#10b981", "child_type": "TEAM", "child_label": "Add Team"}'::jsonb,
     '#10b981'),

    ('ORG_LEVEL', 'TEAM', 'Team', true, false, 5,
     '{"sort_order": 5, "color": "#6366f1", "child_type": null, "child_label": null}'::jsonb,
     '#6366f1')
ON CONFLICT DO NOTHING;

-- STEP 3: Map existing organization_units.type to new codes
-- Handle all known legacy patterns
DO $$
BEGIN
    -- LEVEL_1 → DIVISION (most common pattern from OrgLevelSettingsModal)
    UPDATE organization_units SET type = 'DIVISION'
    WHERE type IN ('LEVEL_1') AND parent_id IS NULL;

    -- LEVEL_1 children that should be DIVISION
    UPDATE organization_units SET type = 'SITE'
    WHERE type IN ('LEVEL_1') AND parent_id IS NULL;

    -- Actually, map by depth instead of guessing
    -- First pass: root units without parents → SITE
    UPDATE organization_units SET type = 'SITE'
    WHERE parent_id IS NULL
      AND type NOT IN ('SITE', 'DIVISION', 'DEPARTMENT', 'SECTION', 'TEAM');

    -- Second pass: re-type by depth using the resync approach
    -- Depth 0 (no parent) = SITE
    -- Depth 1 = DIVISION
    -- Depth 2 = DEPARTMENT
    -- Depth 3 = SECTION
    -- Depth 4+ = TEAM

    -- We use a recursive CTE to calculate depth
    WITH RECURSIVE unit_depth AS (
        SELECT id, parent_id, type, 0 AS depth
        FROM organization_units
        WHERE parent_id IS NULL
        UNION ALL
        SELECT ou.id, ou.parent_id, ou.type, ud.depth + 1
        FROM organization_units ou
        JOIN unit_depth ud ON ou.parent_id = ud.id
    ),
    depth_type_map AS (
        SELECT id, depth,
            CASE
                WHEN depth = 0 THEN 'SITE'
                WHEN depth = 1 THEN 'DIVISION'
                WHEN depth = 2 THEN 'DEPARTMENT'
                WHEN depth = 3 THEN 'SECTION'
                ELSE 'TEAM'
            END AS expected_type
        FROM unit_depth
    )
    UPDATE organization_units ou
    SET type = dtm.expected_type
    FROM depth_type_map dtm
    WHERE ou.id = dtm.id
      AND ou.type != dtm.expected_type;

    -- Handle legacy GROUP → DEPARTMENT (if manually typed)
    UPDATE organization_units SET type = 'DEPARTMENT' WHERE type = 'GROUP';

    RAISE NOTICE 'Organization unit types re-mapped by hierarchy depth';
END $$;

-- STEP 4: Add cost_center column if not present
ALTER TABLE organization_units
ADD COLUMN IF NOT EXISTS cost_center TEXT;

COMMENT ON COLUMN organization_units.cost_center IS 'Reference to cost center code for financial allocation';
