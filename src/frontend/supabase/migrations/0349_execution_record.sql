-- 0349 — the execution record: the dates and people a maintenance order is
-- expected to carry, stamped by the database so every client agrees.
--
-- Found 2026-09-09 (execution test on WO-EXEC-09091056, docs/Process-Test-
-- Work-Management-Run-2026-09-08.md § Execution): after a textbook run the
-- order held est_duration 0 (steps totalled 6.5 h), actual_duration null
-- (11 h posted), no actual start or finish (no columns — the Details
-- "Completed" date saved into the void), step 2 actual = the last final
-- posting only, one closed_at doing duty for both TECO and CLOSED, nothing
-- about who completed / accepted / closed, no required-by date, no committed
-- schedule date, and a WAIT status that carried no reason. reviewed_by /
-- reviewed_at / review_notes existed on the table and nothing wrote them.
--
-- NEW COLUMNS (work_orders)
--   required_by        when the work must be done, from priority at creation
--                      (P1 4 h · P2 1 d · P3 7 d · P4 30 d · P5 90 d), editable
--   committed_start    the schedule date first promised (first SCHED); reschedules
--                      move due dates, never this — schedule attainment reads it
--   released_at/by     who scheduled it and when
--   actual_start_at    first WIP
--   actual_finish_at   TECO (editable afterwards until financial close)
--   completed_at/by    technical completion stamp and person
--   closed_by          financial close person (closed_at stays: first TECO,
--                      as 0284 defined it)
--   wait_reason/since  why the job is waiting, since when (cleared on leaving WAIT)
--   reported_by        originator of an order raised without a request
--   planner_id         who owns the plan
--   handed_back_at/by  operations accepted the asset back
--   (job_tasks) completed_at/by  who signed the step off
--
-- ROLL-UPS (kept by trigger, so the rail, the scheduler and the scores read
-- one number):
--   work_orders.est_duration     = Σ job_tasks.est_hours   while steps exist
--   job_tasks.actual_hours       = Σ posted confirmations on the step (every
--                                  person, final or not); a final posting marks
--                                  the step COMPLETED with completed_by/at
--   work_orders.actual_duration_hrs = Σ posted confirmations on the order
--                                  (a typed figure only counts when nothing
--                                  has been posted)
-- The close-out note is a JOURNAL entry (entry_type 'Closeout'), not a column.

ALTER TABLE public.work_orders
    ADD COLUMN IF NOT EXISTS required_by       timestamptz,
    ADD COLUMN IF NOT EXISTS committed_start   timestamptz,
    ADD COLUMN IF NOT EXISTS released_at       timestamptz,
    ADD COLUMN IF NOT EXISTS released_by       uuid,
    ADD COLUMN IF NOT EXISTS actual_start_at   timestamptz,
    ADD COLUMN IF NOT EXISTS actual_finish_at  timestamptz,
    ADD COLUMN IF NOT EXISTS completed_at      timestamptz,
    ADD COLUMN IF NOT EXISTS completed_by      uuid,
    ADD COLUMN IF NOT EXISTS closed_by         uuid,
    ADD COLUMN IF NOT EXISTS wait_reason       text,
    ADD COLUMN IF NOT EXISTS wait_since        timestamptz,
    ADD COLUMN IF NOT EXISTS reported_by       uuid,
    ADD COLUMN IF NOT EXISTS planner_id        uuid,
    ADD COLUMN IF NOT EXISTS handed_back_at    timestamptz,
    ADD COLUMN IF NOT EXISTS handed_back_by    uuid;

ALTER TABLE public.job_tasks
    ADD COLUMN IF NOT EXISTS completed_at timestamptz,
    ADD COLUMN IF NOT EXISTS completed_by uuid;

COMMENT ON COLUMN public.work_orders.committed_start IS '0349: the schedule date first promised (set on the first SCHED, never moved by reschedules). Schedule attainment measures against this.';
COMMENT ON COLUMN public.work_orders.required_by IS '0349: when the work must be done — derived from priority at creation (P1 4h, P2 1d, P3 7d, P4 30d, P5 90d), editable by planners.';
COMMENT ON COLUMN public.work_orders.closed_at IS 'Stamps at the FIRST TECO (0284) and stays through CLOSED. completed_at (0349) is the technical completion stamp; the financial close moment is the audit row / closed_by.';

