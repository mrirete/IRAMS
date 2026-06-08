-- ============================================================
-- 0102: Reliability Analyses — persist calculator results
-- Stores results from MTBF/MTTR, Weibull, Availability,
-- Spares Demand, and Maintainability calculators.
-- ============================================================

CREATE TABLE IF NOT EXISTS ers_reliability_analyses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id        UUID REFERENCES assets(id) ON DELETE SET NULL,
    asset_tag       TEXT,
    asset_name      TEXT,
    analysis_type   TEXT NOT NULL CHECK (analysis_type IN (
        'mtbf', 'weibull', 'availability', 'spares', 'maintainability'
    )),
    title           TEXT NOT NULL,
    inputs          JSONB NOT NULL DEFAULT '{}',
    results         JSONB NOT NULL DEFAULT '{}',
    notes           TEXT,
    created_by      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast asset-scoped lookups
CREATE INDEX IF NOT EXISTS idx_reliability_analyses_asset
    ON ers_reliability_analyses(asset_id);

-- Index for type-filtered listing
CREATE INDEX IF NOT EXISTS idx_reliability_analyses_type
    ON ers_reliability_analyses(analysis_type);

-- Auto-update updated_at on every UPDATE
CREATE OR REPLACE FUNCTION update_reliability_analyses_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reliability_analyses_updated ON ers_reliability_analyses;
CREATE TRIGGER trg_reliability_analyses_updated
    BEFORE UPDATE ON ers_reliability_analyses
    FOR EACH ROW
    EXECUTE FUNCTION update_reliability_analyses_timestamp();

-- RLS
ALTER TABLE ers_reliability_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for authenticated users"
    ON ers_reliability_analyses FOR ALL
    USING (true)
    WITH CHECK (true);
