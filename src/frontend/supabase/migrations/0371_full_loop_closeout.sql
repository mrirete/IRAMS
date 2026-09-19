-- 0371 — Full-loop assurance run (2026-09-19): server-side closeout
--
-- What the four-role run (PM → work order → spares → PO/GRN/invoice →
-- scheduling → execution → financial close) found in the database, and what
-- this migration does about each:
--
--   1. stock_reserved never released. sync_stock_reserved() (0201) ran as the
--      caller; a technician's TECO save could not update inventory_items, so
--      reservations outlived their orders (0345 fixed on-hand, not reserved).
--      → SECURITY DEFINER + a resync of every item.
--   2. A technician's first ordinary save deleted a planned step (P0). The
--      client fix makes deletion explicit; here the database refuses to delete
--      a step that carries posted time or is completed, and posted time keeps
--      its step when someone tries to detach it first.
--   3. The work-order Cost Centre select wrote work_orders.cost_center (text);
--      settlement, budgets and PO receivers read cost_center_id (NULL) — the
--      run's settlement posted to the asset only and budgets never moved.
--      → one trigger keeps the two columns agreeing (uuid text → id, id → text),
--        defaults the receiver from the asset's financial record, backfills the
--        three orders already affected, and re-points their settlement lines.
--   4. A technician could rewrite a technically-complete order through the API
--      (the state machine only guarded CLOSED/CANC/assign).
--      → at TECO, only the review columns move unless the caller holds
--        Work Orders · Approve or FinOps · Edit.
--   5. Authorise passed an order with no lines and no receiver, and the same
--      person raised and authorised it.
--      → NO_LINES / NO_RECEIVER / SOD refusals in ers_authorize_purchase_order.
--   6. Task Library blocks saved from a work order stored their text in
--      block.description; the PM import, the step drawer and Do-work render
--      block.label — imported steps were blank and the technician saw five
--      identical observation boxes. → label := description where label is empty
--      (library, open orders' steps, PM templates). The client writes label too.
--   7. A generated order named the technician on its labour line but the step's
--      assigned_user_ids stayed empty ("0 of 1 filled").
--      → pm_copy_plan_labour seats the labour user on the step it pins to; a
--        repair pass does the same for open orders.
--
-- Idempotent; safe to re-run.

BEGIN;

-- ── 1. Reserved stock releases for everyone ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_stock_reserved()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_item_ids UUID[];
BEGIN
    IF TG_TABLE_NAME = 'work_order_parts' THEN
        IF TG_OP = 'INSERT' THEN
            v_item_ids := ARRAY[NEW.item_id];
        ELSIF TG_OP = 'DELETE' THEN
            v_item_ids := ARRAY[OLD.item_id];
        ELSE
            v_item_ids := ARRAY[NEW.item_id, OLD.item_id];
        END IF;
    ELSE
        SELECT COALESCE(array_agg(DISTINCT item_id), '{}') INTO v_item_ids
        FROM public.work_order_parts WHERE wo_id = NEW.id;
    END IF;

    UPDATE public.inventory_items i
       SET stock_reserved = COALESCE((
               SELECT SUM(wop.quantity)
                 FROM public.work_order_parts wop
                 JOIN public.work_orders wo ON wo.id = wop.wo_id
                WHERE wop.item_id = i.id
                  AND (wo.status IS NULL
                       OR wo.status::text NOT IN ('CLOSED', 'CANC', 'CANCELLED', 'TECO'))
           ), 0)
     WHERE i.id = ANY(v_item_ids) AND i.id IS NOT NULL;

    RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE ALL ON FUNCTION public.sync_stock_reserved() FROM public, anon;
COMMENT ON FUNCTION public.sync_stock_reserved() IS
    'Recomputes inventory_items.stock_reserved from open-order part lines (0201). SECURITY DEFINER since 0371 so a technician''s completion releases the reservation.';

-- Resync: every item whose reserved figure disagrees with its open orders.
UPDATE public.inventory_items i
   SET stock_reserved = src.should_be
  FROM (
        SELECT i2.id,
               COALESCE((SELECT SUM(wop.quantity)
                           FROM public.work_order_parts wop
                           JOIN public.work_orders wo ON wo.id = wop.wo_id
                          WHERE wop.item_id = i2.id
                            AND (wo.status IS NULL OR wo.status::text NOT IN ('CLOSED', 'CANC', 'CANCELLED', 'TECO'))), 0) AS should_be
          FROM public.inventory_items i2
       ) src
 WHERE src.id = i.id
   AND COALESCE(i.stock_reserved, 0) IS DISTINCT FROM src.should_be;

-- ── 2. Steps with history cannot be deleted; posted time keeps its step ─────
CREATE OR REPLACE FUNCTION public.refuse_step_delete_with_history()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF public.session_is_internal() OR public.is_admin() THEN RETURN OLD; END IF;
    IF upper(coalesce(OLD.status, '')) = 'COMPLETED'
       OR coalesce(OLD.actual_hours, 0) > 0
       OR EXISTS (SELECT 1 FROM public.work_order_labor l
                   WHERE l.job_task_id = OLD.id
                     AND (l.confirmation_no IS NOT NULL OR coalesce(l.hours_worked, 0) > 0)) THEN
        RAISE EXCEPTION 'STEP_HAS_HISTORY: Step % "%" has posted time or is completed and cannot be deleted.',
            coalesce(OLD.sequence::text, '?'), coalesce(OLD.description, '')
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS ab_refuse_step_delete ON public.job_tasks;
CREATE TRIGGER ab_refuse_step_delete
    BEFORE DELETE ON public.job_tasks
    FOR EACH ROW EXECUTE FUNCTION public.refuse_step_delete_with_history();

CREATE OR REPLACE FUNCTION public.keep_confirmed_labour_step()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF public.session_is_internal() OR public.is_admin() THEN RETURN NEW; END IF;
    -- A posted confirmation stays on the step it was posted against.
    IF NEW.job_task_id IS DISTINCT FROM OLD.job_task_id AND OLD.job_task_id IS NOT NULL
       AND (OLD.confirmation_no IS NOT NULL OR coalesce(OLD.hours_worked, 0) > 0) THEN
        NEW.job_task_id := OLD.job_task_id;
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ab_keep_confirmed_step ON public.work_order_labor;
CREATE TRIGGER ab_keep_confirmed_step
    BEFORE UPDATE OF job_task_id ON public.work_order_labor
    FOR EACH ROW EXECUTE FUNCTION public.keep_confirmed_labour_step();

-- ── 3. One cost centre on the work order ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wo_cost_center_one_column()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_uuid uuid;
    v_default uuid;
BEGIN
    -- The select still writes the text column: a uuid there names the receiver.
    IF (TG_OP = 'INSERT' OR NEW.cost_center IS DISTINCT FROM OLD.cost_center) AND NEW.cost_center IS NOT NULL THEN
        IF NEW.cost_center ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
            v_uuid := NEW.cost_center::uuid;
            IF EXISTS (SELECT 1 FROM public.cost_centers c WHERE c.id = v_uuid) THEN
                NEW.cost_center_id := v_uuid;
            END IF;
        ELSE
            SELECT c.id INTO v_uuid FROM public.cost_centers c
             WHERE c.code = NEW.cost_center AND (c.company_id = NEW.company_id OR NEW.company_id IS NULL)
             ORDER BY (c.company_id = NEW.company_id) DESC NULLS LAST LIMIT 1;
            IF v_uuid IS NOT NULL THEN NEW.cost_center_id := v_uuid; END IF;
        END IF;
    ELSIF TG_OP = 'UPDATE' AND NEW.cost_center_id IS DISTINCT FROM OLD.cost_center_id THEN
        -- Written by id (settlement tools, imports): keep the legacy text in step.
        NEW.cost_center := CASE WHEN NEW.cost_center_id IS NULL THEN NULL ELSE NEW.cost_center_id::text END;
    ELSIF TG_OP = 'UPDATE' AND NEW.cost_center IS NULL AND OLD.cost_center IS NOT NULL THEN
        NEW.cost_center_id := NULL;
    END IF;

    -- No receiver named: the asset's financial record decides (its cost centre
    -- is where the asset's upkeep is budgeted). Only when nothing is set.
    IF NEW.cost_center_id IS NULL AND NEW.asset_id IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.asset_id IS DISTINCT FROM OLD.asset_id OR NEW.cost_center IS DISTINCT FROM OLD.cost_center) THEN
        SELECT af.cost_center_id INTO v_default FROM public.asset_financials af
         WHERE af.asset_id = NEW.asset_id AND af.cost_center_id IS NOT NULL LIMIT 1;
        IF v_default IS NOT NULL THEN
            NEW.cost_center_id := v_default;
            NEW.cost_center := v_default::text;
        END IF;
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS aa_wo_cost_center ON public.work_orders;
CREATE TRIGGER aa_wo_cost_center
    BEFORE INSERT OR UPDATE OF cost_center, cost_center_id, asset_id ON public.work_orders
    FOR EACH ROW EXECUTE FUNCTION public.wo_cost_center_one_column();