-- ── Required-by from priority ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.priority_lead_interval(p_code text)
RETURNS interval LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE upper(coalesce(p_code, ''))
        WHEN 'P1' THEN interval '4 hours'
        WHEN 'EMERGENCY' THEN interval '4 hours'
        WHEN 'CRITICAL' THEN interval '4 hours'
        WHEN 'P2' THEN interval '1 day'
        WHEN 'URGENT' THEN interval '1 day'
        WHEN 'P3' THEN interval '7 days'
        WHEN 'HIGH' THEN interval '7 days'
        WHEN 'P4' THEN interval '30 days'
        WHEN 'MEDIUM' THEN interval '30 days'
        WHEN 'NORMAL' THEN interval '30 days'
        WHEN 'P5' THEN interval '90 days'
        WHEN 'LOW' THEN interval '90 days'
        ELSE interval '30 days' END;
$$;

-- ── Stamps and roll-ups on the order ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.stamp_wo_execution()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    me uuid := CASE WHEN public.session_is_internal() THEN NULL ELSE public.caller_user_id() END;
    old_s text := CASE WHEN TG_OP = 'INSERT' THEN '' ELSE upper(coalesce(OLD.status::text, '')) END;
    new_s text := upper(coalesce(NEW.status::text, ''));
    v_est numeric;
    v_steps int;
    v_posted numeric;
    v_conf int;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.required_by IS NULL THEN
            NEW.required_by := coalesce(NEW.created_at, now()) + public.priority_lead_interval(NEW.priority_code);
        END IF;
        IF NEW.reported_by IS NULL THEN
            IF NEW.request_id IS NOT NULL THEN
                SELECT r.requester_id INTO NEW.reported_by FROM public.service_requests r WHERE r.id = NEW.request_id;
            END IF;
            IF NEW.reported_by IS NULL THEN NEW.reported_by := me; END IF;
        END IF;
        RETURN NEW;
    END IF;

    -- Roll-ups: steps own the estimate, confirmations own the actual.
    SELECT count(*), coalesce(sum(est_hours), 0) INTO v_steps, v_est FROM public.job_tasks t WHERE t.wo_id = NEW.id;
    IF v_steps > 0 AND v_est > 0 THEN NEW.est_duration := v_est; END IF;
    SELECT count(*), coalesce(sum(hours_worked), 0) INTO v_conf, v_posted FROM public.work_order_labor l WHERE l.wo_id = NEW.id AND l.confirmation_no IS NOT NULL;
    IF v_conf > 0 THEN NEW.actual_duration_hrs := v_posted; END IF;

    IF new_s IS DISTINCT FROM old_s THEN
        IF new_s = 'SCHED' AND NEW.committed_start IS NULL THEN
            NEW.committed_start := coalesce(NEW.date_due_start, NEW.due_date, now());
            NEW.released_at := now();
            NEW.released_by := me;
        END IF;
        IF new_s = 'WIP' AND NEW.actual_start_at IS NULL THEN
            NEW.actual_start_at := now();
        END IF;
        IF new_s = 'WAIT' THEN
            NEW.wait_since := now();
        ELSIF old_s = 'WAIT' THEN
            NEW.wait_since := NULL;
            NEW.wait_reason := NULL;
        END IF;
        IF new_s IN ('TECO', 'COMPLETED') THEN
            IF NEW.actual_finish_at IS NULL THEN NEW.actual_finish_at := now(); END IF;
            NEW.completed_at := now();
            NEW.completed_by := coalesce(me, NEW.completed_by);
        END IF;
        IF new_s = 'CLOSED' THEN
            NEW.closed_by := coalesce(me, NEW.closed_by);
            IF NEW.actual_finish_at IS NULL THEN NEW.actual_finish_at := coalesce(NEW.completed_at, NEW.closed_at, now()); END IF;
        END IF;
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ac_stamp_wo_execution ON public.work_orders;
CREATE TRIGGER ac_stamp_wo_execution
    BEFORE INSERT OR UPDATE ON public.work_orders
    FOR EACH ROW EXECUTE FUNCTION public.stamp_wo_execution();

-- ── Confirmations roll up to the step and the order ─────────────────────────
CREATE OR REPLACE FUNCTION public.rollup_confirmations()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_task uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.job_task_id ELSE NEW.job_task_id END;
    v_wo uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.wo_id ELSE NEW.wo_id END;
    v_hours numeric;
    v_final_by uuid;
    v_final_at timestamptz;
