-- ============================================================================
-- 0306 — Audit programme planning: future-dated, recurring assessments
--
-- AuditSchedulePage's own header named this as its roadmap ("needs a planned
-- status in the assessment schema"). It also carries the criticality-review
-- recurrence ruling (RF-01 dedup): rather than a criticality-specific reminder
-- somewhere else, ANY assessment can be planned ahead and made recurring —
-- an annual criticality review is simply a planned, 12-month-recurring
-- assessment whose objective says so. ISO 55001 §9.2 audit programme, made
-- schedulable.
--
-- Roll-forward semantics (deliberately at START, not completion): starting a
-- planned recurring assessment immediately plans the next occurrence. Simple,
-- deterministic, no completion hooks — and a programme that misses a start
-- shows an OVERDUE planned row rather than silently skipping a cycle.
-- ============================================================================

BEGIN;

ALTER TABLE public.audit_assessments
    DROP CONSTRAINT IF EXISTS audit_assessments_status_check;
ALTER TABLE public.audit_assessments
    ADD CONSTRAINT audit_assessments_status_check
    CHECK (status IN ('planned', 'in_progress', 'completed', 'archived', 'deleted'));

ALTER TABLE public.audit_assessments
    ADD COLUMN IF NOT EXISTS planned_date DATE,
    ADD COLUMN IF NOT EXISTS recur_months INTEGER;

COMMENT ON COLUMN public.audit_assessments.planned_date IS
    'For status=planned: when this assessment is due to start. Past date = overdue on the Audit Schedule.';
COMMENT ON COLUMN public.audit_assessments.recur_months IS
    'NULL = one-off. Set = starting this planned assessment immediately plans the next occurrence this many months later (e.g. 12 for an annual criticality review).';

COMMIT;

-- VERIFY (after apply):
--   INSERT INTO audit_assessments (assessor_name, assessor_company, assessor_email, status, planned_date, recur_months, audit_objective)
--     VALUES ('smoke','x','', 'planned', CURRENT_DATE + 30, 12, 'verify') RETURNING id;  -- then status='deleted'
