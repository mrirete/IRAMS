-- 0365 — a daily PM is due today, raised on time, and handed to its technician.
--
-- PM-44743 ("1 Days", created 2026-09-14) sat with next_due_date = +30 days
-- (the modal computed interval × 30 whatever the unit) and would still have
-- come out a day late for ever: next_due_date carried the 14:25 creation
-- clock time and the 04:20 sweep compared `next_due_date <= now()`. Four
-- changes to the sweep, all on the calendar day:
--   1. due = date(next_due_date); an occurrence is raised when
--      date(next_due) - lead_time <= current_date. lead_time_days finally means
--      something (a call horizon, as in SAP) and is clamped below the cadence.
--   2. the catch-up loop always steps once, then over missed days; the new
--      next_due is a midnight, so the comparison never drifts again.
--   3. the order is assigned to the plan's lead labour line (assigned_to), so
--      it is the technician's on My Work even if the labour copy fails.
--   4. planned labour is remaining_hours, not hours_worked.
-- notify_generated_pm() additionally tells the assignee. recurring_work.code
-- gains a per-company unique index (codes were 5 random digits, unchecked).
-- The function is DROP+CREATEd, so EXECUTE is revoked again (0361 lesson).
BEGIN;

CREATE OR REPLACE FUNCTION public.pm_call_horizon_days(lead int, freq_int int, freq_unit text)
 RETURNS int
 LANGUAGE sql
 IMMUTABLE
AS $$
    -- Lead time that makes sense for the cadence: anything at or beyond one
    -- cycle collapses to 0 (a "7-day lead" on a daily round is not a horizon,
    -- it is a second copy every day). Mirrors lib/pmCadence.sensibleLeadTimeDays.
    SELECT CASE
        WHEN coalesce(lead, 0) <= 0 THEN 0
        WHEN coalesce(freq_int, 0) <= 0 THEN coalesce(lead, 0)
        WHEN coalesce(lead, 0) >= freq_int * CASE upper(coalesce(freq_unit, ''))
                WHEN 'DAYS' THEN 1 WHEN 'WEEKS' THEN 7 WHEN 'MONTHS' THEN 30 WHEN 'YEARS' THEN 365 ELSE 0 END
             AND upper(coalesce(freq_unit, '')) IN ('DAYS', 'WEEKS', 'MONTHS', 'YEARS')
            THEN 0
        ELSE lead
    END;
