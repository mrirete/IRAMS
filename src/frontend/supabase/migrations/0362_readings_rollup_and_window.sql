-- 0362 — Readable signal history: hourly rollups + a windowed read for Predict and the agents
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY
-- 0236 gave the product a real time-series table (ers_sensor_reading_points,
-- 90-day raw retention) and every writer appends to it. Nothing reads it.
-- Predict, the digital twin and the alert scan all read the 50-point JSONB
-- projection on ers_sensor_readings; the agent tools read nothing at all.
-- "Rising for three weeks at constant load" is therefore unanswerable by any
-- layer of the system, and the Specialist can only reason about work orders.
--
-- WHAT
--   1. ers_reading_rollups_hourly — one row per (asset, tag, hour): n/min/avg/
--      max/last. Kept indefinitely (small: 10 tags x 8 760 h = 88k rows per
--      asset-year) so the long history survives the 90-day raw prune.
--   2. ers_rollup_reading_points(hours, company) — idempotent upsert of the
--      trailing window from raw points. Scheduled hourly; backfilled once here.
--      ers_rollup_my_reading_points(hours) is the tenant-scoped wrapper a
--      logged-in user may call after a bulk load (seed scripts, CSV import).
--   3. sem_readings_window(asset, tag, from, to, max_buckets) — the read.
--      Raw points when the window is <= 7 days, rollups otherwise; always
--      re-bucketed to at most max_buckets rows so an agent never pages through
--      a stream. SECURITY INVOKER: RLS on both tables scopes it to the caller's
--      tenant, so there is no company derivation to get wrong.
--   4. sem_readings_trend(days) — per (asset, tag) slope over the trailing
--      window, computed in one pass for the nightly watchdog.
--
-- WHAT THIS IS NOT
-- Not a historian. The plant's historian keeps years of raw data; this keeps
-- what the maintenance organisation chose to push, at the resolution they
-- pushed it, and makes that readable.

BEGIN;

-- ── 1. Hourly rollups ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ers_reading_rollups_hourly (
    asset_id    uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
    tag         text NOT NULL,
    bucket_ts   timestamptz NOT NULL,
    n           integer NOT NULL,
    min_value   numeric(18,6) NOT NULL,
    avg_value   numeric(18,6) NOT NULL,
    max_value   numeric(18,6) NOT NULL,
    last_value  numeric(18,6) NOT NULL,
    unit        text,
    company_id  uuid NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (asset_id, tag, bucket_ts)
);

CREATE INDEX IF NOT EXISTS idx_reading_rollups_asset_tag_ts
    ON public.ers_reading_rollups_hourly (asset_id, tag, bucket_ts DESC);
CREATE INDEX IF NOT EXISTS idx_reading_rollups_company_id
    ON public.ers_reading_rollups_hourly (company_id);

COMMENT ON TABLE public.ers_reading_rollups_hourly IS
    'Hourly n/min/avg/max/last per (asset, tag), derived from ers_sensor_reading_points by ers_rollup_reading_points(). Kept beyond the raw 90-day prune so trends stay readable.';

ALTER TABLE public.ers_reading_rollups_hourly ENABLE ROW LEVEL SECURITY;

-- Read-only for users; only the rollup function (service role / cron) writes.
DROP POLICY IF EXISTS "auth_select_reading_rollups" ON public.ers_reading_rollups_hourly;
CREATE POLICY "auth_select_reading_rollups" ON public.ers_reading_rollups_hourly
    FOR SELECT TO authenticated
    USING (company_id = (SELECT public.caller_company()));

GRANT SELECT ON public.ers_reading_rollups_hourly TO authenticated;
GRANT ALL    ON public.ers_reading_rollups_hourly TO service_role;

