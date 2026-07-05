-- ═══════════════════════════════════════════════════════════════════════
-- 0173: Company Code tier (T-0 org spine) — SAP Company Code (BUKRS)
-- ═══════════════════════════════════════════════════════════════════════
-- Introduces the sub-company / legal-entity tier the enterprise-structure
-- design calls for, so one deployment can serve a parent with multiple
-- companies, each owning its own org units (sites/areas) and — via the
-- scope keys already on numbering_config/hierarchy_config (0165) — its own
-- numbering framework and configuration, with group-level rollup.
--
-- SCOPING NOTES (deviations from the design doc, deliberate — reality moved on):
--  · Reuse `organization_units` as the site/org spine (0168 work_centers
--    already references it as site_id) instead of a competing `sites` table.
--    company_id is added to organization_units; the org tree hangs under a
--    company.
--  · No separate `tenants` table under the chosen SINGLE-TENANT-PER-DEPLOYMENT
--    model — one deployment == one tenant. A nullable companies.tenant_id is
--    reserved for a future shared-tenant migration without a retrofit.
--  · The `site_id`-everywhere denormalization (design §4) is deferred with
--    T-3 RLS enforcement — its purpose is fast row-scoped policies, which the
--    single-tenant posture de-prioritizes. This migration is purely the org
--    tier: additive, non-breaking, no behaviour change.
--
-- ATOMIC + idempotent (lesson from 0171): the Supabase SQL editor runs
-- statement-by-statement, so a mid-script error would leave a partial state.
-- Wrapped in one transaction; safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. companies (SAP Company Code) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS companies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID,                         -- reserved; NULL = the single implicit tenant
  code        TEXT NOT NULL UNIQUE,         -- e.g. '1000', 'CAIN-NG'
  name        TEXT NOT NULL,
  description TEXT,
  country     TEXT,                         -- legal-entity country (SAP company code carries one)
  currency    TEXT,                         -- reporting currency (ISO 4217), optional
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. link org units to a company (nullable during rollout) ────────────
ALTER TABLE organization_units
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);
CREATE INDEX IF NOT EXISTS idx_org_units_company_id ON organization_units(company_id);

-- ── 3. seed a default company + backfill existing org units ─────────────
-- The current implicit single company. Idempotent: only inserts if absent,
-- only backfills org units that have no company yet.
INSERT INTO companies (code, name, description)
VALUES ('MAIN', 'Main Company', 'Default company (auto-created for the existing organization). Rename in Admin → Companies.')
ON CONFLICT (code) DO NOTHING;

UPDATE organization_units
   SET company_id = (SELECT id FROM companies WHERE code = 'MAIN')
 WHERE company_id IS NULL;

-- ── 4. RLS — reads broad, writes admin-only (matches 0171 config posture) ─
-- companies is enterprise configuration: everyone can read (scope pickers,
-- rollup), only admins mutate. public.is_admin() from 0171.
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_companies"  ON companies;
DROP POLICY IF EXISTS "admin_insert_companies" ON companies;
DROP POLICY IF EXISTS "admin_update_companies" ON companies;
DROP POLICY IF EXISTS "admin_delete_companies" ON companies;
CREATE POLICY "auth_select_companies"  ON companies FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_insert_companies" ON companies FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "admin_update_companies" ON companies FOR UPDATE TO authenticated USING (public.is_admin());
CREATE POLICY "admin_delete_companies" ON companies FOR DELETE TO authenticated USING (public.is_admin());

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════
-- VERIFY
--   SELECT code, name FROM companies;                        -- MAIN present
--   SELECT count(*) FROM organization_units WHERE company_id IS NULL;  -- 0
-- ROLLBACK (manual):
--   ALTER TABLE organization_units DROP COLUMN IF EXISTS company_id;
--   DROP TABLE IF EXISTS companies;
-- ═══════════════════════════════════════════════════════════════════════
