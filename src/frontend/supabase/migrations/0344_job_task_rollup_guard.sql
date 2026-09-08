-- 0344 — a completed operation keeps its confirmed hours.
--
-- postConfirmation rolls a final time confirmation up into job_tasks
-- (status COMPLETED, actual_hours = Σ confirmations). The work order page
-- saves its task list on a 1.5 s debounce, and a save already in flight
-- when the roll-up lands writes the pre-posting copy back: PENDING, hours
-- null (seen 0.6 s after the roll-up on 2026-09-08). The client now diffs
-- against the DB row, but the race is the DB's to close: a row that holds
-- confirmed hours does not lose them to a write that carries none.

CREATE OR REPLACE FUNCTION public.keep_confirmed_rollup()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status = 'COMPLETED' AND coalesce(OLD.actual_hours, 0) > 0
       AND (NEW.actual_hours IS NULL OR NEW.actual_hours = 0)
       AND NEW.status IS DISTINCT FROM 'COMPLETED' THEN
        NEW.status := OLD.status;
        NEW.actual_hours := OLD.actual_hours;
        NEW.actual_finish_date := OLD.actual_finish_date;
        NEW.actual_finish_time := OLD.actual_finish_time;
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ab_keep_confirmed_rollup ON public.job_tasks;
CREATE TRIGGER ab_keep_confirmed_rollup
    BEFORE UPDATE ON public.job_tasks
    FOR EACH ROW EXECUTE FUNCTION public.keep_confirmed_rollup();

COMMENT ON FUNCTION public.keep_confirmed_rollup() IS
    '0344: an operation completed by a final time confirmation keeps COMPLETED / actual_hours when a stale client save carries none.';
