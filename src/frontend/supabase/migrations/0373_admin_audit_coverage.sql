-- 0373 — the audit trail covers administrative change
--
-- WHAT WAS WRONG
--   audit_logs has carried triggers since 0000, on assets, work_orders,
--   dictionaries and inventory (plus journal_entries and the RCA tables later).
--   Those are the operational tables. Nothing watched the administrative ones:
--   a permission grant, a user account, the company record, a data connector,
--   an ingest key and the hierarchy level model could all be changed without
--   leaving a row behind. The Admin Activity Log is sold as "Full audit trail —
--   Who changed What, When, and Where" and is gated to SUPER_ADMIN, so the one
--   log a reviewer asks for was the one blind to privileged change.
--
--   This cannot be backfilled. Every day it stays off is a day with no record.
--
-- WHY A SECOND FUNCTION RATHER THAN MORE TRIGGERS ON log_audit_event()
--   Two reasons, both fatal to the simple approach:
--
--   1. SECRETS. log_audit_event() stores to_jsonb(NEW) whole. connectors.config
--      holds api_key, auth_token and basic-auth passwords in clear text. Putting
--      that function on connectors would copy every credential into audit_logs
--      on each save, and audit_logs is append-only and long-lived — it would be
--      the worst place in the database to keep them. This function redacts the
--      known secret-bearing keys before the row is written.
--
--   2. KEYS. log_audit_event() writes NEW.id::TEXT. role_permissions has no id
--      column at all: its primary key is (role, module, action). The trigger
--      would raise on every write and, because it is a BEFORE/AFTER trigger on
--      the statement path, take the write with it. This function derives a
--      record key and falls back to the composite one.
--
-- SAFE TO RE-RUN.

BEGIN;

-- ── The redacting audit function ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_admin_audit_event()
RETURNS TRIGGER AS $$
DECLARE
    v_user      UUID;
    v_old       JSONB;
    v_new       JSONB;
    v_payload   JSONB;    -- whichever side carries the identity of the row
    v_changes   JSONB;
    v_record_id TEXT;
    v_company   UUID;
    -- Anything whose VALUE is a credential. Matched case-insensitively against
    -- the key name, at the top level and one level into `config`.
    c_secret_keys TEXT[] := ARRAY[
        'config', 'api_key', 'apikey', 'auth_token', 'token', 'password',
        'secret', 'client_secret', 'key_hash', 'private_key', 'credentials'
    ];
BEGIN
    BEGIN
        v_user := auth.uid();
    EXCEPTION WHEN OTHERS THEN
        v_user := NULL;
    END;

    IF TG_OP = 'DELETE' THEN
        v_old := to_jsonb(OLD);
    ELSIF TG_OP = 'INSERT' THEN
        v_new := to_jsonb(NEW);
    ELSE
        v_old := to_jsonb(OLD);
        v_new := to_jsonb(NEW);
    END IF;

    v_payload := coalesce(v_new, v_old);

    -- Redact. The key is kept with a marker so a reader can see THAT a
    -- credential changed without the audit row handing them the credential.
    IF v_old IS NOT NULL THEN
        SELECT jsonb_object_agg(k, CASE WHEN lower(k) = ANY (c_secret_keys) THEN '"[redacted]"'::jsonb ELSE val END)
          INTO v_old FROM jsonb_each(v_old) AS t(k, val);
    END IF;
    IF v_new IS NOT NULL THEN
        SELECT jsonb_object_agg(k, CASE WHEN lower(k) = ANY (c_secret_keys) THEN '"[redacted]"'::jsonb ELSE val END)
          INTO v_new FROM jsonb_each(v_new) AS t(k, val);
    END IF;

    v_changes := jsonb_strip_nulls(jsonb_build_object('old', v_old, 'new', v_new));

    -- Record key: id when the table has one, else the composite that identifies
    -- the row (role_permissions), else a marker rather than a NULL — record_id
    -- is NOT NULL and a failed audit insert would roll back the caller's write.
    v_record_id := coalesce(
        nullif(v_payload->>'id', ''),
        nullif(concat_ws(':', v_payload->>'role', v_payload->>'module', v_payload->>'action'), ''),
        nullif(v_payload->>'code', ''),
        '(composite)'
    );

    -- Tenant: the row's own company, the company row itself, else the caller's.
    v_company := coalesce(
        nullif(v_payload->>'company_id', '')::uuid,
        CASE WHEN TG_TABLE_NAME = 'companies' THEN nullif(v_payload->>'id', '')::uuid END,
        public.caller_company()
    );

    -- A tenantless administrative change (a cron or service-role write with no
    -- session) must not abort the write it is auditing. company_id is NOT NULL
    -- since 0276, so skip the log rather than fail the transaction.
    IF v_company IS NULL THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    INSERT INTO public.audit_logs (table_name, record_id, action, changed_by, changes, company_id)
    VALUES (TG_TABLE_NAME, v_record_id, TG_OP, v_user, v_changes, v_company);

    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog;

COMMENT ON FUNCTION public.log_admin_audit_event() IS
    'Audit trigger for administrative tables (0373). Redacts credential-bearing columns and derives a record key for tables with no id column. Skips the log rather than failing the write when no tenant can be resolved.';

REVOKE ALL ON FUNCTION public.log_admin_audit_event() FROM public, anon;

-- ── Attach it ────────────────────────────────────────────────────────────────
-- Only to tables that exist: a project that has not run every optional
-- migration must still apply this one.
DO $$
DECLARE
    t TEXT;
    -- Every table the Admin section can change and the trail could not see.
    targets TEXT[] := ARRAY[
        'users',                -- accounts, role grants, permission overrides
        'companies',            -- the tenant record itself
        'role_permissions',     -- the permission matrix RLS reads
        'connectors',           -- data feeds (config redacted above)
        'ers_collector_keys',   -- ingest API keys (hash redacted above)
        'hierarchy_config',     -- asset level model, drives numbering
        'numbering_config',     -- number ranges
        'work_centers'          -- costed capacity, feeds settlement
    ];
BEGIN
    FOREACH t IN ARRAY targets LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = t
        ) THEN
            EXECUTE format('DROP TRIGGER IF EXISTS audit_%1$s_admin ON public.%1$I', t);
            EXECUTE format(
                'CREATE TRIGGER audit_%1$s_admin
                 AFTER INSERT OR UPDATE OR DELETE ON public.%1$I
                 FOR EACH ROW EXECUTE FUNCTION public.log_admin_audit_event()', t);
            RAISE NOTICE '0373: audit trigger on %', t;
        ELSE
            RAISE NOTICE '0373: skipped % (table absent)', t;
        END IF;
    END LOOP;
END $$;

COMMIT;

-- VERIFY
--   SELECT c.relname
--     FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
--    WHERE t.tgname LIKE 'audit_%_admin' ORDER BY 1;
--   -- expect: companies, connectors, ers_collector_keys, hierarchy_config,
--   --         numbering_config, role_permissions, users, work_centers
--
--   -- and that a connector save logs nothing sensitive:
--   SELECT changes->'new'->>'config' FROM audit_logs
--    WHERE table_name = 'connectors' ORDER BY timestamp DESC LIMIT 1;
--   -- expect: [redacted]