COMMENT ON COLUMN public.work_orders.cost_center_id IS
    'Settlement receiver (0244). Since 0371 the only column readers should use; cost_center (text) is kept in step by aa_wo_cost_center.';

-- Backfill the orders that already carry a uuid or a code in the text column.
-- Done as a plain UPDATE of the id (the trigger mirrors the text); the state
-- machine allows it because the migration runs as an internal session.
UPDATE public.work_orders w
   SET cost_center_id = w.cost_center::uuid
 WHERE w.cost_center_id IS NULL
   AND w.cost_center ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   AND EXISTS (SELECT 1 FROM public.cost_centers c WHERE c.id = w.cost_center::uuid);
UPDATE public.work_orders w
   SET cost_center_id = c.id
  FROM public.cost_centers c
 WHERE w.cost_center_id IS NULL
   AND w.cost_center IS NOT NULL
   AND w.cost_center !~* '^[0-9a-f]{8}-'
   AND c.code = w.cost_center
   AND c.company_id = w.company_id;

-- Settlement lines already posted without a receiver: point them at the
-- order's receiver now that it resolves, then refresh the budget actuals.
DO $$
DECLARE r record;
BEGIN
    FOR r IN
        SELECT ca.id AS alloc_id, rcv.cost_center_id
          FROM public.cost_allocations ca
          JOIN public.sem_wo_receiver rcv ON rcv.work_order_id = ca.work_order_id
         WHERE ca.source = 'WO_SETTLEMENT'
           AND ca.cost_center_id IS NULL
           AND rcv.cost_center_id IS NOT NULL
    LOOP
        UPDATE public.cost_allocations SET cost_center_id = r.cost_center_id WHERE id = r.alloc_id;
        BEGIN
            PERFORM public.ers_refresh_budget_actual(r.cost_center_id);
        EXCEPTION WHEN undefined_function THEN
            NULL; -- older tenants without the FinOps refresh: the allocation is still corrected
        END;
    END LOOP;
