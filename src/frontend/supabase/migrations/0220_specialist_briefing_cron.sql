-- ═══════════════════════════════════════════════════════════════
-- 0220 — Specialist Phase 2: scheduled Monday briefing
--
-- Schedules the specialist-briefing edge function every Monday
-- 06:00 UTC (07:00 WAT) via pg_cron + pg_net. The function runs the
-- reliability_digest agent, logs the run, and emails the briefing
-- through the notification outbox (0199) / notify-dispatch.
--
-- The cron job authenticates with the x-cron-key header, read at
-- fire time from Vault secret 'briefing_cron_key' — the key itself
-- is NEVER stored in this migration. Operational setup (one-time,
-- outside the repo):
--   1. SELECT vault.create_secret('<key>', 'briefing_cron_key');
--   2. supabase secrets set BRIEFING_CRON_KEY=<same key>
--   3. supabase functions deploy specialist-briefing --no-verify-jwt
-- If the vault secret is missing the POST carries a null key and the
-- function answers 401 — a safe no-op.
-- ═══════════════════════════════════════════════════════════════
BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Scheduled agent runs have no human session — allow system rows in
-- the AI audit log (username carries the actor: 'specialist-scheduler').
ALTER TABLE ers_ai_audit_log ALTER COLUMN user_id DROP NOT NULL;

-- Idempotent (re)schedule.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'specialist-monday-briefing') THEN
        PERFORM cron.unschedule('specialist-monday-briefing');
    END IF;
END $$;

SELECT cron.schedule(
    'specialist-monday-briefing',
    '0 6 * * 1',  -- Monday 06:00 UTC = 07:00 WAT
    $$
    SELECT net.http_post(
        url     := 'https://hacrebcfvyqdnjvilhqc.supabase.co/functions/v1/specialist-briefing',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-cron-key', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'briefing_cron_key')
        ),
        body    := '{}'::jsonb
    );
    $$
);

COMMIT;