$$;
REVOKE ALL ON FUNCTION public.pm_call_horizon_days(int, int, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.pm_call_horizon_days(int, int, text) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.pm_autogen_sweep();
CREATE FUNCTION public.pm_autogen_sweep()
 RETURNS TABLE(schedule_id text, schedule_code text, wo_id uuid, action text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
    v_assignee  uuid;
BEGIN
    FOR rw IN
        SELECT x.*
        FROM public.recurring_work x
        JOIN public.companies c ON c.id = x.company_id
        WHERE coalesce(c.pm_auto_generate, true)
          AND coalesce(x.auto_generate, true)
          AND (x.active IS TRUE OR upper(coalesce(x.status, '')) = 'ACTIVE')
          AND x.next_due_date IS NOT NULL
          AND (date(x.next_due_date)
               - public.pm_call_horizon_days(x.lead_time_days, x.frequency_interval, x.frequency_unit)) <= current_date
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
                  AND s.asset_id = tgt_asset::text
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
                    next_due_date = date(rw.next_due_date)::timestamptz + make_interval(days => mine_days)
                WHERE id = rw.id;
                schedule_id := rw.id; schedule_code := rw.code; wo_id := NULL;
                action := format('absorbed by the %s service due the same day — rolled forward', absorber);
                RETURN NEXT; CONTINUE;
            END IF;
        END IF;

        -- Catch-up: one WO at the oldest missed date; roll next_due past today.
        -- Always step once (the occurrence being raised — it may still be in
        -- the future, inside its call horizon), then over any missed days.
        -- Day granularity: next_due is a midnight from here on.
        due_at  := date(rw.next_due_date)::timestamptz;
        nxt     := due_at;
        covered := 0;
        LOOP
            nxt := nxt + CASE freq_unit
                WHEN 'DAYS'   THEN make_interval(days   => freq_int)
                WHEN 'WEEKS'  THEN make_interval(weeks  => freq_int)
                WHEN 'MONTHS' THEN make_interval(months => freq_int)
                WHEN 'YEARS'  THEN make_interval(years  => freq_int)
            END;
            covered := covered + 1;
            EXIT WHEN date(nxt) > current_date OR covered >= 120;
        END LOOP;

        -- 3. The technician: the plan's lead labour line, else its first named person.
        v_assignee := NULL;
        BEGIN
            SELECT nullif(l ->> 'contactId', '')::uuid INTO v_assignee
            FROM jsonb_array_elements(coalesce(r -> 'templates' -> 'labor', '[]'::jsonb)) AS l
            WHERE coalesce(l ->> 'contactId', '') <> ''
            ORDER BY (coalesce(l ->> 'isLead', 'false') = 'true') DESC
            LIMIT 1;
        EXCEPTION WHEN OTHERS THEN
            v_assignee := NULL;
        END;

        v_wo  := gen_random_uuid();
        seq   := seq + 1;
        v_won := to_char(now(), 'YYYY') || '-' || lpad((seq % 1000000)::text, 6, '0');
        v_title := coalesce(nullif(r ->> 'description', ''), rw.title)
                   || CASE WHEN coalesce(r ->> 'strategy_package', '') <> '' THEN ' — ' || (r ->> 'strategy_package') || ' service' ELSE '' END
                   || CASE WHEN covered > 1 THEN format(' (Generated — covers %s missed occurrences)', covered) ELSE ' (Generated)' END;

        INSERT INTO public.work_orders (
            id, wo_number, title, description, status, type, priority_code,
            asset_id, recurring_work_id, assigned_to, cost_frozen, frozen_labor_cost,
            frozen_material_cost, created_by, due_date, date_due_start,
            est_duration, company_id, created_at, updated_at
        ) VALUES (
            v_wo, v_won, v_title,
            coalesce(nullif(r ->> 'description', ''), rw.title),
            'OPEN', coalesce(nullif(r ->> 'job_type', ''), 'PM'),
            coalesce(rw.priority_code, 'MEDIUM'),
            tgt_asset, rw.id, v_assignee, false, 0, 0, NULL, due_at, due_at,
            coalesce(nullif(r ->> 'est_duration', '')::numeric,
                     nullif(r ->> 'estimated_duration', '')::numeric, 0),
            rw.company_id, now(), now()
        );

        -- ISO 14224 failure-context seed (best-effort, like every copy below).
        BEGIN
            IF coalesce(r ->> 'failure_mode_code', '') <> ''
               OR (r ->> 'local_impact') IS NOT NULL
               OR (r ->> 'plant_wide_impact') IS NOT NULL
               OR coalesce(r ->> 'subunit_code', '') <> '' OR coalesce(r ->> 'object_part', '') <> '' THEN
                INSERT INTO public.wo_failure_data
                    (wo_id, failure_mode_code, failure_cause_code, remedy_code,
                     local_impact, plant_wide_impact, subunit_code, object_part, comments, company_id)
                VALUES
                    (v_wo, coalesce(r ->> 'failure_mode_code', ''), '', '',
                     r ->> 'local_impact', r ->> 'plant_wide_impact',
                     nullif(r ->> 'subunit_code', ''), nullif(r ->> 'object_part', ''),
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
            -- A plan line is remaining work, not hours worked (0365).
            INSERT INTO public.work_order_labor
                (id, wo_id, contact_id, contact_type_code, hours_worked, remaining_hours, is_lead,
                 rate_per_hour, date_worked, created_at, company_id)
            SELECT gen_random_uuid(), v_wo,
                   nullif(l ->> 'contactId', '')::uuid,
                   coalesce(nullif(l ->> 'contactType', ''), 'TECHNICIAN'),
                   0,
                   coalesce(nullif(l ->> 'estDuration', '')::numeric, 0),
                   coalesce(l ->> 'isLead', 'false') = 'true',
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
$function$
;
-- DROP+CREATE re-arms the default EXECUTE grant to PUBLIC (0361) — take it back.
REVOKE ALL ON FUNCTION public.pm_autogen_sweep() FROM public, anon;
COMMENT ON FUNCTION public.pm_autogen_sweep() IS
  '0304/0354/0365 PM Autopilot: raises due calendar PMs on the calendar day, inside their lead-time call horizon; arms after the first completed generated WO; one open WO at a time; catch-up = one WO covering missed occurrences; assigns the plan''s lead labour contact.';

-- ── The technician hears about their generated PM ────────────────────────
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
    -- The Autopilot / Generator signature: schedule-linked, no human creator.
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
    -- 0365: the assignee (assigned_to is a contacts.id; some paths store users.id).
    IF NEW.assigned_to IS NOT NULL THEN
        FOR u IN
            SELECT DISTINCT x.id FROM public.users x
             WHERE x.company_id = NEW.company_id
               AND coalesce(x.status, 'active') = 'active'
               AND (x.contact_id = NEW.assigned_to OR x.id = NEW.assigned_to)
             LIMIT 5
        LOOP
            INSERT INTO public.notifications
                (recipient_id, title, message, severity, notification_type, module,
                 entity_id, entity_type, entity_number, action_link, action_required, company_id)
            VALUES
                (u.id::text,
                 'PM assigned to you: ' || coalesce(NEW.wo_number, ''),
                 left(coalesce(NEW.title, 'Preventive work order'), 180) ||
                     CASE WHEN NEW.due_date IS NOT NULL THEN ' — due ' || to_char(NEW.due_date, 'DD Mon') ELSE '' END,
                 'INFO', 'ASSIGNMENT', 'pm',
                 NEW.id::text, 'WORK_ORDER', NEW.wo_number, '/work-orders/' || NEW.id::text, true, NEW.company_id);
        END LOOP;
    END IF;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Never let a notification problem block the PM itself.
    RAISE NOTICE 'notify_generated_pm: % (WO %)', SQLERRM, NEW.wo_number;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_generated_pm() FROM public, anon;

-- ── PM codes are unique per company (they were 5 random digits, unchecked) ──
CREATE UNIQUE INDEX IF NOT EXISTS recurring_work_company_code_uq
    ON public.recurring_work (company_id, code)
    WHERE code IS NOT NULL;

COMMIT;
