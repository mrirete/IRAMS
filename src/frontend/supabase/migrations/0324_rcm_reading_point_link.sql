-- 0324: an on-condition RCM decision knows the measurement point behind it
--
-- Before this, "Create reading point" on the Strategy page inserted a
-- reading_definitions row named after the failure mode and forgot it. The
-- decision could not say which point implements it, a second click made a
-- second point, and the Evidence tab could only guess coverage from words.
--
-- (1) ers_rcm_decisions.reading_definition_id — the point this decision
--     monitors. Set by "Create reading point"; the button becomes a link.
-- (2) The 0319 freeze trigger lets this link change on an approved study,
--     exactly as it lets recurring_work_id change: wiring the approved plan
--     into Condition Data is carrying the plan out, not editing it.
-- (3) sem_rcm_coverage gains cbm_count (on-condition / predictive decisions)
--     and reading_point_count (those with a linked point), so "how many CBM
--     tasks are paper tasks" is one subtraction, tenant-scoped.

BEGIN;

-- ── (1) the link ────────────────────────────────────────────────────────────
ALTER TABLE public.ers_rcm_decisions
    ADD COLUMN IF NOT EXISTS reading_definition_id uuid
        REFERENCES public.reading_definitions(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.ers_rcm_decisions.reading_definition_id IS
    '0324: the Condition Data measurement point this on-condition / predictive decision monitors. NULL = paper task until a point exists.';

CREATE INDEX IF NOT EXISTS idx_ers_rcm_decisions_reading_definition
    ON public.ers_rcm_decisions(reading_definition_id)
    WHERE reading_definition_id IS NOT NULL;

-- ── (2) freeze exception ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rcm_refuse_edit_when_approved()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
    v_study uuid;
    v_old jsonb;
    v_new jsonb;
BEGIN
    IF TG_TABLE_NAME = 'ers_rcm_functions' THEN
        v_study := COALESCE(NEW.study_id, OLD.study_id);
    ELSIF TG_TABLE_NAME = 'ers_rcm_failure_modes' THEN
        SELECT f.study_id INTO v_study FROM public.ers_rcm_functions f WHERE f.id = COALESCE(NEW.function_id, OLD.function_id);
    ELSE
        SELECT f.study_id INTO v_study
          FROM public.ers_rcm_failure_modes m
          JOIN public.ers_rcm_functions f ON f.id = m.function_id
         WHERE m.id = COALESCE(NEW.failure_mode_id, OLD.failure_mode_id);
    END IF;

    IF v_study IS NULL OR NOT public.rcm_study_is_approved(v_study) THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    -- Implementing the approved plan is allowed: only the PM link (0319) and
    -- the reading-point link (0324) may change.
    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'ers_rcm_decisions' THEN
        v_old := to_jsonb(OLD) - 'recurring_work_id' - 'reading_definition_id' - 'updated_at';
        v_new := to_jsonb(NEW) - 'recurring_work_id' - 'reading_definition_id' - 'updated_at';
        IF v_old = v_new THEN
            RETURN NEW;
        END IF;
    END IF;

    RAISE EXCEPTION 'RCM study is approved — choose Revise on the study to edit it (0319)'
        USING ERRCODE = 'check_violation';
END;
$$;

-- ── (3) coverage view: CBM tasks vs points ──────────────────────────────────
CREATE OR REPLACE VIEW public.sem_rcm_coverage AS
SELECT
    s.id            AS study_id,
    s.title,
    s.status,
    s.revision,
    s.asset_id,
    a.tag           AS asset_tag,
    a.name          AS asset_name,
    a.criticality,
    s.approved_at,
    s.updated_at,
    (SELECT count(*) FROM public.ers_rcm_functions f WHERE f.study_id = s.id)::int AS function_count,
    COALESCE(c.fm_count, 0)::int            AS failure_mode_count,
    COALESCE(c.decided_count, 0)::int       AS decided_count,
    COALESCE(c.strategy_count, 0)::int      AS strategy_count,
    COALESCE(c.proactive_count, 0)::int     AS proactive_count,
    COALESCE(c.pm_count, 0)::int            AS pm_count,
    COALESCE(c.cbm_count, 0)::int           AS cbm_count,
    COALESCE(c.reading_point_count, 0)::int AS reading_point_count
FROM public.ers_rcm_studies s
LEFT JOIN public.assets a ON a.id::text = s.asset_id
LEFT JOIN LATERAL (
    SELECT count(m.id)                          AS fm_count,
           count(d.consequence_code)            AS decided_count,
           count(d.recommended_strategy_code)   AS strategy_count,
           count(d.id) FILTER (WHERE d.recommended_strategy_code IN ('PM_TIME','PM_CONDITION','PM_PREDICTIVE')) AS proactive_count,
           count(d.recurring_work_id)           AS pm_count,
           count(d.id) FILTER (WHERE d.recommended_strategy_code IN ('PM_CONDITION','PM_PREDICTIVE')) AS cbm_count,
           count(d.reading_definition_id) FILTER (WHERE d.recommended_strategy_code IN ('PM_CONDITION','PM_PREDICTIVE')) AS reading_point_count
      FROM public.ers_rcm_functions f
      JOIN public.ers_rcm_failure_modes m ON m.function_id = f.id
      LEFT JOIN public.ers_rcm_decisions d ON d.failure_mode_id = m.id
     WHERE f.study_id = s.id
) c ON true
WHERE s.company_id = (SELECT public.caller_company());

GRANT SELECT ON public.sem_rcm_coverage TO authenticated, service_role;

UPDATE public.semantic_catalog
   SET description = 'One row per RCM study with the asset it covers (tag, criticality) and the study''s progress: failure modes, consequences classified (Q5), strategies chosen (Q6-Q7), proactive decisions, how many of them reached Work Management as a PM, and — for on-condition / predictive decisions (cbm_count) — how many have a Condition Data measurement point behind them (reading_point_count). cbm_count minus reading_point_count is the number of paper CBM tasks. Tenant-scoped. Answers "how much of our critical plant has an approved study, and how much of it is implemented in the CMMS".'
 WHERE object_name = 'sem_rcm_coverage' AND column_name IS NULL;

COMMIT;

-- VERIFY (after apply):
--   SELECT study_id, asset_tag, cbm_count, reading_point_count, pm_count FROM sem_rcm_coverage;
--   UPDATE ers_rcm_decisions SET reading_definition_id = NULL WHERE id = '<decision on an approved study>';  -- expect success
--   UPDATE ers_rcm_decisions SET task_description = 'y' WHERE id = '<same>';                                  -- expect 23514
