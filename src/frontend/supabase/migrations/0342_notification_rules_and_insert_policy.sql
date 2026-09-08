-- 0342 — notifications: one copy of each rule, sane fan-out, no spoofing.
--
-- From the 2026-09-08 assurance run (P2-18, P2-19):
--   • every notification rule existed twice per tenant (a re-run seed), so
--     each event could dispatch twice;
--   • "Work Request" fanned out to every SYS_ADMIN and REQUESTER-role
--     contact (9 people including service accounts) — the supervisor,
--     planner and the responsible work-centre crew are the triage owners;
--   • any authenticated user could insert a notification addressed to
--     anyone in the tenant with any created_by. The app now stamps
--     created_by from the session and the policy requires it to match.

-- 1. De-duplicate rules: keep the oldest row per (company, name, event).
DELETE FROM public.notification_rules r
 USING public.notification_rules k
 WHERE r.company_id IS NOT DISTINCT FROM k.company_id
   AND r.name = k.name
   AND r.event_trigger = k.event_trigger
   AND (r.created_at, r.id::text) > (k.created_at, k.id::text);  -- seed copies share created_at; id breaks the tie

-- 2. New-request fan-out: triage owners only.
UPDATE public.notification_rules
   SET recipients = (
        SELECT coalesce(jsonb_agg(x), '[]'::jsonb)
          FROM jsonb_array_elements(recipients) x
         WHERE NOT (x->>'type' = 'ROLE' AND upper(x->>'targetId') IN ('REQUESTER', 'SYS_ADMIN', 'SUPER_ADMIN'))
           AND NOT (x->>'type' = 'DYNAMIC' AND lower(x->>'targetId') = 'assignee')
       ),
       updated_at = now()
 WHERE event_trigger = 'SR_CREATED';

-- 3. Insert policy: a row is written by the person the session belongs to.
DROP POLICY IF EXISTS p2_insert_notifications ON public.notifications;
DROP POLICY IF EXISTS scoped_insert_notifications ON public.notifications;
CREATE POLICY scoped_insert_notifications ON public.notifications
    FOR INSERT TO authenticated
    WITH CHECK (
        company_id = (SELECT public.caller_company())
        AND (created_by = (SELECT public.caller_user_id())::text OR (SELECT public.is_admin()))
    );
COMMENT ON POLICY scoped_insert_notifications ON public.notifications IS
    '0342: created_by must be the caller (the app stamps it from the session); admins may write on behalf of the system.';
