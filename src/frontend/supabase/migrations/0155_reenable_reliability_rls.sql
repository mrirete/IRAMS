-- ═══════════════════════════════════════════════════════════════════════
-- 0155: Re-enable Row-Level Security on Reliability / Integrity / Library Tables
-- ═══════════════════════════════════════════════════════════════════════
-- Migration 0150 re-enabled RLS on the ~28 core EAM tables, but the
-- reliability, integrity, intelligence, MOC, readings and task-library
-- tables were created without RLS and never enabled. With RLS *off*, these
-- tables are flagged by Supabase's security advisor ("RLS Disabled in
-- Public") and — depending on role grants — can be reachable by the `anon`
-- role. This migration brings them up to the SAME Phase-1 baseline as
-- migration 0150: RLS enabled + an "any authenticated user can do anything"
-- policy. No real access restriction is imposed, so there is zero lockout
-- risk; the only change is that anonymous access is now blocked.
--
-- Phase 1 (this migration): All authenticated users get full CRUD.
-- Phase 2 (deferred, project-wide): site-scoped policies keyed off
--          auth.uid() → public.users role + data_scope_overrides →
--          asset.organization_unit_id, applied to reliability + core
--          tables together. Tracked separately; intentionally NOT here.
--
-- Idempotent: safe to re-run. Conditional on table existence so it works
-- across environments where some feature tables may not be provisioned.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Reusable helper: enable RLS + create open "authenticated" policies ──
-- Mirrors migration 0150's _create_auth_policies, recreated here so this
-- migration is self-contained (0150 drops the function at its end).
CREATE OR REPLACE FUNCTION _create_auth_policies(tbl TEXT)
RETURNS VOID AS $$
BEGIN
    -- Only act if the table actually exists in this environment.
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = tbl) THEN
        RETURN;
    END IF;

    -- Enable RLS (no-op if already enabled).
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);

    -- Drop existing policies first to stay idempotent.
    EXECUTE format('DROP POLICY IF EXISTS "auth_select_%s" ON %I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "auth_insert_%s" ON %I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "auth_update_%s" ON %I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "auth_delete_%s" ON %I', tbl, tbl);

    -- Recreate open Phase-1 policies (any authenticated user, full CRUD).
    EXECUTE format(
        'CREATE POLICY "auth_select_%s" ON %I FOR SELECT TO authenticated USING (true)',
        tbl, tbl
    );
    EXECUTE format(
        'CREATE POLICY "auth_insert_%s" ON %I FOR INSERT TO authenticated WITH CHECK (true)',
        tbl, tbl
    );
    EXECUTE format(
        'CREATE POLICY "auth_update_%s" ON %I FOR UPDATE TO authenticated USING (true) WITH CHECK (true)',
        tbl, tbl
    );
    EXECUTE format(
        'CREATE POLICY "auth_delete_%s" ON %I FOR DELETE TO authenticated USING (true)',
        tbl, tbl
    );
END;
$$ LANGUAGE plpgsql;


-- ── Apply to every reliability/integrity/library table 0150 missed ──────
DO $$
DECLARE
    t TEXT;
    tables TEXT[] := ARRAY[
        -- Reliability core (FMEA / RCM / RCA / RBD / prediction)
        'ers_fmea_worksheets', 'ers_fmea_items',
        'ers_rcm_studies', 'ers_rcm_functions', 'ers_rcm_failure_modes', 'ers_rcm_decisions',
        'ers_rca_investigations', 'ers_rca_nodes', 'ers_rca_evidence', 'ers_rca_barriers',
        'ers_rca_team_members', 'ers_rca_cause_taxonomy', 'ers_rca_audit_log',
        'ers_rbd_models', 'ers_bad_actor_snapshots', 'ers_defect_elimination_tasks',
        'ers_prediction_alerts', 'ers_rul_estimates', 'ers_sensor_readings', 'ers_twin_states',
        -- Integrity / mechanical (API 510/570/653, RBI, FFS, corrosion)
        'ers_cmls', 'ers_thickness_readings', 'ers_corrosion_rates', 'ers_inspections',
        'ers_damage_mechanisms', 'ers_rbi_assessments', 'ers_ffs_assessments',
        'ers_iow_parameters', 'ers_risk_register',
        -- Process safety (PHA / HAZOP / LOPA / SIL / PSM)
        'ers_psm_studies', 'ers_pha_items', 'ers_hazop_nodes', 'ers_hazop_deviations',
        'ers_lopa_scenarios', 'ers_sil_assessments', 'ers_bowtie_elements', 'ers_pssr_checklists',
        -- Intelligence / ESG / digital twin / vision
        'ers_climate_risks', 'ers_carbon_metrics', 'ers_drone_surveys', 'ers_vision_results',
        'ers_pid_configurations',
        -- MOC, readings, task library
        'moc_requests',
        'reading_definitions', 'reading_logs',
        'task_library_files', 'task_library_inventory', 'task_library_items', 'task_library_roles'
    ];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        PERFORM _create_auth_policies(t);
    END LOOP;
END $$;

-- Cleanup helper function (matches 0150).
DROP FUNCTION IF EXISTS _create_auth_policies(TEXT);


-- ═══════════════════════════════════════════════════════════════════════
-- Verification (run manually in Supabase SQL editor if desired):
--   SELECT tablename FROM pg_tables t
--   WHERE schemaname = 'public'
--     AND NOT rowsecurity
--   ORDER BY tablename;
-- Expect: no ers_*, moc_requests, reading_*, or task_library_* rows.
-- ═══════════════════════════════════════════════════════════════════════
