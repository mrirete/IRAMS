-- ============================================================
-- PURGE: Remove all assets NOT in the canonical Asset Register
-- The register is defined by migration 0053_seed_assets_v2.sql
-- 
-- Related rows in ers_twin_states, ers_rul_estimates,
-- ers_sensor_readings, ers_prediction_alerts, and finops
-- tables will cascade-delete automatically (ON DELETE CASCADE).
--
-- Work order references (asset_id) are NULLed out first to
-- avoid FK violations on non-cascade constraints.
-- ============================================================

-- Canonical register tags (from 0053_seed_assets_v2.sql)
-- L1: SITE
-- L2: UNITS
-- L3: SYSTEMS
-- L4: EQUIPMENT
-- L5: COMPONENTS

BEGIN;

-- ── Step 1: NULL out asset references on work_orders ──
-- so FK constraints don't block the delete
UPDATE work_orders
SET asset_id = NULL
WHERE asset_id IN (
    SELECT id FROM assets
    WHERE tag NOT IN (
        -- L1 SITE
        'SITE-HOU',
        -- L2 UNITS
        'UNIT-100', 'UNIT-200', 'UNIT-300', 'UNIT-400', 'UNIT-500', 'UNIT-600',
        -- L3 SYSTEMS
        'SYS-100-FEED', 'SYS-100-COOL',
        'SYS-200-COMP', 'SYS-200-SEPN',
        'SYS-300-GTG',
        'SYS-400-AIR', 'SYS-400-STM', 'SYS-400-SLOP',
        'SYS-500-WI',
        'SYS-600-CONV',
        -- L4 EQUIPMENT
        'P-101-A', 'M-101-A',
        'K-601', 'V-602', 'HX-105', 'GT-301', 'P-102',
        'PMP-411', 'CMP-201', 'MV-881', 'TK-005', 'C-902', 'E-605',
        -- L5 COMPONENTS
        'P-101-A-SEAL', 'P-101-A-BRG-DE', 'P-101-A-BRG-NDE', 'P-101-A-IMPEL',
        'K-601-DGS', 'K-601-RADBRG', 'K-601-AXBRG',
        'GT-301-COMB', 'GT-301-HPT'
    )
);

-- ── Step 2: NULL out parent_id self-references for children first ──
-- (avoid FK self-ref errors when deleting parent rows)
UPDATE assets
SET parent_id = NULL
WHERE parent_id IN (
    SELECT id FROM assets
    WHERE tag NOT IN (
        'SITE-HOU',
        'UNIT-100', 'UNIT-200', 'UNIT-300', 'UNIT-400', 'UNIT-500', 'UNIT-600',
        'SYS-100-FEED', 'SYS-100-COOL',
        'SYS-200-COMP', 'SYS-200-SEPN',
        'SYS-300-GTG',
        'SYS-400-AIR', 'SYS-400-STM', 'SYS-400-SLOP',
        'SYS-500-WI',
        'SYS-600-CONV',
        'P-101-A', 'M-101-A',
        'K-601', 'V-602', 'HX-105', 'GT-301', 'P-102',
        'PMP-411', 'CMP-201', 'MV-881', 'TK-005', 'C-902', 'E-605',
        'P-101-A-SEAL', 'P-101-A-BRG-DE', 'P-101-A-BRG-NDE', 'P-101-A-IMPEL',
        'K-601-DGS', 'K-601-RADBRG', 'K-601-AXBRG',
        'GT-301-COMB', 'GT-301-HPT'
    )
);

-- ── Step 3: Delete non-register assets ──
DELETE FROM assets
WHERE tag NOT IN (
    -- L1 SITE
    'SITE-HOU',
    -- L2 UNITS
    'UNIT-100', 'UNIT-200', 'UNIT-300', 'UNIT-400', 'UNIT-500', 'UNIT-600',
    -- L3 SYSTEMS
    'SYS-100-FEED', 'SYS-100-COOL',
    'SYS-200-COMP', 'SYS-200-SEPN',
    'SYS-300-GTG',
    'SYS-400-AIR', 'SYS-400-STM', 'SYS-400-SLOP',
    'SYS-500-WI',
    'SYS-600-CONV',
    -- L4 EQUIPMENT
    'P-101-A', 'M-101-A',
    'K-601', 'V-602', 'HX-105', 'GT-301', 'P-102',
    'PMP-411', 'CMP-201', 'MV-881', 'TK-005', 'C-902', 'E-605',
    -- L5 COMPONENTS
    'P-101-A-SEAL', 'P-101-A-BRG-DE', 'P-101-A-BRG-NDE', 'P-101-A-IMPEL',
    'K-601-DGS', 'K-601-RADBRG', 'K-601-AXBRG',
    'GT-301-COMB', 'GT-301-HPT'
);

COMMIT;

-- Verify: should return only the 37 canonical assets
SELECT count(*) AS remaining_assets FROM assets;
