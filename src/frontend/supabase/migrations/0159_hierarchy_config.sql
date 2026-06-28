-- ============================================================================
-- Migration: 0159_hierarchy_config
-- UAT F-002/F-004/F-007/F-010 — "configurable in Admin". Persists the hierarchy
-- level model so an Admin screen can edit labels, object class (FLOC vs Equipment,
-- which drives numbering + field visibility), and the per-level criticality rule.
--
-- Singleton row (id = 1) holding the level array as JSONB. If empty/absent, the
-- app falls back to hierarchyModel.DEFAULT_LEVELS.
-- ============================================================================

CREATE TABLE IF NOT EXISTS hierarchy_config (
  id         INT PRIMARY KEY DEFAULT 1,
  levels     JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT hierarchy_config_singleton CHECK (id = 1)
);

ALTER TABLE hierarchy_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_hierarchy_config" ON hierarchy_config;
CREATE POLICY "auth_all_hierarchy_config"
  ON hierarchy_config FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Rollback (manual):
--   DROP TABLE IF EXISTS hierarchy_config;
