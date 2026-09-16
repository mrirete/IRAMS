-- 0367 — Readable PM codes and short job text for RCM-generated schedules;
-- generated orders are titled by the schedule's name.
--
-- RCM-generated schedules carried code = id = "RCM-<study8>-<decision8>" and a
-- description that opened with the study reference, revision, strategy and
-- consequence codes — the Generator and every work order showed that essay as
-- the job. Now:
--   * code = "PM-<asset tag>-R<nn>" (R = raised from an RCM study, numbered
--     per asset in creation order); the id is unchanged, so idempotency and
--     every decision → PM link hold.
--   * description = "Prevents: <failure mode>" + one line of task type,
--     consequence and craft; the study reference and justification move into
--     origin (study_title, failure_mode, justification, narrative) where the
--     Origin line shows them, linked to the study.
--   * the sweep titles an order by the schedule's name (title) — the
--     description is the job text, not the headline. Mirrors
--     DatabaseService.generateWOFromPM.
-- The sweep is DROP+CREATEd → EXECUTE revoked again (0361 lesson).
BEGIN;

-- ── Data: recode and re-describe existing RCM-generated schedules ────────
WITH r AS (
    SELECT rw.id, upper(a.tag) AS tag,
           row_number() OVER (PARTITION BY rw.asset_id ORDER BY rw.created_at, rw.id) AS n
    FROM public.recurring_work rw
    JOIN public.assets a ON a.id::text = rw.asset_id
    WHERE rw.id LIKE 'RCM-%' AND rw.code LIKE 'RCM-%' AND coalesce(a.tag, '') <> ''
)
UPDATE public.recurring_work rw
   SET code = 'PM-' || r.tag || '-R' || lpad(r.n::text, 2, '0'),
       updated_at = now()
  FROM r
 WHERE rw.id = r.id
   AND NOT EXISTS (SELECT 1 FROM public.recurring_work x
                    WHERE x.company_id = rw.company_id AND x.code = 'PM-' || r.tag || '-R' || lpad(r.n::text, 2, '0'));

UPDATE public.recurring_work
   SET origin = coalesce(origin, '{}'::jsonb)
                || jsonb_build_object(
                       'narrative', description,
                       'failure_mode', nullif(regexp_replace(split_part(description, E'\n', 1),
                                              '^RCM study "[^"]*"( rev [0-9]+)? · Failure mode: ', ''), ''),
                       'study_title', nullif(substring(description from '^RCM study "([^"]*)"'), '')),
       description = regexp_replace(split_part(description, E'\n', 1),
                                    '^RCM study "[^"]*"( rev [0-9]+)? · Failure mode: ', 'Prevents: ')
                     || CASE WHEN nullif(split_part(description, E'\n', 2), '') IS NOT NULL
                             THEN E'\n' || regexp_replace(regexp_replace(split_part(description, E'\n', 2), '^Strategy: ', ''), ' · Consequence: ([A-Z_a-z]+)', ' · \1 consequence')
                             ELSE '' END,
       title = regexp_replace(title, '^RCM task — ', ''),
       updated_at = now()
 WHERE id LIKE 'RCM-%' AND description LIKE 'RCM study %';

