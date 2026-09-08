-- 0346 — who is on a step is decided by people who hold Assign.
--
-- Decision 2026-09-08 (option 1 of the close-out discussion, the SAP PM
-- position): assignment is a planner's / supervisor's act at both levels.
-- Technicians confirm time against the steps they are on; the confirmation
-- names who really did the work. Nobody adds or removes anyone on a step —
-- themselves included — without workOrders.assign or scheduling.assign, so
-- a supervisor's plan cannot be quietly undone by the person it was made
-- for. 0340 already enforces this for the order-level responsible person;
-- this extends it to job_tasks.assigned_user_ids / assigned_org_unit_ids,
-- refuses step writes under a frozen order, and journals every change.

CREATE OR REPLACE FUNCTION public.enforce_step_assignment()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    old_users jsonb := CASE WHEN TG_OP = 'INSERT' THEN '[]'::jsonb ELSE coalesce(OLD.assigned_user_ids, '[]'::jsonb) END;
    new_users jsonb := coalesce(NEW.assigned_user_ids, '[]'::jsonb);
    old_units jsonb := CASE WHEN TG_OP = 'INSERT' THEN '[]'::jsonb ELSE coalesce(OLD.assigned_org_unit_ids, '[]'::jsonb) END;
    new_units jsonb := coalesce(NEW.assigned_org_unit_ids, '[]'::jsonb);
    changed boolean;
    v_no text;
BEGIN
    IF public.session_is_internal() OR public.is_admin() THEN RETURN NEW; END IF;

    changed := (SELECT coalesce(jsonb_agg(x ORDER BY x), '[]'::jsonb) FROM jsonb_array_elements_text(old_users) x)
            IS DISTINCT FROM (SELECT coalesce(jsonb_agg(x ORDER BY x), '[]'::jsonb) FROM jsonb_array_elements_text(new_users) x)
        OR (SELECT coalesce(jsonb_agg(x ORDER BY x), '[]'::jsonb) FROM jsonb_array_elements_text(old_units) x)
            IS DISTINCT FROM (SELECT coalesce(jsonb_agg(x ORDER BY x), '[]'::jsonb) FROM jsonb_array_elements_text(new_units) x);
    IF NOT changed THEN RETURN NEW; END IF;

    IF NOT (public.caller_can('workOrders', 'assign') OR public.caller_can('scheduling', 'assign')) THEN
        SELECT wo_number INTO v_no FROM public.work_orders WHERE id = NEW.wo_id;
        RAISE EXCEPTION 'ASSIGN_REQUIRED: Your role cannot change who is assigned to a step of work order % (needs Assign). Ask your supervisor or planner.', coalesce(v_no, NEW.wo_id::text)
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ab_enforce_step_assignment ON public.job_tasks;
CREATE TRIGGER ab_enforce_step_assignment
    BEFORE INSERT OR UPDATE ON public.job_tasks
    FOR EACH ROW EXECUTE FUNCTION public.enforce_step_assignment();

-- Steps under a frozen order are as immutable as its labour and parts.
DROP TRIGGER IF EXISTS ab_refuse_frozen ON public.job_tasks;
CREATE TRIGGER ab_refuse_frozen BEFORE INSERT OR UPDATE OR DELETE ON public.job_tasks
    FOR EACH ROW EXECUTE FUNCTION public.refuse_child_write_when_frozen();

-- The record says who was put on, and taken off, which step, by whom.
CREATE OR REPLACE FUNCTION public.journal_step_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    old_users jsonb := coalesce(OLD.assigned_user_ids, '[]'::jsonb);
    new_users jsonb := coalesce(NEW.assigned_user_ids, '[]'::jsonb);
    added text; removed text; actor text; v_company uuid;
BEGIN
    SELECT string_agg(coalesce(u.username, u.email, x), ', ') INTO added
      FROM jsonb_array_elements_text(new_users) x LEFT JOIN public.users u ON u.id::text = x
     WHERE NOT (old_users ? x);
    SELECT string_agg(coalesce(u.username, u.email, x), ', ') INTO removed
      FROM jsonb_array_elements_text(old_users) x LEFT JOIN public.users u ON u.id::text = x
     WHERE NOT (new_users ? x);
    IF added IS NULL AND removed IS NULL THEN RETURN NULL; END IF;
    SELECT coalesce(u.username, u.email, 'system') INTO actor FROM public.users u WHERE u.id = public.caller_user_id();
    SELECT company_id INTO v_company FROM public.work_orders WHERE id = NEW.wo_id;
    INSERT INTO public.journal_entries (entity_id, entity_type, entry_type, entry, is_system, client_id, author_name, company_id, created_at)
    VALUES (NEW.wo_id, 'WORK_ORDER', 'SYSTEM',
            format('Step %s assignment changed: %s%s',
                   coalesce(NEW.operation_no, NEW.sequence::text),
                   CASE WHEN added IS NOT NULL THEN 'added ' || added ELSE '' END,
                   CASE WHEN removed IS NOT NULL THEN (CASE WHEN added IS NOT NULL THEN '; ' ELSE '' END) || 'removed ' || removed ELSE '' END),
            true, 'step-' || NEW.id::text || '-' || extract(epoch FROM clock_timestamp())::bigint::text,
            coalesce(actor, 'system'), v_company, now());
    RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS zz_journal_step_assignment ON public.job_tasks;
CREATE TRIGGER zz_journal_step_assignment
    AFTER UPDATE OF assigned_user_ids ON public.job_tasks
    FOR EACH ROW EXECUTE FUNCTION public.journal_step_assignment();

COMMENT ON FUNCTION public.enforce_step_assignment() IS
    '0346: changing assigned_user_ids / assigned_org_unit_ids on a step needs workOrders.assign or scheduling.assign — no self-pickup, no self-removal. Internal sessions and admins bypass.';
