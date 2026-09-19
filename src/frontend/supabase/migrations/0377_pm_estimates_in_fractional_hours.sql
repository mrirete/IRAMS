-- 0377 — schedule estimates hold fractional hours
--
-- WHAT WAS WRONG
--   recurring_work.est_duration and est_downtime were INTEGER (0001a). Step
--   hours are numeric(5,2) and the work order's est_duration is numeric(8,2),
--   and since 2026-09-19 the schedule's estimate is derived from its steps.
--   A 12-minute step (0.2 h) therefore made every save of the schedule fail
--   with 22P02 — including saves of its hazards, labour and parts, which ride
--   on the same request. Planners saw "invalid input syntax for type integer".
--
-- WHAT THIS DOES
--   Widens both columns to numeric(8,2), matching work_orders. Existing whole
--   hours are unchanged.
--
-- SAFE TO RE-RUN.

BEGIN;

ALTER TABLE public.recurring_work
    ALTER COLUMN est_duration TYPE numeric(8,2) USING est_duration::numeric,
    ALTER COLUMN est_downtime TYPE numeric(8,2) USING est_downtime::numeric;

DO $$
DECLARE t text;
BEGIN
    SELECT data_type INTO t FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'recurring_work' AND column_name = 'est_duration';
    IF t <> 'numeric' THEN RAISE EXCEPTION '0377: est_duration is still %', t; END IF;
    RAISE NOTICE '0377 verified: recurring_work estimates are numeric(8,2)';
END $$;

COMMIT;
