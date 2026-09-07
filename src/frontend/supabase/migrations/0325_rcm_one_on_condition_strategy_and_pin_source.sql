-- 0325: one on-condition strategy, and where a failure-mode pin came from
--
-- (1) SAE JA1012 knows ONE on-condition task type: inspect, measure or monitor
--     at an interval shorter than the P-F interval and act on the potential
--     failure. Whether a person reads a gauge or a sensor streams the value is
--     a property of the task (on_condition_technology / suggested_technology),
--     not a different strategy. "PM_PREDICTIVE" is therefore folded into
--     "PM_CONDITION": existing decisions are rewritten, the dictionary entry is
--     retired, and the UI no longer offers it. sem_rcm_coverage keeps accepting
--     the old code so nothing changes shape for readers.
--
-- (2) ers_rcm_failure_modes.component_link_source — how the pin to a
--     component / BOM line was made. 'text' = inferred from the mode's own
--     words and not yet confirmed by a person; the worksheet marks those and
--     offers them for review as a set, because ISO 14224 failure data hangs
--     off the maintainable item and a guessed item is worse than none.

BEGIN;

-- ── (1) fold Predictive into Condition-Based ────────────────────────────────
UPDATE public.ers_rcm_decisions
   SET recommended_strategy_code = 'PM_CONDITION',
       task_type_code = COALESCE(task_type_code, 'ON_CONDITION')
 WHERE recommended_strategy_code = 'PM_PREDICTIVE';

-- The 0118 dictionary seed row for PM_PREDICTIVE is left as it is: it is a
-- global row with no company_id, and updating it trips the audit trigger
-- (audit_logs.company_id NOT NULL, no caller in a migration). Nothing reads
-- RCM_STRATEGY from dictionaries — the UI vocabulary is rcmPlan.STRATEGY_CODES,
-- where PM_PREDICTIVE is now a legacy code.

-- ── (2) pin provenance ──────────────────────────────────────────────────────
ALTER TABLE public.ers_rcm_failure_modes
    ADD COLUMN IF NOT EXISTS component_link_source text
        CHECK (component_link_source IS NULL OR component_link_source IN ('manual', 'specialist', 'text', 'import'));
COMMENT ON COLUMN public.ers_rcm_failure_modes.component_link_source IS
    '0325: how component_asset_id / bom_item_id was set. manual = a person chose it; specialist = the model named it; text = inferred from the failure-mode wording (review it); import = carried by an import file. NULL = unpinned or pinned before 0325.';

-- Pins made before this migration were chosen by a person or the Specialist —
-- treat them as confirmed rather than flagging a whole register for review.
UPDATE public.ers_rcm_failure_modes
   SET component_link_source = 'manual'
 WHERE component_link_source IS NULL
   AND (component_asset_id IS NOT NULL OR bom_item_id IS NOT NULL);

COMMIT;

-- VERIFY (after apply):
--   SELECT count(*) FROM ers_rcm_decisions WHERE recommended_strategy_code = 'PM_PREDICTIVE';   -- 0
--   SELECT component_link_source, count(*) FROM ers_rcm_failure_modes GROUP BY 1;
