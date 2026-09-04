-- ============================================================================
-- 0316 — Maturity columns named for what they are, not for the 6M taxonomy
--
-- The guided maturity checklist was built on Ishikawa's six categories
-- (man / machine / method / material / measurement / mother nature), and the
-- columns that carry its results were named "sixm_*" (0147, 0308, 0309).
-- 6M is also the fishbone taxonomy in Analyze › RCA — a cause taxonomy for
-- one failure event, which is a different thing from the maturity of a
-- management system. Two "6M"s in the catalogue and in every agent prompt
-- read as a clash, and the assessment is moving to an ISO 55001 / GFMAM
-- grouping next (docs/Maturity-Framework-Crosswalk.md).
--
-- This migration renames the columns to framework-neutral names and stamps
-- every row with the framework that produced it, so snapshots from different
-- frameworks are never averaged into one trend:
--   maturity_framework = 'sixm-v1'   the 30-question 6M-grouped checklist
--                        'gfmam-v1'  the GFMAM six-group bank (next release)
-- Existing rows keep their data and are stamped sixm-v1 by the default.
-- Idempotent: every rename checks the column still carries the old name.
-- ============================================================================

BEGIN;

-- ── 1. audit_maturity_snapshots (0309) ──────────────────────────────────────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'audit_maturity_snapshots' AND column_name = 'sixm_overall') THEN
        ALTER TABLE public.audit_maturity_snapshots RENAME COLUMN sixm_overall TO maturity_overall;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'audit_maturity_snapshots' AND column_name = 'sixm_level') THEN
        ALTER TABLE public.audit_maturity_snapshots RENAME COLUMN sixm_level TO maturity_level;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'audit_maturity_snapshots' AND column_name = 'sixm_by_dimension') THEN
        ALTER TABLE public.audit_maturity_snapshots RENAME COLUMN sixm_by_dimension TO maturity_by_dimension;
    END IF;
END $$;

ALTER TABLE public.audit_maturity_snapshots
    ADD COLUMN IF NOT EXISTS maturity_framework text NOT NULL DEFAULT 'sixm-v1';

COMMENT ON TABLE public.audit_maturity_snapshots IS
    'Append-only history of guided maturity assessment results (one row per generated report). Powers run-over-run deltas on the report, the Assessments page trend and the org_context trend line. Compare rows of the SAME maturity_framework only.';
COMMENT ON COLUMN public.audit_maturity_snapshots.maturity_framework IS
    'Scoring framework that produced maturity_by_dimension. sixm-v1 = the 30-question checklist grouped by man/machine/method/material/measurement/mother_nature; gfmam-v1 = the ISO 55001 / GFMAM six-group bank. Rows of different frameworks are not comparable.';
COMMENT ON COLUMN public.audit_maturity_snapshots.maturity_by_dimension IS
    'Per-dimension mean score (1–5), keyed by the dimension ids of maturity_framework. Self-reported via the guided checklist.';

CREATE INDEX IF NOT EXISTS idx_audit_maturity_snapshots_company_fw_created
    ON public.audit_maturity_snapshots (company_id, maturity_framework, created_at DESC);

-- ── 2. org_context (0308) ───────────────────────────────────────────────────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'org_context' AND column_name = 'sixm_overall') THEN
        ALTER TABLE public.org_context RENAME COLUMN sixm_overall TO maturity_overall;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'org_context' AND column_name = 'sixm_level') THEN
        ALTER TABLE public.org_context RENAME COLUMN sixm_level TO maturity_level;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'org_context' AND column_name = 'sixm_by_dimension') THEN
        ALTER TABLE public.org_context RENAME COLUMN sixm_by_dimension TO maturity_by_dimension;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'org_context' AND column_name = 'sixm_gap_count') THEN
        ALTER TABLE public.org_context RENAME COLUMN sixm_gap_count TO maturity_gap_count;
    END IF;
END $$;

ALTER TABLE public.org_context
    ADD COLUMN IF NOT EXISTS maturity_framework text NOT NULL DEFAULT 'sixm-v1';

COMMENT ON COLUMN public.org_context.maturity_by_dimension IS
    'Guided maturity checklist: per-dimension mean (1–5), keyed by the dimension ids of maturity_framework. Self-reported.';
