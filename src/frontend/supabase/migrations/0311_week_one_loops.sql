-- ============================================================================
-- 0311 — Week-one loops (launch review, items outside the blocker list)
--
-- Part A — retention_sweep fix. The GDPR sweep has failed on every run since
--   0276 made audit_logs.company_id NOT NULL: the sweep is sessionless, so the
--   evidence row it writes had a NULL company_id. It now writes one evidence
--   row per active company (retention evidence is per tenant anyway).
--
-- Part B — PM Autopilot announces itself. An AFTER INSERT trigger on
--   work_orders raises a SCHEDULE_ALERT notification when a generated PM lands
--   (recurring_work_id set, created_by NULL = the sweep's signature), addressed
--   to every active PLANNER / SUPERVISOR / SYS_ADMIN of the tenant. Before this
--   nobody was told and "Autopilot isn't working" was the natural conclusion.
--
-- Part C — Goods issue as ONE transaction. ers_issue_work_order_parts(wo)
--   consumes planned parts, writes the 261 issues and flips the part rows
--   atomically; lib/goodsIssue.ts calls it first and keeps its four-step
--   client path only as a fallback. It also returns the items that fell to or
--   below their reorder point so the caller can raise STOCK_LOW / STOCK_OUT —
--   which used to fire only from a manual item-form save.
--
-- Part D — Seeded notification rules that could never fire. Five target
--   roles nobody can hold ("Storekeeper", "Finance", "Budget Holder", "Area
--   Authority", "HSE"): retargeted to real role codes (STOREKEEPER is a new
--   template in rolePermissions.ts). Five target modules that never raise
--   events (safety PTW ×2, assets criticality-A, analytics ×2): deactivated
--   with the reason in the description, so the Notification Config page tells
--   the truth instead of promising silence.
--
-- Part E — Tenant-portable registration for the three HTTP crons that had no
--   migration (detect-sweep-tick, notify-dispatch-sweep, sensor-sync-tick).
--   Uses Vault 'project_url' + 'anon_key' (they call verify_jwt functions).
--   Guarded: when either secret is missing the existing jobs are left alone
--   and a NOTICE says what to set — never a silent cross-tenant call.
-- ============================================================================

BEGIN;

-- ── Part A: retention sweep writes evidence per tenant ──────────────────────
CREATE OR REPLACE FUNCTION public.retention_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v jsonb := '{}'::jsonb;
    n int;
    c record;
BEGIN
    DELETE FROM public.notifications WHERE created_at < now() - interval '12 months';
    GET DIAGNOSTICS n = ROW_COUNT; v := v || jsonb_build_object('notifications', n);

    DELETE FROM public.notification_logs WHERE created_at < now() - interval '12 months';
    GET DIAGNOSTICS n = ROW_COUNT; v := v || jsonb_build_object('notification_logs', n);

    DELETE FROM public.notification_outbox WHERE created_at < now() - interval '12 months';
    GET DIAGNOSTICS n = ROW_COUNT; v := v || jsonb_build_object('notification_outbox', n);

    DELETE FROM public.ers_ai_audit_log WHERE created_at < now() - interval '12 months';
    GET DIAGNOSTICS n = ROW_COUNT; v := v || jsonb_build_object('ai_audit_log', n);

    UPDATE public.user_invites SET status = 'expired'
     WHERE status = 'pending' AND expires_at < now();

    DELETE FROM public.user_invites
     WHERE status IN ('expired', 'revoked') AND expires_at < now() - interval '90 days';
    GET DIAGNOSTICS n = ROW_COUNT; v := v || jsonb_build_object('invites', n);

    -- Sweep evidence, one row per tenant (audit_logs.company_id is NOT NULL
    -- since 0276 and this function has no session to default it from).
    FOR c IN SELECT id FROM public.companies WHERE active IS TRUE LOOP
        INSERT INTO public.audit_logs (table_name, record_id, action, changed_by, changes, company_id)
        VALUES ('retention_sweep', to_char(now(), 'YYYY-MM-DD'), 'RETENTION_SWEEP', NULL, v, c.id);
    END LOOP;

    RETURN v;
END $$;

-- ── Part B: generated PMs raise a notification ──────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_generated_pm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    u record;
    n int := 0;
BEGIN
    -- The Autopilot signature: schedule-linked, no human creator.
    IF NEW.recurring_work_id IS NULL OR NEW.created_by IS NOT NULL THEN
        RETURN NEW;
    END IF;
    FOR u IN
        SELECT id FROM public.users
         WHERE company_id = NEW.company_id
           AND coalesce(status, 'active') = 'active'
           AND roles ?| ARRAY['PLANNER', 'SUPERVISOR', 'SYS_ADMIN']
         LIMIT 25
    LOOP
        INSERT INTO public.notifications
            (recipient_id, title, message, severity, notification_type, module,
             entity_id, entity_type, entity_number, action_link, action_required, company_id)
        VALUES
            (u.id::text,
             'PM generated: ' || coalesce(NEW.wo_number, ''),
             left(coalesce(NEW.title, 'Preventive work order'), 180) ||
                 CASE WHEN NEW.due_date IS NOT NULL THEN ' — due ' || to_char(NEW.due_date, 'DD Mon') ELSE '' END,
             'INFO', 'SCHEDULE_ALERT', 'pm',
             NEW.id::text, 'WORK_ORDER', NEW.wo_number, '/work-orders/' || NEW.id::text, false, NEW.company_id);
        n := n + 1;
    END LOOP;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Never let a notification problem block the PM itself.
    RAISE NOTICE 'notify_generated_pm: % (WO %)', SQLERRM, NEW.wo_number;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS zz_notify_generated_pm ON public.work_orders;
CREATE TRIGGER zz_notify_generated_pm
    AFTER INSERT ON public.work_orders
    FOR EACH ROW EXECUTE FUNCTION public.notify_generated_pm();

-- ── Part C: atomic goods issue ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ers_issue_work_order_parts(p_wo_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
    part        record;
    loc         record;
    remaining   numeric;
    take        numeric;
    issued_parts int := 0;
    issued_qty  numeric := 0;
    already     int := 0;
    shortfalls  jsonb := '[]'::jsonb;
    touched     uuid[] := '{}';
    low_stock   jsonb := '[]'::jsonb;
BEGIN
    FOR part IN
        SELECT p.id, p.item_id, coalesce(p.quantity, 0)::numeric AS qty, coalesce(p.unit_cost, 0)::numeric AS unit_cost,
               p.is_planned, i.description
          FROM public.work_order_parts p
          LEFT JOIN public.inventory_items i ON i.id = p.item_id
         WHERE p.wo_id = p_wo_id
         ORDER BY p.id
    LOOP
        IF part.is_planned IS FALSE THEN already := already + 1; CONTINUE; END IF;   -- idempotent re-entry
        IF part.item_id IS NULL OR part.qty <= 0 THEN CONTINUE; END IF;

        remaining := part.qty;
        FOR loc IN
            SELECT id, location_id, coalesce(quantity, 0)::numeric AS quantity
              FROM public.inventory_stock
             WHERE item_id = part.item_id AND coalesce(quantity, 0) > 0
             ORDER BY quantity DESC, id
             FOR UPDATE
        LOOP
            EXIT WHEN remaining <= 0;
            take := LEAST(remaining, loc.quantity);
            UPDATE public.inventory_stock SET quantity = loc.quantity - take, updated_at = now() WHERE id = loc.id;
            INSERT INTO public.inventory_transactions
                (item_id, transaction_type, movement_type, wo_id, location_id, quantity, cost_at_time, timestamp)
            VALUES
                (part.item_id, 'ISSUE', '261', p_wo_id, loc.location_id, take, part.unit_cost, now());
            remaining := remaining - take;
        END LOOP;

        UPDATE public.work_order_parts SET is_planned = false, date_used = current_date WHERE id = part.id;
        issued_parts := issued_parts + 1;
        issued_qty := issued_qty + part.qty;
        IF remaining > 0 THEN
            shortfalls := shortfalls || jsonb_build_object('description', coalesce(part.description, 'part'), 'short', remaining);
        END IF;
        touched := array_append(touched, part.item_id);
    END LOOP;

    -- Reorder-point check on every item touched (netting open reservations is
    -- the client's job; on-hand vs min_level is the honest floor here).
    IF array_length(touched, 1) > 0 THEN
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'item_id', i.id, 'code', i.code, 'description', i.description,
                   'on_hand', s.on_hand, 'min_level', i.min_level)), '[]'::jsonb)
          INTO low_stock
          FROM public.inventory_items i
          JOIN LATERAL (SELECT coalesce(sum(quantity), 0)::numeric AS on_hand FROM public.inventory_stock WHERE item_id = i.id) s ON true
         WHERE i.id = ANY (SELECT DISTINCT unnest(touched))
           AND coalesce(i.min_level, 0) > 0
           AND s.on_hand <= i.min_level;
    END IF;

    RETURN jsonb_build_object(
        'issued_parts', issued_parts, 'issued_qty', issued_qty, 'already_issued', already,
        'shortfalls', shortfalls, 'low_stock', low_stock);
