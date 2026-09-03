-- ============================================================================
-- 0308 — Organisational context: the audit becomes the agents' brain
--
-- Presentation-readiness assessment (RELANTERN-AS-01, 2026-09-03) found that
-- none of the 13 server-side agents, the Monday briefing or the nightly
-- watchdog read anything the onboarding audit captures. Industry, stated
-- objectives, key risks, AM policy / SAMP status and the self-reported
-- maturity vector all sat on audit_assessments and reached nothing but one
-- advisory card. A brewery and a gas plant with identical work orders got
-- identical advice.
--
-- Part A — org_context: ONE row per company, the structured profile an agent
--   can read in a single select. Written by the assessment wizard on every
--   save (OrgContextService.syncFromAssessment); read by the get_org_context
--   tool and injected into every agent's system prompt (agent-run/orgContext.ts).
--   Self-reported fields stay labelled self-reported all the way to the prompt.
--
-- Part B — audit_corrective_actions learns where a corrective action came
--   from (assessment_id / finding_ref), so a scored finding can become an
--   action with one click and the Corrective Actions page shows provenance.
--   The wizard's findings were an island before this.
--
-- Part C — semantic_catalog entries so the agents' lookup_data_definitions
--   tool can explain the new dataset.
-- ============================================================================

BEGIN;

