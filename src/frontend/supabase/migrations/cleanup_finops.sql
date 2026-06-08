-- =====================================================
-- FINOPS DATA CLEANUP SCRIPT
-- RUN THIS TO REMOVE DEMO COST CENTERS AND START FRESH
-- =====================================================

-- This will remove all cost centers (and their budgets via CASCADE)
-- WARNING: This is a full reset of the FinOps Cost Centers
TRUNCATE TABLE cost_centers RESTART IDENTITY CASCADE;

-- If you only want to remove SPECIFIC demo centers from master_seed:
/*
DELETE FROM cost_centers 
WHERE code IN ('CC-MNT-01', 'CC-OPS-01', 'CC-ADM-01', '1000-MAINT', '1000-PROD', '1000-UTIL', '2000-PROJ');
*/
