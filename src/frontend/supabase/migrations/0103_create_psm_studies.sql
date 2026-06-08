-- ============================================================
-- 0103: PSM Analytical Tools — Process Safety Analysis Schema
--
-- Standards: OSHA 1910.119, IEC 61882, IEC 61511, IEC 61508,
--            IEC 61025, IEC 62502, ISO 31000, CCPS, API 752/753
-- ============================================================

-- ── 1. Study Container (master record for all PSM tools) ────

CREATE TABLE IF NOT EXISTS ers_psm_studies (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    study_type        TEXT NOT NULL CHECK (study_type IN (
        'pha','hazop','lopa','bowtie','fta','eta','sil','pssr'
    )),
    title             TEXT NOT NULL,
    asset_id          UUID REFERENCES assets(id) ON DELETE SET NULL,
    asset_tag         TEXT,
    asset_name        TEXT,
    unit_id           UUID,
    status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
        'draft','in_progress','review','approved','closed'
    )),
    facilitator       TEXT,
    team_members      JSONB NOT NULL DEFAULT '[]',
    methodology       TEXT,
    standard_ref      TEXT,
    scope_description TEXT,
    study_date        DATE,
    next_review       DATE,
    metadata          JSONB NOT NULL DEFAULT '{}',
    created_by        TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_psm_studies_type   ON ers_psm_studies(study_type);
CREATE INDEX IF NOT EXISTS idx_psm_studies_asset  ON ers_psm_studies(asset_id);
CREATE INDEX IF NOT EXISTS idx_psm_studies_status ON ers_psm_studies(status);


-- ── 2. HAZOP Nodes (IEC 61882 — one per process section) ────