-- ── Part A: org_context ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.org_context (
    company_id                 uuid PRIMARY KEY DEFAULT public.caller_company()
                               REFERENCES public.companies(id) ON DELETE CASCADE,

    -- Identity of the operating context (intake §A)
    industry_sector            text,
    asset_class                text,
    site_name                  text,

    -- Intent (ISO 55001 §4–§6, intake §B/§C) — free text as the organisation wrote it
    vision                     text,
    mission                    text,
    strategic_objectives       text,
    assessment_objective       text,
    key_risks                  text[] NOT NULL DEFAULT '{}',
    key_opportunities          text[] NOT NULL DEFAULT '{}',

    -- Governance status (intake §C dropdowns — fixed vocabularies, filterable)
    am_policy_status           text,
    samp_status                text,
    roles_status               text,
    risk_framework_status      text,
    budget_alignment_status    text,

    -- Self-reported maturity (IntakeQuickAnalysis, 0–5): governance / financial /
    -- regulatory / people / data. Directional by design.
    intake_overall             numeric(3,1),
    intake_level               text,
    intake_by_dimension        jsonb NOT NULL DEFAULT '{}'::jsonb,
    weakest_dimension          text,
    quick_wins                 jsonb NOT NULL DEFAULT '[]'::jsonb,

    -- 6M checklist maturity (sixmScoring, 1–5): man / machine / method /
    -- material / measurement / mother_nature.
    sixm_overall               numeric(3,1),
    sixm_level                 text,
    sixm_by_dimension          jsonb NOT NULL DEFAULT '{}'::jsonb,
    sixm_gap_count             integer,

    -- Provenance
    source_assessment_id       uuid,
    source_assessment_number   text,
    assessed_at                timestamptz,
    updated_at                 timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.org_context IS
    'One row per company: the organisational context (ISO 55001 §4) that the AI agents read before advising — industry, objectives, risks, governance status and self-reported maturity from the onboarding audit. Self-reported fields are directional and are labelled so in every prompt.';
COMMENT ON COLUMN public.org_context.intake_by_dimension IS
    'IntakeQuickAnalysis dimensions {governance, financial, regulatory, people, data} → 0–5 or null. Self-reported.';
COMMENT ON COLUMN public.org_context.sixm_by_dimension IS
    'sixmScoring dimensions {man, machine, method, material, measurement, mother_nature} → 1–5. Self-reported via the guided checklist.';

ALTER TABLE public.org_context ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_context_select ON public.org_context;
DROP POLICY IF EXISTS org_context_insert ON public.org_context;
DROP POLICY IF EXISTS org_context_update ON public.org_context;
CREATE POLICY org_context_select ON public.org_context FOR SELECT TO authenticated
    USING (company_id = public.caller_company());
-- Any authenticated user of the tenant may run and save the assessment
-- (audits module is open to RELIABILITY_ENG and website-invited prospects),
-- so the same audience maintains the context row. Tenant conjunct on both.
CREATE POLICY org_context_insert ON public.org_context FOR INSERT TO authenticated
    WITH CHECK (company_id = public.caller_company());
CREATE POLICY org_context_update ON public.org_context FOR UPDATE TO authenticated
    USING (company_id = public.caller_company())
    WITH CHECK (company_id = public.caller_company());
-- No DELETE policy: the context is replaced, never removed (0186 tier-3a).

GRANT SELECT, INSERT, UPDATE ON public.org_context TO authenticated;
GRANT ALL ON public.org_context TO service_role;

-- ── Part B: corrective-action provenance ────────────────────────────────────
ALTER TABLE public.audit_corrective_actions
    ADD COLUMN IF NOT EXISTS assessment_id     uuid REFERENCES public.audit_assessments(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS assessment_number text,
    ADD COLUMN IF NOT EXISTS finding_ref       text;
COMMENT ON COLUMN public.audit_corrective_actions.assessment_id IS
    'The 6M assessment (audit_assessments) whose scored finding raised this action. NULL for standalone or template-audit actions.';
COMMENT ON COLUMN public.audit_corrective_actions.finding_ref IS
    'Id of the scored finding inside audit_assessments.scored_findings that this action closes.';
CREATE INDEX IF NOT EXISTS idx_audit_ca_assessment ON public.audit_corrective_actions (assessment_id);

-- ── Part C: catalogue ───────────────────────────────────────────────────────
INSERT INTO public.semantic_catalog
  (object_name, column_name, title, description, tags, owner, source_tables, iso_standard)
VALUES
  ('org_context', NULL, 'Organisational context',
   'One row per company: industry, asset class, stated objectives and key risks, ISO 55001 governance status (AM policy, SAMP, roles, risk framework, budget alignment) and the self-reported maturity vectors from the onboarding audit (intake 0–5 by governance/financial/regulatory/people/data; 6M checklist 1–5 by man/machine/method/material/measurement/mother nature). Read by every AI agent before advising. Self-reported = directional, not measured.',
   ARRAY['context','audit','maturity','iso55001','agents'], 'Reliability Engineering',
   ARRAY['audit_assessments'], 'ISO 55001:2024 §4'),
  ('org_context', 'weakest_dimension', 'Weakest self-reported dimension',
   'The intake dimension (governance, financial, regulatory, people or data) with the lowest self-reported score. The Migration Center and the Specialist use it to decide where to start.',
   ARRAY['context','maturity'], 'Reliability Engineering',
   ARRAY['audit_assessments'], 'ISO 55001:2024 §4'),
  ('org_context', 'sixm_overall', '6M maturity (self-reported)',
   'Mean of the six 6M dimension means from the guided checklist, 1 Innocent … 5 Optimizing. Deterministic from the 30 answers (sixmScoring.ts).',
   ARRAY['context','maturity','6m'], 'Reliability Engineering',
   ARRAY['audit_assessments'], 'ISO 55002')
ON CONFLICT (object_name, COALESCE(column_name, '·')) DO UPDATE
  SET title       = EXCLUDED.title,
      description = EXCLUDED.description,
      tags        = EXCLUDED.tags,
      iso_standard = EXCLUDED.iso_standard,
      updated_at  = now();

COMMIT;

-- VERIFY (after apply):
--   SELECT company_id, industry_sector, sixm_overall, weakest_dimension, source_assessment_number FROM org_context;
--   -- one row per company that has saved an assessment; NULL maturity until Step 3 is answered.
--   SELECT ca_number, assessment_number, finding_ref FROM audit_corrective_actions WHERE assessment_id IS NOT NULL;
