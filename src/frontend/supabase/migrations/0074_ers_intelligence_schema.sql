-- ============================================================
-- ERS Intelligence Schema
-- Creates all ers_* tables for Predict, Integrity, Analyze,
-- Vision, and Sustain domains.
-- All tables FK → assets(id), UUID PKs, RLS for authenticated.
-- ============================================================

-- ═══════════════════════════════════════════════════════════════
--  PREDICT DOMAIN
-- ═══════════════════════════════════════════════════════════════

-- Digital twin health snapshots per asset
CREATE TABLE IF NOT EXISTS ers_twin_states (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id        UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    twin_id         TEXT NOT NULL,
    health_index    NUMERIC(5,1) NOT NULL CHECK (health_index BETWEEN 0 AND 100),
    calibration_quality  NUMERIC(5,1),
    calibration_drift    NUMERIC(5,3),
    sensor_summary       JSONB DEFAULT '{}'::JSONB,
    degradation_models   JSONB DEFAULT '[]'::JSONB,
    health_projection    JSONB DEFAULT '[]'::JSONB,
    last_calibrated_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_twin_states_asset ON ers_twin_states(asset_id);

-- RUL predictions with confidence bands
CREATE TABLE IF NOT EXISTS ers_rul_estimates (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id        UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    rul_days        NUMERIC(8,1) NOT NULL,
    confidence      NUMERIC(4,2) CHECK (confidence BETWEEN 0 AND 1),
    distribution_type TEXT CHECK (distribution_type IN ('weibull_2p','weibull_3p','lognormal','exponential','normal')),
    dqs_impact      NUMERIC(4,2),
    governance_tier INTEGER CHECK (governance_tier BETWEEN 1 AND 5),
    confidence_bands JSONB DEFAULT '[]'::JSONB,
    computed_at     TIMESTAMPTZ DEFAULT NOW(),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_rul_estimates_asset ON ers_rul_estimates(asset_id);

-- AI-generated alerts per asset
CREATE TABLE IF NOT EXISTS ers_prediction_alerts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    alert_id        TEXT UNIQUE NOT NULL,
    asset_id        UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    alert_type      TEXT NOT NULL CHECK (alert_type IN ('trend_deviation','threshold_breach','anomaly','rul_warning','pattern_detected')),
    severity        TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
    title           TEXT NOT NULL,
    description     TEXT,
    confidence      NUMERIC(4,2),
    dqs_impact      NUMERIC(4,2),
    governance_tier INTEGER,
    acknowledged    BOOLEAN DEFAULT FALSE,
    acknowledged_by UUID REFERENCES users(id),
    acknowledged_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_prediction_alerts_asset ON ers_prediction_alerts(asset_id);

-- Sensor trend data (time-series snapshots)
CREATE TABLE IF NOT EXISTS ers_sensor_readings (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id        UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    tag             TEXT NOT NULL,
    current_value   NUMERIC(12,3),
    unit            TEXT NOT NULL,
    trend           TEXT CHECK (trend IN ('rising','falling','stable')),
    alarm_high      NUMERIC(12,3),
    alarm_low       NUMERIC(12,3),
    readings        JSONB DEFAULT '[]'::JSONB,  -- Array of numeric values for sparkline
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_sensor_readings_asset ON ers_sensor_readings(asset_id);

-- ═══════════════════════════════════════════════════════════════
--  INTEGRITY DOMAIN
-- ═══════════════════════════════════════════════════════════════

-- Condition Monitoring Locations
CREATE TABLE IF NOT EXISTS ers_cmls (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id        UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    cml_number      TEXT UNIQUE NOT NULL,
    component_type  TEXT NOT NULL,
    nominal_thickness_mm NUMERIC(6,2) NOT NULL,
    tmin_mm         NUMERIC(6,2) NOT NULL,
    orientation     TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_cmls_asset ON ers_cmls(asset_id);

-- Ultrasonic thickness readings
CREATE TABLE IF NOT EXISTS ers_thickness_readings (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cml_id          UUID NOT NULL REFERENCES ers_cmls(id) ON DELETE CASCADE,
    reading_date    TIMESTAMPTZ NOT NULL,
    measured_thickness_mm NUMERIC(6,2) NOT NULL,
    ut_method       TEXT CHECK (ut_method IN ('ut_contact','paut','tofd','ut_compression','scan')),
    technician      TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_thickness_cml ON ers_thickness_readings(cml_id);

-- Corrosion rates
CREATE TABLE IF NOT EXISTS ers_corrosion_rates (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cml_id          UUID NOT NULL REFERENCES ers_cmls(id) ON DELETE CASCADE,
    asset_id        UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    short_term_rate_mmpy NUMERIC(6,3) NOT NULL,
    long_term_rate_mmpy  NUMERIC(6,3) NOT NULL,
    rate_type       TEXT CHECK (rate_type IN ('general','pitting','erosion','crevice','galvanic')),
    is_accelerating BOOLEAN DEFAULT FALSE,
    last_reading_date TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_corrosion_asset ON ers_corrosion_rates(asset_id);

-- RBI assessments (API 580/581)
CREATE TABLE IF NOT EXISTS ers_rbi_assessments (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id        UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    governing_code  TEXT NOT NULL,
    pof_score       INTEGER NOT NULL CHECK (pof_score BETWEEN 1 AND 5),
    cof_score       TEXT NOT NULL CHECK (cof_score IN ('A','B','C','D','E')),
    risk_rank       TEXT NOT NULL CHECK (risk_rank IN ('Very High','High','Medium-High','Medium','Low')),
    next_inspection_interval_months INTEGER,
    next_inspection_due TIMESTAMPTZ,
    assessor        TEXT,
    assessed_date   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_rbi_asset ON ers_rbi_assessments(asset_id);

-- Integrity Operating Windows (IOW)
CREATE TABLE IF NOT EXISTS ers_iow_parameters (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id        UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    parameter_name  TEXT NOT NULL,
    iow_type        TEXT NOT NULL CHECK (iow_type IN ('critical','standard','informational')),
    unit            TEXT NOT NULL,
    low_limit       NUMERIC(12,3),
    high_limit      NUMERIC(12,3),
    current_value   NUMERIC(12,3),
    breach_status   TEXT CHECK (breach_status IN ('normal','alert','breach')),
    last_breach_date TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_iow_asset ON ers_iow_parameters(asset_id);

-- Inspection schedule & results
CREATE TABLE IF NOT EXISTS ers_inspections (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id        UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    inspection_type TEXT NOT NULL,
    scheduled_date  TIMESTAMPTZ NOT NULL,
    status          TEXT NOT NULL CHECK (status IN ('scheduled','in_progress','completed','overdue','cancelled')),
    findings_count  INTEGER DEFAULT 0,
    inspector       TEXT,
    report_url      TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_inspections_asset ON ers_inspections(asset_id);
CREATE INDEX idx_inspections_status ON ers_inspections(status);

-- API 571 damage mechanisms
CREATE TABLE IF NOT EXISTS ers_damage_mechanisms (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    api_571_code    TEXT NOT NULL,
    mechanism_name  TEXT NOT NULL,
    description     TEXT,
    status          TEXT NOT NULL CHECK (status IN ('active','susceptible','latent','mitigated')),
    source          TEXT CHECK (source IN ('engineer_confirmed','historical','ai_suggested','rbi_driven')),
    affected_asset_ids JSONB DEFAULT '[]'::JSONB,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- API 579 FFS assessments
CREATE TABLE IF NOT EXISTS ers_ffs_assessments (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id        UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    api_579_part    TEXT NOT NULL,
    level           TEXT NOT NULL CHECK (level IN ('Level 1','Level 2','Level 3')),
    status          TEXT NOT NULL CHECK (status IN ('passed','failed','monitoring')),
    rsf             NUMERIC(4,2),
    remaining_life_years NUMERIC(5,1),
    assessor        TEXT,
    assessed_date   TIMESTAMPTZ,
    recommended_action TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_ffs_asset ON ers_ffs_assessments(asset_id);

-- ═══════════════════════════════════════════════════════════════
--  ANALYZE DOMAIN
-- ═══════════════════════════════════════════════════════════════

-- FMEA worksheets
CREATE TABLE IF NOT EXISTS ers_fmea_worksheets (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id        UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    fmea_type       TEXT CHECK (fmea_type IN ('equipment','process','design','system')),
    status          TEXT CHECK (status IN ('draft','active','review','closed')),
    max_rpn         INTEGER DEFAULT 0,
    avg_rpn         INTEGER DEFAULT 0,
    high_risk_count INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_fmea_asset ON ers_fmea_worksheets(asset_id);

-- FMEA line items
CREATE TABLE IF NOT EXISTS ers_fmea_items (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    worksheet_id    UUID NOT NULL REFERENCES ers_fmea_worksheets(id) ON DELETE CASCADE,
    component       TEXT NOT NULL,
    "function"      TEXT NOT NULL,
    failure_mode    TEXT NOT NULL,
    failure_effect  TEXT,
    failure_cause   TEXT,
    severity        INTEGER CHECK (severity BETWEEN 1 AND 10),
    occurrence      INTEGER CHECK (occurrence BETWEEN 1 AND 10),
    detection       INTEGER CHECK (detection BETWEEN 1 AND 10),
    rpn             INTEGER GENERATED ALWAYS AS (severity * occurrence * detection) STORED,
    current_controls TEXT,
    recommended_action TEXT,
    action_status   TEXT CHECK (action_status IN ('open','in_progress','closed','deferred')),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_fmea_items_ws ON ers_fmea_items(worksheet_id);

-- RCA investigations
CREATE TABLE IF NOT EXISTS ers_rca_investigations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id        UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    method          TEXT CHECK (method IN ('five_why','fishbone','fault_tree','taproot','apollo')),
    status          TEXT CHECK (status IN ('draft','in_progress','review','closed')),
    problem_statement TEXT,
    root_cause_summary TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_rca_asset ON ers_rca_investigations(asset_id);

-- RCA tree nodes
CREATE TABLE IF NOT EXISTS ers_rca_nodes (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    investigation_id UUID NOT NULL REFERENCES ers_rca_investigations(id) ON DELETE CASCADE,
    parent_id       UUID REFERENCES ers_rca_nodes(id) ON DELETE CASCADE,
    node_type       TEXT NOT NULL CHECK (node_type IN ('problem','why','category','root_cause','contributing_factor')),
    description     TEXT NOT NULL,
    depth           INTEGER DEFAULT 0,
    is_root_cause   BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_rca_nodes_inv ON ers_rca_nodes(investigation_id);

-- Bad actor snapshots (monthly Pareto)
CREATE TABLE IF NOT EXISTS ers_bad_actor_snapshots (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    report_period   TEXT NOT NULL,  -- e.g. '2026-02'
    criteria        TEXT NOT NULL CHECK (criteria IN ('cost','downtime','wo_frequency','failure_rate')),
    pareto_threshold_pct NUMERIC(5,1) DEFAULT 80,
    total_assets_analyzed INTEGER,
    generated_at    TIMESTAMPTZ DEFAULT NOW(),
    top_assets      JSONB DEFAULT '[]'::JSONB  -- Array of {asset_id, rank, metric_value, ...}
);
CREATE INDEX idx_bad_actors_period ON ers_bad_actor_snapshots(report_period, criteria);

-- ═══════════════════════════════════════════════════════════════
--  VISION / SUSTAIN DOMAIN
-- ═══════════════════════════════════════════════════════════════

-- Computer vision analysis results
CREATE TABLE IF NOT EXISTS ers_vision_results (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id        UUID REFERENCES assets(id) ON DELETE SET NULL,
    image_name      TEXT NOT NULL,
    analysis_type   TEXT CHECK (analysis_type IN ('corrosion','thermal','condition','tagging','crack_detection')),
    detected_items  INTEGER DEFAULT 0,
    max_severity    TEXT CHECK (max_severity IN ('minor','moderate','severe','critical')),
    reviewed        BOOLEAN DEFAULT FALSE,
    reviewed_by     UUID REFERENCES users(id),
    timestamp       TIMESTAMPTZ DEFAULT NOW(),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_vision_asset ON ers_vision_results(asset_id);

-- Drone surveys
CREATE TABLE IF NOT EXISTS ers_drone_surveys (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    survey_name     TEXT NOT NULL,
    date            TIMESTAMPTZ NOT NULL,
    area_covered_sqm INTEGER,
    anomalies_found INTEGER DEFAULT 0,
    reviewed        BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Carbon emissions per asset (Scope 1/2)
CREATE TABLE IF NOT EXISTS ers_carbon_metrics (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id        UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    asset_name      TEXT,
    scope1_tco2     NUMERIC(10,1) DEFAULT 0,
    scope2_tco2     NUMERIC(10,1) DEFAULT 0,
    total_tco2      NUMERIC(10,1) GENERATED ALWAYS AS (scope1_tco2 + scope2_tco2) STORED,
    reporting_period TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_carbon_asset ON ers_carbon_metrics(asset_id);

-- Climate vulnerability assessments
CREATE TABLE IF NOT EXISTS ers_climate_risks (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id        UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    asset_name      TEXT,
    risk_level      TEXT CHECK (risk_level IN ('low','moderate','high','extreme')),
    risk_factors    JSONB DEFAULT '[]'::JSONB,
    vulnerability_score NUMERIC(5,1),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_climate_asset ON ers_climate_risks(asset_id);

-- ═══════════════════════════════════════════════════════════════
--  RLS + POLICIES
-- ═══════════════════════════════════════════════════════════════

DO $$ 
DECLARE 
    tbl TEXT;
BEGIN
    FOR tbl IN 
        SELECT unnest(ARRAY[
            'ers_twin_states','ers_rul_estimates','ers_prediction_alerts',
            'ers_sensor_readings','ers_cmls','ers_thickness_readings',
            'ers_corrosion_rates','ers_rbi_assessments','ers_iow_parameters',
            'ers_inspections','ers_damage_mechanisms','ers_ffs_assessments',
            'ers_fmea_worksheets','ers_fmea_items','ers_rca_investigations',
            'ers_rca_nodes','ers_bad_actor_snapshots','ers_vision_results',
            'ers_drone_surveys','ers_carbon_metrics','ers_climate_risks'
        ])
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
        EXECUTE format(
            'CREATE POLICY "Enable all for authenticated" ON %I FOR ALL USING (auth.role() = ''authenticated'')',
            tbl
        );
    END LOOP;
END $$;
