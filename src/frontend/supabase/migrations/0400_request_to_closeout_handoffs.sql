-- ============================================================================
-- 0400 — Request → work order → close-out: every hand-off reaches its owner
--
-- Found 2026-10-03 walking one Emergency request (REQ-2026-072790 on B-301)
-- through to its work order:
--   • authorizing a request told only the requester — the people who hold the
--     NEXT step (authorizers, then approvers) heard nothing;
--   • rule notices were never marked "action required" (the flag was tied to
--     three event names nothing emits);
--   • an Emergency request became a HIGH order due in 7 days: the order lead
--     times ran on a different scale from the request response targets;
--   • one person could authorize AND approve a high-consequence job, and the
--     database accepted a conversion from any status;
--   • a request could pass its response target with nobody told;
--   • the requester never heard the work was done, and finance never heard an
--     accepted order was ready to close.
--
-- Parts: A rule flag · B lead times · C hand-off rules · D request workflow
-- guard · E response-target escalation (pg_cron).
-- ============================================================================

BEGIN;

-- ── A. Rules say whether the reader must act ────────────────────────────────
ALTER TABLE public.notification_rules
    ADD COLUMN IF NOT EXISTS action_required boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.notification_rules.action_required IS
    '0400: notices from this rule are hand-offs the recipient must act on (shown as action-required in the bell).';

-- ── B. One priority scale for requests and orders ───────────────────────────
-- Request response targets (lib/requestPriority.ts): EMERGENCY 4 h, HIGH 24 h,
-- MEDIUM 72 h, LOW 7 d. The order's required-by now follows the same ladder
-- one step out: EMERGENCY 4 h, HIGH 1 d, MEDIUM 7 d, LOW 30 d.
CREATE OR REPLACE FUNCTION public.priority_lead_interval(p_code text)
RETURNS interval LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE upper(coalesce(p_code, ''))
        WHEN 'P1' THEN interval '4 hours'
        WHEN 'EMERGENCY' THEN interval '4 hours'
        WHEN 'CRITICAL' THEN interval '4 hours'
        WHEN 'P2' THEN interval '1 day'
        WHEN 'URGENT' THEN interval '1 day'
        WHEN 'HIGH' THEN interval '1 day'
        WHEN 'P3' THEN interval '7 days'
        WHEN 'MEDIUM' THEN interval '7 days'
        WHEN 'NORMAL' THEN interval '7 days'
        WHEN 'P4' THEN interval '30 days'
        WHEN 'LOW' THEN interval '30 days'
        WHEN 'P5' THEN interval '90 days'
        ELSE interval '7 days' END;
$$;

-- Orders raised from an Emergency request that the old conversion filed as
-- HIGH, and that nobody has started: give them their real priority and date.
UPDATE public.work_orders w
   SET priority_code = 'EMERGENCY',
       required_by   = w.created_at + interval '4 hours'
  FROM public.service_requests r
 WHERE r.id = w.request_id
   AND r.risk_score >= 40
   AND upper(coalesce(w.priority_code, '')) = 'HIGH'
   AND upper(w.status::text) IN ('OPEN', 'PLAN');

-- ── C. Hand-off rules, one set per active company ───────────────────────────
INSERT INTO public.notification_rules
    (name, description, module, event_trigger, is_active, severity, filters, recipients, channels,
     escalation_timeout_minutes, escalation_recipient_role, action_required, company_id)
