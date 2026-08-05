-- ════════════════════════════════════════════════════════════════════════════
-- 0276 — Tenancy: company_id becomes NOT NULL, and the writers earn it
--
-- 0259 deliberately left company_id NULLABLE because five cron jobs write with
-- no JWT: caller_company() returns NULL, the DEFAULT evaluates to NULL, and
-- the row lands with no tenant. Measured today, that has already happened 809
-- times across exactly five tables:
--
--     audit_logs            786    the audit trigger, on service-role writes
--     ers_ai_audit_log       14    agent-run
--     notification_outbox     3    the nightly watchdog
--     notifications           3    the nightly watchdog
--     ers_ai_usage_daily      3    agent-run
--
-- A NULL company_id row is invisible to every tenant — the tenant conjunct
-- fails for everyone. These are rows the system wrote and then lost. Every one
-- predates the existence of any second tenant, so they all belong to the
-- origin, and the backfill below says so.
--
-- Three parts, in dependency order: teach the writers, repair the past,
-- then make the invariant a constraint.
--
-- ── 1. log_audit_event derives from the AUDITED ROW ─────────────────────────
-- The audit row's tenant is the tenant of the record that changed — available
-- in the old/new jsonb the function already builds. Deriving from auth would
-- be wrong twice over: it is NULL for service writes (notify-dispatch PATCHes
-- outbox rows, and each PATCH fires this trigger), and even when present it
-- answers "who did it", not "whose record is it".
--
-- Patched surgically via replace() on pg_get_functiondef — the 0272 technique —
-- because a hand-transcribed CREATE OR REPLACE is how function bodies drift.
--
-- ── 2. a generic stamp for everything else ──────────────────────────────────
-- BEFORE INSERT on every tenant-owned table. Column DEFAULTs are applied
-- before triggers run, so an authenticated insert arrives with company_id
-- already set and the trigger is a single IF. A service-role insert arrives
-- NULL and the trigger derives the tenant from the row's own parent:
-- asset_id → assets, user_id/changed_by → users, recipient columns → users
-- then contacts, connector_id → connectors, contact_id → contacts. If nothing
-- derives, it stays NULL — and part 3 turns that into a LOUD error instead of
-- an invisible row, which is the entire point.
--
-- Named aa_stamp_tenant so it fires before other BEFORE triggers
-- (alphabetical within the same event) and they see the stamped value.
--
-- ── What stays nullable, with reasons ───────────────────────────────────────
--   users            create_auth_user inserts the row first; provisioning
--                    stamps company_id in the next statement
--   the six config tables    NULL is a VALUE there (= global product row)
--   companies        has no company_id; it IS the tenant
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. the audit trigger ────────────────────────────────────────────────────
DO $$
DECLARE def text;
BEGIN
    SELECT pg_get_functiondef(p.oid) INTO def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'log_audit_event';

    IF def NOT LIKE '%(table_name, record_id, action, changed_by, changes)%' THEN
        RAISE EXCEPTION 'log_audit_event INSERT shape not found — the function changed, update 0276';
    END IF;

    def := replace(def,
        'INSERT INTO audit_logs (table_name, record_id, action, changed_by, changes)',
        'INSERT INTO audit_logs (table_name, record_id, action, changed_by, changes, company_id)');
    def := replace(def,
        $q$VALUES (TG_TABLE_NAME, OLD.id::TEXT, 'DELETE', user_id, changes_json);$q$,
        $q$VALUES (TG_TABLE_NAME, OLD.id::TEXT, 'DELETE', user_id, changes_json,
                   coalesce(nullif(old_data->>'company_id','')::uuid,
                            CASE WHEN TG_TABLE_NAME = 'companies' THEN nullif(old_data->>'id','')::uuid END,
                            public.caller_company()));$q$);
    def := replace(def,
        $q$VALUES (TG_TABLE_NAME, NEW.id::TEXT, 'UPDATE', user_id, changes_json);$q$,
        $q$VALUES (TG_TABLE_NAME, NEW.id::TEXT, 'UPDATE', user_id, changes_json,
                   coalesce(nullif(new_data->>'company_id','')::uuid,
                            CASE WHEN TG_TABLE_NAME = 'companies' THEN nullif(new_data->>'id','')::uuid END,
                            public.caller_company()));$q$);
    def := replace(def,
        $q$VALUES (TG_TABLE_NAME, NEW.id::TEXT, 'INSERT', user_id, changes_json);$q$,
        $q$VALUES (TG_TABLE_NAME, NEW.id::TEXT, 'INSERT', user_id, changes_json,
                   coalesce(nullif(new_data->>'company_id','')::uuid,
                            CASE WHEN TG_TABLE_NAME = 'companies' THEN nullif(new_data->>'id','')::uuid END,
                            public.caller_company()));$q$);

    IF def NOT LIKE '%changes, company_id)%' THEN
        RAISE EXCEPTION 'log_audit_event patch did not take';
    END IF;
    EXECUTE def;
