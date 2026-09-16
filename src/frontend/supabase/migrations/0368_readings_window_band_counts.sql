-- 0368 — sem_readings_window counts samples against a band, so "how often" is exact
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY
-- The first live answer to "how often was the outlet steam temperature outside
-- 530–545 °C" (B-301, 2026-09-17) was 0 %. The truth is 8 %. The summariser
-- judged each bucket by its MEAN, and at 96 buckets over 7 days a bucket is
-- ~1.75 h — the real excursions are minute-scale dips to 517 °C that average
-- away inside it. A mean cannot see a short dip; only the samples can, and the
-- samples live here.
--
-- WHAT
-- sem_readings_window gains p_lo / p_hi (both optional). On the raw path each
-- bucket now also returns n_below / n_above — samples strictly outside the
-- band — so the caller's time share is a count, not an estimate. The rollup
-- path (windows > 7 days) has no samples and returns NULL for both, and the
-- summariser says "by bucket mean" when that is all it has.
--
-- Same name, replaced signature (not an overload — PostgREST would find two
-- candidates for a 5-argument call). Callers passing the original five named
-- arguments keep working through the defaults.

BEGIN;

DROP FUNCTION IF EXISTS public.sem_readings_window(uuid, text, timestamptz, timestamptz, integer);

CREATE OR REPLACE FUNCTION public.sem_readings_window(
    p_asset_id    uuid,
    p_tag         text,
    p_from        timestamptz,
    p_to          timestamptz DEFAULT now(),
    p_max_buckets integer     DEFAULT 96,
    p_lo          numeric     DEFAULT NULL,
    p_hi          numeric     DEFAULT NULL
)
RETURNS TABLE (
    bucket_ts  timestamptz,
    n          integer,
    min_value  numeric,
    avg_value  numeric,
    max_value  numeric,
    last_value numeric,
    source     text,
    n_below    integer,
    n_above    integer
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
    v_span_s  double precision := GREATEST(60, EXTRACT(EPOCH FROM (p_to - p_from)));
    v_max     integer := LEAST(1000, GREATEST(1, COALESCE(p_max_buckets, 96)));
    v_width_s double precision;
BEGIN
    IF p_asset_id IS NULL OR p_tag IS NULL OR p_from IS NULL OR p_to <= p_from THEN
        RETURN;
    END IF;

    IF v_span_s <= 7 * 86400 THEN
        v_width_s := GREATEST(60, floor(v_span_s / v_max / 60) * 60);
        RETURN QUERY
        SELECT to_timestamp(floor(EXTRACT(EPOCH FROM p.ts) / v_width_s) * v_width_s) AS bucket_ts,
               count(*)::int,
               min(p.value), avg(p.value), max(p.value),
               (array_agg(p.value ORDER BY p.ts DESC))[1],
               'raw'::text,
               CASE WHEN p_lo IS NULL THEN 0 ELSE count(*) FILTER (WHERE p.value < p_lo)::int END,
               CASE WHEN p_hi IS NULL THEN 0 ELSE count(*) FILTER (WHERE p.value > p_hi)::int END
          FROM ers_sensor_reading_points p
         WHERE p.asset_id = p_asset_id
           AND lower(p.tag) = lower(p_tag)
           AND p.ts >= p_from AND p.ts < p_to
         GROUP BY 1
         ORDER BY 1;
    ELSE
        v_width_s := GREATEST(3600, ceil(v_span_s / v_max / 3600) * 3600);
        RETURN QUERY
        SELECT to_timestamp(floor(EXTRACT(EPOCH FROM r.bucket_ts) / v_width_s) * v_width_s) AS bucket_ts,
               sum(r.n)::int,
               min(r.min_value),
               sum(r.avg_value * r.n) / NULLIF(sum(r.n), 0),
               max(r.max_value),
               (array_agg(r.last_value ORDER BY r.bucket_ts DESC))[1],
               'rollup'::text,
               NULL::int,
               NULL::int
          FROM ers_reading_rollups_hourly r
         WHERE r.asset_id = p_asset_id
           AND lower(r.tag) = lower(p_tag)
           AND r.bucket_ts >= p_from AND r.bucket_ts < p_to
         GROUP BY 1
         ORDER BY 1;
    END IF;
END;
$$;

COMMENT ON FUNCTION public.sem_readings_window(uuid, text, timestamptz, timestamptz, integer, numeric, numeric) IS
    'Bucketed history for one (asset, tag): raw points for windows <= 7 days (with n_below/n_above the optional band), hourly rollups beyond (band counts NULL). <= p_max_buckets rows, oldest first. RLS-scoped (security invoker).';

-- DROP + CREATE re-arms the default EXECUTE→PUBLIC (0361 lesson): revoke again.
REVOKE ALL ON FUNCTION public.sem_readings_window(uuid, text, timestamptz, timestamptz, integer, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sem_readings_window(uuid, text, timestamptz, timestamptz, integer, numeric, numeric) TO authenticated, service_role;

COMMIT;

-- VERIFY (after apply):
--   SELECT sum(n) AS samples, sum(n_below + n_above) AS outside
--     FROM sem_readings_window('<B-301 uuid>', 'TE_8332A', now() - interval '7 days', now(), 96, 530, 545);
--   -- expect outside/samples ≈ 0.08 on the boiler demo (paper: 8.6 % at 5 s)
--   SELECT has_function_privilege('anon', 'public.sem_readings_window(uuid,text,timestamptz,timestamptz,integer,numeric,numeric)', 'EXECUTE');  -- false
