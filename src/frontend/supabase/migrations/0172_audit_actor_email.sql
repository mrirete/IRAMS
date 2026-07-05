-- ═══════════════════════════════════════════════════════════════════════
-- 0172: Capture the acting user's email in the audit trigger
-- ═══════════════════════════════════════════════════════════════════════
-- The audit trail showed "by System" for every create/edit. Root cause: the
-- trigger stored changed_by = auth.uid() (the SUPABASE AUTH user's UUID), but
-- the app resolves names against public.users.id — a DIFFERENT UUID (the two
-- are linked by EMAIL, not id). So the lookup never matched. And some real
-- operators (e.g. efosa01) have no public.users row at all — they are
-- auth-only — so an id-based lookup could never name them.
--
-- Fix: also stamp the JWT email (auth.jwt() ->> 'email') into the audit row's
-- `changes` JSON as `actor_email`. Email is present for EVERY authenticated
-- write, users-row or not, and the app already knows how to map an email to a
-- person. changed_by is preserved unchanged. No table/schema change — this
-- only enriches the JSON, so old rows keep working and the many triggers that
-- call this one function all benefit at once.
--
-- Writes made without a JWT (service role / SQL editor / seed) have no email;
-- actor_email stays NULL and the app shows "System" — which is correct.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION log_audit_event()
RETURNS TRIGGER AS $$
DECLARE
    user_id UUID;
    actor_email TEXT;
    old_data JSONB;
    new_data JSONB;
    changes_json JSONB;
BEGIN
    -- Identity from the request JWT (both may be NULL for system writes).
    BEGIN
        user_id := auth.uid();
    EXCEPTION WHEN OTHERS THEN
        user_id := NULL;
    END;
    BEGIN
        actor_email := auth.jwt() ->> 'email';
    EXCEPTION WHEN OTHERS THEN
        actor_email := NULL;
    END;

    IF (TG_OP = 'DELETE') THEN
        old_data := to_jsonb(OLD);
        changes_json := jsonb_build_object('old', old_data, 'actor_email', actor_email);
        INSERT INTO audit_logs (table_name, record_id, action, changed_by, changes)
        VALUES (TG_TABLE_NAME, OLD.id::TEXT, 'DELETE', user_id, changes_json);
        RETURN OLD;
    ELSIF (TG_OP = 'UPDATE') THEN
        old_data := to_jsonb(OLD);
        new_data := to_jsonb(NEW);
        changes_json := jsonb_build_object('old', old_data, 'new', new_data, 'actor_email', actor_email);
        INSERT INTO audit_logs (table_name, record_id, action, changed_by, changes)
        VALUES (TG_TABLE_NAME, NEW.id::TEXT, 'UPDATE', user_id, changes_json);
        RETURN NEW;
    ELSIF (TG_OP = 'INSERT') THEN
        new_data := to_jsonb(NEW);
        changes_json := jsonb_build_object('new', new_data, 'actor_email', actor_email);
        INSERT INTO audit_logs (table_name, record_id, action, changed_by, changes)
        VALUES (TG_TABLE_NAME, NEW.id::TEXT, 'INSERT', user_id, changes_json);
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════
-- Note: this attributes actions from NOW ON. Rows written before this
-- migration have no actor_email and will still show "System" (their acting
-- identity was never recorded and cannot be reconstructed).
-- ═══════════════════════════════════════════════════════════════════════
