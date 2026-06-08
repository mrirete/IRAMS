-- ============================================================
-- Disable RLS on ERS intelligence tables for development
-- The sb_publishable_ key format does not map to the 'anon' or
-- 'authenticated' Postgres roles, so all policy-based filtering
-- returns 0 rows / blocks all writes.
-- Matches the pattern from 0052_disable_assets_rls.sql.
-- Re-enable RLS with proper policies before production deployment.
-- ============================================================

ALTER TABLE ers_twin_states DISABLE ROW LEVEL SECURITY;
ALTER TABLE ers_rul_estimates DISABLE ROW LEVEL SECURITY;
ALTER TABLE ers_prediction_alerts DISABLE ROW LEVEL SECURITY;
ALTER TABLE ers_sensor_readings DISABLE ROW LEVEL SECURITY;
ALTER TABLE ers_cmls DISABLE ROW LEVEL SECURITY;
ALTER TABLE ers_thickness_readings DISABLE ROW LEVEL SECURITY;
ALTER TABLE ers_corrosion_rates DISABLE ROW LEVEL SECURITY;
ALTER TABLE ers_rbi_assessments DISABLE ROW LEVEL SECURITY;
ALTER TABLE ers_iow_parameters DISABLE ROW LEVEL SECURITY;
ALTER TABLE ers_inspections DISABLE ROW LEVEL SECURITY;
ALTER TABLE ers_damage_mechanisms DISABLE ROW LEVEL SECURITY;
ALTER TABLE ers_ffs_assessments DISABLE ROW LEVEL SECURITY;
ALTER TABLE ers_fmea_worksheets DISABLE ROW LEVEL SECURITY;
ALTER TABLE ers_fmea_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE ers_rca_investigations DISABLE ROW LEVEL SECURITY;
ALTER TABLE ers_rca_nodes DISABLE ROW LEVEL SECURITY;
ALTER TABLE ers_bad_actor_snapshots DISABLE ROW LEVEL SECURITY;
ALTER TABLE ers_vision_results DISABLE ROW LEVEL SECURITY;
ALTER TABLE ers_drone_surveys DISABLE ROW LEVEL SECURITY;
ALTER TABLE ers_carbon_metrics DISABLE ROW LEVEL SECURITY;
ALTER TABLE ers_climate_risks DISABLE ROW LEVEL SECURITY;

-- Also disable on analysis data sources if it exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'ers_analysis_data_sources') THEN
        ALTER TABLE ers_analysis_data_sources DISABLE ROW LEVEL SECURITY;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'ers_criticality_assessments') THEN
        ALTER TABLE ers_criticality_assessments DISABLE ROW LEVEL SECURITY;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'ers_rca_corrective_actions') THEN
        ALTER TABLE ers_rca_corrective_actions DISABLE ROW LEVEL SECURITY;
    END IF;
END $$;
