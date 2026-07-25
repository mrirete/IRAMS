-- ═══════════════════════════════════════════════════════════════
-- 0223 — Make the Monday-briefing cron tenant-portable
--
-- 0220 hardcoded the origin project's URL into the cron command:
--
--     url := 'https://hacrebcfvyqdnjvilhqc.supabase.co/functions/v1/...'
--
-- Harmless while one deployment existed, but under deployment-per-tenant
-- (one Supabase project per customer) EVERY new tenant would replay 0220
-- and schedule a job pointing at the ORIGIN project rather than its own.
--
-- Forward-only fix — 0220 is left untouched so already-applied databases
-- keep a matching checksum in the migration ledger. Fresh projects run
-- 0220 (wrong URL) then immediately this one (correct), so the incorrect
-- schedule never survives provisioning.
--
-- The URL now comes from Vault secret 'project_url', set per project
-- during provisioning:
--     SELECT vault.create_secret('https://<ref>.supabase.co', 'project_url');
-- If it is missing the job posts to NULL and does nothing — a visible
-- no-op rather than a cross-tenant call.
-- ═══════════════════════════════════════════════════════════════
BEGIN;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'specialist-monday-briefing') THEN
        PERFORM cron.unschedule('specialist-monday-briefing');
    END IF;
END $$;

SELECT cron.schedule(
    'specialist-monday-briefing',
    '0 6 * * 1',  -- Monday 06:00 UTC
    $$
    SELECT net.http_post(
        url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
                   || '/functions/v1/specialist-briefing',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-cron-key', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'briefing_cron_key')
        ),
        body    := '{}'::jsonb
    );
    $$
);

COMMIT;
