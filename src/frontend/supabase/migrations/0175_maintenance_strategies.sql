-- ═══════════════════════════════════════════════════════════════════════
-- 0175: Maintenance strategies & packages (R-5) — SAP strategy plans
-- ═══════════════════════════════════════════════════════════════════════
-- A strategy is a named set of nested maintenance packages (cycles, e.g.
-- 1M/3M/6M/12M). Assets adopt a strategy; when several packages fall due
-- together the longer cycle absorbs the shorter ones (scheduling engine +
-- lib/maintenanceStrategy.ts resolveDue), killing PM over/under-maintenance.
--
-- Additive & non-breaking: new tables + a nullable assets.maintenance_strategy_id.
-- Atomic + idempotent (0171 lesson). Reads broad, writes admin-only.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS maintenance_strategies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS strategy_packages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id   UUID NOT NULL REFERENCES maintenance_strategies(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,               -- '1M', 'Annual', …
  interval_days INT  NOT NULL CHECK (interval_days > 0),
  task_count    INT  NOT NULL DEFAULT 0,
  sort_order    INT  NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_strategy_packages_strategy ON strategy_packages(strategy_id);

-- Assets adopt a strategy (nullable; assign by criticality class).
ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS maintenance_strategy_id UUID REFERENCES maintenance_strategies(id);

-- ── RLS: reads broad, writes admin-only (config posture, is_admin from 0171) ──
DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['maintenance_strategies', 'strategy_packages']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "auth_select_%s"  ON %I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "admin_insert_%s" ON %I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "admin_update_%s" ON %I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "admin_delete_%s" ON %I', tbl, tbl);
    EXECUTE format('CREATE POLICY "auth_select_%s"  ON %I FOR SELECT TO authenticated USING (true)', tbl, tbl);
    EXECUTE format('CREATE POLICY "admin_insert_%s" ON %I FOR INSERT TO authenticated WITH CHECK (public.is_admin())', tbl, tbl);
    EXECUTE format('CREATE POLICY "admin_update_%s" ON %I FOR UPDATE TO authenticated USING (public.is_admin())', tbl, tbl);
    EXECUTE format('CREATE POLICY "admin_delete_%s" ON %I FOR DELETE TO authenticated USING (public.is_admin())', tbl, tbl);
  END LOOP;
END $$;

COMMIT;

-- ROLLBACK (manual):
--   ALTER TABLE assets DROP COLUMN IF EXISTS maintenance_strategy_id;
--   DROP TABLE IF EXISTS strategy_packages;
--   DROP TABLE IF EXISTS maintenance_strategies;
