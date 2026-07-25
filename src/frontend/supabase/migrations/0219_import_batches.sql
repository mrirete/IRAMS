-- ═══════════════════════════════════════════════════════════════
-- 0219 — Specialist Phase 1: CMMS import staging + edition flag
--
-- The assessment-led sale runs on foreign CMMS exports (SAP PM,
-- Maximo, MaintainX, spreadsheets). This migration adds:
--   1. import_batches — one row per import: source system, the
--      human-approved column mapping (agent-proposed), the
--      deterministic data-quality report, and lifecycle status.
--   2. import_batch_id provenance on assets + work_orders, so
--      imported rows are traceable to their batch and a bad import
--      can be located (and rolled back) precisely.
--   3. companies.edition — 'platform' (full IRAMS) | 'specialist'
--      (Specialist-only: EAM navigation hidden). The packaging
--      ruling in docs/IRAMS-Specialist-Strategy.md §5.2: standalone
--      commercially, one platform technically.
--   4. Admin read access to ers_ai_audit_log so the Specialist
--      workspace can show the agent work log (writes stay
--      service-role-only; log remains append-only).
--
-- Historical WOs are inserted directly with frozen costs +
-- cost_frozen=true: the freeze_costs_on_close trigger is BEFORE
-- UPDATE only, and pre-frozen rows are then immutable — correct
-- for imported history.
-- ═══════════════════════════════════════════════════════════════
BEGIN;

-- ── 1. import_batches ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS import_batches (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_system  TEXT NOT NULL DEFAULT 'unknown'
                   CHECK (source_system IN ('sap_pm','maximo','maintainx','emaint','limble','fiix','upkeep','spreadsheet','other','unknown')),
    file_name      TEXT,
    status         TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','mapped','committed','rolled_back','failed')),
    mapping        JSONB,   -- confirmed column mapping (agent-proposed, human-approved)
    dq_report      JSONB,   -- deterministic data-quality findings (issues[], coverage, date_range)
    row_counts     JSONB,   -- {assets, work_orders, failure_rows, skipped}
    notes          TEXT,
    created_by     UUID,
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    committed_at   TIMESTAMPTZ
);

ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auth_select_import_batches  ON import_batches;
DROP POLICY IF EXISTS admin_insert_import_batches ON import_batches;
DROP POLICY IF EXISTS admin_update_import_batches ON import_batches;
DROP POLICY IF EXISTS admin_delete_import_batches ON import_batches;
-- Reads open to authenticated; writes admin-only (imports are an admin operation).
CREATE POLICY auth_select_import_batches ON import_batches
    FOR SELECT TO authenticated USING (true);
CREATE POLICY admin_insert_import_batches ON import_batches
    FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY admin_update_import_batches ON import_batches
    FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY admin_delete_import_batches ON import_batches
    FOR DELETE TO authenticated USING (public.is_admin());

-- ── 2. Provenance on target tables ──────────────────────────────
ALTER TABLE assets
    ADD COLUMN IF NOT EXISTS import_batch_id UUID REFERENCES import_batches(id) ON DELETE SET NULL;
ALTER TABLE work_orders
    ADD COLUMN IF NOT EXISTS import_batch_id UUID REFERENCES import_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_assets_import_batch ON assets(import_batch_id) WHERE import_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wo_import_batch     ON work_orders(import_batch_id) WHERE import_batch_id IS NOT NULL;

-- ── 3. Edition flag (packaging ruling, strategy §5.2) ───────────
ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS edition TEXT NOT NULL DEFAULT 'platform'
    CHECK (edition IN ('platform','specialist'));

-- ── 4. Specialist work log: admins may read the AI audit trail ──
-- (0149 created the table; writes happen via service role in the
-- agent-run edge function. No SELECT policy existed for the app.)
DROP POLICY IF EXISTS admin_select_ers_ai_audit_log ON ers_ai_audit_log;
CREATE POLICY admin_select_ers_ai_audit_log ON ers_ai_audit_log
    FOR SELECT TO authenticated USING (public.is_admin());

COMMIT;