SELECT r.name, r.description, r.module, r.event_trigger, true, r.severity, r.filters::jsonb, r.recipients::jsonb,
       '["IN_APP"]'::jsonb, r.esc_minutes, r.esc_role, r.action_required, c.id
  FROM public.companies c
 CROSS JOIN (VALUES
    -- the next actor
    ('WR Awaiting Authorization',
     'A work request has been reviewed and is waiting for you to authorize it',
     'requests', 'SR_STATUS_CHANGE', 'INFO',
     '[{"field":"status","operator":"EQUALS","value":"REVIEW"}]',
     '[{"type":"ROLE","targetId":"SUPERVISOR"}]',
     240, 'MANAGER', true),
    ('WR Authorized — Approve and Raise the Order',
     'A work request is authorized and is waiting for approval to become a work order',
     'requests', 'SR_STATUS_CHANGE', 'INFO',
     '[{"field":"status","operator":"EQUALS","value":"AUTHORIZED"}]',
     '[{"type":"ROLE","targetId":"PLANNER"},{"type":"ROLE","targetId":"MANAGER"},{"type":"ROLE","targetId":"SUPER_ADMIN"}]',
     240, 'MANAGER', true),
    ('Emergency WR Authorized — Second Approver Needed',
     'An Emergency request is authorized. It must be approved by someone other than the person who authorized it',
     'requests', 'SR_STATUS_CHANGE', 'CRITICAL',
     '[{"field":"status","operator":"EQUALS","value":"AUTHORIZED"},{"field":"priority","operator":"EQUALS","value":"EMERGENCY"}]',
     '[{"type":"ROLE","targetId":"MANAGER"}]',
     60, 'SUPER_ADMIN', true),
    -- the requester, at every step (these two were hard-coded in the page)
    ('WR Being Reviewed',
     'A supervisor has picked up your request and is reviewing it',
     'requests', 'SR_STATUS_CHANGE', 'INFO',
     '[{"field":"status","operator":"EQUALS","value":"REVIEW"}]',
     '[{"type":"DYNAMIC","targetId":"requester"}]',
     0, '', false),
    ('WR Authorized',
     'Your request was authorized and is with planning to become a work order',
     'requests', 'SR_STATUS_CHANGE', 'INFO',
     '[{"field":"status","operator":"EQUALS","value":"AUTHORIZED"}]',
     '[{"type":"DYNAMIC","targetId":"requester"}]',
     0, '', false),
    -- closing the loop
    ('Work Complete — Your Request',
     'The work you reported is complete',
     'workOrders', 'WO_STATUS_CHANGE', 'SUCCESS',
     '[{"field":"status","operator":"EQUALS","value":"TECO"}]',
     '[{"type":"DYNAMIC","targetId":"requester"}]',
     0, '', false),
    ('Work Accepted — Ready for Financial Close',
     'A completed work order was accepted by the supervisor and is ready to be closed',
     'workOrders', 'WO_ACCEPTED', 'INFO',
     '[]',
     '[{"type":"ROLE","targetId":"FINANCE"},{"type":"ROLE","targetId":"MANAGER"}]',
     0, '', true)
 ) AS r(name, description, module, event_trigger, severity, filters, recipients, esc_minutes, esc_role, action_required)
 WHERE c.active
   AND NOT EXISTS (SELECT 1 FROM public.notification_rules n WHERE n.company_id = c.id AND n.name = r.name);

-- Existing hand-offs become action-required: a new request (triage owners),
-- a completed order (review), a new order (planner).
UPDATE public.notification_rules
   SET action_required = true
 WHERE (module = 'requests'   AND event_trigger = 'SR_CREATED')
    OR (module = 'workOrders' AND event_trigger = 'WO_CREATED')
    OR (module = 'workOrders' AND event_trigger = 'WO_STATUS_CHANGE'
        AND filters @> '[{"field":"status","operator":"EQUALS","value":"TECO"}]'::jsonb
        AND recipients::text LIKE '%"ROLE"%');

-- Self-serve signups clone the seed company's rules by id (0279a).
INSERT INTO public.product_seed_rows (id, table_name)
SELECT n.id, 'notification_rules'
  FROM public.notification_rules n
 WHERE n.company_id = (SELECT id FROM public.companies WHERE active ORDER BY created_at LIMIT 1)
   AND n.module IN ('requests', 'workOrders')
   AND NOT EXISTS (SELECT 1 FROM public.product_seed_rows s WHERE s.id = n.id);

