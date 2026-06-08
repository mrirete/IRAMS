-- ============================================================
-- 0080 — RCA Full Schema
-- Extends ers_rca_investigations & ers_rca_nodes.
-- Adds: evidence, corrective_actions, barriers,
--       team_members, audit_log, cause_taxonomy.
-- Aligned with ISO 55000 (2024), SAE JA1011, PROACT, Apollo.
-- ============================================================

-- ═══════════════════════════════════════════════════════════════
--  1. EXTEND ers_rca_investigations
-- ═══════════════════════════════════════════════════════════════

-- RCA categorization (4 types)
ALTER TABLE ers_rca_investigations
  ADD COLUMN IF NOT EXISTS rca_category TEXT
    CHECK (rca_category IN ('safety','production','process','asset_failure'));

-- Reactive vs. Proactive (PROACT near-miss support)
ALTER TABLE ers_rca_investigations
  ADD COLUMN IF NOT EXISTS investigation_type TEXT DEFAULT 'reactive'
    CHECK (investigation_type IN ('reactive','proactive'));

-- Trigger metadata
ALTER TABLE ers_rca_investigations
  ADD COLUMN IF NOT EXISTS trigger_type TEXT
    CHECK (trigger_type IN ('cost','recurrence','criticality','safety','pareto','downtime','near_miss','manual'));

ALTER TABLE ers_rca_investigations
  ADD COLUMN IF NOT EXISTS trigger_reference_id UUID;

-- 3W2H — Event context
ALTER TABLE ers_rca_investigations
  ADD COLUMN IF NOT EXISTS event_date TIMESTAMPTZ;

ALTER TABLE ers_rca_investigations
  ADD COLUMN IF NOT EXISTS event_location TEXT;

ALTER TABLE ers_rca_investigations
  ADD COLUMN IF NOT EXISTS event_what TEXT;

ALTER TABLE ers_rca_investigations
  ADD COLUMN IF NOT EXISTS event_how TEXT;

ALTER TABLE ers_rca_investigations
  ADD COLUMN IF NOT EXISTS event_how_much JSONB DEFAULT '{}'::JSONB;
  -- { "cost": 0, "downtime_hrs": 0, "safety_tier": null, "env_impact": null }

-- Linkages
ALTER TABLE ers_rca_investigations
  ADD COLUMN IF NOT EXISTS work_order_id UUID;
  -- Soft FK to work_orders(id) — not enforced to allow WO deletion

ALTER TABLE ers_rca_investigations
  ADD COLUMN IF NOT EXISTS lead_investigator UUID;
  -- Soft FK to contacts(id)

-- Step tracker (1-6 for the 6-step process)
ALTER TABLE ers_rca_investigations
  ADD COLUMN IF NOT EXISTS current_step INTEGER DEFAULT 1
    CHECK (current_step BETWEEN 1 AND 6);

-- Closure & effectiveness
ALTER TABLE ers_rca_investigations
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

ALTER TABLE ers_rca_investigations
  ADD COLUMN IF NOT EXISTS effectiveness_due DATE;

ALTER TABLE ers_rca_investigations
  ADD COLUMN IF NOT EXISTS effectiveness_status TEXT DEFAULT 'pending'
    CHECK (effectiveness_status IN ('pending','effective','ineffective','recurred'));

-- Re-occurrence linkage (self-FK)
ALTER TABLE ers_rca_investigations
  ADD COLUMN IF NOT EXISTS previous_rca_id UUID
    REFERENCES ers_rca_investigations(id) ON DELETE SET NULL;

-- ═══════════════════════════════════════════════════════════════
--  2. EXTEND ers_rca_nodes — PROACT 3-layer + ISO 14224 coding
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE ers_rca_nodes
  ADD COLUMN IF NOT EXISTS cause_category TEXT
    CHECK (cause_category IN ('physical','human','latent'));

ALTER TABLE ers_rca_nodes
  ADD COLUMN IF NOT EXISTS cause_code TEXT;
  -- ISO 14224 taxonomy code, e.g. 'DES-01'

