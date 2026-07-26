-- ═══════════════════════════════════════════════════════════════
-- 0225 — Close the remaining gaps between the live database and
--        what the migration set actually produces
--
-- Once history replayed cleanly (5fef401), a replayed database could
-- be diffed against the origin. The origin turned out to be missing
-- objects that migrations 0051, 0082, 0149 and several audit-trigger
-- migrations were supposed to create — they had failed silently,
-- statement by statement, over the years.
--
-- 0189 (messages/thread_reads), 0049 (stock sync) and 0082 carry their
-- own guards and were simply re-applied. The objects below could not
-- be, because their source files contain unguarded CREATE POLICY
-- statements that now collide, so they are recreated here instead.
--
-- Everything is idempotent: CREATE OR REPLACE for functions,
-- DROP … IF EXISTS before each trigger, existence checks around
-- anything that could collide. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════
BEGIN;

-- ── 0. ers_agent_actions: realign with 0149 ─────────────────────
-- THE MOST CONSEQUENTIAL REPAIR HERE. The deployed table had drifted
-- from 0149 in ways that silently disabled the Specialist's entire
-- human-in-the-loop proposal flow — the governance the product rests
-- on. The table held ZERO rows because every insert was rejected:
--
--   • CHECK constraints on agent_type and action_type that appear in
--     NO migration, restricting them to three legacy values each
--     ('alert_to_wo'/'bad_actor_rca'/'threshold_adapter' and
--     'wr_draft'/'rca_draft'/'threshold_proposal'). Every proposal
--     from bad_actor_hunter/draft_de_task and weibull_analyst/
--     draft_pm_interval violated them.
--   • asset_id and trigger_id NOT NULL, though 0149 makes both
--     nullable — agent-run supplies neither for fleet-wide proposals.
--   • updated_at missing entirely.
--
-- The status CHECK is genuine (0149 defines it) and is left alone.
ALTER TABLE public.ers_agent_actions
    DROP CONSTRAINT IF EXISTS ers_agent_actions_action_type_check,
    DROP CONSTRAINT IF EXISTS ers_agent_actions_agent_type_check;

ALTER TABLE public.ers_agent_actions
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
DECLARE
    col TEXT;
BEGIN
    FOREACH col IN ARRAY ARRAY['trigger_id','asset_id','reviewed_by','reviewed_at','review_notes'] LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema='public' AND table_name='ers_agent_actions'
              AND column_name=col AND is_nullable='NO'
        ) THEN
            EXECUTE format('ALTER TABLE public.ers_agent_actions ALTER COLUMN %I DROP NOT NULL', col);
        END IF;
    END LOOP;
END $$;

-- ── 1. From 0149 — lost when the file died partway through ──────
-- ers_agent_actions.updated_at has never moved: the Specialist's
-- proposal queue reports its creation time as its last-modified time.
CREATE OR REPLACE FUNCTION public.update_agent_action_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF to_regclass('public.ers_agent_actions') IS NOT NULL THEN
        DROP TRIGGER IF EXISTS trg_agent_action_updated ON public.ers_agent_actions;
        CREATE TRIGGER trg_agent_action_updated
            BEFORE UPDATE ON public.ers_agent_actions
            FOR EACH ROW EXECUTE FUNCTION public.update_agent_action_timestamp();
    END IF;
END $$;

-- The NL-to-SQL sandbox. Service-role only, SELECT-only, 10s timeout.
CREATE OR REPLACE FUNCTION public.execute_readonly_sql(query_text TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '10s'
AS $$
DECLARE
    result JSONB;
BEGIN
    IF NOT (UPPER(TRIM(query_text)) LIKE 'SELECT%') THEN
        RAISE EXCEPTION 'Only SELECT queries are allowed';
    END IF;

    IF query_text ~* '\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|EXEC|EXECUTE)\b' THEN
        RAISE EXCEPTION 'Query contains forbidden SQL keywords';
    END IF;

    SET LOCAL transaction_read_only = ON;
    EXECUTE 'SELECT jsonb_agg(row_to_json(t)) FROM (' || query_text || ') t' INTO result;

    RETURN COALESCE(result, '[]'::jsonb);
EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'SQL execution error: %', SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_readonly_sql(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.execute_readonly_sql(TEXT) TO service_role;

-- ── 2. From 0051 — permit numbers were never auto-generated ─────
CREATE OR REPLACE FUNCTION public.generate_permit_number()
RETURNS TRIGGER AS $$
DECLARE
    next_seq INT;
BEGIN
    SELECT COALESCE(MAX(
        CAST(SUBSTRING(permit_number FROM 'PTW-\d{4}-(\d+)') AS INT)
    ), 0) + 1
    INTO next_seq
    FROM public.ptw_permits
    WHERE permit_number LIKE 'PTW-' || EXTRACT(YEAR FROM NOW())::TEXT || '-%';

    NEW.permit_number := 'PTW-' || EXTRACT(YEAR FROM NOW())::TEXT || '-' || LPAD(next_seq::TEXT, 3, '0');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF to_regclass('public.ptw_permits') IS NOT NULL THEN
        DROP TRIGGER IF EXISTS trg_permit_number ON public.ptw_permits;
        CREATE TRIGGER trg_permit_number
            BEFORE INSERT ON public.ptw_permits
            FOR EACH ROW
            WHEN (NEW.permit_number IS NULL)
            EXECUTE FUNCTION public.generate_permit_number();
    END IF;
END $$;

-- ── 3. Audit trail — nine tables had none ───────────────────────
-- log_audit_event() exists and is attached elsewhere; these tables
-- were simply never wired up, so every change to them went unrecorded.
DO $$
DECLARE
    spec RECORD;
BEGIN
    IF to_regprocedure('public.log_audit_event()') IS NULL THEN
        RAISE NOTICE '0225: log_audit_event() missing — audit triggers skipped';
        RETURN;
    END IF;

    FOR spec IN
        SELECT * FROM (VALUES
            ('audit_files_changes',        'entity_files'),
            ('audit_inventory_stock_changes', 'inventory_stock'),
            ('audit_job_tasks_changes',    'job_tasks'),
            ('audit_models_changes',       'manufacturer_models'),
            ('audit_org_members_changes',  'organization_unit_members'),
            ('audit_org_units_changes',    'organization_units'),
            ('audit_qualifications_changes', 'qualifications'),
            ('audit_wo_labor_changes',     'work_order_labor'),
            ('audit_wo_parts_changes',     'work_order_parts')
        ) AS t(trg, tbl)
    LOOP
        IF to_regclass('public.' || spec.tbl) IS NULL THEN
            RAISE NOTICE '0225: % absent — audit trigger skipped', spec.tbl;
            CONTINUE;
        END IF;
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', spec.trg, spec.tbl);
        EXECUTE format(
            'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I '
            'FOR EACH ROW EXECUTE FUNCTION public.log_audit_event()',
            spec.trg, spec.tbl
        );
    END LOOP;
END $$;

COMMIT;
