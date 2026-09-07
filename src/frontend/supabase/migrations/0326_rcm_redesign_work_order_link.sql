-- 0326: a Redesign decision knows the work order that carries it out
--
-- Strategy (Q6–Q7) can end in a default action: Redesign — a one-off change
-- to the design, procedure or operating context. That is a work order (or
-- MOC), not a schedule. Until now "Raise redesign work order" opened the
-- create form and forgot; the plan could never say the redesign was raised,
-- let alone done. The decision now records the work order it became, the
-- same way recurring_work_id records the PM and reading_definition_id (0324)
-- records the measurement point.
--
-- The 0319 freeze trigger lets this link change on an approved study, like
-- the other two: carrying the plan out is not editing it.

BEGIN;

ALTER TABLE public.ers_rcm_decisions
    ADD COLUMN IF NOT EXISTS work_order_id uuid
        REFERENCES public.work_orders(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.ers_rcm_decisions.work_order_id IS
    '0326: the work order raised to carry out a REDESIGN decision. NULL = not raised yet.';

CREATE INDEX IF NOT EXISTS idx_ers_rcm_decisions_work_order
    ON public.ers_rcm_decisions(work_order_id)
    WHERE work_order_id IS NOT NULL;

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

    -- Implementing the approved plan is allowed: only the PM link (0319), the
    -- reading-point link (0324) and the redesign work-order link (0326) may change.
    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'ers_rcm_decisions' THEN
        v_old := to_jsonb(OLD) - 'recurring_work_id' - 'reading_definition_id' - 'work_order_id' - 'updated_at';
        v_new := to_jsonb(NEW) - 'recurring_work_id' - 'reading_definition_id' - 'work_order_id' - 'updated_at';
        IF v_old = v_new THEN
            RETURN NEW;
        END IF;
    END IF;

    RAISE EXCEPTION 'RCM study is approved — choose Revise on the study to edit it (0319)'
        USING ERRCODE = 'check_violation';
END;
$$;

COMMIT;

-- VERIFY (after apply):
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'ers_rcm_decisions' AND column_name = 'work_order_id';
--   SELECT position('work_order_id' in pg_get_functiondef('public.rcm_refuse_edit_when_approved'::regproc)) > 0;
