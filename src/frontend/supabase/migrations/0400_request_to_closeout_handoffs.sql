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
--   • the database accepted a conversion from any status, and whether a
--     person may authorize their own request was not a decision anyone could
--     make — it is now a matrix permission (requests.authorizeOwn);
--   • a request could pass its response target with nobody told;
--   • the requester never heard the work was done, and finance never heard an
--     accepted order was ready to close.
--
-- Parts: A rule flag · B lead times · C hand-off rules · D request workflow
-- guard · E response-target escalation (pg_cron) · F role matrix re-seed
-- (adds requests.authorizeOwn; npm run gen:role-permissions).
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
    -- Emergencies are fast-tracked, then reviewed: the manager is told an
    -- order was raised, not asked for permission first.
    ('Emergency Work Order Raised — Review',
     'An Emergency request was turned into a work order. Review the decision and the priority',
     'requests', 'SR_STATUS_CHANGE', 'WARNING',
     '[{"field":"status","operator":"EQUALS","value":"CONVERTED"},{"field":"priority","operator":"EQUALS","value":"EMERGENCY"}]',
     '[{"type":"ROLE","targetId":"MANAGER"}]',
     0, '', false),
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
-- What the database enforces:
--   • authorizing a request you raised needs requests.authorizeOwn (role
--     matrix; on for supervisors and managers by default). Admins are exempt.
--   • a work order comes only from an authorized request — except an
--     Emergency (risk score ≥ 40), which whoever holds requests.approve may
--     raise straight from New or Review. Emergency work does not wait in an
--     approval queue; it is reviewed afterwards (rule in part C). The approver
--     is recorded as its authorizer.
-- The authorizer is stamped from the session, not taken from the client.
-- (Approval by a higher authority belongs on the ORDER, by planned cost
-- against the approver's spending limit — not on the request, where no cost
-- is known yet.)
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
        IF me IS NOT NULL AND OLD.requester_id = me
           AND NOT public.caller_can('requests', 'authorizeOwn') AND NOT public.is_admin() THEN
            RAISE EXCEPTION 'OWN_REQUEST: your role cannot authorize a request you raised (%). Someone else must authorize it.', OLD.request_number
                USING ERRCODE = 'check_violation';
        END IF;
        NEW.authorized_by := coalesce(me, NEW.authorized_by);
        NEW.authorized_at := coalesce(NEW.authorized_at, now());
    END IF;

    IF new_s = 'CONVERTED' AND old_s NOT IN ('AUTHORIZED', 'APPROVED') THEN
        IF old_s IN ('NEW', 'REVIEW') AND coalesce(OLD.risk_score, 0) >= 40
           AND (public.caller_can('requests', 'approve') OR public.is_admin()) THEN
            -- Emergency fast-track: the approver authorizes on the spot.
            NEW.authorized_by := coalesce(me, NEW.authorized_by);
            NEW.authorized_at := now();
        ELSE
            RAISE EXCEPTION 'NOT_AUTHORIZED: request % must be authorized before it becomes a work order.', OLD.request_number
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

