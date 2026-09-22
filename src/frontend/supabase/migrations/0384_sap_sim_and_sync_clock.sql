-- 0384 — the SAP PM simulator's state, and the live link's clock.
--
-- sap_sim_entities is what the sap-sim edge function keeps: one row per
-- OData entity (equipment, functional location, later measuring points,
-- notifications, orders) per tenant, with the ETag S/4 would return and the
-- LastChangeDateTime the worker filters on. It is not a SAP. It is enough SAP
-- to prove the runtime, the conflict rule, the retry path and the exception
-- queue, and it is what every demo runs against until a client sandbox exists
-- (docs/SAP-Live-Link-Plan.md §2.5). Readable in the app so the Integrations
-- screen can show "what SAP has" beside "what IREAMS has"; written only by
-- the simulator under the service role.
--
-- erp-sync-tick calls the worker every five minutes with the project's cron
-- key, the way sensor-sync and erp-export are called. The worker decides per
-- target whether anything is due (poll_interval_minutes, is_active); the
-- clock only ticks.

CREATE TABLE IF NOT EXISTS public.sap_sim_entities (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id    uuid NOT NULL DEFAULT public.caller_company()
                  REFERENCES public.companies(id) ON DELETE CASCADE,
    entity_set    text NOT NULL
                  CHECK (entity_set IN ('A_Equipment', 'A_FunctionalLocation', 'A_MeasuringPoint',
                                        'A_MeasurementDocument', 'A_MaintenanceNotification', 'A_MaintenanceOrder')),
    entity_key    text NOT NULL,
    etag          integer NOT NULL DEFAULT 1,
    payload       jsonb NOT NULL,
    last_change_datetime timestamptz NOT NULL DEFAULT now(),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT sap_sim_entities_key_uq UNIQUE (company_id, entity_set, entity_key)
);

CREATE INDEX IF NOT EXISTS idx_sap_sim_entities_changed
    ON public.sap_sim_entities (company_id, entity_set, last_change_datetime);

COMMENT ON TABLE public.sap_sim_entities IS
    'State of the sap-sim edge function: one OData entity per row, per tenant, with ETag and LastChangeDateTime. A simulator for demos and tests, never a SAP.';

DROP TRIGGER IF EXISTS aa_stamp_tenant ON public.sap_sim_entities;
CREATE TRIGGER aa_stamp_tenant BEFORE INSERT ON public.sap_sim_entities
    FOR EACH ROW EXECUTE FUNCTION public.stamp_tenant();
DROP TRIGGER IF EXISTS set_updated_at ON public.sap_sim_entities;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.sap_sim_entities
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_col();

ALTER TABLE public.sap_sim_entities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sap_sim_entities_select ON public.sap_sim_entities;
CREATE POLICY sap_sim_entities_select ON public.sap_sim_entities
    FOR SELECT TO authenticated
    USING (company_id = (SELECT public.caller_company()));

GRANT SELECT ON public.sap_sim_entities TO authenticated;
GRANT ALL ON public.sap_sim_entities TO service_role;

-- ── The clock ──────────────────────────────────────────────────────────────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'erp-sync-tick') THEN
        PERFORM cron.unschedule('erp-sync-tick');
    END IF;
END $$;

SELECT cron.schedule(
    'erp-sync-tick',
    '*/5 * * * *',
    $$
    SELECT net.http_post(
        url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
                   || '/functions/v1/erp-sync',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-cron-key', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'briefing_cron_key')
        ),
        body    := '{}'::jsonb
    );
    $$
);

-- ── Prove the boundary before returning ────────────────────────────────────
DO $$
DECLARE n int; sample text;
BEGIN
    SELECT count(*), min(object_name) INTO n, sample FROM public.tenancy_policy_gaps();
    IF n > 0 THEN
        RAISE EXCEPTION 'G4 reports % gap(s), e.g. % — refusing to commit', n, sample;
    END IF;
END $$;

-- VERIFY (after apply):
--   SELECT jobname, schedule FROM cron.job WHERE jobname = 'erp-sync-tick';
--   SELECT count(*) FROM public.tenancy_policy_gaps();   -- 0
