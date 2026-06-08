-- ═══════════════════════════════════════════════════════════════════════
-- 0135_audit_assessments_full_state.sql
-- Extends audit_assessments to persist ALL 7-step wizard state
-- Enables full save/resume/edit/delete lifecycle
-- ISO 55001:2024 §6.1 — Risks & Opportunities arrays
-- ═══════════════════════════════════════════════════════════════════════

-- ─── Add missing Intake fields ──────────────────────────────────────

-- Asset classification
ALTER TABLE audit_assessments
    ADD COLUMN IF NOT EXISTS asset_class TEXT DEFAULT 'Mixed / All Classes';

-- ISO 55001 §6.1 — Risks & Opportunities (supersedes TEXT key_risks)
ALTER TABLE audit_assessments
    ADD COLUMN IF NOT EXISTS key_risks_arr JSONB DEFAULT '[]'::JSONB,
    ADD COLUMN IF NOT EXISTS key_opportunities JSONB DEFAULT '[]'::JSONB;

-- Mobile country code (separate from number)
ALTER TABLE audit_assessments
    ADD COLUMN IF NOT EXISTS assessor_mobile_country_code TEXT;

-- Reporting line
ALTER TABLE audit_assessments
    ADD COLUMN IF NOT EXISTS reporting_line TEXT;

-- Organizational Context (§4) — individual fields already exist in 0133
-- but we need these if they don't exist:
ALTER TABLE audit_assessments
    ADD COLUMN IF NOT EXISTS org_vision TEXT,
    ADD COLUMN IF NOT EXISTS org_mission TEXT,
    ADD COLUMN IF NOT EXISTS org_strategic_objectives TEXT,
    ADD COLUMN IF NOT EXISTS org_am_policy TEXT,
    ADD COLUMN IF NOT EXISTS org_samp TEXT,
    ADD COLUMN IF NOT EXISTS org_roles_authorities TEXT,
    ADD COLUMN IF NOT EXISTS org_risk_framework TEXT,
    ADD COLUMN IF NOT EXISTS org_budget_alignment TEXT;

-- ISO Series Alignment (JSONB already exists in 0133)
ALTER TABLE audit_assessments
    ADD COLUMN IF NOT EXISTS iso_series_alignment JSONB DEFAULT '{}'::JSONB;

-- ─── Scored Findings (Step 6) ───────────────────────────────────────
ALTER TABLE audit_assessments
    ADD COLUMN IF NOT EXISTS scored_findings JSONB DEFAULT '[]'::JSONB;

-- ─── Current Step tracking ──────────────────────────────────────────
ALTER TABLE audit_assessments
    ADD COLUMN IF NOT EXISTS current_step INTEGER DEFAULT 1;

-- ─── COMMENT ────────────────────────────────────────────────────────
-- All 7 steps are now fully persistable:
--   Step 1: Intake — assessor_*, industry_sector, asset_class, key_risks_arr,
--           key_opportunities, reporting_line, org_*, iso_series_alignment
--   Step 2: document_review (JSONB)
--   Step 3: site_verification (JSONB)
--   Step 4: interview_register (JSONB)
--   Step 5: dimension_results (JSONB), dimensions_completed
--   Step 6: scored_findings (JSONB)
--   Step 7: report_data (JSONB), roadmap_data (JSONB), overall_*
-- ═══════════════════════════════════════════════════════════════════════
