-- 0236 — Sensor time-series store + collector authentication
-- ═══════════════════════════════════════════════════════════════════════════
-- Two gaps closed, both prerequisites for streaming sensor data:
--
-- 1. ers_sensor_readings holds ONE row per (asset, tag) with a 50-point rolling
--    JSONB array. That is a latest-state projection, not history — a stream at
--    even 1/minute discards everything older than 50 samples. This adds a real
--    append-only points table beside it.
--
--    ers_sensor_readings is deliberately LEFT ALONE: Predict, the digital twin,
--    the CSV importer and PredictionService all read it. It stays the fast
--    "current value + sparkline" projection; writers now append to both.
--
-- 2. ingest-readings authenticated against a single global INGEST_API_KEY, so
--    every collector everywhere would share one secret with no revocation and
--    no attribution. This adds per-collector keys: hashed at rest, revocable
--    individually, with a last-seen heartbeat.

-- ── 1. Append-only sensor time-series ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS ers_sensor_reading_points (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    asset_id    UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    tag         TEXT NOT NULL,
    ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    value       NUMERIC(18,6) NOT NULL,
    unit        TEXT,
    -- which writer produced this point: 'sensor-sync' | 'ingest' | 'csv' | 'manual'
    source      TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The query every consumer makes: one tag's history, newest first.
CREATE INDEX IF NOT EXISTS idx_reading_points_asset_tag_ts
    ON ers_sensor_reading_points (asset_id, tag, ts DESC);
-- Retention sweeps and cross-asset time windows.
CREATE INDEX IF NOT EXISTS idx_reading_points_ts
    ON ers_sensor_reading_points (ts);

-- A source that re-reports the same instant (a retried poll, a replayed batch)
-- must not double-count. Same (asset, tag, ts) = same observation.
CREATE UNIQUE INDEX IF NOT EXISTS uq_reading_points_asset_tag_ts
    ON ers_sensor_reading_points (asset_id, tag, ts);

COMMENT ON TABLE ers_sensor_reading_points IS
    'Append-only sensor history. ers_sensor_readings remains the latest-value projection that Predict reads; this is the series behind it.';

ALTER TABLE ers_sensor_reading_points ENABLE ROW LEVEL SECURITY;

-- Matches the access pattern already used for ers_sensor_readings: readable by
-- any authenticated user, written by the service role (the sync workers).
DROP POLICY IF EXISTS "auth_select_reading_points" ON ers_sensor_reading_points;
CREATE POLICY "auth_select_reading_points" ON ers_sensor_reading_points
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_insert_reading_points" ON ers_sensor_reading_points;
CREATE POLICY "auth_insert_reading_points" ON ers_sensor_reading_points
    FOR INSERT TO authenticated WITH CHECK (true);

GRANT SELECT, INSERT ON ers_sensor_reading_points TO authenticated;
GRANT ALL ON ers_sensor_reading_points TO service_role;
GRANT USAGE, SELECT ON SEQUENCE ers_sensor_reading_points_id_seq TO authenticated, service_role;

-- ── 2. Retention ───────────────────────────────────────────────────────────
-- Raw points are cheap but not free. Default: keep 90 days. Call from cron:
--   select cron.schedule('sensor-points-retention','0 3 * * *',
--     $$select ers_prune_reading_points(90)$$);
CREATE OR REPLACE FUNCTION ers_prune_reading_points(keep_days INT DEFAULT 90)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    removed BIGINT;
BEGIN
    DELETE FROM ers_sensor_reading_points
     WHERE ts < NOW() - (keep_days || ' days')::INTERVAL;
    GET DIAGNOSTICS removed = ROW_COUNT;
    RETURN removed;
END;
$$;

COMMENT ON FUNCTION ers_prune_reading_points IS
    'Deletes sensor points older than keep_days. Schedule daily once streaming sources are connected.';

-- ── 3. Per-collector API keys ──────────────────────────────────────────────
-- The ERS Collector runs inside a customer network and pushes to the
-- ingest-readings function. Each install gets its own key so one can be revoked
-- without cutting off the rest, and so writes are attributable.
CREATE TABLE IF NOT EXISTS ers_collector_keys (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL,
    -- First 8 chars of the key, stored plainly so a key can be identified in
    -- the UI without being able to reconstruct it.
    key_prefix    TEXT NOT NULL,
    -- SHA-256 of the full key, lowercase hex. The key itself is shown once at
    -- mint time and never stored.
    key_hash      TEXT NOT NULL UNIQUE,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    last_seen_at  TIMESTAMPTZ,
    readings_count BIGINT NOT NULL DEFAULT 0,
    note          TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by    UUID
);

CREATE INDEX IF NOT EXISTS idx_collector_keys_hash
    ON ers_collector_keys (key_hash) WHERE is_active;

COMMENT ON TABLE ers_collector_keys IS
    'Per-collector credentials for the ingest-readings push endpoint. Keys are hashed; revoke by setting is_active=false.';

ALTER TABLE ers_collector_keys ENABLE ROW LEVEL SECURITY;

-- Credentials are admin-only, reusing the is_admin() predicate from 0171 (it
-- matches the JWT email against users.email/username — users.id is NOT
-- auth.uid() in this schema, so a naive uid comparison would lock everyone out).
-- The ingest function reads these with the service role, which bypasses RLS, so
-- no authenticated client ever needs the hashes.
DROP POLICY IF EXISTS "admin_manage_collector_keys" ON ers_collector_keys;
CREATE POLICY "admin_manage_collector_keys" ON ers_collector_keys
    FOR ALL TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE ON ers_collector_keys TO authenticated;
GRANT ALL ON ers_collector_keys TO service_role;
