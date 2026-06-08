-- ═══════════════════════════════════════════════════════════════
--  0082 — Analysis Data Sources (Maintenance Database Integration)
--
--  Stores the maintenance data context pulled from local EAM or
--  external CMMS connectors for each RCA/FMEA analysis.
-- ═══════════════════════════════════════════════════════════════

-- 1. Table
CREATE TABLE IF NOT EXISTS ers_analysis_data_sources (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    analysis_id          UUID NOT NULL,
    analysis_type        TEXT NOT NULL CHECK (analysis_type IN ('rca', 'fmea')),
    source_mode          TEXT NOT NULL DEFAULT 'connected' CHECK (source_mode IN ('connected', 'manual')),
    connector_id         TEXT,                  -- NULL if local EAM or manual
    connector_name       TEXT,                  -- Display name snapshot
    target_level         TEXT NOT NULL DEFAULT 'equipment'
                           CHECK (target_level IN ('site','system','equipment','subunit','component','location')),
    -- Pulled / manual summary data
    total_work_orders    INT DEFAULT 0,
    failure_work_orders  INT DEFAULT 0,
    last_wo_date         TIMESTAMPTZ,
    mtbf_hours           NUMERIC,
    mttr_hours           NUMERIC,
    top_failure_modes    JSONB DEFAULT '[]'::jsonb,
    work_order_samples   JSONB DEFAULT '[]'::jsonb,
    manual_notes         TEXT,
    created_at           TIMESTAMPTZ DEFAULT now(),
    updated_at           TIMESTAMPTZ DEFAULT now()
);

-- 2. Index on analysis lookup
CREATE INDEX IF NOT EXISTS idx_analysis_data_src_analysis
    ON ers_analysis_data_sources (analysis_id, analysis_type);

-- 3. Auto-update trigger
CREATE OR REPLACE FUNCTION set_updated_at_col()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ers_analysis_data_sources_updated_at'
    ) THEN
        CREATE TRIGGER trg_ers_analysis_data_sources_updated_at
            BEFORE UPDATE ON ers_analysis_data_sources
            FOR EACH ROW EXECUTE FUNCTION set_updated_at_col();
    END IF;
END $$;

-- 4. RLS + Policy
ALTER TABLE ers_analysis_data_sources ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    CREATE POLICY "Enable all for authenticated"
        ON ers_analysis_data_sources
        FOR ALL
        USING (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN
    NULL;
END $$;
