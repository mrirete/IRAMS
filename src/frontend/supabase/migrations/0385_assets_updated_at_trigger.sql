-- 0385 — assets.updated_at must actually change when an asset changes.
--
-- Found by the live-link UAT (2026-09-22): the column exists, defaults to
-- now() on insert, and is then never touched — no trigger, and the app does
-- not set it. The live link captures change by watermark on updated_at
-- (docs/SAP-Live-Link-Plan.md §2.2), so an equipment renamed in IREAMS was
-- never sent, and "both sides changed" could never be detected: SAP's edit
-- simply won every time, with nothing queued for a person.
--
-- The fix is the same trigger the other maintained tables carry
-- (set_updated_at_col, 0187-era). Nothing is backfilled: an old row's
-- updated_at is still the last moment it was known to change, which is the
-- honest value.

DROP TRIGGER IF EXISTS set_updated_at ON public.assets;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.assets
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_col();

-- VERIFY (after apply):
--   SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.assets'::regclass AND tgname = 'set_updated_at';