BEGIN
    IF v_task IS NOT NULL THEN
        SELECT coalesce(sum(hours_worked), 0) INTO v_hours FROM public.work_order_labor WHERE job_task_id = v_task AND confirmation_no IS NOT NULL;
        SELECT contact_id, coalesce(date_worked::timestamptz, created_at) INTO v_final_by, v_final_at
          FROM public.work_order_labor WHERE job_task_id = v_task AND confirmation_no IS NOT NULL AND coalesce(is_final, false)
          ORDER BY created_at DESC LIMIT 1;
        UPDATE public.job_tasks t
           SET actual_hours = CASE WHEN v_hours > 0 THEN v_hours ELSE t.actual_hours END,
               status = CASE WHEN v_final_by IS NOT NULL THEN 'COMPLETED' ELSE t.status END,
               completed_at = CASE WHEN v_final_by IS NOT NULL THEN coalesce(t.completed_at, v_final_at) ELSE t.completed_at END,
               completed_by = CASE WHEN v_final_by IS NOT NULL THEN coalesce(t.completed_by, v_final_by) ELSE t.completed_by END,
               actual_finish_date = CASE WHEN v_final_by IS NOT NULL THEN coalesce(t.actual_finish_date, v_final_at::date) ELSE t.actual_finish_date END
         WHERE t.id = v_task;
    END IF;
    -- touch the order so stamp_wo_execution recomputes actual_duration_hrs
    UPDATE public.work_orders SET updated_at = now() WHERE id = v_wo;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

DROP TRIGGER IF EXISTS zz_rollup_confirmations ON public.work_order_labor;
CREATE TRIGGER zz_rollup_confirmations
    AFTER INSERT OR UPDATE OR DELETE ON public.work_order_labor
    FOR EACH ROW EXECUTE FUNCTION public.rollup_confirmations();

-- Steps changed → order estimate follows
CREATE OR REPLACE FUNCTION public.rollup_step_estimates()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_wo uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.wo_id ELSE NEW.wo_id END;
BEGIN
    UPDATE public.work_orders SET updated_at = now() WHERE id = v_wo;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
DROP TRIGGER IF EXISTS zz_rollup_step_estimates ON public.job_tasks;
CREATE TRIGGER zz_rollup_step_estimates
    AFTER INSERT OR UPDATE OF est_hours OR DELETE ON public.job_tasks
    FOR EACH ROW EXECUTE FUNCTION public.rollup_step_estimates();

-- ── Backfill the existing orders ────────────────────────────────────────────
-- Actual start from the first "→ WIP" journal line, finish/completion from
-- closed_at (which 0284 stamps at first TECO), required_by from priority.
UPDATE public.work_orders w SET
    actual_start_at = coalesce(w.actual_start_at, (SELECT min(j.created_at) FROM public.journal_entries j WHERE j.entity_id = w.id AND j.is_system AND j.entry ~ '→ WIP$')),
    actual_finish_at = coalesce(w.actual_finish_at, CASE WHEN upper(w.status::text) IN ('TECO', 'CLOSED') THEN w.closed_at END),
    completed_at = coalesce(w.completed_at, CASE WHEN upper(w.status::text) IN ('TECO', 'CLOSED') THEN w.closed_at END),
    committed_start = coalesce(w.committed_start, CASE WHEN upper(w.status::text) IN ('SCHED', 'WIP', 'WAIT', 'TECO', 'CLOSED') THEN coalesce(w.date_due_start, w.due_date) END),
    required_by = coalesce(w.required_by, w.created_at + public.priority_lead_interval(w.priority_code)),
    est_duration = CASE WHEN (SELECT coalesce(sum(est_hours), 0) FROM public.job_tasks t WHERE t.wo_id = w.id) > 0 THEN (SELECT sum(est_hours) FROM public.job_tasks t WHERE t.wo_id = w.id) ELSE w.est_duration END,
    actual_duration_hrs = CASE WHEN EXISTS (SELECT 1 FROM public.work_order_labor l WHERE l.wo_id = w.id AND l.confirmation_no IS NOT NULL) THEN (SELECT sum(hours_worked) FROM public.work_order_labor l WHERE l.wo_id = w.id AND l.confirmation_no IS NOT NULL) ELSE w.actual_duration_hrs END;

UPDATE public.job_tasks t SET
    actual_hours = s.h
FROM (SELECT job_task_id, sum(hours_worked) h FROM public.work_order_labor WHERE confirmation_no IS NOT NULL AND job_task_id IS NOT NULL GROUP BY job_task_id) s
WHERE s.job_task_id = t.id AND s.h > 0;