END $$;

-- ── 2. the generic stamp ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.stamp_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    j   jsonb;
    v   uuid;
    ref text;
BEGIN
    -- The common case: the DEFAULT already stamped it (defaults run before
    -- BEFORE-triggers), or the client supplied it. One IF and out.
    IF NEW.company_id IS NOT NULL THEN
        RETURN NEW;
    END IF;

    j := to_jsonb(NEW);

    -- asset-anchored rows (sensor points, readings, alerts, twin states…)
    ref := coalesce(j->>'asset_id', '');
    IF ref <> '' THEN
        SELECT company_id INTO v FROM public.assets WHERE id = ref::uuid;
        IF v IS NOT NULL THEN NEW.company_id := v; RETURN NEW; END IF;
    END IF;

    -- work-order-anchored rows
    ref := coalesce(j->>'wo_id', j->>'work_order_id', '');
    IF ref <> '' THEN
        SELECT company_id INTO v FROM public.work_orders WHERE id::text = ref;
        IF v IS NOT NULL THEN NEW.company_id := v; RETURN NEW; END IF;
    END IF;

    -- user-anchored rows (AI logs, usage counters)
    ref := coalesce(j->>'user_id', j->>'changed_by', '');
    IF ref <> '' THEN
        SELECT company_id INTO v FROM public.users WHERE id::text = ref;
        IF v IS NOT NULL THEN NEW.company_id := v; RETURN NEW; END IF;
    END IF;

    -- recipient-anchored rows (outbox, notifications) — recipient columns are
    -- TEXT and have historically held users.id OR contacts.id, so try both.
    ref := coalesce(j->>'recipient_user_id', j->>'recipient_id', '');
    IF ref <> '' THEN
        SELECT company_id INTO v FROM public.users WHERE id::text = ref;
        IF v IS NULL THEN
            SELECT company_id INTO v FROM public.contacts WHERE id::text = ref;
        END IF;
        IF v IS NOT NULL THEN NEW.company_id := v; RETURN NEW; END IF;
    END IF;

    ref := coalesce(j->>'connector_id', '');
    IF ref <> '' THEN
        SELECT company_id INTO v FROM public.connectors WHERE id::text = ref;
        IF v IS NOT NULL THEN NEW.company_id := v; RETURN NEW; END IF;
    END IF;

    ref := coalesce(j->>'contact_id', '');
    IF ref <> '' THEN
        SELECT company_id INTO v FROM public.contacts WHERE id::text = ref;
        IF v IS NOT NULL THEN NEW.company_id := v; RETURN NEW; END IF;
    END IF;

    -- Nothing derived. Leave it NULL: the NOT NULL constraint makes that a
    -- loud, attributable error at the writer, instead of a row no tenant can
    -- ever see. Silent loss is the failure mode this migration exists to end.
    RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
    FOR t IN
        SELECT c.relname FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND c.relname NOT IN ('companies', 'users',
                                'dictionaries', 'reference_codes', 'manufacturers', 'tax_codes',
                                'hierarchy_config', 'numbering_config')
          AND EXISTS (SELECT 1 FROM information_schema.columns col
                       WHERE col.table_schema = 'public' AND col.table_name = c.relname
                         AND col.column_name = 'company_id')
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS aa_stamp_tenant ON public.%I', t);
        EXECUTE format('CREATE TRIGGER aa_stamp_tenant BEFORE INSERT ON public.%I
                        FOR EACH ROW EXECUTE FUNCTION public.stamp_tenant()', t);
    END LOOP;
END $$;

-- ── 3. repair the past, then constrain the future ───────────────────────────
DO $$
DECLARE
    v_origin uuid;
    t        text;
    n        int;
    fixed    int := 0;
BEGIN
    SELECT id INTO v_origin FROM public.companies WHERE active ORDER BY created_at LIMIT 1;

    FOR t IN
        SELECT c.relname FROM pg_class c
        JOIN pg_namespace n2 ON n2.oid = c.relnamespace
        WHERE n2.nspname = 'public' AND c.relkind = 'r'
          AND c.relname NOT IN ('companies', 'users',
                                'dictionaries', 'reference_codes', 'manufacturers', 'tax_codes',
                                'hierarchy_config', 'numbering_config')
          AND EXISTS (SELECT 1 FROM information_schema.columns col
                       WHERE col.table_schema = 'public' AND col.table_name = c.relname
                         AND col.column_name = 'company_id')
        ORDER BY c.relname
    LOOP
        -- Every orphan predates the second tenant, so origin is not a guess.
        EXECUTE format('UPDATE public.%I SET company_id = $1 WHERE company_id IS NULL', t) USING v_origin;
        GET DIAGNOSTICS n = ROW_COUNT;
        fixed := fixed + n;

        EXECUTE format('SELECT count(*) FROM public.%I WHERE company_id IS NULL', t) INTO n;
        IF n > 0 THEN
            RAISE EXCEPTION '%: % NULL row(s) survived the backfill', t, n;
        END IF;
        EXECUTE format('ALTER TABLE public.%I ALTER COLUMN company_id SET NOT NULL', t);
    END LOOP;

    RAISE NOTICE 'backfilled % orphaned row(s); company_id NOT NULL everywhere it should be', fixed;
END $$;

-- ── 4. prove the stamp works where the orphans came from ────────────────────
DO $$
DECLARE
    v_origin uuid;
    v_user   uuid;
    v_co     uuid;
    v_id     uuid;
BEGIN
    SELECT id INTO v_origin FROM public.companies WHERE active ORDER BY created_at LIMIT 1;
    SELECT id INTO v_user FROM public.users WHERE email = 'admin001@cainergy.com';

    -- Simulate the watchdog: a sessionless INSERT naming only a recipient.
    -- caller_company() is NULL here, so only the trigger can save it.
    INSERT INTO public.notification_outbox (recipient_user_id, channel, subject, message, severity, module, status, attempts)
    VALUES (v_user::text, 'EMAIL', '__0276_probe__', 'probe', 'INFO', 'system', 'SKIPPED', 0)
    RETURNING id, company_id INTO v_id, v_co;
    DELETE FROM public.notification_outbox WHERE id = v_id;
    IF v_co IS DISTINCT FROM v_origin THEN
        RAISE EXCEPTION 'stamp failed: sessionless outbox insert got company_id % (wanted %)', v_co, v_origin;
    END IF;

    -- And the failure mode is now loud: an underivable sessionless insert must
    -- ERROR, not vanish.
    BEGIN
        INSERT INTO public.notification_outbox (recipient_user_id, channel, subject, message, severity, module, status, attempts)
        VALUES ('no-such-user', 'EMAIL', '__0276_probe2__', 'probe', 'INFO', 'system', 'SKIPPED', 0);
        RAISE EXCEPTION 'an underivable service insert was accepted — NOT NULL is not enforcing';
    EXCEPTION WHEN not_null_violation THEN
        NULL; -- exactly right
    END;

    RAISE NOTICE 'stamp verified: derivable inserts stamped, underivable inserts refused';
END $$;
