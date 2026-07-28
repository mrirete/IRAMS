-- ═══════════════════════════════════════════════════════════════
-- 0230 — Specialist Phase C1: nightly watchdog cron
--
-- Schedules specialist-watchdog (deterministic, zero-LLM sweep: emergent
-- bad-actor step changes, PM-effectiveness drift, data-quality regression
-- → proposals queue / audit log) every day at 05:30 UTC — before the
-- Monday 06:00 briefing so Monday's digest can already see what the
-- watchdog queued.
--
-- Tenant-portable from birth (the 0223 pattern): URL and key come from
-- Vault secrets 'project_url' and 'briefing_cron_key' — one shared cron
-- key for both scheduled functions. Idempotent: reschedules on replay.
-- ═══════════════════════════════════════════════════════════════
BEGIN;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'specialist-nightly-watchdog') THEN
        PERFORM cron.unschedule('specialist-nightly-watchdog');
    END IF;
END $$;

SELECT cron.schedule(
    'specialist-nightly-watchdog',
    '30 5 * * *',  -- daily 05:30 UTC
    $$
    SELECT net.http_post(
        url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
                   || '/functions/v1/specialist-watchdog',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-cron-key', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'briefing_cron_key')
        ),
        body    := '{}'::jsonb
    );
    $$
);

COMMIT;
