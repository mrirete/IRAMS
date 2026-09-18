-- 0369 — A planned PM raises a planned work order.
--
-- A schedule that already carries steps, an estimate, a labour line with a
-- person and a rate, and a JSA still produced an order that had to be planned
-- again. Traced on PM-44743 (2026-09-18): the order raised that morning had
-- zero labour rows. Causes, both generation paths:
--   1. The PM Labour tab stores contacts.id; work_order_labor.contact_id
--      references users.id. The insert failed on the FK and both paths
--      swallowed it (the sweep raised a NOTICE, the Generator logged it).
--   2. rate_per_hour was written as 0 — the planned rate never reached the order.
--   3. Hours went to remaining_hours only; the UI reads planned hours from
--      hours_worked (fixed in DataMapper alongside this migration).
--   4. Labour was never linked to a step, so the step popup showed no crew.
--   5. The order always landed as OPEN (Created), never PLAN.
--
-- This migration:
--   * pm_labour_user_id / pm_assignee_contact_id — translate either id space
--     into the one each column references.
--   * pm_copy_plan_labour — one labour copy for the sweep and the repair:
--     translated person, planned rate, headcount, step link (an explicit
--     jobTaskId on the plan line, else the only step when there is one).
--   * pm_mark_planned — the planning gate (asset, scope, real step, estimate,
--     labour, JSA for criticality A/B) in SQL; flips OPEN → PLAN when met.
--     Exposed to authenticated so the Generator applies the same verdict.
--   * pm_autogen_sweep — DROP+CREATE with the above; copy failures are written
--     to work_orders.properties.plan_copy_failures; the action text says so.
--   * Repair: open generated orders with no labour whose schedule has labour
--     lines get them now (WO 2026-200296 among them); open generated orders
--     whose plan already meets the gate become Planned.
BEGIN;