COMMENT ON COLUMN public.org_context.maturity_framework IS
    'Framework of the maturity_* columns: sixm-v1 (6M-grouped checklist) or gfmam-v1 (ISO 55001 / GFMAM six groups).';

-- ── 3. audit_assessments (0147) ─────────────────────────────────────────────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'audit_assessments' AND column_name = 'sixm_checklist_answers') THEN
        ALTER TABLE public.audit_assessments RENAME COLUMN sixm_checklist_answers TO maturity_answers;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'audit_assessments' AND column_name = 'sixm_dimension_notes') THEN
        ALTER TABLE public.audit_assessments RENAME COLUMN sixm_dimension_notes TO maturity_dimension_notes;
    END IF;
END $$;

ALTER TABLE public.audit_assessments
    ADD COLUMN IF NOT EXISTS maturity_framework text NOT NULL DEFAULT 'sixm-v1';

COMMENT ON COLUMN public.audit_assessments.maturity_answers IS
    'Guided maturity checklist answers [{questionId, dimensionKey, selectedScore, optionText, notes?}] for the bank named by maturity_framework.';
COMMENT ON COLUMN public.audit_assessments.maturity_framework IS
    'Question bank / grouping that maturity_answers and dimension_results belong to: sixm-v1 or gfmam-v1.';

-- ── 4. catalogue ────────────────────────────────────────────────────────────
DELETE FROM public.semantic_catalog
 WHERE object_name = 'org_context' AND column_name = 'sixm_overall';

INSERT INTO public.semantic_catalog
  (object_name, column_name, title, description, tags, owner, source_tables, iso_standard)
VALUES
  ('audit_maturity_snapshots', NULL, 'Maturity assessment history',
   'Append-only snapshot per generated maturity report: overall 1–5 score, level, per-dimension scores keyed by maturity_framework (sixm-v1 today; gfmam-v1 = ISO 55001 / GFMAM groups), gap and finding counts, and the intake self-report vector. Compare rows of the same framework to show maturity movement between assessments. Self-reported.',
   ARRAY['audit','maturity','trend','iso55001'], 'Reliability Engineering',
   ARRAY['audit_assessments'], 'ISO 55001:2024 §9.1'),
  ('audit_maturity_snapshots', 'maturity_framework', 'Maturity scoring framework',
   'Which question bank and grouping produced this row. sixm-v1 = 30 questions grouped by man/machine/method/material/measurement/mother nature (an Ishikawa grouping, distinct from the RCA fishbone in Analyze). gfmam-v1 = the GFMAM six subject groups. Never average across frameworks.',
   ARRAY['audit','maturity'], 'Reliability Engineering',
   ARRAY['audit_maturity_snapshots'], 'ISO 55002'),
  ('org_context', NULL, 'Organisational context',
   'One row per company: industry, asset class, stated objectives and key risks, ISO 55001 governance status (AM policy, SAMP, roles, risk framework, budget alignment) and the self-reported maturity vectors from the onboarding assessment (intake 0–5 by governance/financial/regulatory/people/data; guided checklist 1–5 by the dimensions of maturity_framework). Read by every AI agent before advising. Self-reported = directional, not measured.',
   ARRAY['context','audit','maturity','iso55001','agents'], 'Reliability Engineering',
   ARRAY['audit_assessments'], 'ISO 55001:2024 §4'),
  ('org_context', 'maturity_overall', 'Guided maturity score (self-reported)',
   'Mean of the dimension means from the guided maturity checklist, 1 Innocent … 5 Optimizing. Deterministic from the answers (sixmScoring.ts); dimension set named by maturity_framework.',
   ARRAY['context','maturity'], 'Reliability Engineering',
   ARRAY['audit_assessments'], 'ISO 55002')
ON CONFLICT (object_name, COALESCE(column_name, '·')) DO UPDATE
  SET title       = EXCLUDED.title,
      description = EXCLUDED.description,
      tags        = EXCLUDED.tags,
      iso_standard = EXCLUDED.iso_standard,
      updated_at  = now();

COMMIT;

-- VERIFY (after apply):
--   SELECT table_name, column_name FROM information_schema.columns
--    WHERE table_schema='public' AND column_name LIKE 'sixm%';            -- expect 0 rows
--   SELECT table_name, column_name FROM information_schema.columns
--    WHERE table_schema='public' AND column_name = 'maturity_framework';  -- expect 3 rows
