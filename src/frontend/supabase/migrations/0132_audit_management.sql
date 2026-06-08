-- ═══════════════════════════════════════════════════════════════════════
-- 0132_audit_management.sql
-- Enterprise Audit Management Module
-- Standards: ISO 55001:2024, GFMAM Landscape, OSHA 1910.119, API 580/581
-- ═══════════════════════════════════════════════════════════════════════

-- ─── ENUMS ───────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE audit_domain AS ENUM ('AMS', 'AIM', 'PSM', 'CUSTOM');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE audit_status AS ENUM (
    'planned', 'in_progress', 'completed', 'closed', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE finding_severity AS ENUM ('critical', 'high', 'medium', 'low');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── SEQUENCE: Audit Number ──────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS audit_number_seq START WITH 1 INCREMENT BY 1;

CREATE OR REPLACE FUNCTION generate_audit_number()
RETURNS TEXT AS $$
BEGIN
  RETURN 'AUD-' || EXTRACT(YEAR FROM NOW())::TEXT || '-' ||
         LPAD(nextval('audit_number_seq')::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════════
-- TABLE 1: audit_templates — Reusable Assessment Frameworks
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE audit_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code TEXT UNIQUE NOT NULL,                -- 'ISO55001-2024', 'PSM-14', 'API-RBI'
    name TEXT NOT NULL,
    description TEXT,
    standard_reference TEXT,                  -- 'ISO 55001:2024'
    audit_domain audit_domain NOT NULL DEFAULT 'AMS',
    industry TEXT DEFAULT 'GENERAL',          -- 'OIL_GAS', 'MANUFACTURING', 'MINING'
    version TEXT DEFAULT '1.0',
    maturity_scale TEXT DEFAULT 'IAM_0_5',    -- Scoring methodology
    total_sections INTEGER DEFAULT 0,
    total_questions INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════
-- TABLE 2: audit_template_sections — Clause / Element Groupings
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE audit_template_sections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    template_id UUID NOT NULL REFERENCES audit_templates(id) ON DELETE CASCADE,
    code TEXT NOT NULL,                       -- '4', '4.1', 'PSM-03'
    title TEXT NOT NULL,                      -- 'Context of the Organization'
    description TEXT,
    sort_order INTEGER DEFAULT 0,
    weight NUMERIC(5,2) DEFAULT 1.0,          -- Weighted scoring factor
    standard_clause TEXT,                     -- 'ISO 55001:2024 §4.1'
    parent_section_id UUID REFERENCES audit_template_sections(id),
    UNIQUE(template_id, code)
);

-- ═══════════════════════════════════════════════════════════════════════
-- TABLE 3: audit_template_questions — Assessment Criteria
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE audit_template_questions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    section_id UUID NOT NULL REFERENCES audit_template_sections(id) ON DELETE CASCADE,
    code TEXT NOT NULL,                       -- 'Q4.1.1'
    question_text TEXT NOT NULL,
    guidance_notes TEXT,                      -- Assessor guidance / what to look for
    evidence_expected TEXT,                   -- "Policy document, meeting minutes"
    question_type TEXT DEFAULT 'maturity'     -- 'maturity', 'yes_no', 'text', 'numeric'
        CHECK (question_type IN ('maturity', 'yes_no', 'text', 'numeric')),
    is_mandatory BOOLEAN DEFAULT TRUE,
    sort_order INTEGER DEFAULT 0,
    UNIQUE(section_id, code)
);

