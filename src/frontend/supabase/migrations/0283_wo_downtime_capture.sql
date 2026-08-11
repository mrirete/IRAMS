-- 0283: Work-order downtime & malfunction capture (P0 reliability-data fix)
--
-- Problem: the completion flow had nowhere to put equipment-event data, so
-- MTTR/MTBF/availability were computed from paperwork dates (created_at /
-- closed_at) and actual_downtime_hrs (0079) was only ever written by the CSV
-- importer. The UI's Est. Downtime / actual-hours inputs saved into the void
-- because DataMapper never mapped them to columns (frontend fix ships with
-- this migration).
--
-- Adds to work_orders:
--   malfunction_start / malfunction_end  — equipment failure event window
--                                          (SAP AUSVN/AUSBS equivalents;
--                                          preferred MTBF basis over created_at)
--   breakdown                            — SAP MSAUS-style breakdown indicator
--                                          (true = function lost; null = not recorded)
--   actual_duration_hrs                  — order-level actual labour hours captured
--                                          at completion (job_tasks.actual_hours
--                                          remains the per-operation source)
--   est_downtime_hrs                     — planned downtime (previously a dead
--                                          UI control writing nowhere)
--
-- A BEFORE trigger derives actual_downtime_hrs from the malfunction window when
-- the technician entered the window but not the hours.
--
-- NOT touched here: sem_work_orders (0233) — it carries the 0261a DEFINER
-- tenant patch and is recreated by reading pg_get_viewdef, so extending it is
-- a deliberate separate change. Same for sem_asset_reliability (0234a), which
-- should adopt malfunction_start as its event basis in the KPI-unification pass.

ALTER TABLE public.work_orders
    ADD COLUMN IF NOT EXISTS malfunction_start   timestamptz,
    ADD COLUMN IF NOT EXISTS malfunction_end     timestamptz,
    ADD COLUMN IF NOT EXISTS breakdown           boolean,
    ADD COLUMN IF NOT EXISTS actual_duration_hrs numeric,
    ADD COLUMN IF NOT EXISTS est_downtime_hrs    numeric;

COMMENT ON COLUMN public.work_orders.malfunction_start
    IS 'Equipment malfunction start (ISO 14224 failure event time; SAP AUSVN). Preferred failure-event basis for MTBF over created_at.';
COMMENT ON COLUMN public.work_orders.malfunction_end
    IS 'Equipment back in service (SAP AUSBS). With malfunction_start, defines the outage window.';
COMMENT ON COLUMN public.work_orders.breakdown
    IS 'Breakdown indicator (SAP MSAUS): true = loss of required function. NULL = not recorded (legacy rows).';
COMMENT ON COLUMN public.work_orders.actual_duration_hrs
    IS 'Order-level actual labour hours entered at completion. Per-operation actuals live on job_tasks.actual_hours.';
COMMENT ON COLUMN public.work_orders.est_downtime_hrs
    IS 'Planned equipment downtime (hours) from planning. Actual is actual_downtime_hrs.';

-- Malfunction window must be ordered when both ends are present.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'work_orders_malfunction_window_chk'
    ) THEN
        ALTER TABLE public.work_orders
            ADD CONSTRAINT work_orders_malfunction_window_chk
            CHECK (
                malfunction_start IS NULL
                OR malfunction_end IS NULL
                OR malfunction_end >= malfunction_start
            );
    END IF;
END $$;

-- Derive actual_downtime_hrs from the malfunction window when not entered.
-- Only fills a NULL — a hand-entered value always wins.
CREATE OR REPLACE FUNCTION public.derive_wo_downtime()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
    IF NEW.actual_downtime_hrs IS NULL
       AND NEW.malfunction_start IS NOT NULL
       AND NEW.malfunction_end IS NOT NULL THEN
        NEW.actual_downtime_hrs :=
            ROUND(EXTRACT(EPOCH FROM (NEW.malfunction_end - NEW.malfunction_start)) / 3600.0, 2);
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_derive_wo_downtime ON public.work_orders;
CREATE TRIGGER trg_derive_wo_downtime
    BEFORE INSERT OR UPDATE ON public.work_orders
    FOR EACH ROW EXECUTE FUNCTION public.derive_wo_downtime();

-- Semantic catalog: document the new fields so agents can look them up.
INSERT INTO public.semantic_catalog
  (object_name, column_name, title, description, tags, owner, source_tables, iso_standard)
VALUES
  ('work_orders', 'malfunction_start', 'Malfunction Start',
   'Equipment malfunction start timestamp (SAP AUSVN equivalent). Use this — not created_at — as the ISO 14224 failure event time when present; created_at is only a paperwork proxy.',
   ARRAY['work_management','reliability','iso14224'], 'Reliability Engineering',
   ARRAY['work_orders'], 'ISO 14224'),
  ('work_orders', 'breakdown', 'Breakdown Indicator',
   'SAP MSAUS-style breakdown flag: true = loss of required function during the malfunction window. NULL on legacy rows means not recorded, not "no breakdown".',
   ARRAY['work_management','reliability','iso14224'], 'Reliability Engineering',
   ARRAY['work_orders'], 'ISO 14224')
ON CONFLICT DO NOTHING;
