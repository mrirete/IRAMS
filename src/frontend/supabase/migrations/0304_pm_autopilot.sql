-- ═══════════════════════════════════════════════════════════════
-- 0304 — PM Autopilot: server-side generation of due PM work orders
--
-- Until now PM work orders were only generated when a human opened
-- Recurring Work and ran the Generator by hand. Nobody did after
-- 2026-03-05, so active monthly schedules sat frozen for six months
-- while "PM Overdue" escalations fired about the March occurrences.
--
-- This adds a daily sweep that generates due calendar PMs on the
-- server. Deliberately conservative:
--
--   • OPT-OUT, not surprise: companies.pm_auto_generate and
--     recurring_work.auto_generate both default ON, but a schedule
--     only ARMS once its first generated work order has been
--     COMPLETED by a human (COMP/TECO/CLOSED). Until the loop is
--     proven, the manual Generator remains the only writer — a
--     fresh import or demo org never gets flooded.
--   • One-open-at-a-time: while a generated WO for the schedule
--     (and asset) is still open, no second copy is stacked on it.
--     next_due_date is left where it is, so the miss stays visible
--     to the compliance metric instead of being rolled away.
--   • Calendar cadences only (Days/Weeks/Months/Years). Hours =
--     meter cadence — the meter/readings path owns those.
--   • Catch-up without flooding: a schedule stalled across N
--     periods gets ONE work order (due at the oldest missed date,
--     labelled with how many occurrences it covers), then rolls
--     forward past today.
--   • Mirrors DatabaseService.generateWOFromPM: full plan copy
--     (steps, JSA, labour, parts), ISO 14224 failure-context seed,
--     strategy-package absorption (0292). Copies are best-effort
--     per section — a failed copy never abandons a created WO.
--   • Cron has no JWT, so caller_company() is NULL: company_id is
--     stamped explicitly from the schedule on EVERY insert (0261
--     lesson: SECURITY DEFINER must derive the tenant itself).
-- ═══════════════════════════════════════════════════════════════
BEGIN;

ALTER TABLE public.companies
    ADD COLUMN IF NOT EXISTS pm_auto_generate boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.companies.pm_auto_generate IS
    '0304: org-level switch for the PM Autopilot sweep. Default on; schedules still arm individually.';

ALTER TABLE public.recurring_work
    ADD COLUMN IF NOT EXISTS auto_generate boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.recurring_work.auto_generate IS
    '0304: per-schedule Autopilot opt-out. Even when on, the sweep only takes a schedule after its first generated WO was completed.';