-- ═══════════════════════════════════════════════════════════════════════
-- TABLE 4: audits — Live Audit Instances
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE audits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    audit_number TEXT UNIQUE NOT NULL DEFAULT generate_audit_number(),
    template_id UUID REFERENCES audit_templates(id),

    -- Classification
    audit_type TEXT NOT NULL DEFAULT 'routine'
        CHECK (audit_type IN (
            'routine', 'regulatory', 'surveillance', 'certification',
            'turnaround', 'incident', 'management', 'self_assessment'
        )),
    audit_domain audit_domain NOT NULL DEFAULT 'AMS',
    status audit_status NOT NULL DEFAULT 'planned',

    -- Scheduling
    scheduled_date TIMESTAMPTZ,
    start_date TIMESTAMPTZ,
    completion_date TIMESTAMPTZ,

    -- Scope
    scope TEXT,
    objectives TEXT,
    criteria TEXT,                            -- "ISO 55001:2024, GFMAM 3rd Ed"
    site_id UUID,                            -- FK to assets hierarchy (site level)
    site_name TEXT,                           -- Denormalized for display
    industry TEXT DEFAULT 'OIL_GAS',

    -- Scoring (calculated by AuditScoringEngine)
    overall_maturity NUMERIC(3,1),           -- 0.0 – 5.0 (IAM scale)
    overall_compliance_pct NUMERIC(5,2),     -- 0 – 100%
    sections_completed INTEGER DEFAULT 0,
    total_sections INTEGER DEFAULT 0,
    total_findings INTEGER DEFAULT 0,
    open_findings INTEGER DEFAULT 0,
    critical_findings INTEGER DEFAULT 0,

    -- Governance
    lead_auditor_name TEXT,                  -- Denormalized for list display
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    closed_by UUID REFERENCES users(id),
    closed_at TIMESTAMPTZ,

    -- AI Analysis
    ai_summary TEXT,                         -- Relantern AI executive summary
    ai_recommendations JSONB,                -- [{gap, recommendation, service_offering}]

    -- Meta
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════
-- TABLE 5: audit_participants — Full Identity Capture
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE audit_participants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    audit_id UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES contacts(id),  -- Link to ERS contact if internal

    -- Identity (always captured — name, company, email, mobile per requirement)
    full_name TEXT NOT NULL,
    company TEXT,
    email TEXT,
    mobile TEXT,
    job_title TEXT,

    -- Audit Role
    participant_role TEXT NOT NULL DEFAULT 'auditor'
        CHECK (participant_role IN (
            'lead_auditor', 'auditor', 'auditee', 'observer',
            'subject_matter_expert', 'scribe', 'sponsor'
        )),

    -- Certifications (for auditors)
    certifications TEXT[] DEFAULT '{}',       -- ['CAMA', 'API-510', 'API-570', 'CWI']

    -- Signature
    signed_off BOOLEAN DEFAULT FALSE,
    signed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(audit_id, email)
);

-- ═══════════════════════════════════════════════════════════════════════
-- TABLE 6: audit_responses — Question-Level Scores & Evidence
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE audit_responses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    audit_id UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES audit_template_questions(id),
    section_id UUID NOT NULL REFERENCES audit_template_sections(id),

    -- Maturity Score (IAM Scale 0-5)
    maturity_score INTEGER CHECK (maturity_score BETWEEN 0 AND 5),

    -- Yes/No for compliance-type questions
    compliance_answer TEXT
        CHECK (compliance_answer IN ('YES', 'NO', 'PARTIAL', 'N_A')),

    -- Narrative
    evidence_notes TEXT,
    evidence_attachments TEXT[] DEFAULT '{}', -- Storage URLs
    assessor_comments TEXT,

    -- Assessment Metadata
    assessed_by UUID REFERENCES users(id),
    assessed_at TIMESTAMPTZ,

    UNIQUE(audit_id, question_id)
);

-- ═══════════════════════════════════════════════════════════════════════
-- TABLE 7: audit_findings — Non-Conformances, Observations, Opportunities
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE audit_findings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    audit_id UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
    finding_number TEXT NOT NULL,             -- 'F-001'
    response_id UUID REFERENCES audit_responses(id),
    section_code TEXT,                        -- Denormalized: 'Clause 4.1'

    -- Classification
    finding_type TEXT NOT NULL DEFAULT 'observation'
        CHECK (finding_type IN (
            'major_nc', 'minor_nc', 'observation',
            'opportunity', 'positive_practice'
        )),
    severity finding_severity DEFAULT 'medium',

    -- Detail
    description TEXT NOT NULL,
    standard_reference TEXT,                 -- 'ISO 55001:2024 §6.2.1'
    evidence TEXT,
    root_cause TEXT,
    risk_rating TEXT CHECK (risk_rating IN ('HIGH', 'MEDIUM', 'LOW')),
    asset_id UUID,                           -- If finding relates to specific asset

    -- Corrective Action Summary (denormalized)
    ca_count INTEGER DEFAULT 0,
    ca_closed INTEGER DEFAULT 0,

    -- Status
    status TEXT DEFAULT 'open'
        CHECK (status IN (
            'open', 'ca_assigned', 'ca_in_progress',
            'ca_completed', 'verified', 'closed'
        )),

    -- Meta
    raised_by UUID REFERENCES users(id),
    raised_at TIMESTAMPTZ DEFAULT NOW(),
    closed_at TIMESTAMPTZ
);

