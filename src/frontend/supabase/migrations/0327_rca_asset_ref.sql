-- 0327 — ers_rca_investigations.asset_ref: the asset as typed when it is not in the register.
--
-- asset_id has been nullable since 0117, but the only place a free-text asset could go
-- was event_what, which the Define Problem form now uses for the failed COMPONENT. Give
-- the manual asset its own column so the two are never conflated again. Free text on
-- purpose (no FK): the whole point is that the register has no row for it yet.
BEGIN;

ALTER TABLE public.ers_rca_investigations
  ADD COLUMN IF NOT EXISTS asset_ref TEXT;

COMMENT ON COLUMN public.ers_rca_investigations.asset_ref IS
  'Asset as typed by the investigator when no register row was linked (asset_id NULL). Free text by design.';

COMMIT;