-- ── D. Request workflow guard ───────────────────────────────────────────────
-- A supervisor MAY authorize a request they raised themselves. What the
-- database refuses:
--   • a work order from a request nobody authorized;
--   • an Emergency request (risk score ≥ 40) approved by the same person who
--     authorized it — a high-consequence job needs a second, higher authority.
--     Administrators are exempt so a single-supervisor site is never stuck.
-- The authorizer is stamped from the session, not taken from the client.
CREATE OR REPLACE FUNCTION public.enforce_request_workflow()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    old_s text := upper(coalesce(OLD.status::text, ''));
    new_s text := upper(coalesce(NEW.status::text, ''));
    me uuid;
BEGIN
    IF public.session_is_internal() OR new_s = old_s THEN RETURN NEW; END IF;
    me := public.caller_user_id();

    IF new_s = 'AUTHORIZED' THEN
        NEW.authorized_by := coalesce(me, NEW.authorized_by);
        NEW.authorized_at := coalesce(NEW.authorized_at, now());
    END IF;

    IF new_s = 'CONVERTED' THEN
        IF old_s NOT IN ('AUTHORIZED', 'APPROVED') THEN
            RAISE EXCEPTION 'NOT_AUTHORIZED: request % must be authorized before it becomes a work order.', OLD.request_number
                USING ERRCODE = 'check_violation';
        END IF;
        IF coalesce(OLD.risk_score, 0) >= 40 AND OLD.authorized_by IS NOT NULL AND OLD.authorized_by = me
           AND NOT public.is_admin() THEN
            RAISE EXCEPTION 'SECOND_APPROVER_REQUIRED: % is an Emergency job. It must be approved by someone other than the person who authorized it.', OLD.request_number
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_request_workflow ON public.service_requests;
CREATE TRIGGER trg_enforce_request_workflow
    BEFORE UPDATE OF status ON public.service_requests
    FOR EACH ROW EXECUTE FUNCTION public.enforce_request_workflow();

-- ── E. Response-target escalation ───────────────────────────────────────────
-- Lateness used to show only to someone looking at the board. Every 15
-- minutes: an open Emergency or High request half-way through its target
-- (level 1) and any open request past its target (level 2) is escalated once
-- per level — to the responsible department's leads, else the tenant's
-- supervisors; level 2 adds the managers.
ALTER TABLE public.service_requests
    ADD COLUMN IF NOT EXISTS sla_escalation_level smallint NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.service_requests.sla_escalation_level IS
    '0400: 0 = not escalated, 1 = half-way notice sent, 2 = overdue notice sent (ers_request_sla_sweep).';

-- Requests already past their target today are history, not news.
UPDATE public.service_requests r
   SET sla_escalation_level = 2
 WHERE upper(r.status::text) IN ('NEW', 'REVIEW', 'AUTHORIZED')
   AND now() >= r.created_at + make_interval(hours =>
        CASE WHEN coalesce(r.risk_score, 0) >= 40 THEN 4 WHEN coalesce(r.risk_score, 0) >= 25 THEN 24
             WHEN coalesce(r.risk_score, 0) >= 10 THEN 72 ELSE 168 END);

CREATE OR REPLACE FUNCTION public.ers_request_sla_sweep()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    q record;
    v_level smallint;
    v_sent integer := 0;
    v_rows integer;
    v_band text;
