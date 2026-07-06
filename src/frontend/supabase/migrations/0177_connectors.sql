-- 0177 — Real connector registry for the sensor-sync Edge Function.
-- Replaces the mock Connector Hub data with a real table the function reads to
-- know which REST/weather sources to pull, and writes sync status back to.
-- Atomic: Supabase's SQL editor runs statements individually, so wrap in a txn.
BEGIN;

CREATE TABLE IF NOT EXISTS connectors (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                  TEXT NOT NULL,
    type                  TEXT NOT NULL,                    -- 'rest_api' | 'weather_api'
    is_active             BOOLEAN DEFAULT TRUE,
    config                JSONB NOT NULL DEFAULT '{}'::jsonb, -- { url, headers, root, map }
    sync_interval_seconds INTEGER DEFAULT 3600,
    last_sync             TIMESTAMPTZ,
    last_status           TEXT,                             -- 'ok' | 'error'
    last_error            TEXT,
    records_synced        BIGINT DEFAULT 0,
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS connector_sync_logs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connector_id UUID REFERENCES connectors(id) ON DELETE CASCADE,
    started_at   TIMESTAMPTZ DEFAULT NOW(),
    finished_at  TIMESTAMPTZ,
    status       TEXT,                                     -- 'ok' | 'error'
    records      INTEGER DEFAULT 0,
    message      TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_logs_connector ON connector_sync_logs(connector_id, started_at DESC);

-- RLS: authenticated users read; only admins write from the app. The Edge
-- Function uses the service-role key, which bypasses RLS, so it can still sync.
ALTER TABLE connectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_sync_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS connectors_read ON connectors;
CREATE POLICY connectors_read ON connectors FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS connectors_admin_write ON connectors;
CREATE POLICY connectors_admin_write ON connectors FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS sync_logs_read ON connector_sync_logs;
CREATE POLICY sync_logs_read ON connector_sync_logs FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS sync_logs_admin_write ON connector_sync_logs;
CREATE POLICY sync_logs_admin_write ON connector_sync_logs FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

COMMIT;
