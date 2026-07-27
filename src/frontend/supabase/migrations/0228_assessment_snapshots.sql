-- ═══════════════════════════════════════════════════════════════
-- 0228 — Specialist Phase A1: persisted assessment snapshots
--
-- The $150k-replacement plan (docs/Specialist-150k-Replacement-Plan.md §5)
-- rests on a before/after story, and today the assessment report is React
-- state: recompute replaces it, navigation discards it. This table makes
-- every qualifying assessment run a durable, append-only snapshot so the
-- report can show run-over-run deltas and the briefing can trend KPIs.
--
-- Scalar KPI columns exist so trending never has to parse `findings`;
-- `findings` keeps the complete computed Assessment object for re-render
-- and audit. Append-only by construction: no UPDATE policy at all,
-- deletes admin-only (matches the 0186 governance tiering).
-- ═══════════════════════════════════════════════════════════════
BEGIN;

CREATE TABLE IF NOT EXISTS ers_assessment_snapshots (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by            TEXT,
    -- scalar KPIs for cheap trending
    total_spend_12mo      NUMERIC NOT NULL DEFAULT 0,
    wo_count_12mo         INTEGER NOT NULL DEFAULT 0,
    asset_count           INTEGER NOT NULL DEFAULT 0,
    warranty_recoverable  NUMERIC NOT NULL DEFAULT 0,
    pm_flag_count         INTEGER NOT NULL DEFAULT 0,
    coverage_cost_pct     INTEGER,
    coverage_failure_pct  INTEGER,
    coverage_downtime_pct INTEGER,
    register_health_pct   INTEGER,
    -- complete computed Assessment object + the narrator's prose
    findings              JSONB NOT NULL DEFAULT '{}',
    narrative             TEXT
);

CREATE INDEX IF NOT EXISTS idx_assessment_snapshots_created
    ON ers_assessment_snapshots(created_at DESC);

ALTER TABLE ers_assessment_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_select_assessment_snapshots  ON ers_assessment_snapshots;
DROP POLICY IF EXISTS admin_insert_assessment_snapshots ON ers_assessment_snapshots;
DROP POLICY IF EXISTS admin_delete_assessment_snapshots ON ers_assessment_snapshots;

-- Reads open to authenticated (the report reads the same tables anyway);
-- writes admin-only like import_batches — running the assessment is an
-- admin operation. No UPDATE policy: snapshots are immutable.
CREATE POLICY auth_select_assessment_snapshots ON ers_assessment_snapshots
    FOR SELECT TO authenticated USING (true);
CREATE POLICY admin_insert_assessment_snapshots ON ers_assessment_snapshots
    FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY admin_delete_assessment_snapshots ON ers_assessment_snapshots
    FOR DELETE TO authenticated USING (public.is_admin());

COMMIT;