-- ── F. Role matrix re-seed: requests.authorizeOwn ───────────────────────────
-- ── BEGIN GENERATED SEED (scripts/gen-role-permissions.mjs) ──
-- 829 permitted (role, module, action) triples. Do not hand-edit.
DELETE FROM public.role_permissions;
INSERT INTO public.role_permissions (role, module, action) VALUES
    ('ASSET_MANAGER', 'analytics', 'view'),
    ('ASSET_MANAGER', 'analytics', 'viewCosts'),
    ('ASSET_MANAGER', 'assets', 'view'),
    ('ASSET_MANAGER', 'assets', 'create'),
    ('ASSET_MANAGER', 'assets', 'edit'),
    ('ASSET_MANAGER', 'assets', 'approve'),
    ('ASSET_MANAGER', 'assets', 'viewCosts'),
    ('ASSET_MANAGER', 'audits', 'view'),
    ('ASSET_MANAGER', 'audits', 'create'),
    ('ASSET_MANAGER', 'audits', 'edit'),
    ('ASSET_MANAGER', 'audits', 'approve'),
    ('ASSET_MANAGER', 'audits', 'viewCosts'),
    ('ASSET_MANAGER', 'contacts', 'view'),
    ('ASSET_MANAGER', 'dashboard', 'view'),
    ('ASSET_MANAGER', 'dashboard', 'create'),
    ('ASSET_MANAGER', 'dashboard', 'edit'),
    ('ASSET_MANAGER', 'dashboard', 'viewCosts'),
    ('ASSET_MANAGER', 'finops', 'view'),
    ('ASSET_MANAGER', 'finops', 'create'),
    ('ASSET_MANAGER', 'finops', 'edit'),
    ('ASSET_MANAGER', 'finops', 'viewCosts'),
    ('ASSET_MANAGER', 'integrity', 'view'),
    ('ASSET_MANAGER', 'integrity', 'viewCosts'),
    ('ASSET_MANAGER', 'inventory', 'view'),
    ('ASSET_MANAGER', 'inventory', 'viewCosts'),
    ('ASSET_MANAGER', 'moc', 'view'),
    ('ASSET_MANAGER', 'moc', 'create'),
    ('ASSET_MANAGER', 'moc', 'edit'),
    ('ASSET_MANAGER', 'moc', 'approve'),
    ('ASSET_MANAGER', 'moc', 'authorize'),
    ('ASSET_MANAGER', 'notifications', 'view'),
    ('ASSET_MANAGER', 'notifications', 'create'),
    ('ASSET_MANAGER', 'notifications', 'edit'),
    ('ASSET_MANAGER', 'pm', 'view'),
    ('ASSET_MANAGER', 'pm', 'create'),
    ('ASSET_MANAGER', 'pm', 'edit'),
    ('ASSET_MANAGER', 'pm', 'approve'),
    ('ASSET_MANAGER', 'pm', 'viewCosts'),
    ('ASSET_MANAGER', 'purchasing', 'view'),
    ('ASSET_MANAGER', 'purchasing', 'approve'),
    ('ASSET_MANAGER', 'purchasing', 'viewCosts'),
    ('ASSET_MANAGER', 'readings', 'view'),
    ('ASSET_MANAGER', 'reliability', 'view'),
    ('ASSET_MANAGER', 'reliability', 'viewCosts'),
    ('ASSET_MANAGER', 'requests', 'view'),
    ('ASSET_MANAGER', 'requests', 'create'),
    ('ASSET_MANAGER', 'requests', 'edit'),
    ('ASSET_MANAGER', 'requests', 'approve'),
    ('ASSET_MANAGER', 'requests', 'authorize'),
    ('ASSET_MANAGER', 'requests', 'authorizeOwn'),
    ('ASSET_MANAGER', 'requests', 'viewCosts'),
    ('ASSET_MANAGER', 'requests', 'assign'),
    ('ASSET_MANAGER', 'safety', 'view'),
    ('ASSET_MANAGER', 'scheduling', 'view'),
    ('ASSET_MANAGER', 'sustain', 'view'),
    ('ASSET_MANAGER', 'taskLibrary', 'view'),
    ('ASSET_MANAGER', 'vendors', 'view'),
    ('ASSET_MANAGER', 'vendors', 'viewCosts'),
    ('ASSET_MANAGER', 'workOrders', 'view'),
    ('ASSET_MANAGER', 'workOrders', 'create'),
    ('ASSET_MANAGER', 'workOrders', 'edit'),
    ('ASSET_MANAGER', 'workOrders', 'approve'),
    ('ASSET_MANAGER', 'workOrders', 'viewCosts'),
    ('EXECUTIVE', 'analytics', 'view'),
    ('EXECUTIVE', 'analytics', 'viewCosts'),
    ('EXECUTIVE', 'assets', 'view'),
    ('EXECUTIVE', 'assets', 'viewCosts'),
    ('EXECUTIVE', 'audits', 'view'),
    ('EXECUTIVE', 'audits', 'approve'),
    ('EXECUTIVE', 'audits', 'viewCosts'),
    ('EXECUTIVE', 'contacts', 'view'),
    ('EXECUTIVE', 'dashboard', 'view'),
    ('EXECUTIVE', 'dashboard', 'viewCosts'),
    ('EXECUTIVE', 'finops', 'view'),
    ('EXECUTIVE', 'finops', 'viewCosts'),
    ('EXECUTIVE', 'integrity', 'view'),
    ('EXECUTIVE', 'inventory', 'view'),
    ('EXECUTIVE', 'inventory', 'viewCosts'),
    ('EXECUTIVE', 'moc', 'view'),
    ('EXECUTIVE', 'moc', 'approve'),
    ('EXECUTIVE', 'moc', 'authorize'),
    ('EXECUTIVE', 'notifications', 'view'),
    ('EXECUTIVE', 'pm', 'view'),
    ('EXECUTIVE', 'pm', 'viewCosts'),
    ('EXECUTIVE', 'purchasing', 'view'),
    ('EXECUTIVE', 'purchasing', 'approve'),
    ('EXECUTIVE', 'purchasing', 'authorize'),
    ('EXECUTIVE', 'purchasing', 'viewCosts'),
    ('EXECUTIVE', 'readings', 'view'),
    ('EXECUTIVE', 'reliability', 'view'),
    ('EXECUTIVE', 'requests', 'view'),
    ('EXECUTIVE', 'requests', 'approve'),
    ('EXECUTIVE', 'requests', 'viewCosts'),
    ('EXECUTIVE', 'safety', 'view'),
    ('EXECUTIVE', 'scheduling', 'view'),
    ('EXECUTIVE', 'sustain', 'view'),
    ('EXECUTIVE', 'taskLibrary', 'view'),
    ('EXECUTIVE', 'vendors', 'view'),
    ('EXECUTIVE', 'vendors', 'viewCosts'),
    ('EXECUTIVE', 'workOrders', 'view'),
    ('EXECUTIVE', 'workOrders', 'approve'),
    ('EXECUTIVE', 'workOrders', 'authorize'),
    ('EXECUTIVE', 'workOrders', 'viewCosts'),
    ('FINANCE', 'analytics', 'view'),
    ('FINANCE', 'analytics', 'viewCosts'),
    ('FINANCE', 'assets', 'view'),
    ('FINANCE', 'audits', 'view'),
    ('FINANCE', 'contacts', 'view'),
    ('FINANCE', 'dashboard', 'view'),
    ('FINANCE', 'dashboard', 'viewCosts'),
    ('FINANCE', 'finops', 'view'),
    ('FINANCE', 'finops', 'create'),
    ('FINANCE', 'finops', 'edit'),
    ('FINANCE', 'finops', 'approve'),
    ('FINANCE', 'finops', 'authorize'),
    ('FINANCE', 'finops', 'viewCosts'),
    ('FINANCE', 'finops', 'assign'),
    ('FINANCE', 'inventory', 'view'),
    ('FINANCE', 'inventory', 'viewCosts'),
    ('FINANCE', 'moc', 'view'),
    ('FINANCE', 'notifications', 'view'),
    ('FINANCE', 'notifications', 'create'),
    ('FINANCE', 'notifications', 'edit'),
    ('FINANCE', 'pm', 'view'),
    ('FINANCE', 'purchasing', 'view'),
    ('FINANCE', 'purchasing', 'approve'),
    ('FINANCE', 'purchasing', 'authorize'),
    ('FINANCE', 'purchasing', 'viewCosts'),
    ('FINANCE', 'readings', 'view'),
    ('FINANCE', 'reliability', 'view'),
    ('FINANCE', 'requests', 'view'),
    ('FINANCE', 'requests', 'create'),
    ('FINANCE', 'safety', 'view'),
    ('FINANCE', 'scheduling', 'view'),
    ('FINANCE', 'taskLibrary', 'view'),
    ('FINANCE', 'vendors', 'view'),
    ('FINANCE', 'vendors', 'viewCosts'),
    ('FINANCE', 'workOrders', 'view'),
    ('FINANCE', 'workOrders', 'viewCosts'),
    ('INTERNAL', 'assets', 'view'),
    ('INTERNAL', 'audits', 'view'),
    ('INTERNAL', 'dashboard', 'view'),
    ('INTERNAL', 'inventory', 'view'),
    ('INTERNAL', 'notifications', 'view'),
    ('INTERNAL', 'reliability', 'view'),
    ('INTERNAL', 'requests', 'view'),
    ('INTERNAL', 'requests', 'create'),
    ('INTERNAL', 'workOrders', 'view'),
    ('MANAGER', 'analytics', 'view'),
    ('MANAGER', 'analytics', 'viewCosts'),
    ('MANAGER', 'assets', 'view'),
    ('MANAGER', 'assets', 'create'),
    ('MANAGER', 'assets', 'edit'),
    ('MANAGER', 'assets', 'viewCosts'),
    ('MANAGER', 'audits', 'view'),
    ('MANAGER', 'audits', 'create'),
    ('MANAGER', 'audits', 'edit'),
    ('MANAGER', 'audits', 'approve'),
    ('MANAGER', 'audits', 'viewCosts'),
    ('MANAGER', 'contacts', 'view'),
    ('MANAGER', 'contacts', 'create'),
    ('MANAGER', 'contacts', 'edit'),
    ('MANAGER', 'dashboard', 'view'),
    ('MANAGER', 'dashboard', 'create'),
    ('MANAGER', 'dashboard', 'edit'),
    ('MANAGER', 'dashboard', 'viewCosts'),
    ('MANAGER', 'finops', 'view'),
    ('MANAGER', 'integrity', 'view'),
    ('MANAGER', 'inventory', 'view'),
    ('MANAGER', 'inventory', 'create'),
    ('MANAGER', 'inventory', 'edit'),
    ('MANAGER', 'inventory', 'viewCosts'),
    ('MANAGER', 'moc', 'view'),
    ('MANAGER', 'moc', 'create'),
    ('MANAGER', 'moc', 'edit'),
    ('MANAGER', 'moc', 'approve'),
    ('MANAGER', 'notifications', 'view'),
    ('MANAGER', 'notifications', 'create'),
    ('MANAGER', 'notifications', 'edit'),
    ('MANAGER', 'pm', 'view'),
    ('MANAGER', 'pm', 'create'),
    ('MANAGER', 'pm', 'edit'),
    ('MANAGER', 'pm', 'approve'),
    ('MANAGER', 'pm', 'viewCosts'),
    ('MANAGER', 'pm', 'assign'),
    ('MANAGER', 'purchasing', 'view'),
    ('MANAGER', 'purchasing', 'create'),
    ('MANAGER', 'purchasing', 'edit'),
    ('MANAGER', 'purchasing', 'approve'),
    ('MANAGER', 'purchasing', 'viewCosts'),
    ('MANAGER', 'readings', 'view'),
    ('MANAGER', 'readings', 'create'),
    ('MANAGER', 'readings', 'edit'),
    ('MANAGER', 'reliability', 'view'),
    ('MANAGER', 'requests', 'view'),
    ('MANAGER', 'requests', 'create'),
    ('MANAGER', 'requests', 'edit'),
    ('MANAGER', 'requests', 'approve'),
    ('MANAGER', 'requests', 'authorize'),
    ('MANAGER', 'requests', 'authorizeOwn'),
    ('MANAGER', 'requests', 'viewCosts'),
    ('MANAGER', 'requests', 'assign'),
    ('MANAGER', 'safety', 'view'),
    ('MANAGER', 'scheduling', 'view'),
    ('MANAGER', 'scheduling', 'create'),
    ('MANAGER', 'scheduling', 'edit'),
    ('MANAGER', 'scheduling', 'approve'),
    ('MANAGER', 'scheduling', 'assign'),
    ('MANAGER', 'sustain', 'view'),
    ('MANAGER', 'taskLibrary', 'view'),
    ('MANAGER', 'taskLibrary', 'create'),
    ('MANAGER', 'taskLibrary', 'edit'),
    ('MANAGER', 'vendors', 'view'),
    ('MANAGER', 'vendors', 'create'),
    ('MANAGER', 'vendors', 'edit'),
    ('MANAGER', 'vendors', 'approve'),
    ('MANAGER', 'vendors', 'viewCosts'),
    ('MANAGER', 'workOrders', 'view'),
    ('MANAGER', 'workOrders', 'create'),
    ('MANAGER', 'workOrders', 'edit'),
    ('MANAGER', 'workOrders', 'approve'),
    ('MANAGER', 'workOrders', 'viewCosts'),
    ('MANAGER', 'workOrders', 'assign'),
    ('PLANNER', 'analytics', 'view'),
    ('PLANNER', 'analytics', 'viewCosts'),
    ('PLANNER', 'assets', 'view'),
    ('PLANNER', 'assets', 'create'),
    ('PLANNER', 'assets', 'edit'),
    ('PLANNER', 'assets', 'viewCosts'),
    ('PLANNER', 'audits', 'view'),
    ('PLANNER', 'contacts', 'view'),
    ('PLANNER', 'contacts', 'create'),
    ('PLANNER', 'contacts', 'edit'),
    ('PLANNER', 'dashboard', 'view'),
    ('PLANNER', 'dashboard', 'create'),
    ('PLANNER', 'dashboard', 'edit'),
    ('PLANNER', 'dashboard', 'viewCosts'),
    ('PLANNER', 'inventory', 'view'),
    ('PLANNER', 'inventory', 'create'),
    ('PLANNER', 'inventory', 'edit'),
    ('PLANNER', 'inventory', 'viewCosts'),
    ('PLANNER', 'notifications', 'view'),
    ('PLANNER', 'notifications', 'create'),
    ('PLANNER', 'notifications', 'edit'),
    ('PLANNER', 'pm', 'view'),
    ('PLANNER', 'pm', 'create'),
    ('PLANNER', 'pm', 'edit'),
    ('PLANNER', 'pm', 'approve'),
    ('PLANNER', 'pm', 'viewCosts'),
    ('PLANNER', 'pm', 'assign'),
    ('PLANNER', 'purchasing', 'view'),
    ('PLANNER', 'purchasing', 'create'),
    ('PLANNER', 'purchasing', 'edit'),
    ('PLANNER', 'purchasing', 'approve'),
    ('PLANNER', 'purchasing', 'viewCosts'),
    ('PLANNER', 'readings', 'view'),
    ('PLANNER', 'reliability', 'view'),
    ('PLANNER', 'requests', 'view'),
    ('PLANNER', 'requests', 'create'),
    ('PLANNER', 'requests', 'edit'),
    ('PLANNER', 'requests', 'approve'),
    ('PLANNER', 'requests', 'viewCosts'),
    ('PLANNER', 'requests', 'assign'),
    ('PLANNER', 'safety', 'view'),
    ('PLANNER', 'safety', 'create'),
    ('PLANNER', 'safety', 'edit'),
    ('PLANNER', 'scheduling', 'view'),
    ('PLANNER', 'scheduling', 'create'),
    ('PLANNER', 'scheduling', 'edit'),
    ('PLANNER', 'scheduling', 'approve'),
    ('PLANNER', 'scheduling', 'assign'),
    ('PLANNER', 'taskLibrary', 'view'),
    ('PLANNER', 'taskLibrary', 'create'),
    ('PLANNER', 'taskLibrary', 'edit'),
    ('PLANNER', 'vendors', 'view'),
    ('PLANNER', 'vendors', 'create'),
    ('PLANNER', 'vendors', 'edit'),
    ('PLANNER', 'vendors', 'approve'),
    ('PLANNER', 'vendors', 'viewCosts'),
    ('PLANNER', 'workOrders', 'view'),
    ('PLANNER', 'workOrders', 'create'),
    ('PLANNER', 'workOrders', 'edit'),
    ('PLANNER', 'workOrders', 'approve'),
    ('PLANNER', 'workOrders', 'viewCosts'),
    ('PLANNER', 'workOrders', 'assign'),
    ('RELIABILITY_ENG', 'analytics', 'view'),
    ('RELIABILITY_ENG', 'analytics', 'viewCosts'),
    ('RELIABILITY_ENG', 'assets', 'view'),
    ('RELIABILITY_ENG', 'assets', 'create'),
    ('RELIABILITY_ENG', 'assets', 'edit'),
    ('RELIABILITY_ENG', 'assets', 'viewCosts'),
    ('RELIABILITY_ENG', 'audits', 'view'),
    ('RELIABILITY_ENG', 'audits', 'create'),
    ('RELIABILITY_ENG', 'audits', 'edit'),
    ('RELIABILITY_ENG', 'audits', 'delete'),
    ('RELIABILITY_ENG', 'audits', 'approve'),
    ('RELIABILITY_ENG', 'audits', 'authorize'),
    ('RELIABILITY_ENG', 'audits', 'viewCosts'),
    ('RELIABILITY_ENG', 'audits', 'assign'),
    ('RELIABILITY_ENG', 'contacts', 'view'),
    ('RELIABILITY_ENG', 'dashboard', 'view'),
    ('RELIABILITY_ENG', 'dashboard', 'create'),
    ('RELIABILITY_ENG', 'dashboard', 'edit'),
    ('RELIABILITY_ENG', 'dashboard', 'viewCosts'),
    ('RELIABILITY_ENG', 'integrity', 'view'),
    ('RELIABILITY_ENG', 'integrity', 'create'),
    ('RELIABILITY_ENG', 'integrity', 'edit'),
    ('RELIABILITY_ENG', 'integrity', 'delete'),
    ('RELIABILITY_ENG', 'integrity', 'approve'),
    ('RELIABILITY_ENG', 'integrity', 'authorize'),
    ('RELIABILITY_ENG', 'integrity', 'viewCosts'),
    ('RELIABILITY_ENG', 'integrity', 'assign'),
    ('RELIABILITY_ENG', 'inventory', 'view'),
    ('RELIABILITY_ENG', 'inventory', 'viewCosts'),
    ('RELIABILITY_ENG', 'notifications', 'view'),
    ('RELIABILITY_ENG', 'notifications', 'create'),
    ('RELIABILITY_ENG', 'notifications', 'edit'),
    ('RELIABILITY_ENG', 'pm', 'view'),
    ('RELIABILITY_ENG', 'pm', 'create'),
    ('RELIABILITY_ENG', 'pm', 'edit'),
    ('RELIABILITY_ENG', 'pm', 'viewCosts'),
    ('RELIABILITY_ENG', 'purchasing', 'view'),
    ('RELIABILITY_ENG', 'readings', 'view'),
    ('RELIABILITY_ENG', 'readings', 'create'),
    ('RELIABILITY_ENG', 'readings', 'edit'),
    ('RELIABILITY_ENG', 'reliability', 'view'),
    ('RELIABILITY_ENG', 'reliability', 'create'),
    ('RELIABILITY_ENG', 'reliability', 'edit'),
    ('RELIABILITY_ENG', 'reliability', 'delete'),
    ('RELIABILITY_ENG', 'reliability', 'approve'),
    ('RELIABILITY_ENG', 'reliability', 'authorize'),
    ('RELIABILITY_ENG', 'reliability', 'viewCosts'),
    ('RELIABILITY_ENG', 'reliability', 'assign'),
    ('RELIABILITY_ENG', 'requests', 'view'),
    ('RELIABILITY_ENG', 'requests', 'create'),
    ('RELIABILITY_ENG', 'requests', 'edit'),
    ('RELIABILITY_ENG', 'safety', 'view'),
    ('RELIABILITY_ENG', 'scheduling', 'view'),
    ('RELIABILITY_ENG', 'taskLibrary', 'view'),
    ('RELIABILITY_ENG', 'taskLibrary', 'create'),
    ('RELIABILITY_ENG', 'taskLibrary', 'edit'),
    ('RELIABILITY_ENG', 'vendors', 'view'),
    ('RELIABILITY_ENG', 'workOrders', 'view'),
    ('RELIABILITY_ENG', 'workOrders', 'create'),
    ('RELIABILITY_ENG', 'workOrders', 'edit'),
    ('RELIABILITY_ENG', 'workOrders', 'viewCosts'),
    ('REQUESTER', 'assets', 'view'),
    ('REQUESTER', 'audits', 'view'),
    ('REQUESTER', 'dashboard', 'view'),
    ('REQUESTER', 'notifications', 'view'),
    ('REQUESTER', 'reliability', 'view'),
    ('REQUESTER', 'requests', 'view'),
    ('REQUESTER', 'requests', 'create'),
    ('REQUESTER', 'requests', 'edit'),
    ('STOREKEEPER', 'analytics', 'view'),
    ('STOREKEEPER', 'assets', 'view'),
    ('STOREKEEPER', 'contacts', 'view'),
    ('STOREKEEPER', 'dashboard', 'view'),
    ('STOREKEEPER', 'dashboard', 'create'),
    ('STOREKEEPER', 'dashboard', 'edit'),
    ('STOREKEEPER', 'inventory', 'view'),
    ('STOREKEEPER', 'inventory', 'create'),
    ('STOREKEEPER', 'inventory', 'edit'),
    ('STOREKEEPER', 'inventory', 'delete'),
    ('STOREKEEPER', 'inventory', 'viewCosts'),
    ('STOREKEEPER', 'inventory', 'assign'),
    ('STOREKEEPER', 'notifications', 'view'),
    ('STOREKEEPER', 'notifications', 'create'),
    ('STOREKEEPER', 'notifications', 'edit'),
    ('STOREKEEPER', 'pm', 'view'),
    ('STOREKEEPER', 'purchasing', 'view'),
    ('STOREKEEPER', 'purchasing', 'create'),
    ('STOREKEEPER', 'purchasing', 'edit'),
    ('STOREKEEPER', 'purchasing', 'viewCosts'),
    ('STOREKEEPER', 'reliability', 'view'),
    ('STOREKEEPER', 'requests', 'view'),
    ('STOREKEEPER', 'requests', 'create'),
    ('STOREKEEPER', 'requests', 'edit'),
    ('STOREKEEPER', 'scheduling', 'view'),
    ('STOREKEEPER', 'vendors', 'view'),
    ('STOREKEEPER', 'vendors', 'create'),
    ('STOREKEEPER', 'vendors', 'edit'),
    ('STOREKEEPER', 'vendors', 'viewCosts'),
    ('STOREKEEPER', 'workOrders', 'view'),
    ('SUPERVISOR', 'analytics', 'view'),
    ('SUPERVISOR', 'assets', 'view'),
    ('SUPERVISOR', 'assets', 'create'),
    ('SUPERVISOR', 'assets', 'edit'),
    ('SUPERVISOR', 'audits', 'view'),
    ('SUPERVISOR', 'contacts', 'view'),
    ('SUPERVISOR', 'dashboard', 'view'),
    ('SUPERVISOR', 'dashboard', 'create'),
    ('SUPERVISOR', 'dashboard', 'edit'),
    ('SUPERVISOR', 'inventory', 'view'),
    ('SUPERVISOR', 'inventory', 'create'),
    ('SUPERVISOR', 'inventory', 'edit'),
    ('SUPERVISOR', 'notifications', 'view'),
    ('SUPERVISOR', 'notifications', 'create'),
    ('SUPERVISOR', 'notifications', 'edit'),
    ('SUPERVISOR', 'pm', 'view'),
    ('SUPERVISOR', 'pm', 'create'),
    ('SUPERVISOR', 'pm', 'edit'),
    ('SUPERVISOR', 'pm', 'approve'),
    ('SUPERVISOR', 'pm', 'assign'),
    ('SUPERVISOR', 'purchasing', 'view'),
    ('SUPERVISOR', 'readings', 'view'),
    ('SUPERVISOR', 'readings', 'create'),
    ('SUPERVISOR', 'readings', 'edit'),
    ('SUPERVISOR', 'reliability', 'view'),
    ('SUPERVISOR', 'requests', 'view'),
    ('SUPERVISOR', 'requests', 'create'),
    ('SUPERVISOR', 'requests', 'edit'),
    ('SUPERVISOR', 'requests', 'approve'),
    ('SUPERVISOR', 'requests', 'authorize'),
    ('SUPERVISOR', 'requests', 'authorizeOwn'),
    ('SUPERVISOR', 'requests', 'assign'),
    ('SUPERVISOR', 'safety', 'view'),
    ('SUPERVISOR', 'safety', 'create'),
    ('SUPERVISOR', 'safety', 'edit'),
    ('SUPERVISOR', 'safety', 'approve'),
    ('SUPERVISOR', 'scheduling', 'view'),
    ('SUPERVISOR', 'scheduling', 'create'),
    ('SUPERVISOR', 'scheduling', 'edit'),
    ('SUPERVISOR', 'scheduling', 'approve'),
    ('SUPERVISOR', 'scheduling', 'assign'),
    ('SUPERVISOR', 'taskLibrary', 'view'),
    ('SUPERVISOR', 'vendors', 'view'),
    ('SUPERVISOR', 'workOrders', 'view'),
    ('SUPERVISOR', 'workOrders', 'create'),
    ('SUPERVISOR', 'workOrders', 'edit'),
    ('SUPERVISOR', 'workOrders', 'approve'),
    ('SUPERVISOR', 'workOrders', 'assign'),
    ('SUPER_ADMIN', 'activityLog', 'view'),
    ('SUPER_ADMIN', 'activityLog', 'create'),
    ('SUPER_ADMIN', 'activityLog', 'edit'),
    ('SUPER_ADMIN', 'activityLog', 'delete'),
    ('SUPER_ADMIN', 'activityLog', 'approve'),
    ('SUPER_ADMIN', 'activityLog', 'authorize'),
    ('SUPER_ADMIN', 'activityLog', 'viewCosts'),
    ('SUPER_ADMIN', 'activityLog', 'assign'),
    ('SUPER_ADMIN', 'admin', 'view'),
    ('SUPER_ADMIN', 'admin', 'create'),
    ('SUPER_ADMIN', 'admin', 'edit'),
    ('SUPER_ADMIN', 'admin', 'delete'),
    ('SUPER_ADMIN', 'admin', 'approve'),
    ('SUPER_ADMIN', 'admin', 'authorize'),
    ('SUPER_ADMIN', 'admin', 'viewCosts'),
    ('SUPER_ADMIN', 'admin', 'assign'),
    ('SUPER_ADMIN', 'analytics', 'view'),
    ('SUPER_ADMIN', 'analytics', 'create'),
    ('SUPER_ADMIN', 'analytics', 'edit'),
    ('SUPER_ADMIN', 'analytics', 'delete'),
    ('SUPER_ADMIN', 'analytics', 'approve'),
    ('SUPER_ADMIN', 'analytics', 'authorize'),
    ('SUPER_ADMIN', 'analytics', 'viewCosts'),
    ('SUPER_ADMIN', 'analytics', 'assign'),
    ('SUPER_ADMIN', 'assets', 'view'),
    ('SUPER_ADMIN', 'assets', 'create'),
    ('SUPER_ADMIN', 'assets', 'edit'),
    ('SUPER_ADMIN', 'assets', 'delete'),
    ('SUPER_ADMIN', 'assets', 'approve'),
    ('SUPER_ADMIN', 'assets', 'authorize'),
    ('SUPER_ADMIN', 'assets', 'viewCosts'),
    ('SUPER_ADMIN', 'assets', 'assign'),
    ('SUPER_ADMIN', 'audits', 'view'),
    ('SUPER_ADMIN', 'audits', 'create'),
    ('SUPER_ADMIN', 'audits', 'edit'),
    ('SUPER_ADMIN', 'audits', 'delete'),
    ('SUPER_ADMIN', 'audits', 'approve'),
    ('SUPER_ADMIN', 'audits', 'authorize'),
    ('SUPER_ADMIN', 'audits', 'viewCosts'),
    ('SUPER_ADMIN', 'audits', 'assign'),
    ('SUPER_ADMIN', 'contacts', 'view'),
    ('SUPER_ADMIN', 'contacts', 'create'),
    ('SUPER_ADMIN', 'contacts', 'edit'),
    ('SUPER_ADMIN', 'contacts', 'delete'),
    ('SUPER_ADMIN', 'contacts', 'approve'),
    ('SUPER_ADMIN', 'contacts', 'authorize'),
    ('SUPER_ADMIN', 'contacts', 'viewCosts'),
    ('SUPER_ADMIN', 'contacts', 'assign'),
    ('SUPER_ADMIN', 'dashboard', 'view'),
    ('SUPER_ADMIN', 'dashboard', 'create'),
    ('SUPER_ADMIN', 'dashboard', 'edit'),
    ('SUPER_ADMIN', 'dashboard', 'delete'),
    ('SUPER_ADMIN', 'dashboard', 'approve'),
    ('SUPER_ADMIN', 'dashboard', 'authorize'),
    ('SUPER_ADMIN', 'dashboard', 'viewCosts'),
    ('SUPER_ADMIN', 'dashboard', 'assign'),
    ('SUPER_ADMIN', 'finops', 'view'),
    ('SUPER_ADMIN', 'finops', 'create'),
    ('SUPER_ADMIN', 'finops', 'edit'),
    ('SUPER_ADMIN', 'finops', 'delete'),
    ('SUPER_ADMIN', 'finops', 'approve'),
    ('SUPER_ADMIN', 'finops', 'authorize'),
    ('SUPER_ADMIN', 'finops', 'viewCosts'),
    ('SUPER_ADMIN', 'finops', 'assign'),
    ('SUPER_ADMIN', 'integrity', 'view'),
    ('SUPER_ADMIN', 'integrity', 'create'),
    ('SUPER_ADMIN', 'integrity', 'edit'),
    ('SUPER_ADMIN', 'integrity', 'delete'),
    ('SUPER_ADMIN', 'integrity', 'approve'),
    ('SUPER_ADMIN', 'integrity', 'authorize'),
    ('SUPER_ADMIN', 'integrity', 'viewCosts'),
    ('SUPER_ADMIN', 'integrity', 'assign'),
    ('SUPER_ADMIN', 'inventory', 'view'),
    ('SUPER_ADMIN', 'inventory', 'create'),
    ('SUPER_ADMIN', 'inventory', 'edit'),
    ('SUPER_ADMIN', 'inventory', 'delete'),
    ('SUPER_ADMIN', 'inventory', 'approve'),
    ('SUPER_ADMIN', 'inventory', 'authorize'),
    ('SUPER_ADMIN', 'inventory', 'viewCosts'),
    ('SUPER_ADMIN', 'inventory', 'assign'),
    ('SUPER_ADMIN', 'moc', 'view'),
    ('SUPER_ADMIN', 'moc', 'create'),
    ('SUPER_ADMIN', 'moc', 'edit'),
    ('SUPER_ADMIN', 'moc', 'delete'),
    ('SUPER_ADMIN', 'moc', 'approve'),
    ('SUPER_ADMIN', 'moc', 'authorize'),
    ('SUPER_ADMIN', 'moc', 'viewCosts'),
    ('SUPER_ADMIN', 'moc', 'assign'),
    ('SUPER_ADMIN', 'notifications', 'view'),
    ('SUPER_ADMIN', 'notifications', 'create'),
    ('SUPER_ADMIN', 'notifications', 'edit'),
    ('SUPER_ADMIN', 'notifications', 'delete'),
    ('SUPER_ADMIN', 'notifications', 'approve'),
    ('SUPER_ADMIN', 'notifications', 'authorize'),
    ('SUPER_ADMIN', 'notifications', 'viewCosts'),
    ('SUPER_ADMIN', 'notifications', 'assign'),
    ('SUPER_ADMIN', 'pm', 'view'),
    ('SUPER_ADMIN', 'pm', 'create'),
    ('SUPER_ADMIN', 'pm', 'edit'),
    ('SUPER_ADMIN', 'pm', 'delete'),
    ('SUPER_ADMIN', 'pm', 'approve'),
    ('SUPER_ADMIN', 'pm', 'authorize'),
    ('SUPER_ADMIN', 'pm', 'viewCosts'),
    ('SUPER_ADMIN', 'pm', 'assign'),
    ('SUPER_ADMIN', 'purchasing', 'view'),
    ('SUPER_ADMIN', 'purchasing', 'create'),
    ('SUPER_ADMIN', 'purchasing', 'edit'),
    ('SUPER_ADMIN', 'purchasing', 'delete'),
    ('SUPER_ADMIN', 'purchasing', 'approve'),
    ('SUPER_ADMIN', 'purchasing', 'authorize'),
    ('SUPER_ADMIN', 'purchasing', 'viewCosts'),
    ('SUPER_ADMIN', 'purchasing', 'assign'),
    ('SUPER_ADMIN', 'readings', 'view'),
    ('SUPER_ADMIN', 'readings', 'create'),
    ('SUPER_ADMIN', 'readings', 'edit'),
    ('SUPER_ADMIN', 'readings', 'delete'),
    ('SUPER_ADMIN', 'readings', 'approve'),
    ('SUPER_ADMIN', 'readings', 'authorize'),
    ('SUPER_ADMIN', 'readings', 'viewCosts'),
    ('SUPER_ADMIN', 'readings', 'assign'),
    ('SUPER_ADMIN', 'reliability', 'view'),
    ('SUPER_ADMIN', 'reliability', 'create'),
    ('SUPER_ADMIN', 'reliability', 'edit'),
    ('SUPER_ADMIN', 'reliability', 'delete'),
    ('SUPER_ADMIN', 'reliability', 'approve'),
    ('SUPER_ADMIN', 'reliability', 'authorize'),
    ('SUPER_ADMIN', 'reliability', 'viewCosts'),
    ('SUPER_ADMIN', 'reliability', 'assign'),
    ('SUPER_ADMIN', 'requests', 'view'),
    ('SUPER_ADMIN', 'requests', 'create'),
    ('SUPER_ADMIN', 'requests', 'edit'),
    ('SUPER_ADMIN', 'requests', 'delete'),
    ('SUPER_ADMIN', 'requests', 'approve'),
    ('SUPER_ADMIN', 'requests', 'authorize'),
    ('SUPER_ADMIN', 'requests', 'viewCosts'),
    ('SUPER_ADMIN', 'requests', 'assign'),
    ('SUPER_ADMIN', 'safety', 'view'),
    ('SUPER_ADMIN', 'safety', 'create'),
    ('SUPER_ADMIN', 'safety', 'edit'),
    ('SUPER_ADMIN', 'safety', 'delete'),
    ('SUPER_ADMIN', 'safety', 'approve'),
    ('SUPER_ADMIN', 'safety', 'authorize'),
    ('SUPER_ADMIN', 'safety', 'viewCosts'),
    ('SUPER_ADMIN', 'safety', 'assign'),
    ('SUPER_ADMIN', 'scheduling', 'view'),
    ('SUPER_ADMIN', 'scheduling', 'create'),
    ('SUPER_ADMIN', 'scheduling', 'edit'),
    ('SUPER_ADMIN', 'scheduling', 'delete'),
    ('SUPER_ADMIN', 'scheduling', 'approve'),
    ('SUPER_ADMIN', 'scheduling', 'authorize'),
    ('SUPER_ADMIN', 'scheduling', 'viewCosts'),
    ('SUPER_ADMIN', 'scheduling', 'assign'),
    ('SUPER_ADMIN', 'sustain', 'view'),
    ('SUPER_ADMIN', 'sustain', 'create'),
    ('SUPER_ADMIN', 'sustain', 'edit'),
    ('SUPER_ADMIN', 'sustain', 'delete'),
    ('SUPER_ADMIN', 'sustain', 'approve'),
    ('SUPER_ADMIN', 'sustain', 'authorize'),
    ('SUPER_ADMIN', 'sustain', 'viewCosts'),
    ('SUPER_ADMIN', 'sustain', 'assign'),
    ('SUPER_ADMIN', 'taskLibrary', 'view'),
    ('SUPER_ADMIN', 'taskLibrary', 'create'),
    ('SUPER_ADMIN', 'taskLibrary', 'edit'),
    ('SUPER_ADMIN', 'taskLibrary', 'delete'),
    ('SUPER_ADMIN', 'taskLibrary', 'approve'),
    ('SUPER_ADMIN', 'taskLibrary', 'authorize'),
    ('SUPER_ADMIN', 'taskLibrary', 'viewCosts'),
    ('SUPER_ADMIN', 'taskLibrary', 'assign'),
    ('SUPER_ADMIN', 'vendors', 'view'),
    ('SUPER_ADMIN', 'vendors', 'create'),
    ('SUPER_ADMIN', 'vendors', 'edit'),
    ('SUPER_ADMIN', 'vendors', 'delete'),
    ('SUPER_ADMIN', 'vendors', 'approve'),
    ('SUPER_ADMIN', 'vendors', 'authorize'),
    ('SUPER_ADMIN', 'vendors', 'viewCosts'),
    ('SUPER_ADMIN', 'vendors', 'assign'),
    ('SUPER_ADMIN', 'workOrders', 'view'),
    ('SUPER_ADMIN', 'workOrders', 'create'),
    ('SUPER_ADMIN', 'workOrders', 'edit'),
    ('SUPER_ADMIN', 'workOrders', 'delete'),
    ('SUPER_ADMIN', 'workOrders', 'approve'),
    ('SUPER_ADMIN', 'workOrders', 'authorize'),
    ('SUPER_ADMIN', 'workOrders', 'viewCosts'),
    ('SUPER_ADMIN', 'workOrders', 'assign'),
    ('SYS_ADMIN', 'admin', 'view'),
    ('SYS_ADMIN', 'admin', 'create'),
    ('SYS_ADMIN', 'admin', 'edit'),
    ('SYS_ADMIN', 'admin', 'delete'),
    ('SYS_ADMIN', 'admin', 'approve'),
    ('SYS_ADMIN', 'admin', 'authorize'),
    ('SYS_ADMIN', 'admin', 'viewCosts'),
    ('SYS_ADMIN', 'admin', 'assign'),
    ('SYS_ADMIN', 'analytics', 'view'),
    ('SYS_ADMIN', 'analytics', 'create'),
    ('SYS_ADMIN', 'analytics', 'edit'),
    ('SYS_ADMIN', 'analytics', 'delete'),
    ('SYS_ADMIN', 'analytics', 'approve'),
    ('SYS_ADMIN', 'analytics', 'authorize'),
    ('SYS_ADMIN', 'analytics', 'viewCosts'),
    ('SYS_ADMIN', 'analytics', 'assign'),
    ('SYS_ADMIN', 'assets', 'view'),
    ('SYS_ADMIN', 'assets', 'create'),
    ('SYS_ADMIN', 'assets', 'edit'),
    ('SYS_ADMIN', 'assets', 'delete'),
    ('SYS_ADMIN', 'assets', 'approve'),
    ('SYS_ADMIN', 'assets', 'authorize'),
    ('SYS_ADMIN', 'assets', 'viewCosts'),
    ('SYS_ADMIN', 'assets', 'assign'),
    ('SYS_ADMIN', 'audits', 'view'),
    ('SYS_ADMIN', 'audits', 'create'),
    ('SYS_ADMIN', 'audits', 'edit'),
    ('SYS_ADMIN', 'audits', 'delete'),
    ('SYS_ADMIN', 'audits', 'approve'),
    ('SYS_ADMIN', 'audits', 'authorize'),
    ('SYS_ADMIN', 'audits', 'viewCosts'),
    ('SYS_ADMIN', 'audits', 'assign'),
    ('SYS_ADMIN', 'contacts', 'view'),
    ('SYS_ADMIN', 'contacts', 'create'),
    ('SYS_ADMIN', 'contacts', 'edit'),
    ('SYS_ADMIN', 'contacts', 'delete'),
    ('SYS_ADMIN', 'contacts', 'approve'),
    ('SYS_ADMIN', 'contacts', 'authorize'),
    ('SYS_ADMIN', 'contacts', 'viewCosts'),
    ('SYS_ADMIN', 'contacts', 'assign'),
    ('SYS_ADMIN', 'dashboard', 'view'),
    ('SYS_ADMIN', 'dashboard', 'create'),
    ('SYS_ADMIN', 'dashboard', 'edit'),
    ('SYS_ADMIN', 'dashboard', 'delete'),
    ('SYS_ADMIN', 'dashboard', 'approve'),
    ('SYS_ADMIN', 'dashboard', 'authorize'),
    ('SYS_ADMIN', 'dashboard', 'viewCosts'),
    ('SYS_ADMIN', 'dashboard', 'assign'),
    ('SYS_ADMIN', 'finops', 'view'),
    ('SYS_ADMIN', 'finops', 'create'),
    ('SYS_ADMIN', 'finops', 'edit'),
    ('SYS_ADMIN', 'finops', 'delete'),
    ('SYS_ADMIN', 'finops', 'approve'),
    ('SYS_ADMIN', 'finops', 'authorize'),
    ('SYS_ADMIN', 'finops', 'viewCosts'),
    ('SYS_ADMIN', 'finops', 'assign'),
    ('SYS_ADMIN', 'integrity', 'view'),
    ('SYS_ADMIN', 'integrity', 'create'),
    ('SYS_ADMIN', 'integrity', 'edit'),
    ('SYS_ADMIN', 'integrity', 'delete'),
    ('SYS_ADMIN', 'integrity', 'approve'),
    ('SYS_ADMIN', 'integrity', 'authorize'),
    ('SYS_ADMIN', 'integrity', 'viewCosts'),
    ('SYS_ADMIN', 'integrity', 'assign'),
    ('SYS_ADMIN', 'inventory', 'view'),
    ('SYS_ADMIN', 'inventory', 'create'),
    ('SYS_ADMIN', 'inventory', 'edit'),
    ('SYS_ADMIN', 'inventory', 'delete'),
    ('SYS_ADMIN', 'inventory', 'approve'),
    ('SYS_ADMIN', 'inventory', 'authorize'),
    ('SYS_ADMIN', 'inventory', 'viewCosts'),
    ('SYS_ADMIN', 'inventory', 'assign'),
    ('SYS_ADMIN', 'moc', 'view'),
    ('SYS_ADMIN', 'moc', 'create'),
    ('SYS_ADMIN', 'moc', 'edit'),
    ('SYS_ADMIN', 'moc', 'delete'),
    ('SYS_ADMIN', 'moc', 'approve'),
    ('SYS_ADMIN', 'moc', 'authorize'),
    ('SYS_ADMIN', 'moc', 'viewCosts'),
    ('SYS_ADMIN', 'moc', 'assign'),
    ('SYS_ADMIN', 'notifications', 'view'),
    ('SYS_ADMIN', 'notifications', 'create'),
    ('SYS_ADMIN', 'notifications', 'edit'),
    ('SYS_ADMIN', 'notifications', 'delete'),
    ('SYS_ADMIN', 'notifications', 'approve'),
    ('SYS_ADMIN', 'notifications', 'authorize'),
    ('SYS_ADMIN', 'notifications', 'viewCosts'),
    ('SYS_ADMIN', 'notifications', 'assign'),
    ('SYS_ADMIN', 'pm', 'view'),
    ('SYS_ADMIN', 'pm', 'create'),
    ('SYS_ADMIN', 'pm', 'edit'),
    ('SYS_ADMIN', 'pm', 'delete'),
    ('SYS_ADMIN', 'pm', 'approve'),
    ('SYS_ADMIN', 'pm', 'authorize'),
    ('SYS_ADMIN', 'pm', 'viewCosts'),
    ('SYS_ADMIN', 'pm', 'assign'),
    ('SYS_ADMIN', 'purchasing', 'view'),
    ('SYS_ADMIN', 'purchasing', 'create'),
    ('SYS_ADMIN', 'purchasing', 'edit'),
    ('SYS_ADMIN', 'purchasing', 'delete'),
    ('SYS_ADMIN', 'purchasing', 'approve'),
    ('SYS_ADMIN', 'purchasing', 'authorize'),
    ('SYS_ADMIN', 'purchasing', 'viewCosts'),
    ('SYS_ADMIN', 'purchasing', 'assign'),
    ('SYS_ADMIN', 'readings', 'view'),
    ('SYS_ADMIN', 'readings', 'create'),
    ('SYS_ADMIN', 'readings', 'edit'),
    ('SYS_ADMIN', 'readings', 'delete'),
    ('SYS_ADMIN', 'readings', 'approve'),
    ('SYS_ADMIN', 'readings', 'authorize'),
    ('SYS_ADMIN', 'readings', 'viewCosts'),
    ('SYS_ADMIN', 'readings', 'assign'),
    ('SYS_ADMIN', 'reliability', 'view'),
    ('SYS_ADMIN', 'reliability', 'create'),
    ('SYS_ADMIN', 'reliability', 'edit'),
    ('SYS_ADMIN', 'reliability', 'delete'),
    ('SYS_ADMIN', 'reliability', 'approve'),
    ('SYS_ADMIN', 'reliability', 'authorize'),
    ('SYS_ADMIN', 'reliability', 'viewCosts'),
    ('SYS_ADMIN', 'reliability', 'assign'),
    ('SYS_ADMIN', 'requests', 'view'),
    ('SYS_ADMIN', 'requests', 'create'),
    ('SYS_ADMIN', 'requests', 'edit'),
    ('SYS_ADMIN', 'requests', 'delete'),
    ('SYS_ADMIN', 'requests', 'approve'),
    ('SYS_ADMIN', 'requests', 'authorize'),
    ('SYS_ADMIN', 'requests', 'viewCosts'),
    ('SYS_ADMIN', 'requests', 'assign'),
    ('SYS_ADMIN', 'safety', 'view'),
    ('SYS_ADMIN', 'safety', 'create'),
    ('SYS_ADMIN', 'safety', 'edit'),
    ('SYS_ADMIN', 'safety', 'delete'),
    ('SYS_ADMIN', 'safety', 'approve'),
    ('SYS_ADMIN', 'safety', 'authorize'),
    ('SYS_ADMIN', 'safety', 'viewCosts'),
    ('SYS_ADMIN', 'safety', 'assign'),
    ('SYS_ADMIN', 'scheduling', 'view'),
    ('SYS_ADMIN', 'scheduling', 'create'),
    ('SYS_ADMIN', 'scheduling', 'edit'),
    ('SYS_ADMIN', 'scheduling', 'delete'),
    ('SYS_ADMIN', 'scheduling', 'approve'),
    ('SYS_ADMIN', 'scheduling', 'authorize'),
    ('SYS_ADMIN', 'scheduling', 'viewCosts'),
    ('SYS_ADMIN', 'scheduling', 'assign'),
    ('SYS_ADMIN', 'sustain', 'view'),
    ('SYS_ADMIN', 'sustain', 'create'),
    ('SYS_ADMIN', 'sustain', 'edit'),
    ('SYS_ADMIN', 'sustain', 'delete'),
    ('SYS_ADMIN', 'sustain', 'approve'),
    ('SYS_ADMIN', 'sustain', 'authorize'),
    ('SYS_ADMIN', 'sustain', 'viewCosts'),
    ('SYS_ADMIN', 'sustain', 'assign'),
    ('SYS_ADMIN', 'taskLibrary', 'view'),
    ('SYS_ADMIN', 'taskLibrary', 'create'),
    ('SYS_ADMIN', 'taskLibrary', 'edit'),
    ('SYS_ADMIN', 'taskLibrary', 'delete'),
    ('SYS_ADMIN', 'taskLibrary', 'approve'),
    ('SYS_ADMIN', 'taskLibrary', 'authorize'),
    ('SYS_ADMIN', 'taskLibrary', 'viewCosts'),
    ('SYS_ADMIN', 'taskLibrary', 'assign'),
    ('SYS_ADMIN', 'vendors', 'view'),
    ('SYS_ADMIN', 'vendors', 'create'),
    ('SYS_ADMIN', 'vendors', 'edit'),
    ('SYS_ADMIN', 'vendors', 'delete'),
    ('SYS_ADMIN', 'vendors', 'approve'),
    ('SYS_ADMIN', 'vendors', 'authorize'),
    ('SYS_ADMIN', 'vendors', 'viewCosts'),
    ('SYS_ADMIN', 'vendors', 'assign'),
    ('SYS_ADMIN', 'workOrders', 'view'),
    ('SYS_ADMIN', 'workOrders', 'create'),
    ('SYS_ADMIN', 'workOrders', 'edit'),
    ('SYS_ADMIN', 'workOrders', 'delete'),
    ('SYS_ADMIN', 'workOrders', 'approve'),
    ('SYS_ADMIN', 'workOrders', 'authorize'),
    ('SYS_ADMIN', 'workOrders', 'viewCosts'),
    ('SYS_ADMIN', 'workOrders', 'assign'),
    ('TECHNICIAN', 'assets', 'view'),
    ('TECHNICIAN', 'assets', 'edit'),
    ('TECHNICIAN', 'audits', 'view'),
    ('TECHNICIAN', 'contacts', 'view'),
    ('TECHNICIAN', 'dashboard', 'view'),
    ('TECHNICIAN', 'inventory', 'view'),
    ('TECHNICIAN', 'notifications', 'view'),
    ('TECHNICIAN', 'notifications', 'create'),
    ('TECHNICIAN', 'notifications', 'edit'),
    ('TECHNICIAN', 'pm', 'view'),
    ('TECHNICIAN', 'readings', 'view'),
    ('TECHNICIAN', 'readings', 'create'),
    ('TECHNICIAN', 'readings', 'edit'),
    ('TECHNICIAN', 'reliability', 'view'),
    ('TECHNICIAN', 'requests', 'view'),
    ('TECHNICIAN', 'requests', 'create'),
    ('TECHNICIAN', 'requests', 'edit'),
    ('TECHNICIAN', 'safety', 'view'),
    ('TECHNICIAN', 'safety', 'create'),
    ('TECHNICIAN', 'scheduling', 'view'),
    ('TECHNICIAN', 'taskLibrary', 'view'),
    ('TECHNICIAN', 'workOrders', 'view'),
    ('TECHNICIAN', 'workOrders', 'edit'),
    ('__default__', 'assets', 'view'),
    ('__default__', 'audits', 'view'),
    ('__default__', 'contacts', 'view'),
    ('__default__', 'dashboard', 'view'),
    ('__default__', 'inventory', 'view'),
    ('__default__', 'notifications', 'view'),
    ('__default__', 'pm', 'view'),
    ('__default__', 'purchasing', 'view'),
    ('__default__', 'requests', 'view'),
    ('__default__', 'requests', 'create'),
    ('__default__', 'scheduling', 'view'),
    ('__default__', 'taskLibrary', 'view'),
    ('__default__', 'vendors', 'view'),
    ('__default__', 'workOrders', 'view');
-- ── END GENERATED SEED ──

COMMIT;

-- VERIFY (after apply):
--   SELECT name, module, event_trigger, action_required, recipients FROM notification_rules
--    WHERE module IN ('requests','workOrders') ORDER BY module, name;
--   SELECT public.priority_lead_interval('HIGH');            -- 1 day
--   SELECT public.ers_request_sla_sweep();                   -- 0 on a quiet board
--   SELECT jobname, schedule FROM cron.job WHERE jobname = 'request-sla-sweep';
