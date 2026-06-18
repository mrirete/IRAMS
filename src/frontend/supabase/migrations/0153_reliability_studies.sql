-- ============================================================
-- 0153: Reliability Studies — parent container that groups an
-- asset's analyses (RBD, RAM/MTBF, Weibull, Monte Carlo, Spares)
-- into one named, dated study. Analyses link via study_id;
-- a null study_id means "ungrouped" (backward compatible).
-- ============================================================

CREATE TABLE IF NOT EXISTS ers_reliability_studies (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT NOT NULL,
    asset_id     UUID REFERENCES assets(id) ON DELETE SET NULL,
    asset_tag    TEXT,
    asset_name   TEXT,
    description  TEXT,
    status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_by   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Link analyses (and their version lineages) to a study.
ALTER TABLE ers_reliability_analyses
    ADD COLUMN IF NOT EXISTS study_id UUID REFERENCES ers_reliability_studies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_reliability_analyses_study ON ers_reliability_analyses(study_id);
CREATE INDEX IF NOT EXISTS idx_reliability_studies_asset ON ers_reliability_studies(asset_id);

-- Auto-update updated_at on every UPDATE
CREATE OR REPLACE FUNCTION update_reliability_studies_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reliability_studies_updated ON ers_reliability_studies;
CREATE TRIGGER trg_reliability_studies_updated
    BEFORE UPDATE ON ers_reliability_studies
    FOR EACH ROW
    EXECUTE FUNCTION update_reliability_studies_timestamp();

ALTER TABLE ers_reliability_studies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for authenticated users"
    ON ers_reliability_studies FOR ALL
    USING (true)
    WITH CHECK (true);
