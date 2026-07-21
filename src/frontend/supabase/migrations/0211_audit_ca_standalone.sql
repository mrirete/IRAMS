-- ============================================================
-- 0211: Standalone corrective actions.
-- The Corrective Actions page now logs CAs directly (ISO 55001
-- §10.1 nonconformities from any source), so the audit-finding
-- link becomes optional instead of mandatory.
-- ============================================================
ALTER TABLE audit_corrective_actions ALTER COLUMN finding_id DROP NOT NULL;