CREATE OR REPLACE FUNCTION public.pm_autogen_sweep()
RETURNS TABLE (schedule_id uuid, schedule_code text, wo_id uuid, action text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
    rw          record;
    r           jsonb;
    freq_unit   text;
    freq_int    int;
    due_at      timestamptz;
    nxt         timestamptz;
    covered     int;
    tgt_asset   uuid;
    v_wo        uuid;
    v_won       text;
    v_jsa       uuid;
    v_title     text;
    seq         bigint := (extract(epoch FROM clock_timestamp()) * 1000)::bigint;
    mine_days   int;
    absorber    text;
BEGIN
    FOR rw IN
        SELECT x.*
        FROM public.recurring_work x
        JOIN public.companies c ON c.id = x.company_id
        WHERE coalesce(c.pm_auto_generate, true)
          AND coalesce(x.auto_generate, true)
          AND (x.active IS TRUE OR upper(coalesce(x.status, '')) = 'ACTIVE')
          AND x.next_due_date IS NOT NULL
          AND x.next_due_date <= now()
        ORDER BY x.next_due_date
    LOOP
        r := to_jsonb(rw);
        freq_unit := upper(coalesce(nullif(r ->> 'frequency_type', ''), r ->> 'frequency_unit', ''));
        freq_int  := coalesce(nullif(r ->> 'interval', '')::int, nullif(r ->> 'frequency_interval', '')::int, 0);

        IF freq_int <= 0 OR freq_unit NOT IN ('DAYS', 'WEEKS', 'MONTHS', 'YEARS') THEN
            schedule_id := rw.id; schedule_code := rw.code; wo_id := NULL;
            action := format('skipped: non-calendar cadence (%s %s) — meter/readings path owns it', freq_int, initcap(lower(freq_unit)));
            RETURN NEXT; CONTINUE;
        END IF;

        -- ARMING: the loop must be proven by a human completing the first
        -- generated occurrence before the autopilot takes the schedule.
        IF NOT EXISTS (
            SELECT 1 FROM public.work_orders w
            WHERE w.recurring_work_id = rw.id
              AND upper(w.status::text) IN ('COMP', 'TECO', 'CLOSED')
        ) THEN
            schedule_id := rw.id; schedule_code := rw.code; wo_id := NULL;
            action := 'skipped: not armed — complete the first generated PM to enable autopilot';
            RETURN NEXT; CONTINUE;
        END IF;

        -- One-open-at-a-time: never stack a second copy on an open one.
        -- next_due_date deliberately stays put so the miss remains visible.
        IF EXISTS (
            SELECT 1 FROM public.work_orders w
            WHERE w.recurring_work_id = rw.id
              AND upper(w.status::text) NOT IN ('COMP', 'TECO', 'CLOSED', 'CANCELLED')
        ) THEN
            schedule_id := rw.id; schedule_code := rw.code; wo_id := NULL;
            action := 'skipped: previous generated WO still open';
            RETURN NEXT; CONTINUE;
        END IF;

        tgt_asset := rw.asset_id;
        IF tgt_asset IS NULL THEN
            schedule_id := rw.id; schedule_code := rw.code; wo_id := NULL;
            action := 'skipped: no asset on schedule (work_orders.asset_id is NOT NULL)';
            RETURN NEXT; CONTINUE;
        END IF;

        -- Strategy-package absorption (0292): if a LONGER package of the same
        -- strategy+asset is due the same day (interval an exact multiple),
        -- the longer service includes this scope — raise nothing, roll forward.
        absorber := NULL;
        IF rw.strategy_id IS NOT NULL AND coalesce(r ->> 'strategy_package', '') <> '' THEN
            SELECT sp.interval_days INTO mine_days
            FROM public.strategy_packages sp
            WHERE sp.strategy_id = rw.strategy_id AND sp.label = r ->> 'strategy_package';
            IF mine_days IS NOT NULL THEN
                SELECT s.strategy_package INTO absorber
                FROM public.recurring_work s
                JOIN public.strategy_packages sp2
                  ON sp2.strategy_id = s.strategy_id AND sp2.label = s.strategy_package
                WHERE s.strategy_id = rw.strategy_id
                  AND s.asset_id = tgt_asset
                  AND s.id <> rw.id
                  AND s.active IS NOT FALSE
                  AND s.next_due_date IS NOT NULL
                  AND date(s.next_due_date) = date(rw.next_due_date)
                  AND sp2.interval_days > mine_days
                  AND sp2.interval_days % mine_days = 0
                LIMIT 1;
            END IF;
            IF absorber IS NOT NULL THEN
                UPDATE public.recurring_work
                SET last_generated_date = now(),
                    next_due_date = rw.next_due_date + make_interval(days => mine_days)
                WHERE id = rw.id;
                schedule_id := rw.id; schedule_code := rw.code; wo_id := NULL;
                action := format('absorbed by the %s service due the same day — rolled forward', absorber);
                RETURN NEXT; CONTINUE;
            END IF;
        END IF;

        -- Catch-up: one WO at the oldest missed date; roll next_due past now.
        due_at  := rw.next_due_date;
        nxt     := rw.next_due_date;
        covered := 0;
        WHILE nxt <= now() AND covered < 120 LOOP
            nxt := nxt + CASE freq_unit
                WHEN 'DAYS'   THEN make_interval(days   => freq_int)
                WHEN 'WEEKS'  THEN make_interval(weeks  => freq_int)
                WHEN 'MONTHS' THEN make_interval(months => freq_int)
                WHEN 'YEARS'  THEN make_interval(years  => freq_int)
            END;
            covered := covered + 1;
        END LOOP;

        v_wo  := gen_random_uuid();
        seq   := seq + 1;
        v_won := to_char(now(), 'YYYY') || '-' || lpad((seq % 1000000)::text, 6, '0');
        v_title := coalesce(nullif(r ->> 'description', ''), rw.title)
                   || CASE WHEN coalesce(r ->> 'strategy_package', '') <> '' THEN ' — ' || (r ->> 'strategy_package') || ' service' ELSE '' END
                   || CASE WHEN covered > 1 THEN format(' (Generated — covers %s missed occurrences)', covered) ELSE ' (Generated)' END;

        INSERT INTO public.work_orders (
            id, wo_number, title, description, status, type, priority_code,
            asset_id, recurring_work_id, cost_frozen, frozen_labor_cost,
            frozen_material_cost, created_by, due_date, date_due_start,
            est_duration, company_id, created_at, updated_at
        ) VALUES (
            v_wo, v_won, v_title,
            coalesce(nullif(r ->> 'description', ''), rw.title),
            'OPEN', coalesce(nullif(r ->> 'job_type', ''), 'PM'),
            coalesce(rw.priority_code, 'MEDIUM'),
            tgt_asset, rw.id, false, 0, 0, NULL, due_at, due_at,
            coalesce(nullif(r ->> 'est_duration', '')::numeric,
                     nullif(r ->> 'estimated_duration', '')::numeric, 0),
            rw.company_id, now(), now()
        );

        -- ISO 14224 failure-context seed (best-effort, like every copy below).
        BEGIN
            IF coalesce(r ->> 'failure_mode_code', '') <> ''
               OR (r ->> 'local_impact') IS NOT NULL
               OR (r ->> 'plant_wide_impact') IS NOT NULL THEN
                INSERT INTO public.wo_failure_data
                    (wo_id, failure_mode_code, failure_cause_code, remedy_code,
                     local_impact, plant_wide_impact, comments, company_id)
                VALUES
                    (v_wo, coalesce(r ->> 'failure_mode_code', ''), '', '',
                     r ->> 'local_impact', r ->> 'plant_wide_impact',
                     CASE WHEN coalesce(r ->> 'failure_mode_code', '') <> ''
                          THEN format('Failure mode "%s" inherited from PM strategy.', r ->> 'failure_mode_code') END,
                     rw.company_id);
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'pm_autogen_sweep: failure-context seed failed for WO %: %', v_won, SQLERRM;
        END;

        -- Plan copy: job steps.
        BEGIN
            INSERT INTO public.job_tasks (
                id, wo_id, sequence, description, est_hours, status, instructions,
                operation_no, control_key, work_center_id, planned_rate,
                assigned_user_ids, assigned_org_unit_ids, company_id
            )
            SELECT gen_random_uuid(), v_wo,
                   coalesce(nullif(t ->> 'sequence', '')::int, (ord * 10)::int),
                   coalesce(t ->> 'description', ''),
                   coalesce(nullif(t ->> 'estHours', '')::numeric, 0),
                   'PENDING',
                   coalesce(t -> 'instructions', '[]'::jsonb),
                   coalesce(nullif(t ->> 'operationNo', ''), lpad((coalesce(nullif(t ->> 'sequence', '')::int, (ord * 10)::int))::text, 4, '0')),
                   coalesce(nullif(t ->> 'controlKey', ''), 'PM01'),
                   nullif(t ->> 'workCenterId', '')::uuid,
                   nullif(t ->> 'plannedRate', '')::numeric,
                   coalesce(t -> 'assignedUserIds', '[]'::jsonb),
                   coalesce(t -> 'assignedOrgUnitIds', '[]'::jsonb),
                   rw.company_id
            FROM jsonb_array_elements(coalesce(r -> 'templates' -> 'tasks', '[]'::jsonb))
                 WITH ORDINALITY AS x(t, ord);
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'pm_autogen_sweep: job-step copy failed for WO %: %', v_won, SQLERRM;
        END;

        -- Plan copy: JSA + hazards.
        BEGIN
            IF jsonb_array_length(coalesce(r -> 'templates' -> 'jsa' -> 'hazards', '[]'::jsonb)) > 0 THEN
                v_jsa := gen_random_uuid();
                INSERT INTO public.jsa_assessments (id, wo_id, status, created_by, permits, updated_at, company_id)
                VALUES (v_jsa, v_wo, 'DRAFT', NULL,
                        coalesce(r -> 'templates' -> 'jsa' -> 'permits', '[]'::jsonb),
                        now(), rw.company_id);
                INSERT INTO public.jsa_hazards (id, jsa_id, hazard, risk_score, controls, company_id)
                SELECT gen_random_uuid(), v_jsa,
                       h ->> 'hazard',
                       coalesce(nullif(h ->> 'riskScore', ''), 'Medium'),
                       coalesce(h ->> 'controls', ''),
                       rw.company_id
                FROM jsonb_array_elements(r -> 'templates' -> 'jsa' -> 'hazards') AS h
                WHERE coalesce(h ->> 'hazard', '') <> '';
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'pm_autogen_sweep: JSA copy failed for WO %: %', v_won, SQLERRM;
        END;

        -- Plan copy: planned labour lines.
        BEGIN
            INSERT INTO public.work_order_labor
                (id, wo_id, contact_id, contact_type_code, hours_worked,
                 rate_per_hour, date_worked, created_at, company_id)
            SELECT gen_random_uuid(), v_wo,
                   nullif(l ->> 'contactId', '')::uuid,
                   coalesce(nullif(l ->> 'contactType', ''), 'TECHNICIAN'),
                   coalesce(nullif(l ->> 'estDuration', '')::numeric, 0),
                   0, current_date, now(), rw.company_id
            FROM jsonb_array_elements(coalesce(r -> 'templates' -> 'labor', '[]'::jsonb)) AS l;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'pm_autogen_sweep: labour copy failed for WO %: %', v_won, SQLERRM;
        END;

        -- Plan copy: planned parts.
        BEGIN
            INSERT INTO public.work_order_parts
                (id, wo_id, item_id, notes, quantity, unit_cost, date_used, company_id)
            SELECT gen_random_uuid(), v_wo,
                   nullif(p ->> 'inventoryId', '')::uuid,
                   coalesce(p ->> 'description', ''),
                   coalesce(nullif(p ->> 'estQty', '')::numeric, 0),
                   coalesce(nullif(p ->> 'estUnitCost', '')::numeric, 0),
                   current_date, rw.company_id
            FROM jsonb_array_elements(coalesce(r -> 'templates' -> 'inventory', '[]'::jsonb)) AS p;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'pm_autogen_sweep: parts copy failed for WO %: %', v_won, SQLERRM;
        END;

        -- Advance the schedule: generation is what rolls next_due_date, exactly
        -- as the manual Generator does.
        UPDATE public.recurring_work
        SET last_generated_date = now(),
            next_due_date = nxt
        WHERE id = rw.id;

        schedule_id := rw.id; schedule_code := rw.code; wo_id := v_wo;
        action := CASE WHEN covered > 1
                       THEN format('generated %s (due %s, covers %s missed occurrences), next due %s', v_won, date(due_at), covered, date(nxt))
                       ELSE format('generated %s (due %s), next due %s', v_won, date(due_at), date(nxt)) END;
        RETURN NEXT;
    END LOOP;
END;
$$;

COMMENT ON FUNCTION public.pm_autogen_sweep() IS
    '0304: daily PM Autopilot. Generates due calendar PMs server-side for schedules that are active, opted in, and ARMED (first generated WO completed). One open generated WO at a time; catch-up collapses a stall into one labelled WO. Mirrors generateWOFromPM incl. plan copy and 0292 absorption.';

REVOKE ALL ON FUNCTION public.pm_autogen_sweep() FROM public, anon;
-- authenticated keeps EXECUTE so admins can run/preview the sweep from the app.

-- Daily, 04:20 UTC. Tenant-portable guard (0223/0282 pattern).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RAISE NOTICE '0304: pg_cron absent — schedule pm-autogen-sweep manually on this project.';
        RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pm-autogen-sweep') THEN
        PERFORM cron.unschedule('pm-autogen-sweep');
    END IF;
    PERFORM cron.schedule('pm-autogen-sweep', '20 4 * * *',
                          'SELECT count(*) FROM public.pm_autogen_sweep()');
END $$;

COMMIT;
