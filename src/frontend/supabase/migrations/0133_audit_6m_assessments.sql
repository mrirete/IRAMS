-- ═══════════════════════════════════════════════════════════════════════
-- 0133_audit_6m_assessments.sql
-- Integrated AMS/AIM/PSM Audit Assessment Engine
-- 7-Step Process: Intake → Doc Review → Site Verify → Interviews → 6M → Score → Report
-- Standards: ISO 55000:2024 Series (55000/55001/55002/55010/55011/55012/55013)
--            API RP 754, API RP 75, ASME BPVC, ASME B31.3, CAMA2/GFMAM
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS audit_assessments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    assessment_number TEXT UNIQUE NOT NULL DEFAULT generate_audit_number(),

    -- ─── STEP 1: Intake & Scope ───────────────────────────────────
    -- Section A: Assessor
    assessor_name TEXT NOT NULL,
    assessor_job_title TEXT,
    assessor_company TEXT NOT NULL,
    assessor_email TEXT NOT NULL,
    assessor_mobile TEXT,
    assessor_site TEXT,
    industry_sector TEXT NOT NULL DEFAULT 'Oil & Gas (Upstream)',
    asset_class TEXT,

    -- Section B: Scope
    audit_objective TEXT,
    reporting_line TEXT,
    key_risks TEXT,

    -- Section C: Organizational Context (ISO 55001 §4)
    org_vision TEXT,
    org_mission TEXT,
    org_strategic_objectives TEXT,
    org_am_policy TEXT,
    org_samp TEXT,
    org_roles_authorities TEXT,
    org_risk_framework TEXT,
    org_budget_alignment TEXT,

    -- Section D: ISO 55000 Series Alignment (55010/55011/55012/55013)
    iso_series_alignment JSONB DEFAULT '{}'::JSONB,
    -- Structure: {
    --   iso55010_financial_alignment, iso55010_register_alignment, iso55010_capex_integration,
    --   iso55011_regulatory_mapping, iso55011_policy_engagement,
    --   iso55012_competence_framework, iso55012_cultural_factors, iso55012_outsourced_competence,
    --   iso55013_data_governance, iso55013_data_quality, iso55013_data_asset_distinction
    -- }

    -- ─── STEP 2: Pre-Audit Document Review ────────────────────────
    document_review JSONB DEFAULT '[]'::JSONB,

    -- ─── STEP 3: Site Verification ────────────────────────────────
    site_verification JSONB DEFAULT '[]'::JSONB,

    -- ─── STEP 4: Interviews ──────────────────────────────────────
    interview_register JSONB DEFAULT '[]'::JSONB,

    -- ─── STEP 5: 6M Assessment (AI Conversational) ───────────────
    dimension_results JSONB DEFAULT '[]'::JSONB,
    dimensions_completed INTEGER DEFAULT 0,
    total_dimensions INTEGER DEFAULT 6,

    -- ─── STEP 6: Scored Findings ─────────────────────────────────
    scored_findings JSONB DEFAULT '[]'::JSONB,

    -- ─── STEP 7: Report & Closeout ───────────────────────────────
    overall_maturity NUMERIC(3,1),
    overall_percentage NUMERIC(5,2),
    maturity_level TEXT,
    report_data JSONB,
    roadmap_data JSONB,

    -- ─── Workflow ─────────────────────────────────────────────────
    current_step INTEGER DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'in_progress'
        CHECK (status IN ('in_progress', 'completed', 'archived', 'deleted')),
    notes TEXT,

    -- ─── Governance ───────────────────────────────────────────────
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    archived_at TIMESTAMPTZ
);

-- ─── TRIGGER ────────────────────────────────────────────────────────
CREATE TRIGGER audit_assessments_changes
  AFTER INSERT OR UPDATE OR DELETE ON audit_assessments
  FOR EACH ROW EXECUTE FUNCTION log_audit_event();

-- ─── RLS ────────────────────────────────────────────────────────────
ALTER TABLE audit_assessments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_assessments_auth" ON audit_assessments
  FOR ALL USING (auth.role() = 'authenticated');

-- ─── INDEXES ────────────────────────────────────────────────────────
CREATE INDEX idx_assessments_status ON audit_assessments(status);
CREATE INDEX idx_assessments_step ON audit_assessments(current_step);
CREATE INDEX idx_assessments_company ON audit_assessments(assessor_company);
CREATE INDEX idx_assessments_industry ON audit_assessments(industry_sector);
CREATE INDEX idx_assessments_maturity ON audit_assessments(overall_maturity);
CREATE INDEX idx_assessments_created ON audit_assessments(created_at DESC);