-- ═══════════════════════════════════════════════════════════════════════
-- TABLE 8: audit_corrective_actions — CA/PA with WO Integration
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE audit_corrective_actions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    finding_id UUID NOT NULL REFERENCES audit_findings(id) ON DELETE CASCADE,
    ca_number TEXT NOT NULL,                 -- 'CA-001'

    -- Classification
    action_type TEXT NOT NULL DEFAULT 'corrective'
        CHECK (action_type IN ('corrective', 'preventive', 'improvement')),

    description TEXT NOT NULL,

    -- Assignment
    assigned_to_contact_id UUID REFERENCES contacts(id),
    assigned_to_name TEXT,
    assigned_to_company TEXT,
    due_date DATE,

    -- Progress
    status TEXT DEFAULT 'open'
        CHECK (status IN (
            'open', 'in_progress', 'completed',
            'verified', 'overdue', 'cancelled'
        )),
    completion_date TIMESTAMPTZ,
    completion_notes TEXT,

    -- Verification (independent sign-off)
    verified_by UUID REFERENCES users(id),
    verified_at TIMESTAMPTZ,
    verification_notes TEXT,

    -- Work Order Integration (CA → WO pipeline)
    wo_id UUID,                              -- FK to work_orders table
    wo_number TEXT,                          -- Denormalized for display

    -- Escalation
    escalated BOOLEAN DEFAULT FALSE,
    escalation_reason TEXT,

    -- Meta
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════
-- AUDIT TRIGGERS — Full provenance on all tables
-- ═══════════════════════════════════════════════════════════════════════
CREATE TRIGGER audit_audit_templates_changes
  AFTER INSERT OR UPDATE OR DELETE ON audit_templates
  FOR EACH ROW EXECUTE FUNCTION log_audit_event();

CREATE TRIGGER audit_audit_template_sections_changes
  AFTER INSERT OR UPDATE OR DELETE ON audit_template_sections
  FOR EACH ROW EXECUTE FUNCTION log_audit_event();

CREATE TRIGGER audit_audit_template_questions_changes
  AFTER INSERT OR UPDATE OR DELETE ON audit_template_questions
  FOR EACH ROW EXECUTE FUNCTION log_audit_event();

CREATE TRIGGER audit_audits_changes
  AFTER INSERT OR UPDATE OR DELETE ON audits
  FOR EACH ROW EXECUTE FUNCTION log_audit_event();

CREATE TRIGGER audit_audit_participants_changes
  AFTER INSERT OR UPDATE OR DELETE ON audit_participants
  FOR EACH ROW EXECUTE FUNCTION log_audit_event();

CREATE TRIGGER audit_audit_responses_changes
  AFTER INSERT OR UPDATE OR DELETE ON audit_responses
  FOR EACH ROW EXECUTE FUNCTION log_audit_event();

CREATE TRIGGER audit_audit_findings_changes
  AFTER INSERT OR UPDATE OR DELETE ON audit_findings
  FOR EACH ROW EXECUTE FUNCTION log_audit_event();

CREATE TRIGGER audit_audit_corrective_actions_changes
  AFTER INSERT OR UPDATE OR DELETE ON audit_corrective_actions
  FOR EACH ROW EXECUTE FUNCTION log_audit_event();

-- ═══════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY — Authenticated access (site-scoping deferred)
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE audit_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_templates_auth" ON audit_templates FOR ALL USING (auth.role() = 'authenticated');

ALTER TABLE audit_template_sections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_template_sections_auth" ON audit_template_sections FOR ALL USING (auth.role() = 'authenticated');

ALTER TABLE audit_template_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_template_questions_auth" ON audit_template_questions FOR ALL USING (auth.role() = 'authenticated');

ALTER TABLE audits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audits_auth" ON audits FOR ALL USING (auth.role() = 'authenticated');

ALTER TABLE audit_participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_participants_auth" ON audit_participants FOR ALL USING (auth.role() = 'authenticated');

ALTER TABLE audit_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_responses_auth" ON audit_responses FOR ALL USING (auth.role() = 'authenticated');

ALTER TABLE audit_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_findings_auth" ON audit_findings FOR ALL USING (auth.role() = 'authenticated');

ALTER TABLE audit_corrective_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_corrective_actions_auth" ON audit_corrective_actions FOR ALL USING (auth.role() = 'authenticated');

-- ═══════════════════════════════════════════════════════════════════════
-- INDEXES — Performance optimization for common queries
-- ═══════════════════════════════════════════════════════════════════════
CREATE INDEX idx_audits_status ON audits(status);
CREATE INDEX idx_audits_domain ON audits(audit_domain);
CREATE INDEX idx_audits_template ON audits(template_id);
CREATE INDEX idx_audits_scheduled ON audits(scheduled_date);
CREATE INDEX idx_audit_participants_audit ON audit_participants(audit_id);
CREATE INDEX idx_audit_responses_audit ON audit_responses(audit_id);
CREATE INDEX idx_audit_responses_question ON audit_responses(question_id);
CREATE INDEX idx_audit_findings_audit ON audit_findings(audit_id);
CREATE INDEX idx_audit_findings_status ON audit_findings(status);
CREATE INDEX idx_audit_cas_finding ON audit_corrective_actions(finding_id);
CREATE INDEX idx_audit_cas_status ON audit_corrective_actions(status);
CREATE INDEX idx_audit_cas_due ON audit_corrective_actions(due_date);

-- ═══════════════════════════════════════════════════════════════════════
-- COMMENT: Schema complete. 8 tables, 8 triggers, 8 RLS policies,
-- 12 indexes, 1 sequence, 1 function. Ready for service layer.
-- ═══════════════════════════════════════════════════════════════════════