-- ── 2. Rollup function ─────────────────────────────────────────────────────
-- Trailing-window upsert. Re-running over the same hours is harmless: every
-- row is recomputed from raw and overwritten. company_id is copied from the
-- raw row (a fact about the data), never from the caller (0261 rule).
CREATE OR REPLACE FUNCTION public.ers_rollup_reading_points(p_hours integer DEFAULT 3, p_company uuid DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_since timestamptz := date_trunc('hour', now()) - make_interval(hours => GREATEST(1, COALESCE(p_hours, 3)));
    v_rows  bigint;
BEGIN
    INSERT INTO ers_reading_rollups_hourly
        (asset_id, tag, bucket_ts, n, min_value, avg_value, max_value, last_value, unit, company_id, updated_at)
    SELECT p.asset_id,
           p.tag,
           date_trunc('hour', p.ts)                             AS bucket_ts,
           count(*)::int                                        AS n,
           min(p.value)                                         AS min_value,
           avg(p.value)                                         AS avg_value,
           max(p.value)                                         AS max_value,
           (array_agg(p.value ORDER BY p.ts DESC))[1]           AS last_value,
           max(p.unit)                                          AS unit,
           p.company_id,
           now()
      FROM ers_sensor_reading_points p
     WHERE p.ts >= v_since
       AND p.company_id IS NOT NULL
       AND (p_company IS NULL OR p.company_id = p_company)
     GROUP BY p.asset_id, p.tag, date_trunc('hour', p.ts), p.company_id
    ON CONFLICT (asset_id, tag, bucket_ts) DO UPDATE
       SET n = EXCLUDED.n, min_value = EXCLUDED.min_value, avg_value = EXCLUDED.avg_value,
           max_value = EXCLUDED.max_value, last_value = EXCLUDED.last_value,
           unit = COALESCE(EXCLUDED.unit, ers_reading_rollups_hourly.unit),
           company_id = EXCLUDED.company_id, updated_at = now();
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

COMMENT ON FUNCTION public.ers_rollup_reading_points(integer, uuid) IS
    'Recomputes hourly rollups for the trailing p_hours from ers_sensor_reading_points (all tenants, or one when p_company is given). Idempotent. Scheduled hourly by readings-rollup-hourly.';

-- Writers only. Default EXECUTE->PUBLIC would let anon call a SECURITY DEFINER
-- writer (0361 lesson).
REVOKE ALL ON FUNCTION public.ers_rollup_reading_points(integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ers_rollup_reading_points(integer, uuid) TO service_role;

-- A logged-in user who has just bulk-loaded history (CSV import, a seed
-- script) may roll up their OWN tenant without waiting for the hourly cron.
-- Capped at 100 days: rollups are cheap but not free.
CREATE OR REPLACE FUNCTION public.ers_rollup_my_reading_points(p_hours integer DEFAULT 24)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company uuid := public.caller_company();
BEGIN
    IF v_company IS NULL THEN
        RAISE EXCEPTION 'ROLLUP_DENIED: no tenant on the session' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN public.ers_rollup_reading_points(LEAST(24 * 100, GREATEST(1, COALESCE(p_hours, 24))), v_company);
END;
$$;

REVOKE ALL ON FUNCTION public.ers_rollup_my_reading_points(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ers_rollup_my_reading_points(integer) TO authenticated, service_role;

-- ── 3. Windowed read ───────────────────────────────────────────────────────
-- SECURITY INVOKER on purpose: the caller's RLS on ers_sensor_reading_points /
-- ers_reading_rollups_hourly is the tenant boundary. Returns <= p_max_buckets
-- rows, oldest first. `source` says which table answered.
CREATE OR REPLACE FUNCTION public.sem_readings_window(
    p_asset_id    uuid,
    p_tag         text,
    p_from        timestamptz,
    p_to          timestamptz DEFAULT now(),
    p_max_buckets integer     DEFAULT 96
)
RETURNS TABLE (
    bucket_ts  timestamptz,
    n          integer,
    min_value  numeric,
    avg_value  numeric,
    max_value  numeric,
    last_value numeric,
    source     text
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
        -- Raw path: bucket width = span / max, floored to whole minutes.
        v_width_s := GREATEST(60, floor(v_span_s / v_max / 60) * 60);
        RETURN QUERY
        SELECT to_timestamp(floor(EXTRACT(EPOCH FROM p.ts) / v_width_s) * v_width_s) AS bucket_ts,
               count(*)::int,
               min(p.value), avg(p.value), max(p.value),
               (array_agg(p.value ORDER BY p.ts DESC))[1],
               'raw'::text
          FROM ers_sensor_reading_points p
         WHERE p.asset_id = p_asset_id
           AND lower(p.tag) = lower(p_tag)
           AND p.ts >= p_from AND p.ts < p_to
         GROUP BY 1
         ORDER BY 1;
    ELSE
        -- Rollup path: bucket width = span / max, ceiled to whole hours, so a
        -- 90-day window at 96 buckets reads as one row per ~23 h.
        v_width_s := GREATEST(3600, ceil(v_span_s / v_max / 3600) * 3600);
        RETURN QUERY
        SELECT to_timestamp(floor(EXTRACT(EPOCH FROM r.bucket_ts) / v_width_s) * v_width_s) AS bucket_ts,
               sum(r.n)::int,
               min(r.min_value),
               -- n-weighted mean of hourly means = mean of the underlying points
               sum(r.avg_value * r.n) / NULLIF(sum(r.n), 0),
               max(r.max_value),
               (array_agg(r.last_value ORDER BY r.bucket_ts DESC))[1],
               'rollup'::text
          FROM ers_reading_rollups_hourly r
         WHERE r.asset_id = p_asset_id
           AND lower(r.tag) = lower(p_tag)
           AND r.bucket_ts >= p_from AND r.bucket_ts < p_to
         GROUP BY 1
         ORDER BY 1;
    END IF;
END;
$$;

COMMENT ON FUNCTION public.sem_readings_window(uuid, text, timestamptz, timestamptz, integer) IS
    'Bucketed history for one (asset, tag): raw points for windows <= 7 days, hourly rollups beyond. <= p_max_buckets rows, oldest first. RLS-scoped (security invoker).';

REVOKE ALL ON FUNCTION public.sem_readings_window(uuid, text, timestamptz, timestamptz, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sem_readings_window(uuid, text, timestamptz, timestamptz, integer) TO authenticated, service_role;

-- ── 4. Fleet trend in one pass (watchdog) ──────────────────────────────────
-- Least-squares slope of the hourly means over the trailing p_days, per
-- (asset, tag). Needs >= 6 hourly rows so a two-sample "trend" cannot fire.
CREATE OR REPLACE FUNCTION public.sem_readings_trend(p_days integer DEFAULT 7)
RETURNS TABLE (
    asset_id       uuid,
    tag            text,
    unit           text,
    n_hours        integer,
    first_avg      numeric,
    last_avg       numeric,
    mean_value     numeric,
    slope_per_day  numeric,
    pct_change     numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    WITH w AS (
        SELECT r.asset_id, r.tag, r.unit, r.bucket_ts, r.avg_value,
               EXTRACT(EPOCH FROM r.bucket_ts) / 86400.0 AS t_days
          FROM ers_reading_rollups_hourly r
         WHERE r.bucket_ts >= now() - make_interval(days => GREATEST(1, COALESCE(p_days, 7)))
    ),
    agg AS (
        SELECT asset_id, tag, max(unit) AS unit, count(*)::int AS n_hours,
               regr_slope(avg_value::double precision, t_days::double precision)::numeric AS slope_per_day,
               avg(avg_value)                                                AS mean_value,
               (array_agg(avg_value ORDER BY bucket_ts ASC))[1]              AS first_avg,
               (array_agg(avg_value ORDER BY bucket_ts DESC))[1]             AS last_avg
          FROM w
         GROUP BY asset_id, tag
        HAVING count(*) >= 6
    )
    SELECT asset_id, tag, unit, n_hours, first_avg, last_avg, mean_value,
           slope_per_day,
           CASE WHEN first_avg IS NULL OR first_avg = 0 THEN NULL
                ELSE round(((last_avg - first_avg) / abs(first_avg)) * 100, 2) END AS pct_change
      FROM agg;
$$;

COMMENT ON FUNCTION public.sem_readings_trend(integer) IS
    'Per (asset, tag) slope and % change over the trailing p_days of hourly rollups. One pass for the watchdog. RLS-scoped (security invoker).';

REVOKE ALL ON FUNCTION public.sem_readings_trend(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sem_readings_trend(integer) TO authenticated, service_role;

-- ── 5. Backfill + schedule ─────────────────────────────────────────────────
-- Everything currently retained (<= 90 days + slack) becomes rollups now, so
-- the read works the moment this applies.
SELECT public.ers_rollup_reading_points(24 * 92, NULL);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'readings-rollup-hourly';
    PERFORM cron.schedule('readings-rollup-hourly', '7 * * * *', 'SELECT public.ers_rollup_reading_points(3, NULL)');
  END IF;
END $$;

COMMIT;

-- VERIFY (after apply):
--   SELECT count(*) FROM ers_reading_rollups_hourly;                                   -- >= 0, grows hourly
--   SELECT * FROM sem_readings_window('<asset uuid>', '<tag>', now() - interval '7 days') LIMIT 5;
--   SELECT jobname, schedule FROM cron.job WHERE jobname = 'readings-rollup-hourly';
