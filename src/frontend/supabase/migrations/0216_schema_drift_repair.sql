-- ============================================================
-- 0216: Schema-drift repair (2026-07-22 quality audit)
--
-- The remote DB drifted from the local migration set:
--   1) FinOps tables exist remotely but WITHOUT their FK constraints
--      (0034/0044 defined them) — PostgREST returns 400 on every
--      relational embed (warranties→assets, claims→work_orders, …).
--   2) 0036 (maintenance_forecasts view) was never applied remotely.
--   3) 0103 (ers_psm_studies + PSM tool tables) was never applied
--      remotely — /comply/psm 404s.
-- Orphan-row counts verified 0 on every FK column before writing
-- this, so constraints are added validated.
-- Ends with a PostgREST schema-cache reload — the four reliability
-- RPCs (0104/0108) exist remotely but 404 through REST because they
-- were created out-of-band without a reload.
-- ============================================================

-- ── 1. Missing FK constraints (idempotent by constraint name) ──

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'warranties_asset_id_fkey') THEN
        ALTER TABLE warranties ADD CONSTRAINT warranties_asset_id_fkey
            FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'warranties_vendor_id_fkey') THEN
        ALTER TABLE warranties ADD CONSTRAINT warranties_vendor_id_fkey
            FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_insurance_asset_id_fkey') THEN
        ALTER TABLE asset_insurance ADD CONSTRAINT asset_insurance_asset_id_fkey
            FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'warranty_claims_work_order_id_fkey') THEN
        ALTER TABLE warranty_claims ADD CONSTRAINT warranty_claims_work_order_id_fkey
            FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cost_allocations_work_order_id_fkey') THEN
        ALTER TABLE cost_allocations ADD CONSTRAINT cost_allocations_work_order_id_fkey
            FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_financials_asset_id_fkey') THEN
        ALTER TABLE asset_financials ADD CONSTRAINT asset_financials_asset_id_fkey
            FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_supplier_id_fkey') THEN
        ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_supplier_id_fkey
            FOREIGN KEY (supplier_id) REFERENCES vendors(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assets_cost_center_id_fkey') THEN
        ALTER TABLE assets ADD CONSTRAINT assets_cost_center_id_fkey
            FOREIGN KEY (cost_center_id) REFERENCES cost_centers(id) ON DELETE SET NULL;
    END IF;
END $$;


-- ── 2. Maintenance forecast view (0036, never applied remotely) ──

ALTER TABLE recurring_work
ADD COLUMN IF NOT EXISTS est_labor_cost DECIMAL(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS est_material_cost DECIMAL(10,2) DEFAULT 0;

CREATE OR REPLACE VIEW maintenance_forecasts AS
SELECT
    rw.id,
    rw.code,
    rw.title,
    rw.asset_id,
    rw.frequency_interval,
    rw.frequency_unit,
    rw.est_labor_cost,
    rw.est_material_cost,
    (rw.est_labor_cost + rw.est_material_cost) as cost_per_event,
    CASE
        WHEN rw.frequency_unit = 'Days' THEN 365.0 / NULLIF(rw.frequency_interval, 0)
        WHEN rw.frequency_unit = 'Weeks' THEN 52.0 / NULLIF(rw.frequency_interval, 0)
        WHEN rw.frequency_unit = 'Months' THEN 12.0 / NULLIF(rw.frequency_interval, 0)
        WHEN rw.frequency_unit = 'Years' THEN 1.0 / NULLIF(rw.frequency_interval, 0)
        ELSE 0
    END as annual_frequency,
    (
        (rw.est_labor_cost + rw.est_material_cost) *
        CASE
            WHEN rw.frequency_unit = 'Days' THEN 365.0 / NULLIF(rw.frequency_interval, 0)
            WHEN rw.frequency_unit = 'Weeks' THEN 52.0 / NULLIF(rw.frequency_interval, 0)
            WHEN rw.frequency_unit = 'Months' THEN 12.0 / NULLIF(rw.frequency_interval, 0)
            WHEN rw.frequency_unit = 'Years' THEN 1.0 / NULLIF(rw.frequency_interval, 0)
            ELSE 0
        END
    ) as annual_estimated_spend,
    rw.next_due_date
FROM recurring_work rw
WHERE rw.active = true AND rw.status = 'ACTIVE';


-- ── 3. PSM analytical schema (0103, never applied remotely) ──
-- Identical to 0103 except CREATE POLICY is guarded so re-runs are safe.

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
        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE tablename = tbl AND policyname = 'Allow all for authenticated'
        ) THEN
            EXECUTE format(
                'CREATE POLICY "Allow all for authenticated" ON %I FOR ALL USING (true) WITH CHECK (true)',
                tbl
            );
        END IF;
    END LOOP;
END $$;


-- ── 4. Reliability RPC search_path repair ──
-- The 0104/0108 functions exist remotely but were created with an empty
-- search_path while referencing unqualified table names — every call died
-- with 42P01 ("relation work_orders does not exist"), surfaced as REST 404.

ALTER FUNCTION public.get_reliability_kpis() SET search_path = public;
ALTER FUNCTION public.get_bad_actors(integer) SET search_path = public;
ALTER FUNCTION public.get_asset_mtbf_mttr(integer) SET search_path = public;
ALTER FUNCTION public.get_downtime_by_failure_mode() SET search_path = public;


-- ── 5. PostgREST schema-cache reload ──

NOTIFY pgrst, 'reload schema';