ALTER TABLE ers_rca_nodes
  ADD COLUMN IF NOT EXISTS evidence_notes TEXT;

-- ═══════════════════════════════════════════════════════════════
--  3. ers_rca_evidence — Data collection (Step 2)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ers_rca_evidence (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    investigation_id  UUID NOT NULL REFERENCES ers_rca_investigations(id) ON DELETE CASCADE,
    evidence_type     TEXT NOT NULL
      CHECK (evidence_type IN ('photo','document','work_order','fmea','sensor_data','note','timeline_event')),
    title             TEXT NOT NULL,
    content           TEXT,            -- Note text, URL, or JSON payload
    linked_entity_id  UUID,            -- Optional FK to WO, FMEA, etc.
    event_timestamp   TIMESTAMPTZ,     -- For timeline ordering
    uploaded_by       TEXT,
    created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rca_evidence_inv ON ers_rca_evidence(investigation_id);

-- ═══════════════════════════════════════════════════════════════
--  4. ers_rca_corrective_actions — Solutions (Step 4)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ers_rca_corrective_actions (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    investigation_id    UUID NOT NULL REFERENCES ers_rca_investigations(id) ON DELETE CASCADE,
    cause_node_id       UUID REFERENCES ers_rca_nodes(id) ON DELETE SET NULL,
    cause_category      TEXT CHECK (cause_category IN ('physical','human','latent')),
    action_description  TEXT NOT NULL,
    action_type         TEXT NOT NULL
      CHECK (action_type IN ('immediate','short_term','long_term')),
    assigned_to         TEXT,
    due_date            DATE,
    status              TEXT DEFAULT 'open'
      CHECK (status IN ('open','in_progress','completed','overdue','cancelled')),
    requires_moc        BOOLEAN DEFAULT FALSE,
    completion_date     DATE,
    completion_notes    TEXT,
    risk_of_not_acting  TEXT,
    work_order_id       UUID,          -- Generated WO for this action
    created_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rca_actions_inv ON ers_rca_corrective_actions(investigation_id);
CREATE INDEX IF NOT EXISTS idx_rca_actions_status ON ers_rca_corrective_actions(status);

-- ═══════════════════════════════════════════════════════════════
--  5. ers_rca_barriers — Defense-in-Depth (Step 3)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ers_rca_barriers (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    investigation_id      UUID NOT NULL REFERENCES ers_rca_investigations(id) ON DELETE CASCADE,
    barrier_type          TEXT NOT NULL
      CHECK (barrier_type IN ('preventive','mitigative')),
    barrier_class         TEXT NOT NULL
      CHECK (barrier_class IN ('technical','human','organizational')),
    description           TEXT NOT NULL,
    assessment            TEXT NOT NULL DEFAULT 'non_existent'
      CHECK (assessment IN ('effective','failed','not_used','non_existent')),
    failure_reason        TEXT,
    corrective_action_id  UUID REFERENCES ers_rca_corrective_actions(id) ON DELETE SET NULL,
    created_at            TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rca_barriers_inv ON ers_rca_barriers(investigation_id);

-- ═══════════════════════════════════════════════════════════════
--  6. ers_rca_team_members
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ers_rca_team_members (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    investigation_id  UUID NOT NULL REFERENCES ers_rca_investigations(id) ON DELETE CASCADE,
    contact_id        UUID,            -- Soft FK to contacts(id)
    member_name       TEXT NOT NULL,    -- Display name (in case contact is deleted)
    role              TEXT NOT NULL
      CHECK (role IN ('lead','investigator','sme','approver','observer')),
    added_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rca_team_inv ON ers_rca_team_members(investigation_id);

-- ═══════════════════════════════════════════════════════════════
--  7. ers_rca_audit_log — Immutable trail (NIST/IEC 62443)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ers_rca_audit_log (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    investigation_id  UUID NOT NULL REFERENCES ers_rca_investigations(id) ON DELETE CASCADE,
    action            TEXT NOT NULL
      CHECK (action IN (
        'created','step_advanced','cause_added','cause_removed',
        'action_added','action_updated','barrier_added','barrier_updated',
        'evidence_added','team_changed','status_changed','closed',
        'effectiveness_reviewed','reopened'
      )),
    changed_by        TEXT NOT NULL,
    details           JSONB DEFAULT '{}'::JSONB,
    created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rca_audit_inv ON ers_rca_audit_log(investigation_id);
CREATE INDEX IF NOT EXISTS idx_rca_audit_time ON ers_rca_audit_log(created_at);

-- ═══════════════════════════════════════════════════════════════
--  8. ers_rca_cause_taxonomy — ISO 14224 Annex B seed
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ers_rca_cause_taxonomy (
    code        TEXT PRIMARY KEY,
    category    TEXT NOT NULL
      CHECK (category IN ('design','fabrication','operations','maintenance','management','external')),
    description TEXT NOT NULL,
    examples    TEXT
);

-- Seed ISO 14224 cause codes
INSERT INTO ers_rca_cause_taxonomy (code, category, description, examples) VALUES
  -- Design-related
  ('DES-01', 'design',       'Design error/deficiency',            'Undersized component, wrong material spec, inadequate stress analysis'),
  ('DES-02', 'design',       'Material deficiency',                'Wrong metallurgy, material incompatibility, degradation susceptibility'),
  ('DES-03', 'design',       'Software / control logic error',     'PLC logic fault, SCADA misconfiguration, incorrect setpoint'),

  -- Fabrication / Installation
  ('FAB-01', 'fabrication',  'Fabrication / manufacturing defect', 'Welding defect, casting flaw, machining error, surface finish issue'),
  ('FAB-02', 'fabrication',  'Installation error',                 'Misalignment, incorrect torque, wrong orientation, piping stress'),

  -- Operations-related
  ('OPS-01', 'operations',   'Operating error',                    'Incorrect valve lineup, overspeed, overload, wrong startup sequence'),
  ('OPS-02', 'operations',   'Off-design / upset condition',       'Feed composition change, ambient extreme, power fluctuation'),
  ('OPS-03', 'operations',   'Contamination / foreign object',     'FOD ingestion, lube oil contamination, process fluid carryover'),

  -- Maintenance-related
  ('MNT-01', 'maintenance',  'Inadequate / wrong maintenance',     'Wrong lubricant, missed torque spec, incorrect reassembly'),
  ('MNT-02', 'maintenance',  'Overdue / missed maintenance',       'PM overdue, inspection skipped, deferred maintenance backlog'),
  ('MNT-03', 'maintenance',  'Improper repair',                    'Incorrect spare part, inadequate repair technique, wrong procedure'),

  -- Management / Systemic
  ('MGT-01', 'management',   'Inadequate procedure / policy',      'Missing SOP, outdated procedure, incomplete work instructions'),
  ('MGT-02', 'management',   'Inadequate training / competency',   'Untrained operator, expired certification, insufficient OJT'),
  ('MGT-03', 'management',   'Inadequate supervision / oversight', 'Lack of permitting, no quality check, no review before startup'),
  ('MGT-04', 'management',   'Resource / staffing inadequacy',     'Understaffed shift, budget constraint, tool unavailability'),
  ('MGT-05', 'management',   'MoC not followed / inadequate',      'Process change without MoC, undocumented modification'),
  ('MGT-06', 'management',   'Communication failure',              'Shift handover gap, missing LOTO communication, unclear work scope'),

  -- External
  ('EXT-01', 'external',     'Environmental / weather',            'Lightning, flooding, extreme heat, sandstorm, corrosive atmosphere'),
  ('EXT-02', 'external',     'Third-party / vendor issue',         'Defective OEM part, vendor service error, supply chain delay'),
  ('EXT-03', 'external',     'Sabotage / vandalism / theft',       'Intentional damage, unauthorized access, cable theft')
ON CONFLICT (code) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
--  9. RLS + POLICIES for new tables
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOR tbl IN
        SELECT unnest(ARRAY[
            'ers_rca_evidence','ers_rca_corrective_actions','ers_rca_barriers',
            'ers_rca_team_members','ers_rca_audit_log','ers_rca_cause_taxonomy'
        ])
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
        -- Avoid duplicate policy error
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
