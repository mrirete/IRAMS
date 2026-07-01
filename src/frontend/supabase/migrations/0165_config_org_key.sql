-- ============================================================================
-- Migration: 0165_config_org_key
-- Multi-tenancy groundwork (design doc: Multi-Tenancy-Enterprise-Structure-Design).
--
-- Future-proofs the two config singletons so they can become per-org (SAP NRIV /
-- IMG: number ranges + config assigned per Company Code / Plant) WITHOUT a second
-- migration later. This is the low-regret step ahead of the full T-0 org spine.
--
-- ADDITIVE & NON-BREAKING: adds nullable org-scope columns only. The existing
-- singleton rows become the client-level default (scope_type='TENANT', scope_id
-- NULL). No trigger or app change — resolution still uses the default row until T-2
-- wires most-specific-wins (SITE -> COMPANY -> TENANT default).
-- ============================================================================

ALTER TABLE numbering_config
  ADD COLUMN IF NOT EXISTS scope_type text NOT NULL DEFAULT 'TENANT'
    CHECK (scope_type IN ('TENANT', 'COMPANY', 'SITE')),
  ADD COLUMN IF NOT EXISTS scope_id uuid;   -- NULL = client-level default

ALTER TABLE hierarchy_config
  ADD COLUMN IF NOT EXISTS scope_type text NOT NULL DEFAULT 'TENANT'
    CHECK (scope_type IN ('TENANT', 'COMPANY', 'SITE')),
  ADD COLUMN IF NOT EXISTS scope_id uuid;   -- NULL = client-level default

COMMENT ON COLUMN numbering_config.scope_type IS 'Org level this config applies to (TENANT default / COMPANY / SITE). Resolution most-specific-wins at T-2.';
COMMENT ON COLUMN hierarchy_config.scope_type IS 'Org level this config applies to (TENANT default / COMPANY / SITE).';

-- Rollback (manual):
--   ALTER TABLE numbering_config  DROP COLUMN IF EXISTS scope_type, DROP COLUMN IF EXISTS scope_id;
--   ALTER TABLE hierarchy_config  DROP COLUMN IF EXISTS scope_type, DROP COLUMN IF EXISTS scope_id;
