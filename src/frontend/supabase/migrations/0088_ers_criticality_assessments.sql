-- ============================================================
-- 0088: Criticality Assessment Table (ISO 14224 / ISO 31000)
-- ============================================================
-- Stores granular criticality assessments: 5×5 risk matrix
-- Consequence (Safety, Env, Prod, Cost, Reputation) × Probability
-- Each factor scored 1-5; overall_criticality derived as A/B/C.
-- ============================================================

CREATE TABLE IF NOT EXISTS ers_criticality_assessments (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id        UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,

    -- Consequence factors (1 = Negligible … 5 = Catastrophic)
    consequence_safety      SMALLINT NOT NULL DEFAULT 1 CHECK (consequence_safety BETWEEN 1 AND 5),
    consequence_environment SMALLINT NOT NULL DEFAULT 1 CHECK (consequence_environment BETWEEN 1 AND 5),
    consequence_production  SMALLINT NOT NULL DEFAULT 1 CHECK (consequence_production BETWEEN 1 AND 5),
    consequence_cost        SMALLINT NOT NULL DEFAULT 1 CHECK (consequence_cost BETWEEN 1 AND 5),
    consequence_reputation  SMALLINT NOT NULL DEFAULT 1 CHECK (consequence_reputation BETWEEN 1 AND 5),

    -- Probability of occurrence (1 = Rare … 5 = Almost Certain)
    probability             SMALLINT NOT NULL DEFAULT 1 CHECK (probability BETWEEN 1 AND 5),

    -- Derived: max consequence × probability  →  risk score (1-25)
    risk_score              SMALLINT GENERATED ALWAYS AS (
        GREATEST(
            consequence_safety,
            consequence_environment,
            consequence_production,
            consequence_cost,
            consequence_reputation
        ) * probability
    ) STORED,

    -- Overall criticality rating mapped from risk_score
    -- A = High (score ≥ 15), B = Medium (8-14), C = Low (≤ 7)
    overall_criticality     criticality NOT NULL DEFAULT 'C',

    -- Assessment metadata
    assessed_by             UUID REFERENCES users(id),
    assessed_at             TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    notes                   TEXT,

    -- Audit
    created_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- One active assessment per asset
    UNIQUE(asset_id)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_criticality_asset   ON ers_criticality_assessments(asset_id);
CREATE INDEX IF NOT EXISTS idx_criticality_overall ON ers_criticality_assessments(overall_criticality);
CREATE INDEX IF NOT EXISTS idx_criticality_score   ON ers_criticality_assessments(risk_score);

-- RLS
ALTER TABLE ers_criticality_assessments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all for authenticated"
    ON ers_criticality_assessments FOR ALL
    USING (auth.role() = 'authenticated');

-- Audit trigger
CREATE TRIGGER audit_criticality_changes
    AFTER INSERT OR UPDATE OR DELETE ON ers_criticality_assessments
    FOR EACH ROW EXECUTE FUNCTION log_audit_event();

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_criticality_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_criticality_updated_at
    BEFORE UPDATE ON ers_criticality_assessments
    FOR EACH ROW EXECUTE FUNCTION update_criticality_timestamp();