CREATE TABLE IF NOT EXISTS ers_hazop_nodes (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    study_id      UUID NOT NULL REFERENCES ers_psm_studies(id) ON DELETE CASCADE,
    node_name     TEXT NOT NULL,
    design_intent TEXT,
    drawing_ref   TEXT,
    sort_order    INT NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hazop_nodes_study ON ers_hazop_nodes(study_id);


-- ── 3. HAZOP Deviations (the core worksheet rows) ───────────

CREATE TABLE IF NOT EXISTS ers_hazop_deviations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id         UUID NOT NULL REFERENCES ers_hazop_nodes(id) ON DELETE CASCADE,
    guide_word      TEXT NOT NULL,
    parameter       TEXT NOT NULL,
    deviation       TEXT NOT NULL,
    causes          TEXT,
    consequences    TEXT,
    safeguards      TEXT,
    severity        INT CHECK (severity BETWEEN 1 AND 5),
    likelihood      INT CHECK (likelihood BETWEEN 1 AND 5),
    risk_ranking    TEXT,
    recommendations TEXT,
    action_owner    TEXT,
    action_due_date DATE,
    action_status   TEXT NOT NULL DEFAULT 'open' CHECK (action_status IN (
        'open','in_progress','completed','verified','cancelled'
    )),
    sort_order      INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hazop_deviations_node ON ers_hazop_deviations(node_id);


-- ── 4. LOPA Scenarios (IEC 61511) ───────────────────────────

CREATE TABLE IF NOT EXISTS ers_lopa_scenarios (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    study_id              UUID NOT NULL REFERENCES ers_psm_studies(id) ON DELETE CASCADE,
    scenario_number       TEXT,
    description           TEXT NOT NULL,
    consequence_desc      TEXT,
    severity_category     TEXT,
    initiating_event      TEXT,
    ie_frequency          NUMERIC,
    ipls                  JSONB NOT NULL DEFAULT '[]',
    conditional_modifiers JSONB NOT NULL DEFAULT '{}',
    mitigated_frequency   NUMERIC,
    target_frequency      NUMERIC,
    risk_gap              NUMERIC,
    sil_required          INT CHECK (sil_required BETWEEN 0 AND 4),
    recommendations       TEXT,
    sort_order            INT NOT NULL DEFAULT 0,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lopa_scenarios_study ON ers_lopa_scenarios(study_id);


-- ── 5. Bow-Tie Elements (CCPS / Shell methodology) ──────────

CREATE TABLE IF NOT EXISTS ers_bowtie_elements (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    study_id      UUID NOT NULL REFERENCES ers_psm_studies(id) ON DELETE CASCADE,
    element_type  TEXT NOT NULL CHECK (element_type IN (
        'top_event','threat','consequence',
        'prevention_barrier','mitigation_barrier',
        'escalation_factor','escalation_barrier'
    )),
    label         TEXT NOT NULL,
    description   TEXT,
    parent_id     UUID,
    barrier_type  TEXT,
    pfd           NUMERIC,
    degradation   JSONB NOT NULL DEFAULT '{}',
    position_x    NUMERIC NOT NULL DEFAULT 0,
    position_y    NUMERIC NOT NULL DEFAULT 0,
    sort_order    INT NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bowtie_elements_study ON ers_bowtie_elements(study_id);
CREATE INDEX IF NOT EXISTS idx_bowtie_elements_type  ON ers_bowtie_elements(element_type);


-- ── 6. Event Tree Branches (IEC 62502) ──────────────────────

CREATE TABLE IF NOT EXISTS ers_event_tree_branches (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    study_id         UUID NOT NULL REFERENCES ers_psm_studies(id) ON DELETE CASCADE,
    initiating_event TEXT NOT NULL,
    ie_frequency     NUMERIC,
    headers          JSONB NOT NULL DEFAULT '[]',
    branches         JSONB NOT NULL DEFAULT '[]',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_tree_study ON ers_event_tree_branches(study_id);


-- ── 7. SIL Assessments (IEC 61508 / IEC 61511) ─────────────

CREATE TABLE IF NOT EXISTS ers_sil_assessments (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    study_id                 UUID NOT NULL REFERENCES ers_psm_studies(id) ON DELETE CASCADE,
    sif_tag                  TEXT NOT NULL,
    sif_description          TEXT,
    demand_mode              TEXT NOT NULL DEFAULT 'low' CHECK (demand_mode IN (
        'low','high','continuous'
    )),
    target_sil               INT CHECK (target_sil BETWEEN 0 AND 4),
    achieved_pfd             NUMERIC,
    architecture             TEXT,
    proof_test_interval_months INT,
    common_cause_beta        NUMERIC,
    verified                 BOOLEAN NOT NULL DEFAULT false,
    verification_date        DATE,
    sort_order               INT NOT NULL DEFAULT 0,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sil_assessments_study ON ers_sil_assessments(study_id);


-- ── 8. Risk Register (ISO 31000) ────────────────────────────

CREATE TABLE IF NOT EXISTS ers_risk_register (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    risk_id_code     TEXT NOT NULL,
    category         TEXT NOT NULL CHECK (category IN (
        'safety','environmental','financial','operational','reputational'
    )),
    asset_id         UUID REFERENCES assets(id) ON DELETE SET NULL,
    description      TEXT NOT NULL,
    cause            TEXT,
    consequence      TEXT,
    pre_severity     INT CHECK (pre_severity BETWEEN 1 AND 5),
    pre_likelihood   INT CHECK (pre_likelihood BETWEEN 1 AND 5),
    pre_risk_score   INT GENERATED ALWAYS AS (pre_severity * pre_likelihood) STORED,
    controls         TEXT,
    post_severity    INT CHECK (post_severity BETWEEN 1 AND 5),
    post_likelihood  INT CHECK (post_likelihood BETWEEN 1 AND 5),
    post_risk_score  INT GENERATED ALWAYS AS (post_severity * post_likelihood) STORED,
    risk_owner       TEXT,
    review_date      DATE,
    status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
        'open','mitigated','accepted','closed','escalated'
    )),
    linked_study_id  UUID REFERENCES ers_psm_studies(id) ON DELETE SET NULL,
    created_by       TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_risk_register_category ON ers_risk_register(category);
CREATE INDEX IF NOT EXISTS idx_risk_register_status   ON ers_risk_register(status);
CREATE INDEX IF NOT EXISTS idx_risk_register_asset    ON ers_risk_register(asset_id);


-- ── 9. PSSR Checklists (OSHA 1910.119(i)) ───────────────────

CREATE TABLE IF NOT EXISTS ers_pssr_checklists (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    study_id       UUID NOT NULL REFERENCES ers_psm_studies(id) ON DELETE CASCADE,
    category       TEXT NOT NULL,
    checklist_item TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'not_checked' CHECK (status IN (
        'not_checked','pass','fail','na'
    )),
    comments       TEXT,
    checked_by     TEXT,
    checked_date   TIMESTAMPTZ,
    sort_order     INT NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pssr_checklists_study ON ers_pssr_checklists(study_id);


-- ── 10. PHA Worksheets (OSHA 1910.119(e)) ───────────────────

CREATE TABLE IF NOT EXISTS ers_pha_items (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    study_id       UUID NOT NULL REFERENCES ers_psm_studies(id) ON DELETE CASCADE,
    item_type      TEXT NOT NULL DEFAULT 'what_if' CHECK (item_type IN (
        'what_if','checklist'
    )),
    question       TEXT NOT NULL,
    hazard         TEXT,
    consequence    TEXT,
    safeguards     TEXT,
    severity       INT CHECK (severity BETWEEN 1 AND 5),
    likelihood     INT CHECK (likelihood BETWEEN 1 AND 5),
    risk_ranking   TEXT,
    recommendation TEXT,
    action_owner   TEXT,
    action_status  TEXT NOT NULL DEFAULT 'open' CHECK (action_status IN (
        'open','in_progress','completed','verified','cancelled'
    )),
    sort_order     INT NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pha_items_study ON ers_pha_items(study_id);


-- ── Triggers: auto-update updated_at ────────────────────────

CREATE OR REPLACE FUNCTION update_psm_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_psm_studies_updated ON ers_psm_studies;
CREATE TRIGGER trg_psm_studies_updated
    BEFORE UPDATE ON ers_psm_studies
    FOR EACH ROW EXECUTE FUNCTION update_psm_timestamp();

DROP TRIGGER IF EXISTS trg_risk_register_updated ON ers_risk_register;
CREATE TRIGGER trg_risk_register_updated
    BEFORE UPDATE ON ers_risk_register
    FOR EACH ROW EXECUTE FUNCTION update_psm_timestamp();


-- ── Row Level Security ──────────────────────────────────────

ALTER TABLE ers_psm_studies         ENABLE ROW LEVEL SECURITY;
ALTER TABLE ers_hazop_nodes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE ers_hazop_deviations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ers_lopa_scenarios      ENABLE ROW LEVEL SECURITY;
ALTER TABLE ers_bowtie_elements     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ers_event_tree_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE ers_sil_assessments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ers_risk_register       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ers_pssr_checklists     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ers_pha_items           ENABLE ROW LEVEL SECURITY;

-- Permissive policies (tighten per RBAC requirements later)
DO $$ 
DECLARE
    tbl TEXT;
BEGIN
    FOR tbl IN SELECT unnest(ARRAY[
        'ers_psm_studies','ers_hazop_nodes','ers_hazop_deviations',
        'ers_lopa_scenarios','ers_bowtie_elements','ers_event_tree_branches',
        'ers_sil_assessments','ers_risk_register','ers_pssr_checklists',
        'ers_pha_items'
    ]) LOOP
        EXECUTE format(
            'CREATE POLICY "Allow all for authenticated" ON %I FOR ALL USING (true) WITH CHECK (true)',
            tbl
        );
    END LOOP;
END $$;