BEGIN
    FOR q IN
        SELECT r.id, r.company_id, r.request_number, r.description, r.sla_escalation_level, r.created_at,
               coalesce(r.work_center_id, a.responsible_work_center_id) AS wc_id,
               coalesce(a.tag, a.name) AS asset_label,
               CASE WHEN coalesce(r.risk_score, 0) >= 40 THEN 4 WHEN coalesce(r.risk_score, 0) >= 25 THEN 24
                    WHEN coalesce(r.risk_score, 0) >= 10 THEN 72 ELSE 168 END AS target_h
          FROM public.service_requests r
          LEFT JOIN public.assets a ON a.id = r.asset_id
         WHERE upper(r.status::text) IN ('NEW', 'REVIEW', 'AUTHORIZED')
           AND r.sla_escalation_level < 2
    LOOP
        v_level := CASE
            WHEN now() >= q.created_at + make_interval(hours => q.target_h) THEN 2
            WHEN q.target_h <= 24 AND now() >= q.created_at + make_interval(mins => q.target_h * 30) THEN 1
            ELSE 0 END;
        CONTINUE WHEN v_level <= q.sla_escalation_level;
        v_band := CASE q.target_h WHEN 4 THEN 'Emergency' WHEN 24 THEN 'High' WHEN 72 THEN 'Medium' ELSE 'Low' END;

        INSERT INTO public.notifications
            (recipient_id, title, message, severity, notification_type, module, entity_id, entity_type,
             entity_number, action_link, action_required, created_by, company_id)
        SELECT DISTINCT u.id::text,
               CASE WHEN v_level = 2 THEN 'Overdue: ' ELSE 'Half-way to target: ' END || q.request_number,
               v_band || ' request on ' || coalesce(q.asset_label, 'an asset') || ' — "' || left(q.description, 90) || '" — '
                 || CASE WHEN v_level = 2 THEN 'has passed its ' ELSE 'is half-way through its ' END
                 || q.target_h || '-hour response target and is still open.',
               CASE WHEN v_level = 2 THEN 'CRITICAL' ELSE 'WARNING' END,
               'ESCALATION', 'requests', q.id::text, 'WORK_REQUEST', q.request_number,
               '/requests?id=' || q.id::text, true, 'SYSTEM', q.company_id
          FROM public.users u
         WHERE u.company_id = q.company_id
           AND coalesce(u.status, 'active') = 'active'
           AND (
                -- the department's leads
                (q.wc_id IS NOT NULL AND u.contact_id IN (
                    SELECT m.contact_id FROM public.work_center_members m
                     WHERE m.work_center_id = q.wc_id AND m.role = 'LEAD'))
                -- no department, or a department without a lead: the supervisors
             OR ((q.wc_id IS NULL OR NOT EXISTS (
                    SELECT 1 FROM public.work_center_members m
                      JOIN public.users lu ON lu.contact_id = m.contact_id
                     WHERE m.work_center_id = q.wc_id AND m.role = 'LEAD'))
                 AND u.roles ? 'SUPERVISOR')
                -- overdue: the managers as well
             OR (v_level = 2 AND u.roles ? 'MANAGER')
           );
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        v_sent := v_sent + v_rows;

        UPDATE public.service_requests SET sla_escalation_level = v_level WHERE id = q.id;
    END LOOP;
    RETURN v_sent;
END $$;

REVOKE ALL ON FUNCTION public.ers_request_sla_sweep() FROM public, anon, authenticated;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RAISE NOTICE '0400: pg_cron absent — request-sla-sweep not registered on this project.';
        RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'request-sla-sweep') THEN
        PERFORM cron.unschedule('request-sla-sweep');
    END IF;
    PERFORM cron.schedule('request-sla-sweep', '*/15 * * * *', 'SELECT public.ers_request_sla_sweep()');
END $$;

COMMIT;

-- VERIFY (after apply):
--   SELECT name, module, event_trigger, action_required, recipients FROM notification_rules
--    WHERE module IN ('requests','workOrders') ORDER BY module, name;
--   SELECT public.priority_lead_interval('HIGH');            -- 1 day
--   SELECT public.ers_request_sla_sweep();                   -- 0 on a quiet board
--   SELECT jobname, schedule FROM cron.job WHERE jobname = 'request-sla-sweep';
