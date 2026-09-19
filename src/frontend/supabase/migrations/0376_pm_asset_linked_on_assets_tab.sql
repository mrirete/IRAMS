-- 0376 — a strategy can be created before its assets are linked
--
-- WHAT WAS WRONG
--   recurring_work.asset_id was NOT NULL (0001a), so the New Strategy form had
--   to demand one asset before the record could exist — wrong for a schedule
--   that can cover several, and the reason the form asked eleven questions
--   up front. The page already treats the column as derived: every save writes
--   it from the first entry of assigned_assets.
--
-- WHAT THIS DOES
--   Drops the NOT NULL. Nothing else changes: the Autopilot sweep already skips
--   a schedule whose asset_id is NULL ("skipped: no asset on schedule"), the
--   Generate dialog shows such a schedule blocked with the reason, the client
--   generator refuses it with a plain message, and work_orders.asset_id stays
--   NOT NULL as the backstop. Every reporting view LEFT JOINs the asset.
--
--   Must be applied BEFORE the matching client build is deployed: the new form
--   inserts asset_id NULL.
--
-- SAFE TO RE-RUN.

BEGIN;

ALTER TABLE public.recurring_work ALTER COLUMN asset_id DROP NOT NULL;

COMMENT ON COLUMN public.recurring_work.asset_id IS
    'Primary asset — mirrors assigned_assets[0] (the page keeps them in step). NULL since 0376 until an asset is linked on the Assets tab; nothing generates without one.';

DO $$
BEGIN
    IF (SELECT is_nullable FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'recurring_work' AND column_name = 'asset_id') <> 'YES' THEN
        RAISE EXCEPTION '0376: recurring_work.asset_id is still NOT NULL';
    END IF;
    RAISE NOTICE '0376 verified: recurring_work.asset_id nullable';
END $$;

COMMIT;
