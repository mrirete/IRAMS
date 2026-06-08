-- ═══════════════════════════════════════════════════════════════════════════
-- 0118: RCM Module — Reliability Centered Maintenance (SAE JA1011/JA1012)
-- ═══════════════════════════════════════════════════════════════════════════
-- Creates 4 core RCM tables plus admin dictionary seed data.
-- Integration points: assets, dictionaries, ers_fmea_items, recurring_work,
--                     inventory_items, work_orders, wo_failure_data
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. RCM Studies ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ers_rcm_studies (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id        TEXT,                          -- FK to assets(id)
    title           TEXT NOT NULL,
    operating_context TEXT,                        -- Duty cycle, environment, load
    status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','in_progress','review','approved','closed')),
    study_type      TEXT NOT NULL DEFAULT 'classical'
                    CHECK (study_type IN ('classical','streamlined','back_to_basics')),
    facilitator     TEXT,                          -- Lead analyst username
    approved_by     TEXT,                          -- Sign-off authority
    approved_at     TIMESTAMPTZ,
    criticality_rank TEXT,                         -- Auto-loaded from asset
    rcm_source      TEXT DEFAULT 'new'
                    CHECK (rcm_source IN ('new','imported_fmea','ai_generated')),
    ai_confidence   NUMERIC(3,2),                  -- 0.00–1.00 for AI-generated
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rcm_studies_asset ON ers_rcm_studies(asset_id);
CREATE INDEX IF NOT EXISTS idx_rcm_studies_status ON ers_rcm_studies(status);

-- ─── 2. RCM Functions & Functional Failures (Q1–Q2) ────────────────────
CREATE TABLE IF NOT EXISTS ers_rcm_functions (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    study_id            UUID NOT NULL REFERENCES ers_rcm_studies(id) ON DELETE CASCADE,
    function_number     TEXT NOT NULL,              -- F1, F2, F3...
    function_description TEXT NOT NULL,             -- "Transfer crude at 500 m³/hr..."
    performance_standard TEXT,                      -- Quantified standard
    function_type       TEXT NOT NULL DEFAULT 'primary'
                        CHECK (function_type IN ('primary','secondary','protective')),
    functional_failure  TEXT,                       -- How it fails this function
    failure_code        TEXT,                       -- FK to dictionaries(code) type=FUNCTIONAL_FAILURE
    sort_order          INT DEFAULT 0,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rcm_functions_study ON ers_rcm_functions(study_id);

-- ─── 3. RCM Failure Modes & Effects (Q3–Q4) ────────────────────────────
CREATE TABLE IF NOT EXISTS ers_rcm_failure_modes (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    function_id             UUID NOT NULL REFERENCES ers_rcm_functions(id) ON DELETE CASCADE,
    fmea_item_id            UUID,                   -- Optional FK to ers_fmea_items(id)
    failure_mode_code       TEXT,                    -- FK to dictionaries(code) type=FAILURE_MODE
    failure_mode_description TEXT NOT NULL,
    failure_cause_code      TEXT,                    -- FK to dictionaries(code) type=FAILURE_CAUSE
    failure_cause_description TEXT,
    failure_effect_local    TEXT,                    -- Component-level effect
    failure_effect_system   TEXT,                    -- System-level effect
    failure_effect_plant    TEXT,                    -- Plant-level end effect
    end_effect              TEXT,                    -- Ultimate consequence
    severity                INT CHECK (severity BETWEEN 1 AND 10),
    occurrence              INT CHECK (occurrence BETWEEN 1 AND 10),
    detection               INT CHECK (detection BETWEEN 1 AND 10),
    rpn                     INT GENERATED ALWAYS AS (
                                COALESCE(severity,1) * COALESCE(occurrence,1) * COALESCE(detection,1)
                            ) STORED,
    historical_wo_count     INT DEFAULT 0,          -- From work_orders history
    historical_mtbf_days    NUMERIC,                -- From reliability data
    data_source             TEXT DEFAULT 'manual'
                            CHECK (data_source IN ('manual','fmea_import','wo_history','ai_generated')),
    sort_order              INT DEFAULT 0,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rcm_failure_modes_function ON ers_rcm_failure_modes(function_id);
CREATE INDEX IF NOT EXISTS idx_rcm_failure_modes_fmea ON ers_rcm_failure_modes(fmea_item_id);

-- ─── 4. RCM Decision Logic Worksheet (Q5–Q7) ───────────────────────────
CREATE TABLE IF NOT EXISTS ers_rcm_decisions (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    failure_mode_id             UUID NOT NULL REFERENCES ers_rcm_failure_modes(id) ON DELETE CASCADE,

    -- Q5: Consequence analysis
    is_hidden_failure           BOOLEAN DEFAULT FALSE,
    consequence_code            TEXT,               -- FK to dictionaries(code) type=RCM_CONSEQUENCE
    consequence_description     TEXT,

    -- Q6: Task selection cascade
    on_condition_task           TEXT,
    on_condition_interval       TEXT,
    on_condition_applicable     BOOLEAN,
    on_condition_technology     TEXT,               -- Vibration, thermography, oil, etc.

    scheduled_restoration_task  TEXT,
    restoration_interval        TEXT,
    restoration_applicable      BOOLEAN,

    scheduled_discard_task      TEXT,
    discard_interval            TEXT,
    discard_applicable          BOOLEAN,

    failure_finding_task        TEXT,               -- For hidden failures only
    failure_finding_interval    TEXT,
    failure_finding_applicable  BOOLEAN,

    -- Q7: Recommended strategy
    recommended_strategy_code   TEXT,               -- FK to dictionaries(code) type=RCM_STRATEGY
    task_description            TEXT,               -- Final recommended task
    task_interval               TEXT,               -- Recommended interval
    task_type_code              TEXT,               -- FK to dictionaries(code) type=MAINTENANCE_TASK_TYPE
    task_owner_craft            TEXT,               -- Craft/role responsible
    justification               TEXT,               -- Cost-benefit rationale

    -- AI advisor
    ai_recommendation           JSONB,              -- { strategy, reasoning, confidence }

    -- Output linkages
    recurring_work_id           TEXT,               -- FK to recurring_work(id) — generated PM
    spares_requirements         JSONB DEFAULT '[]', -- [{ part_number, qty, lead_time }]

    created_at                  TIMESTAMPTZ DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rcm_decisions_fm ON ers_rcm_decisions(failure_mode_id);
CREATE INDEX IF NOT EXISTS idx_rcm_decisions_strategy ON ers_rcm_decisions(recommended_strategy_code);

-- ─── 5. Audit Triggers ──────────────────────────────────────────────────
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'log_audit_event') THEN
        CREATE TRIGGER audit_rcm_studies
            AFTER INSERT OR UPDATE OR DELETE ON ers_rcm_studies
            FOR EACH ROW EXECUTE FUNCTION log_audit_event();

        CREATE TRIGGER audit_rcm_functions
            AFTER INSERT OR UPDATE OR DELETE ON ers_rcm_functions
            FOR EACH ROW EXECUTE FUNCTION log_audit_event();

        CREATE TRIGGER audit_rcm_failure_modes
            AFTER INSERT OR UPDATE OR DELETE ON ers_rcm_failure_modes
            FOR EACH ROW EXECUTE FUNCTION log_audit_event();

        CREATE TRIGGER audit_rcm_decisions
            AFTER INSERT OR UPDATE OR DELETE ON ers_rcm_decisions
            FOR EACH ROW EXECUTE FUNCTION log_audit_event();
    END IF;
END $$;

-- ─── 6. RLS (disabled for MVP, same pattern as other ERS tables) ────────
ALTER TABLE ers_rcm_studies DISABLE ROW LEVEL SECURITY;
ALTER TABLE ers_rcm_functions DISABLE ROW LEVEL SECURITY;
ALTER TABLE ers_rcm_failure_modes DISABLE ROW LEVEL SECURITY;
ALTER TABLE ers_rcm_decisions DISABLE ROW LEVEL SECURITY;

-- ─── 7. Updated_at trigger ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_rcm_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_rcm_studies_updated_at
    BEFORE UPDATE ON ers_rcm_studies
    FOR EACH ROW EXECUTE FUNCTION update_rcm_updated_at();

CREATE TRIGGER set_rcm_functions_updated_at
    BEFORE UPDATE ON ers_rcm_functions
    FOR EACH ROW EXECUTE FUNCTION update_rcm_updated_at();

CREATE TRIGGER set_rcm_failure_modes_updated_at
    BEFORE UPDATE ON ers_rcm_failure_modes
    FOR EACH ROW EXECUTE FUNCTION update_rcm_updated_at();

CREATE TRIGGER set_rcm_decisions_updated_at
    BEFORE UPDATE ON ers_rcm_decisions
    FOR EACH ROW EXECUTE FUNCTION update_rcm_updated_at();

-- ─── 8. Admin Dictionary Seed — RCM Strategy Codes ─────────────────────
INSERT INTO dictionaries (type, code, description, is_locked, active, properties)
VALUES
    -- RCM Strategies (SAE JA1012)
    ('RCM_STRATEGY', 'PM_TIME',      'Time-Based Preventive Maintenance',    false, true, '{"interval_type":"calendar"}'::jsonb),
    ('RCM_STRATEGY', 'PM_CONDITION',  'Condition-Based Maintenance (CBM)',    false, true, '{"interval_type":"on_condition"}'::jsonb),
    ('RCM_STRATEGY', 'PM_PREDICTIVE', 'Predictive Maintenance (PdM)',         false, true, '{"interval_type":"predictive"}'::jsonb),
    ('RCM_STRATEGY', 'RTF',           'Run-to-Failure',                       false, true, '{"requires_justification":true}'::jsonb),
    ('RCM_STRATEGY', 'REDESIGN',      'Redesign / Modification',              false, true, '{"requires_moc":true}'::jsonb),
    ('RCM_STRATEGY', 'COMBINATION',   'Combined Strategy',                    false, true, '{}'::jsonb),

    -- RCM Consequence Categories (SAE JA1012 Decision Logic)
    ('RCM_CONSEQUENCE', 'SAFETY_ENV',     'Safety / Environmental Consequence',    false, true, '{"priority":"critical","color":"#dc2626"}'::jsonb),
    ('RCM_CONSEQUENCE', 'OPERATIONAL',    'Operational Consequence',               false, true, '{"priority":"high","color":"#d97706"}'::jsonb),
    ('RCM_CONSEQUENCE', 'NON_OPERATIONAL','Non-Operational (Economic Only)',        false, true, '{"priority":"medium","color":"#2563eb"}'::jsonb),
    ('RCM_CONSEQUENCE', 'HIDDEN',         'Hidden Failure',                        false, true, '{"requires_failure_finding":true,"color":"#7c3aed"}'::jsonb),

    -- Maintenance Task Types (RCM Decision Tree)
    ('MAINTENANCE_TASK_TYPE', 'OC', 'On-Condition Task (Inspect/Monitor)',           false, true, '{"technique":"inspection"}'::jsonb),
    ('MAINTENANCE_TASK_TYPE', 'SR', 'Scheduled Restoration (Overhaul/Rebuild)',      false, true, '{"technique":"overhaul"}'::jsonb),
    ('MAINTENANCE_TASK_TYPE', 'SD', 'Scheduled Discard (Replace at Interval)',       false, true, '{"technique":"replacement"}'::jsonb),
    ('MAINTENANCE_TASK_TYPE', 'FF', 'Failure-Finding Task (Function Test)',          false, true, '{"technique":"function_test"}'::jsonb)
ON CONFLICT (type, code) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- COMMENTS
-- ═══════════════════════════════════════════════════════════════════════════
COMMENT ON TABLE ers_rcm_studies IS 'RCM study container — one per asset, per SAE JA1011';
COMMENT ON TABLE ers_rcm_functions IS 'RCM Q1-Q2: Asset functions & functional failures';
COMMENT ON TABLE ers_rcm_failure_modes IS 'RCM Q3-Q4: Failure modes, causes, effects — linkable to FMEA';
COMMENT ON TABLE ers_rcm_decisions IS 'RCM Q5-Q7: Decision logic worksheet — consequence → task → strategy';
COMMENT ON COLUMN ers_rcm_decisions.ai_recommendation IS 'Gemini AI advisor output: { strategy, reasoning, confidence }';
COMMENT ON COLUMN ers_rcm_decisions.recurring_work_id IS 'Link to generated PM schedule entry in recurring_work';
COMMENT ON COLUMN ers_rcm_decisions.spares_requirements IS 'Linked inventory parts: [{ part_number, qty, lead_time }]';
