-- ============================================================================
-- 0310 — Launch blockers (RELANTERN-LR-01, 2026-09-03)
--
-- Part A — Self-serve trial: companies.trial_ends_at. signup-tenant now
--   provisions the PROFESSIONAL tier with a 30-day trial so the onboarding
--   path (maturity intake, Specialist, import wizard) is reachable; the
--   nightly sweep drops an expired trial to 'starter'. The 0278 tier-pin
--   trigger only blocks tier changes from a user session; the sweep is
--   sessionless, so it may change the tier. Sales still moves plans by hand.
--
-- Part B — Forced password change: users.must_change_password. Admin-granted
--   accounts get a random temporary password and this flag; the app forces a
--   change on first sign-in and clears the flag through a SECURITY DEFINER
--   function that only clears the CALLER's own flag.
--
-- Part C — Completion gates in the database. The TECO failure-coding rule and
--   the criticality-A cancel sign-off were enforced only in the browser. They
--   are now BEFORE UPDATE triggers on work_orders, scoped to interactive user
--   sessions (auth.uid() IS NOT NULL): imports and the sync API run without a
--   user session and load historical CLOSED orders with honest NULL failure
--   codes, and must keep doing so.
--
-- Part D — Operations health: ops_health() (admin-only, SECURITY DEFINER)
--   exposes cron run outcomes, outbox failures, error-log volume and the last
--   briefing so a silent no-op is visible in the app.
-- ============================================================================

BEGIN;

-- ── Part A: trial ────────────────────────────────────────────────────────────
ALTER TABLE public.companies
    ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;
COMMENT ON COLUMN public.companies.trial_ends_at IS
    'Self-serve tenants start on the professional tier until this date; trial_expiry_sweep() then sets tier = starter. NULL = not on trial.';

CREATE OR REPLACE FUNCTION public.trial_expiry_sweep()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE n integer;
BEGIN
    UPDATE public.companies
       SET tier = 'starter', trial_ends_at = NULL, updated_at = now()
     WHERE trial_ends_at IS NOT NULL
       AND trial_ends_at < now()
       AND tier <> 'enterprise';
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.trial_expiry_sweep() FROM public, anon, authenticated;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RAISE NOTICE '0310: pg_cron absent — schedule trial-expiry-sweep manually on this project.';
        RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'trial-expiry-sweep') THEN
        PERFORM cron.unschedule('trial-expiry-sweep');
    END IF;
    PERFORM cron.schedule('trial-expiry-sweep', '50 3 * * *', 'SELECT public.trial_expiry_sweep()');
END $$;

-- ── Part B: forced password change ──────────────────────────────────────────
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.users.must_change_password IS
    'Set when an administrator issues a temporary password. The app forces a change on the next sign-in and clears it via clear_must_change_password().';

CREATE OR REPLACE FUNCTION public.clear_must_change_password()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
    UPDATE public.users SET must_change_password = false WHERE id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.clear_must_change_password() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.clear_must_change_password() TO authenticated;

-- ── Part C: completion gates ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wo_completion_gates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    new_status text := upper(coalesce(NEW.status::text, ''));
    old_status text := upper(coalesce(OLD.status::text, ''));
    crit       text;
    has_mode   boolean;
