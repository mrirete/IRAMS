-- ============================================================================
-- 0309 — Maturity snapshots: the assessment gets a memory
--
-- The assessment-led sale rests on "where you were vs where you are", and
-- ers_assessment_snapshots (0228) already does that for the data-driven
-- dollar assessment. The 6M maturity assessment had no equivalent: only the
-- newest audit_assessments row was ever read, so a re-assessment overwrote
-- the story instead of extending it.
--
-- One append-only row per generated report (AuditWizard → AssessmentService.
-- recordMaturitySnapshot). Scalar columns for cheap trending; the per-
-- dimension vectors as JSONB. Immutable by construction: no UPDATE policy,
-- deletes admin-only (0186 tier-3a), tenant conjunct on read and insert.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.audit_maturity_snapshots (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id            uuid NOT NULL DEFAULT public.caller_company()
                          REFERENCES public.companies(id) ON DELETE CASCADE,
    assessment_id         uuid REFERENCES public.audit_assessments(id) ON DELETE SET NULL,
    assessment_number     text,
    site_name             text,
    -- 6M checklist (sixmScoring, 1–5)
    sixm_overall          numeric(3,1),
    sixm_level            text,
    sixm_by_dimension     jsonb NOT NULL DEFAULT '{}'::jsonb,
    gap_count             integer,          -- answers at Aware or below
    findings_count        integer,          -- scored findings on the assessment
    -- Intake self-report (IntakeQuickAnalysis, 0–5)
    intake_overall        numeric(3,1),
    intake_by_dimension   jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by            uuid DEFAULT auth.uid(),
    created_at            timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.audit_maturity_snapshots IS
    'Append-only history of 6M maturity assessment results (one row per generated report). Powers run-over-run deltas on the report, the Audits page trend and the org_context trend line.';

CREATE INDEX IF NOT EXISTS idx_audit_maturity_snapshots_company_created
    ON public.audit_maturity_snapshots (company_id, created_at DESC);

ALTER TABLE public.audit_maturity_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ams_select ON public.audit_maturity_snapshots;
DROP POLICY IF EXISTS ams_insert ON public.audit_maturity_snapshots;
DROP POLICY IF EXISTS ams_delete ON public.audit_maturity_snapshots;
CREATE POLICY ams_select ON public.audit_maturity_snapshots FOR SELECT TO authenticated
    USING (company_id = public.caller_company());
CREATE POLICY ams_insert ON public.audit_maturity_snapshots FOR INSERT TO authenticated
    WITH CHECK (company_id = public.caller_company());
CREATE POLICY ams_delete ON public.audit_maturity_snapshots FOR DELETE TO authenticated
    USING (company_id = public.caller_company() AND public.is_admin());
-- No UPDATE policy: snapshots are immutable.

GRANT SELECT, INSERT, DELETE ON public.audit_maturity_snapshots TO authenticated;
GRANT ALL ON public.audit_maturity_snapshots TO service_role;

INSERT INTO public.semantic_catalog
  (object_name, column_name, title, description, tags, owner, source_tables, iso_standard)
VALUES
  ('audit_maturity_snapshots', NULL, 'Maturity assessment history',
   'Append-only snapshot per generated 6M maturity report: overall 1–5 score, level, per-dimension scores (man/machine/method/material/measurement/mother nature), gap and finding counts, and the intake self-report vector. Compare rows to show maturity movement between assessments. Self-reported.',
   ARRAY['audit','maturity','trend','iso55001'], 'Reliability Engineering',
   ARRAY['audit_assessments'], 'ISO 55001:2024 §9.1')
ON CONFLICT (object_name, COALESCE(column_name, '·')) DO UPDATE
  SET title = EXCLUDED.title, description = EXCLUDED.description, tags = EXCLUDED.tags,
      iso_standard = EXCLUDED.iso_standard, updated_at = now();

COMMIT;

-- VERIFY (after apply):
--   SELECT assessment_number, sixm_overall, sixm_level, gap_count, created_at FROM audit_maturity_snapshots ORDER BY created_at DESC LIMIT 5;