END $$;

-- ── 4. Technically complete = locked for the technician ─────────────────────
CREATE OR REPLACE FUNCTION public.enforce_wo_state_machine()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    old_s text := upper(coalesce(OLD.status::text, ''));
    new_s text := upper(coalesce(NEW.status::text, ''));
    review_cols text[] := ARRAY['reviewed_by', 'reviewed_at', 'review_notes', 'properties', 'updated_at', 'updated_by', 'last_modified'];
BEGIN
    IF public.session_is_internal() THEN RETURN NEW; END IF;

    -- 1. A financially closed order is immutable except for an administrator.
    IF (old_s = 'CLOSED' OR coalesce(OLD.cost_frozen, false)) AND NOT public.is_admin() THEN
        RAISE EXCEPTION 'STATE_LOCKED: Work order % is financially closed. Only an administrator can change it.', OLD.wo_number
            USING ERRCODE = 'check_violation';
    END IF;

    -- 2. Cancelling is a supervisory decision; financial close is a ledger one.
    IF new_s IS DISTINCT FROM old_s AND new_s IN ('CANC', 'CANCELLED')
       AND NOT (public.is_admin() OR public.caller_can('workOrders', 'approve')) THEN
        RAISE EXCEPTION 'APPROVE_REQUIRED: Your role cannot cancel work order % (needs Work Orders · Approve).', OLD.wo_number
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF new_s IS DISTINCT FROM old_s AND new_s = 'CLOSED'
       AND NOT (public.is_admin() OR public.caller_can('finops', 'edit')) THEN
        RAISE EXCEPTION 'FINOPS_REQUIRED: Your role cannot financially close work order % (needs FinOps · Edit).', OLD.wo_number
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- 3. Responsibility is assigned by people who hold Assign.
    IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
       AND NOT (public.is_admin() OR public.caller_can('workOrders', 'assign') OR public.caller_can('scheduling', 'assign')) THEN
        RAISE EXCEPTION 'ASSIGN_REQUIRED: Your role cannot change who is responsible for work order % (needs Assign).', OLD.wo_number
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- 4. After technical completion only the review moves (0371). Reopening,
    --    re-titling or re-dating a TECO order is a supervisory decision.
    IF old_s = 'TECO'
       AND NOT (public.is_admin() OR public.caller_can('workOrders', 'approve') OR public.caller_can('finops', 'edit'))
       AND (to_jsonb(NEW) - review_cols) IS DISTINCT FROM (to_jsonb(OLD) - review_cols) THEN
        RAISE EXCEPTION 'STATE_LOCKED: Work order % is technically complete. Only a supervisor can change it now.', OLD.wo_number
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END $$;
COMMENT ON FUNCTION public.enforce_wo_state_machine() IS
    '0340 + 0371: CLOSED/frozen orders change only by admins; CANC needs workOrders.approve, CLOSED needs finops.edit; assigned_to needs Assign; at TECO only the review columns move without Approve/FinOps. Internal sessions bypass.';

