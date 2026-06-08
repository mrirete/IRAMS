-- ============================================================
-- 0081 — Analyze Module Persistence
-- Tables for Defect Elimination tasks, RBD models, P&ID configs.
-- Enables manual data input + Supabase-backed persistence.
-- ============================================================

-- ═══════════════════════════════════════════════════════════════
--  1. ers_defect_elimination_tasks — Kanban board persistence
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ers_defect_elimination_tasks (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id             UUID,
    asset_name           TEXT NOT NULL,
    title                TEXT NOT NULL,
    status               TEXT NOT NULL DEFAULT 'identified'
      CHECK (status IN ('identified','in_progress','resolved','verified')),
    priority             TEXT NOT NULL DEFAULT 'medium'
      CHECK (priority IN ('critical','high','medium','low')),
    annual_cost          NUMERIC DEFAULT 0,
    estimated_savings    NUMERIC DEFAULT 0,
    implementation_cost  NUMERIC DEFAULT 0,
    payback_months       NUMERIC DEFAULT 0,
    root_cause_summary   TEXT DEFAULT '',
    proposed_solution    TEXT DEFAULT '',
    rca_id               UUID REFERENCES ers_rca_investigations(id) ON DELETE SET NULL,
    created_by           TEXT,
    created_at           TIMESTAMPTZ DEFAULT NOW(),
    updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_de_tasks_asset    ON ers_defect_elimination_tasks(asset_id);
CREATE INDEX IF NOT EXISTS idx_de_tasks_status   ON ers_defect_elimination_tasks(status);
CREATE INDEX IF NOT EXISTS idx_de_tasks_priority ON ers_defect_elimination_tasks(priority);

-- ═══════════════════════════════════════════════════════════════
--  2. ers_rbd_models — Saved Reliability Block Diagram models
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ers_rbd_models (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title                 TEXT NOT NULL,
    asset_id              UUID,              -- system/unit being modeled
    blocks                JSONB NOT NULL DEFAULT '[]'::JSONB,
    groups                JSONB NOT NULL DEFAULT '[]'::JSONB,
    system_availability   NUMERIC,           -- last calculated value
    created_by            TEXT,
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rbd_models_asset ON ers_rbd_models(asset_id);

-- ═══════════════════════════════════════════════════════════════
--  3. ers_pid_configurations — Saved P&ID layouts
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ers_pid_configurations (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title             TEXT NOT NULL,
    asset_id          UUID,              -- system/unit being diagrammed
    equipment         JSONB NOT NULL DEFAULT '[]'::JSONB,
    connections       JSONB NOT NULL DEFAULT '[]'::JSONB,
    show_heat_map     BOOLEAN DEFAULT FALSE,
    created_by        TEXT,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pid_configs_asset ON ers_pid_configurations(asset_id);

-- ═══════════════════════════════════════════════════════════════
--  4. Auto-update updated_at via trigger
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOR tbl IN
        SELECT unnest(ARRAY[
            'ers_defect_elimination_tasks',
            'ers_rbd_models',
            'ers_pid_configurations'
        ])
    LOOP
        -- Create updated_at trigger
        BEGIN
            EXECUTE format(
                'CREATE TRIGGER trigger_%s_updated_at BEFORE UPDATE ON %I
                 FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()',
                tbl, tbl
            );
        EXCEPTION WHEN duplicate_object THEN
            NULL; -- trigger already exists
        END;
    END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════
--  5. RLS + Policies
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOR tbl IN
        SELECT unnest(ARRAY[
            'ers_defect_elimination_tasks',
            'ers_rbd_models',
            'ers_pid_configurations'
        ])
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
        BEGIN
            EXECUTE format(
                'CREATE POLICY "Enable all for authenticated" ON %I FOR ALL USING (auth.role() = ''authenticated'')',
                tbl
            );
        EXCEPTION WHEN duplicate_object THEN
            NULL; -- policy already exists
        END;
    END LOOP;
END $$;
