-- 0131_maintenance_request_compliance.sql
-- ============================================================
-- MAINTENANCE REQUEST COMPLIANCE FIXES (Assessment Gaps 1,2,4,6,7,9)
--
-- This migration addresses all gaps identified in the
-- Maintenance Request Compliance Assessment (2026-05-02)
-- against SAP PM/CS and ISO 14224/55000 standards.
-- ============================================================

-- ═══════════════════════════════════════════════════════════
-- GAP-1: MISSING AUDIT TRIGGER ON service_requests
-- Per NIST/IEC 62443: "non-erasable log of Who, What, When, Where"
-- The log_audit_event() function already exists (0000_initial_schema).
-- ═══════════════════════════════════════════════════════════

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'audit_service_requests_changes'
    AND tgrelid = 'service_requests'::regclass
  ) THEN
    CREATE TRIGGER audit_service_requests_changes
    AFTER INSERT OR UPDATE OR DELETE ON service_requests
    FOR EACH ROW EXECUTE FUNCTION log_audit_event();
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════
-- GAP-2: is_breakdown COLUMN MISSING
-- Critical for RCM — distinguishes corrective from breakdown
-- maintenance, impacting MTBF/MTTR calculations.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE service_requests
  ADD COLUMN IF NOT EXISTS is_breakdown BOOLEAN DEFAULT FALSE;

-- ═══════════════════════════════════════════════════════════
-- GAP-4: WO NUMBER SEQUENCE
-- Replace timestamp-based generation with a DB sequence
-- to eliminate collision risk under concurrency.
-- SAP PM equivalent: AUFNR number range.
-- ═══════════════════════════════════════════════════════════

CREATE SEQUENCE IF NOT EXISTS wo_number_seq START WITH 1000 INCREMENT BY 1;

-- Helper function to generate SAP-style WO numbers
CREATE OR REPLACE FUNCTION generate_wo_number()
RETURNS TEXT AS $$
BEGIN
  RETURN 'WO-' || EXTRACT(YEAR FROM NOW())::TEXT || '-' ||
         LPAD(nextval('wo_number_seq')::TEXT, 5, '0');
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════
-- GAP-6: CATEGORY COLUMN ON service_requests
-- SAP PM equivalent: QMKAT (Notification Category).
-- Used to route work to the correct maintenance craft.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE service_requests
  ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'GENERAL';

-- ═══════════════════════════════════════════════════════════
-- GAP-7: AUTHORIZATION STAMP COLUMNS
-- Records WHO authorized and WHEN for governance evidence.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE service_requests
  ADD COLUMN IF NOT EXISTS authorized_by UUID;

ALTER TABLE service_requests
  ADD COLUMN IF NOT EXISTS authorized_at TIMESTAMPTZ;

-- ═══════════════════════════════════════════════════════════
-- GAP-9: SITE-SCOPED RLS STUB
-- Current RLS is "authenticated = full access".
-- This adds a comment-level marker for future implementation
-- of data-scope filtering by site/department.
--
-- NOTE: Full RLS scoping requires org_unit membership tables
-- and a site-resolution function. The infrastructure exists
-- (organization_units, organization_unit_members) but the
-- policy functions need to be written as a separate effort.
-- ═══════════════════════════════════════════════════════════

-- Future: Replace the broad policy with:
--   CREATE POLICY "site_scoped_access" ON service_requests
--   FOR ALL USING (
--     asset_id IN (
--       SELECT a.id FROM assets a
--       JOIN organization_unit_members oum ON oum.contact_id = auth.uid()
--       JOIN organization_units ou ON ou.id = oum.organization_unit_id
--       WHERE a.cost_center_id = ou.id  -- or site resolution logic
--     )
--   );

COMMENT ON TABLE service_requests IS
  'Maintenance Request module. RLS: Currently broad authenticated access. '
  'GAP-9: Requires site-scoped RLS policy using organization_units membership. '
  'Target: Per User Rule — "A technician at Site A cannot view cost centers of Site B."';

-- ═══════════════════════════════════════════════════════════
-- DONE — 5 schema fixes applied
-- ═══════════════════════════════════════════════════════════
