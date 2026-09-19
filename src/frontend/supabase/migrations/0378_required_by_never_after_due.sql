-- 0378 — "required by" is never later than the due date
--
-- WHAT WAS WRONG
--   0349 derives required_by from priority at creation (P3 = +7 days, P4 = +30)
--   and ignores the due date. A generated order due on its schedule's date
--   (19 Sep) was therefore "required by" 26 Sep, a week after it was due; the
--   planner had not typed that date and could not see where it came from.
--
-- WHAT THIS DOES
--   When the order is created with a due date, required_by is the EARLIER of
--   the priority window and the due date. A P1 order due next month is still
--   required within hours; a P4 order due in three days is required in three
--   days. Orders created without a due date keep the priority window.
--   Repairs open orders raised from schedules where required_by ran past the
--   due date.
--
-- SAFE TO RE-RUN.

BEGIN;

CREATE OR REPLACE FUNCTION public.wo_required_by_at_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.required_by IS NULL THEN
        NEW.required_by := coalesce(NEW.created_at, now()) + public.priority_lead_interval(NEW.priority_code);
    END IF;
    IF NEW.due_date IS NOT NULL AND NEW.required_by::date > NEW.due_date::date THEN
        NEW.required_by := NEW.due_date::date + time '23:59';
    END IF;
    RETURN NEW;
END $$;
-- Runs before 0349's trigger (alphabetical), so 0349 finds required_by set and leaves it.
DROP TRIGGER IF EXISTS aa_wo_required_by ON public.work_orders;
CREATE TRIGGER aa_wo_required_by
    BEFORE INSERT ON public.work_orders
    FOR EACH ROW EXECUTE FUNCTION public.wo_required_by_at_insert();

UPDATE public.work_orders
   SET required_by = due_date::date + time '23:59'
 WHERE recurring_work_id IS NOT NULL
   AND due_date IS NOT NULL
   AND required_by IS NOT NULL
   AND required_by::date > due_date::date
   AND upper(coalesce(status::text, '')) IN ('OPEN', 'PLAN', 'SCHED', 'WIP', 'WAIT');

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'aa_wo_required_by') THEN
        RAISE EXCEPTION '0378: trigger missing';
    END IF;
    RAISE NOTICE '0378 verified: required_by capped at the due date on insert';
END $$;

COMMIT;
