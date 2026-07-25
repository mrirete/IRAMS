-- ═══════════════════════════════════════════════════════════════
-- 0221 — Specialist Phase 3: write-back to the host CMMS
--
-- Mode A (the Specialist running on someone else's CMMS) is only
-- sellable if approved work reaches THEIR system — the market
-- rejects advice-only tools. Phase 1 brought data in; this sends
-- drafted work back out.
--
--   1. writeback_targets — an outbound endpoint on the customer's
--      CMMS. Deliberately a separate table from `connectors`
--      (0202): sensor-sync polls every active row of type
--      rest_api/weather_api with a GET, so an outbound row parked
--      there would be fetched as if it were a sensor feed.
--   2. writeback_log — one row per delivery attempt, with a
--      PARTIAL UNIQUE index on successful sends so a proposal can
--      be retried after a failure but never delivered twice.
--
-- Credentials: prefer config.auth.secret_env (the NAME of a
-- Supabase function secret the edge function reads at send time),
-- so the token is never stored in a table. config.headers stays
-- supported for parity with sensor-sync, but the UI marks it as
-- stored-in-database.
-- ═══════════════════════════════════════════════════════════════
BEGIN;

-- ── 1. Outbound targets ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS writeback_targets (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL,
    system        TEXT NOT NULL DEFAULT 'generic'
                  CHECK (system IN ('generic','sap_pm','maximo','maintainx','other')),
    endpoint_url  TEXT NOT NULL,
    method        TEXT NOT NULL DEFAULT 'POST'
                  CHECK (method IN ('POST','PUT')),
    -- {headers:{}, auth:{secret_env,scheme}, wrap_key, extra:{}}
    config        JSONB NOT NULL DEFAULT '{}',
    is_active     BOOLEAN NOT NULL DEFAULT false,
    last_delivery_at TIMESTAMPTZ,
    last_status   TEXT,
    last_error    TEXT,
    created_by    UUID,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE writeback_targets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auth_select_writeback_targets  ON writeback_targets;
DROP POLICY IF EXISTS admin_insert_writeback_targets ON writeback_targets;
DROP POLICY IF EXISTS admin_update_writeback_targets ON writeback_targets;
DROP POLICY IF EXISTS admin_delete_writeback_targets ON writeback_targets;
-- Reads open to authenticated; writes admin-only — pointing the Specialist at
-- an outbound endpoint is an administrative act.
CREATE POLICY auth_select_writeback_targets ON writeback_targets
    FOR SELECT TO authenticated USING (true);
CREATE POLICY admin_insert_writeback_targets ON writeback_targets
    FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY admin_update_writeback_targets ON writeback_targets
    FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY admin_delete_writeback_targets ON writeback_targets
    FOR DELETE TO authenticated USING (public.is_admin());

-- ── 2. Delivery log ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS writeback_log (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_id     UUID REFERENCES writeback_targets(id) ON DELETE CASCADE,
    proposal_id   UUID NOT NULL,           -- ers_agent_actions.id
    status        TEXT NOT NULL
                  CHECK (status IN ('sent','failed','dry_run','skipped')),
    http_status   INT,
    request_payload  JSONB,
    response_excerpt TEXT,
    error         TEXT,
    delivered_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_writeback_log_target
    ON writeback_log (target_id, delivered_at DESC);
CREATE INDEX IF NOT EXISTS idx_writeback_log_proposal
    ON writeback_log (proposal_id);

-- Idempotency: at most ONE successful delivery per (target, proposal).
-- Failed / dry-run attempts stay unconstrained so retries are allowed.
CREATE UNIQUE INDEX IF NOT EXISTS uq_writeback_sent_once
    ON writeback_log (target_id, proposal_id)
    WHERE status = 'sent';

ALTER TABLE writeback_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auth_select_writeback_log ON writeback_log;
-- Read-only to the app; rows are written exclusively by the
-- proposal-writeback edge function under the service role, so the
-- delivery trail cannot be forged or edited from a browser.
CREATE POLICY auth_select_writeback_log ON writeback_log
    FOR SELECT TO authenticated USING (true);

COMMIT;