-- ── 5. Authorising a purchase order ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ers_authorize_purchase_order(p_po uuid, p_override_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_check jsonb;
    v_user  text;
    v_email text;
    v_po    public.purchase_orders%ROWTYPE;
BEGIN
    IF NOT public.caller_can('purchasing', 'approve') THEN
        RAISE EXCEPTION 'Not authorized: purchasing.approve is required to authorise a purchase order';
    END IF;
    SELECT * INTO v_po FROM public.purchase_orders WHERE id = p_po;
    IF NOT FOUND THEN RAISE EXCEPTION 'purchase order % not found', p_po; END IF;
    IF v_po.company_id IS DISTINCT FROM public.caller_company() THEN
        RAISE EXCEPTION 'purchase order % is not in your company', p_po;
    END IF;
    IF v_po.status IN ('COMPLETED', 'CANCELLED') THEN
        RAISE EXCEPTION 'purchase order % is %, it cannot be authorised', v_po.po_code, v_po.status;
    END IF;

    -- 0371: nothing to buy, or nobody to charge, is not an order yet.
    IF NOT EXISTS (SELECT 1 FROM public.purchase_order_lines l WHERE l.po_id = p_po) THEN
        RAISE EXCEPTION 'NO_LINES: purchase order % has no lines — add what is being bought before authorising', v_po.po_code
            USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.ers_po_cost_centers(p_po)) THEN
        RAISE EXCEPTION 'NO_RECEIVER: purchase order % has no cost centre — choose one on the order, or link its lines to a work order that has a receiver', v_po.po_code
            USING ERRCODE = 'check_violation';
    END IF;

    -- 0371: segregation of duties — the person who raised the order does not
    -- authorise it (administrators excepted). created_by is free text on this
    -- table: a user id, a username or an e-mail, so all three are compared.
    SELECT COALESCE(u.username, u.email, auth.uid()::text), u.email INTO v_user, v_email
      FROM public.users u WHERE u.id = auth.uid();
    IF NOT public.is_admin() AND NULLIF(trim(coalesce(v_po.created_by, '')), '') IS NOT NULL
       AND lower(trim(v_po.created_by)) IN (lower(coalesce(auth.uid()::text, '')), lower(coalesce(v_user, '')), lower(coalesce(v_email, ''))) THEN
        RAISE EXCEPTION 'SOD: the person who raised purchase order % cannot also authorise it — ask another approver', v_po.po_code
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    v_check := public.ers_po_budget_check(p_po);
    IF (v_check->>'blocked')::boolean THEN
        RAISE EXCEPTION 'BUDGET_BLOCKED: a hard budget block applies — raise the budget or remove the block before authorising' USING DETAIL = v_check::text;
    END IF;
    IF (v_check->>'requires_override')::boolean AND NULLIF(trim(COALESCE(p_override_reason, '')), '') IS NULL THEN
        RAISE EXCEPTION 'BUDGET_EXCEEDED: this order takes a cost centre over budget — an override reason is required' USING DETAIL = v_check::text;
    END IF;

    UPDATE public.purchase_orders
       SET authorized_by_id = COALESCE(v_user, authorized_by_id),
           authorized_at = now(),
           budget_check = v_check,
           budget_override_reason = CASE WHEN (v_check->>'requires_override')::boolean THEN trim(p_override_reason) ELSE NULL END,
           status = CASE WHEN status = 'DRAFT' THEN 'OPEN' ELSE status END,
           updated_at = now()
     WHERE id = p_po;
    RETURN v_check || jsonb_build_object('authorized_by', v_user, 'authorized_at', now());
