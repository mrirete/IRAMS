-- ============================================================================
-- 0299 — Close the internal loop: proposals can be APPLIED to the schedule,
--         and PMs carry structured origin provenance
--
-- Two PARTIAL grades from the Aug 2026 reliability assessment (RELANTERN-VA-01):
--
-- 1. Approved extend_interval / set_interval proposals could only leave
--    OUTWARD (writeback package / proposal-writeback to a foreign CMMS).
--    Nothing applied them to IREAMS's own recurring_work — the full-suite
--    loop-closure claim had a hole. ers_agent_actions gains an 'applied'
--    terminal status plus provenance columns; WritebackService.applyIntervalProposal
--    (same commit) performs the governed update.
--
-- 2. A PM created from a Weibull fit carried its β/η/R² justification only in
--    free-text description, and the analysis→PM link was one-directional
--    (ers_reliability_analyses.linked_pm_id). recurring_work.origin makes the
--    provenance structured and queryable: {source, beta, eta, r2, ...} on
--    creation, and interval_revision entries appended when a proposal is
--    applied — the schedule can always answer "why does this PM look like this?"
--    (strategy_id/strategy_package [0292] are NOT the vehicle for this: they
--    bind a PM to a cycle-package strategy for absorption, a different concept.)
-- ============================================================================

BEGIN;

-- ── 1. ers_agent_actions: 'applied' status + provenance ─────────────────────
ALTER TABLE public.ers_agent_actions
    DROP CONSTRAINT IF EXISTS ers_agent_actions_status_check;
ALTER TABLE public.ers_agent_actions
    ADD CONSTRAINT ers_agent_actions_status_check
    CHECK (status IN ('pending_review', 'approved', 'rejected', 'expired', 'applied'));

ALTER TABLE public.ers_agent_actions
    ADD COLUMN IF NOT EXISTS applied_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS applied_ref JSONB;

COMMENT ON COLUMN public.ers_agent_actions.applied_ref IS
    'Set when status=applied: what the internal apply changed, e.g. {pm_id, pm_code, from_interval, from_unit, to_days, applied_by}. Applied proposals are DELIVERED value (ROI statement counts them alongside approved).';

-- ── 2. recurring_work.origin: structured provenance ─────────────────────────
ALTER TABLE public.recurring_work
    ADD COLUMN IF NOT EXISTS origin JSONB;

COMMENT ON COLUMN public.recurring_work.origin IS
    'Why this PM exists / why its interval is what it is. Creation stamps e.g. {source:"weibull_analysis", beta, eta_hours, r2, b10_hours, data_points, interval_basis} or {source:"rcm", study_id, decision_id}; internal proposal application appends {interval_revision:{proposal_id, from_days, to_days, basis, applied_at, applied_by}}. Display-and-audit data — generation logic must never read it.';

INSERT INTO public.semantic_catalog
  (object_name, column_name, title, description, tags, owner, source_tables, iso_standard)
VALUES
  ('recurring_work', 'origin', 'PM Origin',
   'Structured provenance for a PM programme: the analysis that created it (Weibull β/η/R², RCM decision) and any applied interval revisions with their proposal ids. Lets any surface — and any agent — answer "why does this PM exist at this interval" from data instead of free text.',
   ARRAY['work_management','pm','reliability','provenance'], 'Reliability Engineering',
   ARRAY['recurring_work','ers_agent_actions','ers_reliability_analyses'], NULL)
ON CONFLICT (object_name, COALESCE(column_name, '·')) DO UPDATE
  SET description = EXCLUDED.description,
      tags        = EXCLUDED.tags,
      updated_at  = now();

COMMIT;

-- VERIFY (after apply):
--   UPDATE ers_agent_actions SET status='applied' WHERE false;   -- constraint accepts it
--   SELECT origin FROM recurring_work LIMIT 1;                    -- column exists