-- ── Data: the Weibull-created schedule gets the same shape ───────────────
-- "PM — 20000005 — Weibull-based replacement (β=1.69)" with an analysis
-- essay as its description. The essay moves to origin.narrative; the job text
-- becomes "Prevents: …"; the code becomes PM-<tag>-W01 (W = Weibull analysis).
UPDATE public.recurring_work rw
   SET origin = coalesce(rw.origin, '{}'::jsonb)
                || jsonb_build_object('source', 'weibull_analysis', 'narrative', rw.description,
                                      'asset_tag', a.tag, 'migrated_by', '0367'),
       title = regexp_replace(rw.title, '^PM — (.*?) — Weibull-based replacement.*$', '\1 — time-directed replacement'),
       description = 'Prevents: wear-out failures of ' || coalesce(nullif(a.name, ''), a.tag) || E'\n'
                     || 'Time-directed replacement · every ' || rw.frequency_interval || ' ' || lower(rw.frequency_unit)
                     || ' (from Weibull life-data analysis)',
       code = CASE WHEN rw.code ~ '^PM-[0-9]{5}$'
                   AND NOT EXISTS (SELECT 1 FROM public.recurring_work x WHERE x.company_id = rw.company_id AND x.code = 'PM-' || upper(a.tag) || '-W01')
                   THEN 'PM-' || upper(a.tag) || '-W01' ELSE rw.code END,
       updated_at = now()
  FROM public.assets a
 WHERE a.id::text = rw.asset_id
   AND rw.title ~ '^PM — .* — Weibull-based replacement'
   AND rw.description LIKE 'Time-directed Preventive Maintenance based on Weibull%';

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
    v_assignee  uuid;
    abs_id      text;
    abs_code    text;
    abs_due     date;
    abs_mode    text;
    v_children  jsonb;
    v_incl      text;
    v_props     jsonb;
    ch          jsonb;
    v_seq       int;
    nxt_c       timestamptz;
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

        -- 0366: nested within a longer-interval task due together? Wait — that
        -- order satisfies this occurrence and rolls this schedule when raised.
        abs_id := NULL; abs_code := NULL; abs_due := NULL; abs_mode := NULL;
        SELECT a.absorber_id, a.absorber_code, a.absorber_due, a.nesting_mode
        INTO abs_id, abs_code, abs_due, abs_mode
        FROM public.pm_absorber(rw.id) a;
        IF abs_id IS NOT NULL THEN
            schedule_id := rw.id; schedule_code := rw.code; wo_id := NULL;
            action := format('waiting: nested within %s due %s (%s) — satisfied by that order', abs_code, abs_due, lower(abs_mode));
            RETURN NEXT; CONTINUE;
        END IF;

        -- ARMING: the loop must be proven by a human completing the first
        -- generated occurrence before the autopilot takes the schedule. A
        -- completed longer-interval order that satisfied this schedule counts.
        IF NOT EXISTS (
            SELECT 1 FROM public.work_orders w
            WHERE upper(w.status::text) IN ('COMP', 'TECO', 'CLOSED')
              AND (w.recurring_work_id = rw.id
                   OR w.properties @> jsonb_build_object('included_pm_ids', jsonb_build_array(rw.id)))
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

        -- Catch-up: one WO at the oldest missed date; roll next_due past today.
        -- Always step once (the occurrence being raised — it may still be in
        -- the future, inside its advance generation window), then over any
        -- missed days. Day granularity: next_due is a midnight from here on.
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

        -- The technician: the plan's lead labour line, else its first named person.
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

        -- 0366: the nested schedules this order satisfies — explicit children
        -- and shorter strategy packages whose absorber is this schedule.
        v_children := '[]'::jsonb;
        BEGIN
            SELECT coalesce(jsonb_agg(jsonb_build_object(
                       'id', c.id, 'code', c.code, 'title', c.title,
                       'cadence', c.frequency_interval || ' ' || c.frequency_unit,
                       'due', date(c.next_due_date),
                       'mode', CASE WHEN c.parent_pm_id = rw.id THEN coalesce(c.nesting_mode, 'SUPERSEDES') ELSE 'SUPERSEDES' END,
                       'freq_int', c.frequency_interval, 'freq_unit', upper(c.frequency_unit),
                       'templates', coalesce(c.templates, '{}'::jsonb))
                   ORDER BY c.code), '[]'::jsonb)
            INTO v_children
            FROM public.recurring_work c
            WHERE c.id <> rw.id
              AND c.active IS NOT FALSE
              AND upper(coalesce(c.status, 'ACTIVE')) = 'ACTIVE'
              AND c.next_due_date IS NOT NULL
              AND (c.parent_pm_id = rw.id OR (rw.strategy_id IS NOT NULL AND c.strategy_id = rw.strategy_id))
              AND (SELECT a.absorber_id FROM public.pm_absorber(c.id) a) = rw.id;
        EXCEPTION WHEN OTHERS THEN
            v_children := '[]'::jsonb;
            RAISE NOTICE 'pm_autogen_sweep: nested-scope lookup failed for %: %', rw.code, SQLERRM;
        END;
        v_incl := NULL;
        IF jsonb_array_length(v_children) > 0 THEN
            SELECT string_agg((e ->> 'code') || ' · ' || (e ->> 'cadence'), ', ') INTO v_incl
            FROM jsonb_array_elements(v_children) e;
            SELECT jsonb_build_object(
                       'included_pm_ids', coalesce(jsonb_agg(e ->> 'id'), '[]'::jsonb),
                       'included_scopes', coalesce(jsonb_agg(jsonb_build_object(
                           'pmId', e ->> 'id', 'code', e ->> 'code', 'title', e ->> 'title',
                           'cadence', e ->> 'cadence', 'dueDate', e ->> 'due', 'mode', e ->> 'mode')), '[]'::jsonb))
            INTO v_props
            FROM jsonb_array_elements(v_children) e;
        ELSE
            v_props := '{}'::jsonb;
        END IF;

        v_wo  := gen_random_uuid();
        seq   := seq + 1;
        v_won := to_char(now(), 'YYYY') || '-' || lpad((seq % 1000000)::text, 6, '0');
        v_title := coalesce(nullif(rw.title, ''), r ->> 'description')
                   || CASE WHEN coalesce(r ->> 'strategy_package', '') <> '' THEN ' — ' || (r ->> 'strategy_package') || ' service' ELSE '' END
                   || CASE WHEN v_incl IS NOT NULL THEN ' (also satisfies ' || v_incl || ')' ELSE '' END
                   || CASE WHEN covered > 1 THEN format(' (Generated — covers %s missed occurrences)', covered) ELSE ' (Generated)' END;

        INSERT INTO public.work_orders (
            id, wo_number, title, description, status, type, priority_code,
            asset_id, recurring_work_id, assigned_to, cost_frozen, frozen_labor_cost,
            frozen_material_cost, created_by, due_date, date_due_start,
            est_duration, properties, company_id, created_at, updated_at
        ) VALUES (
            v_wo, v_won, v_title,
            coalesce(nullif(r ->> 'description', ''), rw.title),
            'OPEN', coalesce(nullif(r ->> 'job_type', ''), 'PM'),
            coalesce(rw.priority_code, 'MEDIUM'),
            tgt_asset, rw.id, v_assignee, false, 0, 0, NULL, due_at, due_at,
            coalesce(nullif(r ->> 'est_duration', '')::numeric,
                     nullif(r ->> 'estimated_duration', '')::numeric, 0),
            v_props, rw.company_id, now(), now()
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

        -- 0366: COMBINES children — steps and parts after the longer plan's
        -- own, each tagged "[code · interval]" so the technician sees which
        -- task a step belongs to. Numbering continues in tens. SUPERSEDES
        -- children add nothing: the longer plan already covers them.
        IF jsonb_array_length(v_children) > 0 THEN
            BEGIN
                SELECT coalesce(max(sequence), 0) INTO v_seq FROM public.job_tasks WHERE job_tasks.wo_id = v_wo;
                FOR ch IN SELECT e FROM jsonb_array_elements(v_children) e LOOP
                    CONTINUE WHEN (ch ->> 'mode') <> 'COMBINES';
                    INSERT INTO public.job_tasks (
                        id, wo_id, sequence, description, est_hours, status, instructions,
                        operation_no, control_key, work_center_id, planned_rate,
                        assigned_user_ids, assigned_org_unit_ids, company_id
                    )
                    SELECT gen_random_uuid(), v_wo,
                           v_seq + (ord * 10)::int,
                           '[' || (ch ->> 'code') || ' · ' || (ch ->> 'cadence') || '] ' || coalesce(t ->> 'description', ''),
                           coalesce(nullif(t ->> 'estHours', '')::numeric, 0),
                           'PENDING',
                           coalesce(t -> 'instructions', '[]'::jsonb),
                           lpad((v_seq + (ord * 10)::int)::text, 4, '0'),
                           coalesce(nullif(t ->> 'controlKey', ''), 'PM01'),
                           nullif(t ->> 'workCenterId', '')::uuid,
                           nullif(t ->> 'plannedRate', '')::numeric,
                           coalesce(t -> 'assignedUserIds', '[]'::jsonb),
                           coalesce(t -> 'assignedOrgUnitIds', '[]'::jsonb),
                           rw.company_id
                    FROM jsonb_array_elements(coalesce(ch -> 'templates' -> 'tasks', '[]'::jsonb))
                         WITH ORDINALITY AS x(t, ord);
                    v_seq := v_seq + 10 * jsonb_array_length(coalesce(ch -> 'templates' -> 'tasks', '[]'::jsonb));

                    INSERT INTO public.work_order_parts
                        (id, wo_id, item_id, notes, quantity, unit_cost, date_used, company_id)
                    SELECT gen_random_uuid(), v_wo,
                           nullif(p ->> 'inventoryId', '')::uuid,
                           '[' || (ch ->> 'code') || ' · ' || (ch ->> 'cadence') || '] ' || coalesce(p ->> 'description', ''),
                           coalesce(nullif(p ->> 'estQty', '')::numeric, 0),
                           coalesce(nullif(p ->> 'estUnitCost', '')::numeric, 0),
                           current_date, rw.company_id
                    FROM jsonb_array_elements(coalesce(ch -> 'templates' -> 'inventory', '[]'::jsonb)) AS p;
                END LOOP;
            EXCEPTION WHEN OTHERS THEN
                RAISE NOTICE 'pm_autogen_sweep: nested-scope copy failed for WO %: %', v_won, SQLERRM;
            END;

            -- Roll each nested schedule past this order's due day (at least one
            -- step) — in its own block so a copy problem above never leaves a
            -- nested task due again tomorrow beside an order that satisfies it.
            FOR ch IN SELECT e FROM jsonb_array_elements(v_children) e LOOP
                BEGIN
                    nxt_c := (ch ->> 'due')::date::timestamptz;
                    covered := 0;
                    LOOP
                        nxt_c := nxt_c + CASE ch ->> 'freq_unit'
                            WHEN 'DAYS'   THEN make_interval(days   => (ch ->> 'freq_int')::int)
                            WHEN 'WEEKS'  THEN make_interval(weeks  => (ch ->> 'freq_int')::int)
                            WHEN 'MONTHS' THEN make_interval(months => (ch ->> 'freq_int')::int)
                            WHEN 'YEARS'  THEN make_interval(years  => (ch ->> 'freq_int')::int)
                            ELSE make_interval(days => 1)
                        END;
                        covered := covered + 1;
                        EXIT WHEN date(nxt_c) > greatest(date(due_at), current_date) OR covered >= 120;
                    END LOOP;
                    UPDATE public.recurring_work
                    SET last_generated_date = now(), next_due_date = nxt_c
                    WHERE id = ch ->> 'id';
                    schedule_id := ch ->> 'id'; schedule_code := ch ->> 'code'; wo_id := v_wo;
                    action := format('satisfied by %s (%s, %s), next due %s', v_won, rw.code, lower(ch ->> 'mode'), date(nxt_c));
                    RETURN NEXT;
                EXCEPTION WHEN OTHERS THEN
                    RAISE NOTICE 'pm_autogen_sweep: could not roll nested schedule %: %', ch ->> 'code', SQLERRM;
                END;
            END LOOP;
        END IF;

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

        -- Plan copy: planned labour (a plan line is remaining work, not hours worked).
        BEGIN
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
                       THEN format('generated %s (due %s, covers %s missed occurrences%s), next due %s', v_won, date(due_at), covered,
                                   CASE WHEN v_incl IS NOT NULL THEN ', also satisfies ' || v_incl ELSE '' END, date(nxt))
                       ELSE format('generated %s (due %s%s), next due %s', v_won, date(due_at),
                                   CASE WHEN v_incl IS NOT NULL THEN ', also satisfies ' || v_incl ELSE '' END, date(nxt)) END;
        RETURN NEXT;
    END LOOP;
END;
$function$
;
-- DROP+CREATE re-arms the default EXECUTE grant to PUBLIC (0361) — take it back.
REVOKE ALL ON FUNCTION public.pm_autogen_sweep() FROM public, anon;
COMMENT ON FUNCTION public.pm_autogen_sweep() IS
  '0304/0354/0365/0366/0367 PM Autopilot: raises due calendar PMs on the calendar day inside their advance generation window (lead time); arms after the first completed generated (or satisfied-by-longer-task) WO; one open WO at a time; catch-up = one WO covering missed occurrences; assigns the plan''s lead labour contact; nested tasks wait and are satisfied by the longer order; orders are titled by the schedule''s name.';

COMMIT;
