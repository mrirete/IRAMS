-- 0202: Connector Hub goes live (C1).
--
-- The sensor-sync edge function has always been real — it reads active
-- REST connectors from a `connectors` table, pulls each source, and upserts
-- ers_sensor_readings. But migration 0177_connectors.sql shipped as an empty
-- file, so the table never existed and the Hub ran on mock cards. This
-- supersedes 0177: the schema below matches exactly what sensor-sync reads
-- and writes (config jsonb with url/method/headers/root/map; last_* status
-- columns; connector_sync_logs rows per run).

CREATE TABLE IF NOT EXISTS connectors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    type TEXT NOT NULL,                       -- 'rest_api' | 'weather_api' | future types
    is_active BOOLEAN NOT NULL DEFAULT false, -- drafts start inactive; activation flips this
    config JSONB NOT NULL DEFAULT '{}'::jsonb, -- sensor-sync shape + `source` (wizard fields)
    sync_interval_seconds INT NOT NULL DEFAULT 3600,
    last_sync TIMESTAMPTZ,
    last_status TEXT,                          -- 'ok' | 'error'
    last_error TEXT,
    records_synced NUMERIC NOT NULL DEFAULT 0,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS connector_sync_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connector_id UUID NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    status TEXT,                               -- 'ok' | 'error'
    records INT NOT NULL DEFAULT 0,
    message TEXT
);

CREATE INDEX IF NOT EXISTS idx_connector_sync_logs_connector
    ON connector_sync_logs (connector_id, started_at DESC);

-- Same posture as the rest of the admin config tables (0150 pattern):
-- authenticated users manage connectors; sensor-sync writes via service role.
ALTER TABLE connectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_sync_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "connectors_auth_all" ON connectors;
CREATE POLICY "connectors_auth_all" ON connectors
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "connector_sync_logs_auth_read" ON connector_sync_logs;
CREATE POLICY "connector_sync_logs_auth_read" ON connector_sync_logs
    FOR SELECT TO authenticated USING (true);
