-- 0282 — GDPR mechanics: erase_person() + retention sweeps.
--
-- Closes the [BUILD] items in docs/compliance/data-retention-policy.md:
--
--   1. erase_person(contact_id) — one audited call instead of a runbook.
--      Implements the policy's reconciliation: EVENTS ARE KEPT, IDENTITIES
--      ARE REMOVABLE. Audit rows survive with the actor pseudonymised (the
--      0024 pattern); the contact row is anonymised in place (history keeps
--      its FKs); directly identifying artefacts (avatar, invites,
--      notifications) are deleted.
--
--   2. pg_cron retention sweeps for the schedule's 12-month rows
--      (notifications, notification logs/outbox, AI audit log) and expired
--      invites (+90 days). SQL-only jobs — no edge function, no secrets.
--
-- What this deliberately does NOT do:
--   · Delete auth accounts — that is the existing admin-gated
--     delete_auth_user RPC (0164); erase_person deactivates the app user and
--     the DSR runbook calls both.
--   · Touch operational history (work orders, labor, safety sign-offs) —
--     pseudonymisation of the contact covers joined display; safety records
--     may be under statutory hold (policy P-5).
--   · Sweep audit_logs — append-only forever, identities pseudonymised only.
--
-- Atomic.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. erase_person
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.erase_person(p_contact_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_contact   record;
    v_user_id   uuid;
    v_avatar    text;
    v_audit     int := 0;
    v_ai        int := 0;
    v_notif     int := 0;
    v_invites   int := 0;
BEGIN
    -- SECURITY DEFINER bypasses RLS, so authorisation is explicit:
    -- caller must be an active admin of the tenant that owns the contact.
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'erase_person: admin only';
    END IF;

    SELECT * INTO v_contact FROM public.contacts WHERE id = p_contact_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'erase_person: contact % not found', p_contact_id;
    END IF;
    IF v_contact.company_id IS DISTINCT FROM (SELECT public.caller_company()) THEN
        RAISE EXCEPTION 'erase_person: contact belongs to another tenant';
    END IF;

    v_user_id := v_contact.user_id;
    v_avatar  := v_contact.image_url;

    -- (a) Anonymise the contact in place. The row survives so FK-bearing
    -- history (work orders, labor, sign-off references) stays intact.
    UPDATE public.contacts SET
        name        = 'Removed person',
        first_name  = NULL,
        last_name   = NULL,
        email       = NULL,
        phone       = NULL,
        mobile      = NULL,
        image_url   = NULL,
        address     = NULL,
        is_active   = false
    WHERE id = p_contact_id;

    -- (b) Avatar object: remove the storage row (access dies immediately;
    -- the CI storage audit's orphan check covers the backing file).
    IF v_avatar IS NOT NULL AND v_avatar <> '' THEN
        DELETE FROM storage.objects
         WHERE bucket_id = 'avatars'
           AND name = regexp_replace(v_avatar, '^avatars/', '');
    END IF;

    -- (c) Pseudonymise the audit trail (0024 pattern): events kept, actor
    -- reference cleared. Both identity shapes are in the wild.
    IF v_user_id IS NOT NULL THEN
        UPDATE public.audit_logs SET changed_by = NULL WHERE changed_by = v_user_id;
        GET DIAGNOSTICS v_audit = ROW_COUNT;
        UPDATE public.ers_ai_audit_log SET username = 'removed' WHERE user_id = v_user_id;
        GET DIAGNOSTICS v_ai = ROW_COUNT;
        -- Deactivate the app user; auth deletion is delete_auth_user (0164).
        UPDATE public.users SET is_active = false WHERE id = v_user_id;
    END IF;

    -- (d) Direct identifiers with no historical value: delete.
    DELETE FROM public.notifications
     WHERE recipient_id IN (p_contact_id::text, v_user_id::text);
    GET DIAGNOSTICS v_notif = ROW_COUNT;

    IF v_contact.email IS NOT NULL THEN
        DELETE FROM public.user_invites WHERE lower(email) = lower(v_contact.email);
        GET DIAGNOSTICS v_invites = ROW_COUNT;
    END IF;

    -- (e) The erasure itself is an auditable event (Art. 5(2)).
    INSERT INTO public.audit_logs (table_name, record_id, action, changed_by, changes)
    VALUES ('contacts', p_contact_id::text, 'GDPR_ERASURE', auth.uid(),
            jsonb_build_object(
                'audit_rows_pseudonymised', v_audit,
                'ai_log_rows_pseudonymised', v_ai,
                'notifications_deleted', v_notif,
                'invites_deleted', v_invites,
                'avatar_removed', v_avatar IS NOT NULL,
                'auth_user_remaining', v_user_id IS NOT NULL));

    RETURN jsonb_build_object(
        'contact_id', p_contact_id,
        'audit_rows_pseudonymised', v_audit,
        'ai_log_rows_pseudonymised', v_ai,
        'notifications_deleted', v_notif,
        'invites_deleted', v_invites,
        'auth_user_to_delete', v_user_id);
END;
$$;

COMMENT ON FUNCTION public.erase_person(uuid) IS
    '0282: GDPR Art. 17 erasure — anonymise contact, pseudonymise audit trail (events kept), delete avatar/notifications/invites. Admin-only, tenant-checked, self-auditing. Auth deletion stays with delete_auth_user (0164).';

REVOKE ALL ON FUNCTION public.erase_person(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.erase_person(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Retention sweeps (schedule rows from the retention policy)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.retention_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v jsonb := '{}'::jsonb;
    n int;
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

    -- Sweep evidence: the run itself is recorded (retention policy is
    -- operating, not just written — this is what an auditor samples).
    INSERT INTO public.audit_logs (table_name, record_id, action, changed_by, changes)
    VALUES ('retention_sweep', to_char(now(), 'YYYY-MM-DD'), 'RETENTION_SWEEP', NULL, v);

    RETURN v;
END;
$$;

COMMENT ON FUNCTION public.retention_sweep() IS
    '0282: monthly retention sweep per docs/compliance/data-retention-policy.md — 12-month rows (notifications, notification logs/outbox, AI audit log) and expired invites +90d. Self-auditing.';

REVOKE ALL ON FUNCTION public.retention_sweep() FROM public, anon, authenticated;

-- Monthly, 03:10 on the 1st. Tenant-portable guard (0223 pattern): skip
-- silently where pg_cron is absent; re-schedule idempotently where present.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RAISE NOTICE '0282: pg_cron absent — schedule retention-sweep manually on this project.';
        RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'gdpr-retention-sweep') THEN
        PERFORM cron.unschedule('gdpr-retention-sweep');
    END IF;
    PERFORM cron.schedule('gdpr-retention-sweep', '10 3 1 * *',
                          'SELECT public.retention_sweep()');
END $$;

COMMIT;
