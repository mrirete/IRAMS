-- 0390: a file load of raw readings can be undone by the tenant that made it.
--
-- WHY
-- ers_sensor_reading_points (0236) has SELECT + INSERT policies for
-- authenticated users and nothing for DELETE, and ers_reading_rollups_hourly
-- (0362) is SELECT-only. So seed-boiler-history.mjs --clean "deleted" 0 rows
-- without an error (PostgREST reports success on a policy-filtered delete),
-- the re-seed on 2026-09-24 landed beside the old series, and B-301 now holds
-- 432 060 points instead of 216 030. Any tenant that loads a CSV twice hits
-- the same thing and has no way back.
--
-- WHAT
-- DELETE for authenticated, scoped to the caller's company AND to points a
-- file load wrote (source 'csv' / 'csv-injected'). Collector-fed history
-- ('live' and friends) stays undeletable by users — a feed is evidence, a
-- file is a load you can redo. Rollups are a derived cache (the rollup
-- function upserts, it never removes), so they get the same company-scoped
-- delete; the next rollup pass rebuilds whatever the points still support.

DROP POLICY IF EXISTS "auth_delete_file_loaded_reading_points" ON public.ers_sensor_reading_points;
CREATE POLICY "auth_delete_file_loaded_reading_points" ON public.ers_sensor_reading_points
    FOR DELETE TO authenticated
    USING (
        company_id = (SELECT public.caller_company())
        AND source IN ('csv', 'csv-injected')
    );
GRANT DELETE ON public.ers_sensor_reading_points TO authenticated;

DROP POLICY IF EXISTS "auth_delete_reading_rollups" ON public.ers_reading_rollups_hourly;
CREATE POLICY "auth_delete_reading_rollups" ON public.ers_reading_rollups_hourly
    FOR DELETE TO authenticated
    USING (company_id = (SELECT public.caller_company()));
GRANT DELETE ON public.ers_reading_rollups_hourly TO authenticated;

COMMENT ON POLICY "auth_delete_file_loaded_reading_points" ON public.ers_sensor_reading_points IS
    'A tenant may remove points its own file loads wrote (source csv / csv-injected); collector-fed points are not user-deletable (0390).';
