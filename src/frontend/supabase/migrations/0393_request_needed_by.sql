-- 0393 — A work request can say when the work is needed by.
--
-- WHY
-- Predict raises a work request from an alert (0391) and can now suggest a
-- date: the day the fitted health trend (0392) or the remaining-life estimate
-- reaches the failure limit, less the planning lead time. A request had no
-- date column, so the date was lost at the request and the converted work
-- order had no due date to schedule against — the P-F interval ended at a
-- description line.
--
-- WHAT
--   service_requests.needed_by DATE (nullable). Written by the Raise form when
--   it shows a "Needed by" date; approveRequestAndConvert copies it into the
--   work order's due_date. The screen also appends "Needed by: <date>" to the
--   description, so a tenant without this column loses nothing but the field.
--
-- No policy change: the column rides the existing service_requests policies.
BEGIN;

ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS needed_by DATE;

COMMENT ON COLUMN public.service_requests.needed_by IS
  'Date the work is needed by (0393). Copied to work_orders.due_date on conversion.';

COMMIT;