END $$;
REVOKE ALL ON FUNCTION public.ers_issue_work_order_parts(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ers_issue_work_order_parts(uuid) TO authenticated, service_role;

-- ── Part D: notification rules that could never fire ────────────────────────
-- Retarget role names to real role codes.
UPDATE public.notification_rules
   SET recipients = (
        SELECT coalesce(jsonb_agg(
            CASE WHEN r ->> 'type' = 'ROLE' THEN
                jsonb_set(r, '{targetId}', to_jsonb(
                    CASE upper(r ->> 'targetId')
                        WHEN 'STOREKEEPER'   THEN 'STOREKEEPER'
                        WHEN 'FINANCE'       THEN 'MANAGER'
                        WHEN 'BUDGET HOLDER' THEN 'MANAGER'
                        WHEN 'AREA AUTHORITY' THEN 'SUPERVISOR'
                        WHEN 'HSE'           THEN 'SUPERVISOR'
                        WHEN 'PLANNER'       THEN 'PLANNER'
                        WHEN 'SUPERVISOR'    THEN 'SUPERVISOR'
                        WHEN 'TECHNICIAN'    THEN 'TECHNICIAN'
                        WHEN 'MANAGER'       THEN 'MANAGER'
                        WHEN 'RELIABILITY ENGINEER' THEN 'RELIABILITY_ENG'
                        WHEN 'RELIABILITY_ENG' THEN 'RELIABILITY_ENG'
                        ELSE upper(replace(r ->> 'targetId', ' ', '_'))
                    END))
            ELSE r END), '[]'::jsonb)
          FROM jsonb_array_elements(recipients) r)
 WHERE recipients IS NOT NULL AND jsonb_typeof(recipients) = 'array';

-- Deactivate rules whose module never raises the event, and say why.
UPDATE public.notification_rules
   SET is_active = false,
       description = '[Not wired — no event is raised for this yet] ' || regexp_replace(coalesce(description, ''), '^\[Not wired[^\]]*\] ', '')
 WHERE (module = 'safety' AND event_trigger IN ('PTW_APPROVAL_REQUIRED', 'PTW_EXPIRED', 'PTW_SUSPENDED'))
    OR (module = 'assets' AND event_trigger IN ('FAILURE_REPORTED', 'CRITICALITY_A_FAILURE'))
    OR (module = 'analytics')
    OR name IN ('Permit to Work Approval Required', 'PTW Expired or Suspended', 'Criticality A Asset Failure Reported',
                'AI Recommendation Available', 'Bad Actor - Defect Elimination Task');

-- ── Part E: portable registration of the anon-key HTTP crons ───────────────
DO $$
DECLARE
    v_url  text;
    v_anon text;
    spec   record;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RAISE NOTICE '0311: pg_cron absent — HTTP crons not registered on this project.';
        RETURN;
    END IF;
    SELECT decrypted_secret INTO v_url  FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1;
    SELECT decrypted_secret INTO v_anon FROM vault.decrypted_secrets WHERE name = 'anon_key'   LIMIT 1;
    IF v_url IS NULL OR v_anon IS NULL THEN
        RAISE NOTICE '0311: vault secrets project_url / anon_key not set — detect-sweep-tick, notify-dispatch-sweep and sensor-sync-tick left as they are. Set them (SELECT vault.create_secret(...)) and re-run this block on a new project.';
        RETURN;
    END IF;
    FOR spec IN
        SELECT * FROM (VALUES
            ('detect-sweep-tick',     '*/15 * * * *', 'detect-sweep'),
            ('notify-dispatch-sweep', '*/15 * * * *', 'notify-dispatch'),
            ('sensor-sync-tick',      '*/15 * * * *', 'sensor-sync')
        ) AS t(jobname, schedule, fn)
    LOOP
        IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = spec.jobname) THEN
            PERFORM cron.unschedule(spec.jobname);
        END IF;
        PERFORM cron.schedule(spec.jobname, spec.schedule, format(
            $c$ SELECT net.http_post(
                    url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/%s',
                    headers := jsonb_build_object('Content-Type', 'application/json',
                               'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key')),
                    body    := '{}'::jsonb) $c$, spec.fn));
    END LOOP;
END $$;

COMMIT;

-- VERIFY (after apply):
--   SELECT public.retention_sweep();                       -- returns counts, no error
--   SELECT name, is_active, recipients FROM notification_rules ORDER BY name;
--   SELECT jobname, schedule, left(command, 90) FROM cron.job ORDER BY jobname;