-- ── Identity helpers ─────────────────────────────────────────────────────
-- contacts.id or users.id → users.id (work_order_labor.contact_id references users)
CREATE OR REPLACE FUNCTION public.pm_labour_user_id(p_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $$
    SELECT coalesce(
        (SELECT u.id FROM public.users u WHERE u.id = p_id),
        (SELECT c.user_id FROM public.contacts c WHERE c.id = p_id AND c.user_id IS NOT NULL),
        (SELECT u.id FROM public.users u WHERE u.contact_id = p_id ORDER BY u.created_at LIMIT 1));
$$;

-- users.id or contacts.id → contacts.id (work_orders.assigned_to references contacts)
CREATE OR REPLACE FUNCTION public.pm_assignee_contact_id(p_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $$
    SELECT coalesce(
        (SELECT c.id FROM public.contacts c WHERE c.id = p_id),
        (SELECT u.contact_id FROM public.users u WHERE u.id = p_id),
        (SELECT c.id FROM public.contacts c WHERE c.user_id = p_id ORDER BY c.created_at LIMIT 1));
$$;

-- ── One labour copy for every path ───────────────────────────────────────
-- p_task_map: {"<template task id>": "<job_tasks.id>"}. A line with a jobTaskId
-- found in the map pins to that step; otherwise, when the order has exactly one
-- step, every line pins to it; otherwise the line stays at order level.
CREATE OR REPLACE FUNCTION public.pm_copy_plan_labour(p_wo uuid, p_labor jsonb, p_task_map jsonb, p_company uuid)
 RETURNS int
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
    l        jsonb;
    n        int := 0;
    v_task   uuid;
    v_single uuid;
    v_keys   int;
    v_cid    uuid;
BEGIN
    SELECT count(*) INTO v_keys FROM jsonb_object_keys(coalesce(p_task_map, '{}'::jsonb));
    IF v_keys = 1 THEN
        SELECT value::uuid INTO v_single FROM jsonb_each_text(p_task_map) LIMIT 1;
    END IF;
    FOR l IN SELECT e FROM jsonb_array_elements(coalesce(p_labor, '[]'::jsonb)) e LOOP
        v_task := NULL;
        IF coalesce(l ->> 'jobTaskId', '') <> '' AND (coalesce(p_task_map, '{}'::jsonb) ? (l ->> 'jobTaskId')) THEN
            v_task := (p_task_map ->> (l ->> 'jobTaskId'))::uuid;
        ELSIF v_single IS NOT NULL THEN
            v_task := v_single;
        END IF;
        -- a non-uuid contactId (mock data) must not sink the whole copy
        v_cid := CASE WHEN (l ->> 'contactId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                      THEN public.pm_labour_user_id((l ->> 'contactId')::uuid) END;
        INSERT INTO public.work_order_labor
            (id, wo_id, contact_id, contact_type_code, hours_worked, remaining_hours, is_lead,
             headcount, rate_per_hour, job_task_id, date_worked, created_at, company_id)
        VALUES
            (gen_random_uuid(), p_wo, v_cid,
             coalesce(nullif(l ->> 'contactType', ''), 'TECHNICIAN'),
             0,
             coalesce(nullif(l ->> 'estDuration', '')::numeric, 0),
             coalesce(l ->> 'isLead', 'false') = 'true',
             greatest(coalesce(nullif(l ->> 'headcount', '')::int, 1), 1),
             coalesce(nullif(l ->> 'estRate', '')::numeric, 0),
             v_task, current_date, now(), p_company);
        n := n + 1;
    END LOOP;
    RETURN n;
END;
$$;

-- ── The planning gate, in SQL ────────────────────────────────────────────
-- Mirrors eam/services/workReadiness.ts assessReadiness (required items only):
-- asset, scope, a real step, an estimate, labour, and a JSA when the asset is
-- criticality A/B. Flips OPEN → PLAN when met; returns the verdict either way.
CREATE OR REPLACE FUNCTION public.pm_mark_planned(p_wo uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
    w    record;
    crit text;
    ok   boolean;
BEGIN
    SELECT wo.id, wo.status, wo.asset_id, wo.description, wo.est_duration
      INTO w FROM public.work_orders wo WHERE wo.id = p_wo;
    IF w.id IS NULL THEN RETURN false; END IF;
    SELECT upper(coalesce(a.criticality, '')) INTO crit FROM public.assets a WHERE a.id = w.asset_id;
    ok := w.asset_id IS NOT NULL
      AND coalesce(trim(w.description), '') <> ''
      AND EXISTS (
            SELECT 1 FROM public.job_tasks t
             WHERE t.wo_id = p_wo
               AND (lower(trim(coalesce(t.description, ''))) NOT IN ('', 'new task step', 'new task', 'untitled step', 'untitled')
                    OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(t.instructions, '[]'::jsonb)) b
                                WHERE coalesce(trim(b ->> 'label'), '') <> '')))
      AND (coalesce(w.est_duration, 0) > 0
           OR coalesce((SELECT sum(t.est_hours) FROM public.job_tasks t WHERE t.wo_id = p_wo), 0) > 0)
      AND EXISTS (SELECT 1 FROM public.work_order_labor l WHERE l.wo_id = p_wo)
      AND (coalesce(crit, '') NOT IN ('A', 'B')
           OR EXISTS (SELECT 1 FROM public.jsa_hazards h JOIN public.jsa_assessments j ON j.id = h.jsa_id WHERE j.wo_id = p_wo));
    IF ok AND upper(w.status::text) = 'OPEN' THEN
        UPDATE public.work_orders SET status = 'PLAN', updated_at = now() WHERE id = p_wo;
    END IF;
    RETURN ok;
END;
$$;

REVOKE ALL ON FUNCTION public.pm_labour_user_id(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.pm_assignee_contact_id(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.pm_copy_plan_labour(uuid, jsonb, jsonb, uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.pm_mark_planned(uuid) FROM public, anon;
-- The Generator (browser, RLS applies — SECURITY INVOKER) asks the same gate.
GRANT EXECUTE ON FUNCTION public.pm_mark_planned(uuid) TO authenticated;

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
    -- 0369: template task id → new job_tasks id, so labour lines pin to steps
    v_task_map  jsonb;
    v_tid       uuid;
    v_t         jsonb;
    v_ord       int;
    v_fail      text[];
    v_planned   boolean;
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
        v_fail := '{}'::text[]; v_task_map := '{}'::jsonb; v_planned := false;
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
        v_assignee := public.pm_assignee_contact_id(v_assignee);

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

        -- Plan copy: job steps — one at a time so each new id is remembered
        -- against its template id (0369: labour lines pin to steps through it).
        BEGIN
            FOR v_t, v_ord IN
                SELECT x.t, x.ord::int
                FROM jsonb_array_elements(coalesce(r -> 'templates' -> 'tasks', '[]'::jsonb))
                     WITH ORDINALITY AS x(t, ord)
            LOOP
                v_tid := gen_random_uuid();
                INSERT INTO public.job_tasks (
                    id, wo_id, sequence, description, est_hours, status, instructions,
                    operation_no, control_key, work_center_id, planned_rate,
                    assigned_user_ids, assigned_org_unit_ids, company_id
                ) VALUES (
                    v_tid, v_wo,
                    coalesce(nullif(v_t ->> 'sequence', '')::int, v_ord * 10),
                    coalesce(v_t ->> 'description', ''),
                    coalesce(nullif(v_t ->> 'estHours', '')::numeric, 0),
                    'PENDING',
                    coalesce(v_t -> 'instructions', '[]'::jsonb),
                    coalesce(nullif(v_t ->> 'operationNo', ''), lpad((coalesce(nullif(v_t ->> 'sequence', '')::int, v_ord * 10))::text, 4, '0')),
                    coalesce(nullif(v_t ->> 'controlKey', ''), 'PM01'),
                    nullif(v_t ->> 'workCenterId', '')::uuid,
                    nullif(v_t ->> 'plannedRate', '')::numeric,
                    coalesce(v_t -> 'assignedUserIds', '[]'::jsonb),
                    coalesce(v_t -> 'assignedOrgUnitIds', '[]'::jsonb),
                    rw.company_id
                );
                v_task_map := v_task_map || jsonb_build_object(coalesce(nullif(v_t ->> 'id', ''), 'ord-' || v_ord::text), v_tid::text);
            END LOOP;
        EXCEPTION WHEN OTHERS THEN
            v_fail := array_append(v_fail, 'job steps');
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
                v_fail := array_append(v_fail, 'nested task scopes');
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
                INSERT INTO public.jsa_hazards (id, jsa_id, hazard, risk_score, controls,
                                                consequence, likelihood, control_hierarchy, signoff_required, company_id)
                SELECT gen_random_uuid(), v_jsa,
                       h ->> 'hazard',
                       coalesce(nullif(h ->> 'riskScore', ''), 'Medium'),
                       coalesce(h ->> 'controls', ''),
                       CASE WHEN (h ->> 'consequence') ~ '^[1-5]$' THEN (h ->> 'consequence')::int END,
                       CASE WHEN (h ->> 'likelihood') ~ '^[1-5]$' THEN (h ->> 'likelihood')::int END,
                       CASE WHEN jsonb_typeof(h -> 'controlHierarchy') = 'array' THEN h -> 'controlHierarchy' ELSE '[]'::jsonb END,
                       (coalesce(h ->> 'signoffRequired', 'false') = 'true'
                        OR CASE WHEN (h ->> 'riskScore') ~ '^[0-9]+$' THEN (h ->> 'riskScore')::int >= 15 ELSE false END),
                       rw.company_id
                FROM jsonb_array_elements(r -> 'templates' -> 'jsa' -> 'hazards') AS h
                WHERE coalesce(h ->> 'hazard', '') <> '';
            END IF;
        EXCEPTION WHEN OTHERS THEN
            v_fail := array_append(v_fail, 'the job safety analysis');
            RAISE NOTICE 'pm_autogen_sweep: JSA copy failed for WO %: %', v_won, SQLERRM;
        END;

        -- Plan copy: planned labour. 0369: the plan stores a contacts.id, the
        -- labour table references users.id — the helper translates, carries the
        -- planned rate and headcount, and pins each line to its step.
        BEGIN
            PERFORM public.pm_copy_plan_labour(v_wo, coalesce(r -> 'templates' -> 'labor', '[]'::jsonb), v_task_map, rw.company_id);
        EXCEPTION WHEN OTHERS THEN
            v_fail := array_append(v_fail, 'planned labour');
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
            v_fail := array_append(v_fail, 'planned parts');
            RAISE NOTICE 'pm_autogen_sweep: parts copy failed for WO %: %', v_won, SQLERRM;
        END;

        -- 0369: an order that arrived with its whole plan and meets the planning
        -- gate is Planned, not merely Created. Anything that did not copy is
        -- written on the order so a planner sees it instead of a server notice.
        IF coalesce(array_length(v_fail, 1), 0) > 0 THEN
            UPDATE public.work_orders
               SET properties = coalesce(properties, '{}'::jsonb) || jsonb_build_object('plan_copy_failures', to_jsonb(v_fail))
             WHERE id = v_wo;
        ELSE
            BEGIN
                v_planned := public.pm_mark_planned(v_wo);
            EXCEPTION WHEN OTHERS THEN
                v_planned := false;
                RAISE NOTICE 'pm_autogen_sweep: planning-gate check failed for WO %: %', v_won, SQLERRM;
            END;
        END IF;

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
                                   CASE WHEN v_incl IS NOT NULL THEN ', also satisfies ' || v_incl ELSE '' END, date(nxt)) END
                  || CASE WHEN v_planned THEN ' — plan complete, status Planned'
                          WHEN coalesce(array_length(v_fail, 1), 0) > 0 THEN ' — generated without ' || array_to_string(v_fail, ', ')
                          ELSE '' END;
        RETURN NEXT;
    END LOOP;
END;
$function$
;

-- DROP+CREATE re-arms the default EXECUTE grant to PUBLIC (0361) — take it back.
REVOKE ALL ON FUNCTION public.pm_autogen_sweep() FROM public, anon;
COMMENT ON FUNCTION public.pm_autogen_sweep() IS
  '0304/0354/0365/0366/0367/0369 PM Autopilot: raises due calendar PMs on the calendar day inside their advance generation window (lead time); arms after the first completed generated (or satisfied-by-longer-task) WO; one open WO at a time; catch-up = one WO covering missed occurrences; assigns the plan''s lead labour contact; nested tasks wait and are satisfied by the longer order; orders are titled by the schedule''s name; labour is copied with the person (users.id), rate, headcount and step link, and an order whose copied plan meets the planning gate lands as PLAN — anything that failed to copy is written to properties.plan_copy_failures.';

-- ── Repair: orders already raised without their labour ───────────────────
DO $$
DECLARE
    w  record;
    tm jsonb;
    n  int;
BEGIN
    FOR w IN
        SELECT wo.id, wo.wo_number, wo.company_id, rw.templates -> 'labor' AS labor
          FROM public.work_orders wo
          JOIN public.recurring_work rw ON rw.id = wo.recurring_work_id
         WHERE upper(wo.status::text) IN ('OPEN', 'PLAN')
           AND jsonb_array_length(coalesce(rw.templates -> 'labor', '[]'::jsonb)) > 0
           AND NOT EXISTS (SELECT 1 FROM public.work_order_labor l WHERE l.wo_id = wo.id)
    LOOP
        -- one step on the order → every line pins to it; otherwise order level
        SELECT CASE WHEN count(*) = 1 THEN jsonb_build_object('only', min(t.id::text)) ELSE '{}'::jsonb END
          INTO tm FROM public.job_tasks t WHERE t.wo_id = w.id;
        BEGIN
            n := public.pm_copy_plan_labour(w.id, w.labor, tm, w.company_id);
            RAISE NOTICE '0369 repair: % labour line(s) added to WO %', n, w.wo_number;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE '0369 repair: labour copy failed for WO %: %', w.wo_number, SQLERRM;
        END;
    END LOOP;

    -- Open generated orders whose plan is already complete are Planned.
    FOR w IN
        SELECT wo.id, wo.wo_number FROM public.work_orders wo
         WHERE wo.recurring_work_id IS NOT NULL AND upper(wo.status::text) = 'OPEN'
    LOOP
        BEGIN
            IF public.pm_mark_planned(w.id) THEN
                RAISE NOTICE '0369 repair: WO % meets the planning gate → PLAN', w.wo_number;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE '0369 repair: gate check failed for WO %: %', w.wo_number, SQLERRM;
        END;
    END LOOP;
END $$;

COMMIT;