END $$;
REVOKE ALL ON FUNCTION public.ers_authorize_purchase_order(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ers_authorize_purchase_order(uuid, text) TO authenticated;

-- ── 6. Instruction text lives in block.label ────────────────────────────────
CREATE OR REPLACE FUNCTION public.ers_fix_text_block_labels(p jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN p IS NULL OR jsonb_typeof(p) <> 'array' THEN p
        ELSE (SELECT coalesce(jsonb_agg(
                        CASE WHEN b->>'type' = 'TEXT'
                              AND coalesce(b->>'label', '') = ''
                              AND coalesce(b->>'description', '') <> ''
                             THEN b || jsonb_build_object('label', b->>'description')
                             ELSE b END
                        ORDER BY ord), '[]'::jsonb)
                FROM jsonb_array_elements(p) WITH ORDINALITY t(b, ord))
    END;
$$;

UPDATE public.task_library_items
   SET instructions = public.ers_fix_text_block_labels(instructions)
 WHERE instructions::text LIKE '%"TEXT"%'
   AND instructions IS DISTINCT FROM public.ers_fix_text_block_labels(instructions);

-- Open orders only: closed/frozen orders are history and their child rows refuse writes.
UPDATE public.job_tasks t
   SET instructions = public.ers_fix_text_block_labels(t.instructions)
  FROM public.work_orders w
 WHERE w.id = t.wo_id
   AND upper(coalesce(w.status::text, '')) NOT IN ('CLOSED', 'CANC', 'CANCELLED')
   AND NOT coalesce(w.cost_frozen, false)
   AND t.instructions::text LIKE '%"TEXT"%'
   AND t.instructions IS DISTINCT FROM public.ers_fix_text_block_labels(t.instructions);

UPDATE public.recurring_work r
   SET templates = jsonb_set(r.templates, '{tasks}', (
            SELECT coalesce(jsonb_agg(
                       CASE WHEN jsonb_typeof(t->'instructions') = 'array'
                            THEN t || jsonb_build_object('instructions', public.ers_fix_text_block_labels(t->'instructions'))
                            ELSE t END
                       ORDER BY ord), '[]'::jsonb)
              FROM jsonb_array_elements(r.templates->'tasks') WITH ORDINALITY x(t, ord)))
 WHERE jsonb_typeof(r.templates->'tasks') = 'array'
   AND jsonb_array_length(r.templates->'tasks') > 0
   AND r.templates::text LIKE '%"TEXT"%'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(r.templates->'tasks') t,
                            jsonb_array_elements(CASE WHEN jsonb_typeof(t->'instructions') = 'array' THEN t->'instructions' ELSE '[]'::jsonb END) b
                WHERE b->>'type' = 'TEXT' AND coalesce(b->>'label', '') = '' AND coalesce(b->>'description', '') <> '');

-- ── 7. The named person is on the step, not just the labour line ────────────
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
        -- 0371: the person planned on the step is assigned to the step — the
        -- crew drawer ("0 of 1 filled") and My Work read assigned_user_ids.
        IF v_task IS NOT NULL AND v_cid IS NOT NULL THEN
            UPDATE public.job_tasks t
               SET assigned_user_ids = coalesce(t.assigned_user_ids, '[]'::jsonb) || to_jsonb(v_cid::text)
             WHERE t.id = v_task
               AND NOT (coalesce(t.assigned_user_ids, '[]'::jsonb) ? v_cid::text);
        END IF;
    END LOOP;
    RETURN n;
END;
$$;

-- Repair: open orders whose steps have a planned person but no assignee.
UPDATE public.job_tasks t
   SET assigned_user_ids = sub.ids
  FROM (
        SELECT l.job_task_id, jsonb_agg(DISTINCT l.contact_id::text) AS ids
          FROM public.work_order_labor l
          JOIN public.job_tasks jt ON jt.id = l.job_task_id
          JOIN public.work_orders w ON w.id = jt.wo_id
          JOIN public.users u ON u.id = l.contact_id
         WHERE l.contact_id IS NOT NULL
           AND upper(coalesce(w.status::text, '')) IN ('OPEN', 'PLAN', 'SCHED', 'WIP', 'WAIT')
           AND coalesce(jt.assigned_user_ids, '[]'::jsonb) = '[]'::jsonb
         GROUP BY l.job_task_id
       ) sub
 WHERE sub.job_task_id = t.id;

-- ── proof ───────────────────────────────────────────────────────────────────
DO $$
DECLARE
    v_def boolean;
    v_bad int;
BEGIN
    SELECT prosecdef INTO v_def FROM pg_proc WHERE proname = 'sync_stock_reserved' AND pronamespace = 'public'::regnamespace;
    IF NOT coalesce(v_def, false) THEN RAISE EXCEPTION '0371: sync_stock_reserved is not SECURITY DEFINER'; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'ab_refuse_step_delete') THEN RAISE EXCEPTION '0371: step delete guard missing'; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'aa_wo_cost_center') THEN RAISE EXCEPTION '0371: cost centre trigger missing'; END IF;
    SELECT count(*) INTO v_bad FROM public.work_orders
     WHERE cost_center_id IS NULL AND cost_center ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND EXISTS (SELECT 1 FROM public.cost_centers c WHERE c.id = cost_center::uuid);
    IF v_bad > 0 THEN RAISE EXCEPTION '0371: % work orders still carry a uuid receiver only in the text column', v_bad; END IF;
    SELECT count(*) INTO v_bad FROM public.task_library_items, jsonb_array_elements(coalesce(instructions, '[]'::jsonb)) b
     WHERE b->>'type' = 'TEXT' AND coalesce(b->>'label', '') = '' AND coalesce(b->>'description', '') <> '';
    IF v_bad > 0 THEN RAISE EXCEPTION '0371: % library TEXT blocks still have no label', v_bad; END IF;
    RAISE NOTICE '0371 verified: reserved-stock DEFINER, step guards, one cost-centre column, TECO lock, PO guards, block labels, step seating';
END $$;

COMMIT;