BEGIN
    -- Interactive sessions only: imports, the sync API and cron run sessionless.
    IF auth.uid() IS NULL OR new_status = old_status THEN
        RETURN NEW;
    END IF;

    -- Gate 1 — corrective work cannot reach technical/business completion
    -- without a failure mode (ISO 14224). Same preventive family as
    -- eam/lib/workOrder.ts and sem_asset_reliability.
    IF new_status IN ('TECO', 'CLOSED')
       AND upper(coalesce(NEW.type, '')) !~ '(PREVENT|PREDICT|INSPECT|SCHEDUL|CALIB|\mPM\M|\mPDM\M)' THEN
        SELECT EXISTS (
            SELECT 1 FROM public.wo_failure_data fd
             WHERE fd.wo_id = NEW.id AND fd.failure_mode_code IS NOT NULL
               AND upper(fd.failure_mode_code) <> 'UNKNOWN'
        ) INTO has_mode;
        IF NOT has_mode THEN
            RAISE EXCEPTION 'TECO_BLOCKED: corrective work order % cannot be set to % without a failure mode (wo_failure_data.failure_mode_code).',
                coalesce(NEW.wo_number, NEW.id::text), new_status
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    -- Gate 2 — cancelling work on a criticality-A asset needs a stated reason
    -- (the gatekeeper protocol). The client stores it in properties.
    IF new_status LIKE 'CANC%' AND NEW.asset_id IS NOT NULL THEN
        SELECT a.criticality::text INTO crit FROM public.assets a WHERE a.id = NEW.asset_id;
        IF upper(coalesce(crit, '')) = 'A'
           AND coalesce(NEW.properties ->> 'rejection_reason', '') = '' THEN
            RAISE EXCEPTION 'GATEKEEPER_BLOCKED: work order % is on a criticality-A asset; a rejection reason and sign-off are required to cancel it.',
                coalesce(NEW.wo_number, NEW.id::text)
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS aa_wo_completion_gates ON public.work_orders;
CREATE TRIGGER aa_wo_completion_gates
    BEFORE UPDATE OF status ON public.work_orders
    FOR EACH ROW EXECUTE FUNCTION public.wo_completion_gates();

-- ── Part D: operations health ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ops_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    crons        jsonb := '[]'::jsonb;
    has_cron     boolean;
    out_failed   integer := 0;
    out_pending  integer := 0;
    err_24h      integer := 0;
    err_7d       integer := 0;
    last_brief   timestamptz;
    last_watch   timestamptz;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'ops_health: administrators only' USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') INTO has_cron;
    IF has_cron THEN
        SELECT coalesce(jsonb_agg(row_to_json(j)::jsonb ORDER BY j.jobname), '[]'::jsonb) INTO crons
          FROM (
            SELECT c.jobname, c.schedule, c.active,
                   r.status AS last_status, r.start_time AS last_run, r.return_message AS last_message
              FROM cron.job c
              LEFT JOIN LATERAL (
                    SELECT d.status, d.start_time, left(d.return_message, 300) AS return_message
                      FROM cron.job_run_details d
                     WHERE d.jobid = c.jobid
                     ORDER BY d.start_time DESC LIMIT 1
              ) r ON true
          ) j;
    END IF;

    BEGIN
        SELECT count(*) FILTER (WHERE status = 'FAILED'),
               count(*) FILTER (WHERE status = 'PENDING')
          INTO out_failed, out_pending
          FROM public.notification_outbox
         WHERE created_at > now() - interval '7 days';
    EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;

    BEGIN
        SELECT count(*) FILTER (WHERE created_at > now() - interval '24 hours'),
               count(*) FILTER (WHERE created_at > now() - interval '7 days')
          INTO err_24h, err_7d
          FROM public.error_logs
         WHERE severity IN ('error', 'critical');
    EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;

    BEGIN
        SELECT max(created_at) INTO last_brief FROM public.ers_ai_audit_log WHERE context_type = 'reliability_digest';
        SELECT max(created_at) INTO last_watch FROM public.ers_ai_audit_log WHERE username = 'specialist-watchdog' OR context_type = 'specialist_watchdog';
    EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;

    RETURN jsonb_build_object(
        'checked_at',      now(),
        'pg_cron',         has_cron,
        'crons',           crons,
        'outbox_failed_7d', out_failed,
        'outbox_pending',  out_pending,
        'errors_24h',      err_24h,
        'errors_7d',       err_7d,
        'last_briefing',   last_brief,
        'last_watchdog',   last_watch
    );
END $$;
REVOKE ALL ON FUNCTION public.ops_health() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ops_health() TO authenticated;

COMMIT;

-- VERIFY (after apply):
--   SELECT jobname, schedule FROM cron.job WHERE jobname = 'trial-expiry-sweep';
--   SELECT public.ops_health();   -- as an admin session
--   -- as a user: UPDATE work_orders SET status='TECO' WHERE id=<corrective WO without failure mode>  → TECO_BLOCKED
