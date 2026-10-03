-- ============================================================================
-- 0401 — Approval authority: value bands, a signing chain, substitutes,
--        escalation
--
-- Every role template carried a spending limit and Admin let you edit one per
-- person. Nothing read them: not purchasing, not work orders, not the
-- database. 2026-10-03.
--
-- Delegation of authority, as configuration the business owns:
--   • VALUE BANDS per company and document type (work order / purchase
--     order): step 1 up to X signed by these roles, step 2 up to Y by those…
--     Edited in Admin › Approvals. A company with no rows of its own runs on
--     the built-in defaults in approval_chain().
--   • THE CHAIN: a document needs every step up to the band that covers its
--     value, signed in order. Whoever starts the chain holds their own step
--     and the ones below it; a person whose own step covers the value needs
--     nobody else.
--   • SUBSTITUTES: an approver names a stand-in for a date range; the stand-in
--     signs on their behalf (recorded), but never something they raised.
--   • ESCALATION: a step not signed within its allowance is reported to the
--     next level; after the second allowance the next level may sign it.
--   • Work orders are gated at RELEASE (→ Scheduled / In progress) on planned
--     cost. Emergency orders are exempt and reviewed afterwards; so, by
--     default, are orders generated from a maintenance plan — their cost was
--     accepted with the plan. Administrators are exempt.
--   • Purchase orders are gated at authorisation on the order total.
--
-- Parts: A tables · B chain + authority · C signing · D notices ·
-- E work orders · F purchase orders · G admin RPCs · H escalation cron.
-- ============================================================================

BEGIN;

-- ── A. Tables ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.approval_bands (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id           uuid NOT NULL DEFAULT public.caller_company(),
    doc_type             text NOT NULL CHECK (doc_type IN ('WORK_ORDER', 'PURCHASE_ORDER')),
    step_order           integer NOT NULL CHECK (step_order > 0),
    roles                text[] NOT NULL CHECK (cardinality(roles) > 0),
    up_to_amount         numeric(14,2) NOT NULL CHECK (up_to_amount > 0),
    notify_after_hours   integer NOT NULL DEFAULT 24 CHECK (notify_after_hours > 0),
    takeover_after_hours integer NOT NULL DEFAULT 48 CHECK (takeover_after_hours > 0),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    UNIQUE (company_id, doc_type, step_order)
);
COMMENT ON TABLE public.approval_bands IS
    '0401: value bands of the approval chain, per company and document type. Written only by ers_save_approval_chain (admins). No rows for a company = the built-in defaults in approval_chain().';

CREATE TABLE IF NOT EXISTS public.approval_settings (
    company_id               uuid PRIMARY KEY DEFAULT public.caller_company(),
    wo_exempt_plan_generated boolean NOT NULL DEFAULT true,
    updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.approver_substitutes (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id         uuid NOT NULL DEFAULT public.caller_company(),
    user_id            uuid NOT NULL,
    substitute_user_id uuid NOT NULL,
    valid_from         date NOT NULL DEFAULT current_date,
    valid_to           date NOT NULL,
    created_by         uuid DEFAULT public.caller_user_id(),
    created_at         timestamptz NOT NULL DEFAULT now(),
    CHECK (user_id <> substitute_user_id),
    CHECK (valid_to >= valid_from)
);
COMMENT ON TABLE public.approver_substitutes IS
    '0401: while current_date is inside the range, substitute_user_id may sign approval steps that user_id''s role holds — recorded as on behalf of user_id. One hop only.';

CREATE TABLE IF NOT EXISTS public.approval_steps (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id           uuid NOT NULL,
    doc_type             text NOT NULL,
    doc_id               uuid NOT NULL,
    step_order           integer NOT NULL,
    roles                text[] NOT NULL,
    amount               numeric(14,2) NOT NULL,
    status               text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'SUPERSEDED')),
    requested_by         uuid,
    decided_by           uuid,
    on_behalf_of         uuid,
    via                  text CHECK (via IN ('OWN', 'REQUESTER', 'SUBSTITUTE', 'ESCALATED', 'ADMIN')),
    decided_at           timestamptz,
    activated_at         timestamptz,
    notify_after_hours   integer NOT NULL DEFAULT 24,
    takeover_after_hours integer NOT NULL DEFAULT 48,
    notified_at          timestamptz,
    created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS approval_steps_doc_idx ON public.approval_steps (doc_type, doc_id, status);
COMMENT ON TABLE public.approval_steps IS
    '0401: the signing record. One row per required step of a release request; SUPERSEDED when a later request replaces it. Written only by the approval functions.';

ALTER TABLE public.approval_bands       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_settings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approver_substitutes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_steps       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS approval_bands_read ON public.approval_bands;
CREATE POLICY approval_bands_read ON public.approval_bands
    FOR SELECT TO authenticated USING (company_id = (SELECT public.caller_company()));
DROP POLICY IF EXISTS approval_settings_read ON public.approval_settings;
CREATE POLICY approval_settings_read ON public.approval_settings
    FOR SELECT TO authenticated USING (company_id = (SELECT public.caller_company()));
DROP POLICY IF EXISTS approval_steps_read ON public.approval_steps;
CREATE POLICY approval_steps_read ON public.approval_steps
    FOR SELECT TO authenticated USING (company_id = (SELECT public.caller_company()));

-- A stand-in is named by an administrator, or by the approver for themselves.
DROP POLICY IF EXISTS approver_substitutes_read ON public.approver_substitutes;
CREATE POLICY approver_substitutes_read ON public.approver_substitutes
    FOR SELECT TO authenticated USING (company_id = (SELECT public.caller_company()));
DROP POLICY IF EXISTS approver_substitutes_insert ON public.approver_substitutes;
CREATE POLICY approver_substitutes_insert ON public.approver_substitutes
    FOR INSERT TO authenticated
    WITH CHECK (company_id = (SELECT public.caller_company())
                AND ((SELECT public.is_admin()) OR user_id = (SELECT public.caller_user_id())));
DROP POLICY IF EXISTS approver_substitutes_delete ON public.approver_substitutes;
CREATE POLICY approver_substitutes_delete ON public.approver_substitutes
    FOR DELETE TO authenticated
    USING (company_id = (SELECT public.caller_company())
           AND ((SELECT public.is_admin()) OR user_id = (SELECT public.caller_user_id())));

GRANT SELECT ON public.approval_bands, public.approval_settings, public.approval_steps TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.approver_substitutes TO authenticated;

-- ── B. The chain and the caller's authority ─────────────────────────────────
-- A company's own bands, or the defaults when it has none.
CREATE OR REPLACE FUNCTION public.approval_chain(p_company uuid, p_doc text)
RETURNS TABLE (step_order integer, roles text[], up_to_amount numeric, notify_after_hours integer, takeover_after_hours integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    RETURN QUERY
        SELECT b.step_order, b.roles, b.up_to_amount::numeric, b.notify_after_hours, b.takeover_after_hours
          FROM public.approval_bands b
         WHERE b.company_id = p_company AND b.doc_type = p_doc
         ORDER BY b.step_order;
    IF FOUND THEN RETURN; END IF;
    IF p_doc = 'WORK_ORDER' THEN
        RETURN QUERY VALUES
            (1, ARRAY['SUPERVISOR', 'PLANNER'],      5000::numeric,   24, 48),
            (2, ARRAY['MANAGER', 'ASSET_MANAGER'],   25000::numeric,  24, 48),
            (3, ARRAY['EXECUTIVE'],                  100000::numeric, 24, 48);
    ELSIF p_doc = 'PURCHASE_ORDER' THEN
        RETURN QUERY VALUES
            (1, ARRAY['PLANNER'],                              25000::numeric,  24, 48),
            (2, ARRAY['MANAGER', 'ASSET_MANAGER', 'FINANCE'],  50000::numeric,  24, 48),
            (3, ARRAY['EXECUTIVE'],                            250000::numeric, 24, 48);
    END IF;
END $$;
REVOKE ALL ON FUNCTION public.approval_chain(uuid, text) FROM public, anon, authenticated;

-- The steps a value needs: every band up to the one that covers it. A value
-- above the top band needs them all, then an administrator.
CREATE OR REPLACE FUNCTION public.approval_required(p_company uuid, p_doc text, p_amount numeric)
RETURNS TABLE (step_order integer, roles text[], notify_after_hours integer, takeover_after_hours integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_cover integer;
BEGIN
    SELECT min(c.step_order) INTO v_cover FROM public.approval_chain(p_company, p_doc) c WHERE c.up_to_amount >= p_amount;
    RETURN QUERY
        SELECT c.step_order, c.roles, c.notify_after_hours, c.takeover_after_hours
          FROM public.approval_chain(p_company, p_doc) c
         WHERE v_cover IS NULL OR c.step_order <= v_cover
         ORDER BY c.step_order;
    IF v_cover IS NULL THEN
        RETURN QUERY VALUES (999, ARRAY['SUPER_ADMIN', 'SYS_ADMIN'], 24, 48);
    END IF;
END $$;
REVOKE ALL ON FUNCTION public.approval_required(uuid, text, numeric) FROM public, anon, authenticated;

-- The caller's first role — the same one caller_can (0241) decides by.
CREATE OR REPLACE FUNCTION public.approval_caller_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT u.roles ->> 0 FROM public.users u
     WHERE u.id = public.caller_user_id() AND coalesce(u.status, 'active') = 'active';
$$;
REVOKE ALL ON FUNCTION public.approval_caller_role() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.approval_caller_role() TO authenticated;

-- The highest step the caller's own role holds (0 = none).
CREATE OR REPLACE FUNCTION public.approval_caller_step(p_doc text)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT coalesce(max(c.step_order), 0)
      FROM public.approval_chain(public.caller_company(), p_doc) c
     WHERE public.approval_caller_role() = ANY (c.roles);
$$;
REVOKE ALL ON FUNCTION public.approval_caller_step(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.approval_caller_step(text) TO authenticated;

-- The value the caller may release on their own: the top of their own band.
CREATE OR REPLACE FUNCTION public.approval_caller_authority(p_doc text)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT CASE WHEN public.is_admin() THEN 1e15
           ELSE coalesce((SELECT max(c.up_to_amount)
                            FROM public.approval_chain(public.caller_company(), p_doc) c
                           WHERE public.approval_caller_role() = ANY (c.roles)), 0) END;
$$;
REVOKE ALL ON FUNCTION public.approval_caller_authority(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.approval_caller_authority(text) TO authenticated;

-- ── C. Signing ──────────────────────────────────────────────────────────────
-- May the caller sign this pending step, and in what capacity? NULL = no.
CREATE OR REPLACE FUNCTION public.approval_can_sign(p_step uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    s       public.approval_steps%ROWTYPE;
    me      uuid := public.caller_user_id();
    my_role text := public.approval_caller_role();
    v_for   uuid;
BEGIN
    SELECT * INTO s FROM public.approval_steps WHERE id = p_step;
    IF NOT FOUND OR s.status <> 'PENDING' OR s.company_id IS DISTINCT FROM public.caller_company() THEN RETURN NULL; END IF;
    IF public.is_admin() THEN RETURN jsonb_build_object('via', 'ADMIN'); END IF;
    IF my_role = ANY (s.roles) THEN RETURN jsonb_build_object('via', 'OWN'); END IF;

    -- Standing in for someone whose role holds the step — but never on a
    -- request the stand-in raised themselves.
    SELECT a.user_id INTO v_for
      FROM public.approver_substitutes a
      JOIN public.users u ON u.id = a.user_id
     WHERE a.substitute_user_id = me AND a.company_id = s.company_id
       AND current_date BETWEEN a.valid_from AND a.valid_to
       AND (u.roles ->> 0) = ANY (s.roles)
     LIMIT 1;
    IF v_for IS NOT NULL AND s.requested_by IS DISTINCT FROM me THEN
        RETURN jsonb_build_object('via', 'SUBSTITUTE', 'on_behalf_of', v_for);
    END IF;

    -- Past the second allowance, a holder of a higher step may sign it.
    IF s.activated_at IS NOT NULL
       AND now() >= s.activated_at + make_interval(hours => s.takeover_after_hours)
       AND EXISTS (SELECT 1 FROM public.approval_chain(s.company_id, s.doc_type) c
                    WHERE c.step_order > s.step_order AND my_role = ANY (c.roles)) THEN
        RETURN jsonb_build_object('via', 'ESCALATED');
    END IF;
    RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.approval_can_sign(uuid) FROM public, anon, authenticated;

-- ── D. Notices ──────────────────────────────────────────────────────────────
-- p_kind: DUE  = the step is now yours (its holders and their stand-ins)
--         LATE = the step passed its allowance (the next level; admins at the top)
--         DONE = the chain is complete (the requester)
CREATE OR REPLACE FUNCTION public.approval_notify(p_step uuid, p_kind text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    s        public.approval_steps%ROWTYPE;
    v_number text;
    v_what   text;
    v_link   text;
    v_wc     uuid;
    v_module text;
    v_entity text;
    v_roles  text[];
    v_title  text;
    v_msg    text;
BEGIN
    SELECT * INTO s FROM public.approval_steps WHERE id = p_step;
    IF NOT FOUND THEN RETURN; END IF;

    IF s.doc_type = 'WORK_ORDER' THEN
        SELECT w.wo_number, w.title, w.work_center_id INTO v_number, v_what, v_wc FROM public.work_orders w WHERE w.id = s.doc_id;
        v_link := '/work-orders/' || s.doc_id::text; v_module := 'workOrders'; v_entity := 'WORK_ORDER';
    ELSE
        SELECT p.po_code INTO v_number FROM public.purchase_orders p WHERE p.id = s.doc_id;
        v_what := 'purchase order';
        v_link := '/purchase-orders'; v_module := 'purchasing'; v_entity := 'PURCHASE_ORDER';
    END IF;

    IF p_kind = 'DONE' THEN
        IF s.requested_by IS NULL THEN RETURN; END IF;
        INSERT INTO public.notifications (recipient_id, title, message, severity, notification_type, module,
               entity_id, entity_type, entity_number, action_link, action_required, created_by, company_id)
        VALUES (s.requested_by::text, 'Approved: ' || coalesce(v_number, ''),
                coalesce(v_what, '') || ' — every approval step is signed. ' ||
                  CASE WHEN s.doc_type = 'WORK_ORDER' THEN 'The order can be scheduled.' ELSE 'The order is authorised.' END,
                'SUCCESS', 'STATUS_CHANGE', v_module, s.doc_id::text, v_entity, v_number, v_link, false,
                coalesce(public.caller_user_id()::text, 'SYSTEM'), s.company_id);
        RETURN;
    END IF;

    IF p_kind = 'LATE' THEN
        SELECT c.roles INTO v_roles FROM public.approval_chain(s.company_id, s.doc_type) c
         WHERE c.step_order > s.step_order ORDER BY c.step_order LIMIT 1;
        v_roles := coalesce(v_roles, ARRAY['SUPER_ADMIN', 'SYS_ADMIN']);
        v_title := 'Approval overdue: ' || coalesce(v_number, '');
        v_msg   := coalesce(v_what, '') || ' — step ' || s.step_order || ' (' || array_to_string(s.roles, ' / ')
                   || ') has waited more than ' || s.notify_after_hours || ' hours. Chase it, name a substitute, or sign it yourself once '
                   || s.takeover_after_hours || ' hours have passed.';
    ELSE
        v_roles := s.roles;
        v_title := 'Approval needed: ' || coalesce(v_number, '');
        v_msg   := coalesce(v_what, '') || ' — waiting for your approval (step ' || s.step_order || ').';
    END IF;

    INSERT INTO public.notifications (recipient_id, title, message, severity, notification_type, module,
           entity_id, entity_type, entity_number, action_link, action_required, created_by, company_id)
    SELECT DISTINCT r.uid::text, v_title, v_msg, CASE WHEN p_kind = 'LATE' THEN 'WARNING' ELSE 'INFO' END,
           CASE WHEN p_kind = 'LATE' THEN 'ESCALATION' ELSE 'STATUS_CHANGE' END, v_module,
           s.doc_id::text, v_entity, v_number, v_link, true,
           coalesce(public.caller_user_id()::text, 'SYSTEM'), s.company_id
      FROM (
            -- holders of the role: the order's own department when it has any, else the company
            SELECT u.id AS uid
              FROM public.users u
             WHERE u.company_id = s.company_id AND coalesce(u.status, 'active') = 'active'
               AND (u.roles ->> 0) = ANY (v_roles)
               AND (v_wc IS NULL
                    OR NOT EXISTS (SELECT 1 FROM public.users d
                                     JOIN public.work_center_members m ON m.contact_id = d.contact_id AND m.work_center_id = v_wc
                                    WHERE d.company_id = s.company_id AND coalesce(d.status, 'active') = 'active'
                                      AND (d.roles ->> 0) = ANY (v_roles))
                    OR EXISTS (SELECT 1 FROM public.work_center_members m
                                WHERE m.contact_id = u.contact_id AND m.work_center_id = v_wc))
            UNION
            -- and whoever is standing in for one of them today
            SELECT a.substitute_user_id
              FROM public.approver_substitutes a
              JOIN public.users u ON u.id = a.user_id
             WHERE a.company_id = s.company_id AND current_date BETWEEN a.valid_from AND a.valid_to
               AND (u.roles ->> 0) = ANY (v_roles)
           ) r
     WHERE r.uid IS DISTINCT FROM s.requested_by OR p_kind = 'LATE';
END $$;
REVOKE ALL ON FUNCTION public.approval_notify(uuid, text) FROM public, anon, authenticated;

-- Start a chain for a document at a value. Earlier rows are superseded. The
-- caller holds their own step and the ones below it. Returns steps still pending.
CREATE OR REPLACE FUNCTION public.approval_open(p_doc text, p_id uuid, p_amount numeric)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    me        uuid := public.caller_user_id();
    v_company uuid := public.caller_company();
    v_mine    integer := CASE WHEN public.is_admin() THEN 1000 ELSE public.approval_caller_step(p_doc) END;
    v_first   uuid;
    v_pending integer;
BEGIN
    UPDATE public.approval_steps SET status = 'SUPERSEDED'
     WHERE doc_type = p_doc AND doc_id = p_id AND status <> 'SUPERSEDED';

    INSERT INTO public.approval_steps (company_id, doc_type, doc_id, step_order, roles, amount, status, requested_by,
                                       decided_by, via, decided_at, notify_after_hours, takeover_after_hours)
    SELECT v_company, p_doc, p_id, r.step_order, r.roles, p_amount,
           CASE WHEN r.step_order <= v_mine THEN 'APPROVED' ELSE 'PENDING' END, me,
           CASE WHEN r.step_order <= v_mine THEN me END,
           CASE WHEN r.step_order > v_mine THEN NULL
                WHEN public.is_admin() THEN 'ADMIN'
                WHEN public.approval_caller_role() = ANY (r.roles) THEN 'OWN'
                ELSE 'REQUESTER' END,
           CASE WHEN r.step_order <= v_mine THEN now() END,
           r.notify_after_hours, r.takeover_after_hours
      FROM public.approval_required(v_company, p_doc, p_amount) r;

    SELECT id INTO v_first FROM public.approval_steps
     WHERE doc_type = p_doc AND doc_id = p_id AND status = 'PENDING' ORDER BY step_order LIMIT 1;
    IF v_first IS NOT NULL THEN
        UPDATE public.approval_steps SET activated_at = now() WHERE id = v_first;
        PERFORM public.approval_notify(v_first, 'DUE');
    END IF;
    SELECT count(*) INTO v_pending FROM public.approval_steps
     WHERE doc_type = p_doc AND doc_id = p_id AND status = 'PENDING';
    RETURN v_pending;
END $$;
REVOKE ALL ON FUNCTION public.approval_open(text, uuid, numeric) FROM public, anon, authenticated;

-- Sign the next pending step, and any that follow which the caller may also
-- sign. Refuses when the next step is not theirs. Returns steps still pending.
CREATE OR REPLACE FUNCTION public.approval_sign(p_doc text, p_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    s         public.approval_steps%ROWTYPE;
    v_how     jsonb;
    v_signed  integer := 0;
    v_pending integer;
BEGIN
    LOOP
        SELECT * INTO s FROM public.approval_steps
         WHERE doc_type = p_doc AND doc_id = p_id AND status = 'PENDING' ORDER BY step_order LIMIT 1;
        EXIT WHEN NOT FOUND;
        v_how := public.approval_can_sign(s.id);
        IF v_how IS NULL THEN
            IF v_signed = 0 THEN
                RAISE EXCEPTION 'NOT_YOUR_STEP: this is waiting on step % (%). You cannot sign it.', s.step_order, array_to_string(s.roles, ' / ')
                    USING ERRCODE = 'insufficient_privilege';
            END IF;
            UPDATE public.approval_steps SET activated_at = now() WHERE id = s.id;
            PERFORM public.approval_notify(s.id, 'DUE');
            EXIT;
        END IF;
        UPDATE public.approval_steps
           SET status = 'APPROVED', decided_by = public.caller_user_id(), decided_at = now(),
               via = v_how ->> 'via', on_behalf_of = (v_how ->> 'on_behalf_of')::uuid
         WHERE id = s.id;
        v_signed := v_signed + 1;
    END LOOP;

    SELECT count(*) INTO v_pending FROM public.approval_steps
     WHERE doc_type = p_doc AND doc_id = p_id AND status = 'PENDING';
    IF v_pending = 0 AND v_signed > 0 THEN
        PERFORM public.approval_notify(
            (SELECT id FROM public.approval_steps WHERE doc_type = p_doc AND doc_id = p_id AND status = 'APPROVED'
              ORDER BY step_order DESC LIMIT 1), 'DONE');
    END IF;
    RETURN v_pending;
END $$;
REVOKE ALL ON FUNCTION public.approval_sign(text, uuid) FROM public, anon, authenticated;

-- ── E. Work orders: cost release ────────────────────────────────────────────
ALTER TABLE public.work_orders
    ADD COLUMN IF NOT EXISTS cost_approved_amount       numeric(14,2),
    ADD COLUMN IF NOT EXISTS cost_approved_by           uuid,
    ADD COLUMN IF NOT EXISTS cost_approved_at           timestamptz,
    ADD COLUMN IF NOT EXISTS cost_release_requested_by  uuid,
    ADD COLUMN IF NOT EXISTS cost_release_requested_at  timestamptz;
COMMENT ON COLUMN public.work_orders.cost_approved_amount IS
    '0401: planned cost the approval chain signed off. The order may be released by anyone while its planned cost stays at or under this.';

-- Planned cost on the planner's basis (sem_wo_planned_lines, 0341: craft lines
-- × headcount × rate + planned parts) PLUS people ticked on a step that has no
-- craft line: step hours × people × the step's rate. Planners assign on the
-- step far more often than they add a craft line, and those jobs priced at 0.
CREATE OR REPLACE FUNCTION public.ers_wo_planned_cost(p_wo uuid)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT coalesce((SELECT sum(amount) FROM public.sem_wo_planned_lines WHERE work_order_id = p_wo), 0)
         + coalesce((
            SELECT sum(coalesce(t.est_hours, 0)
                       * jsonb_array_length(t.assigned_user_ids)
                       * coalesce(t.planned_rate, wc.activity_rate, 0))
              FROM public.job_tasks t
              LEFT JOIN public.work_centers wc ON wc.id = t.work_center_id
             WHERE t.wo_id = p_wo
               AND jsonb_typeof(t.assigned_user_ids) = 'array'
               AND jsonb_array_length(t.assigned_user_ids) > 0
               AND NOT EXISTS (SELECT 1 FROM public.work_order_labor l
                                WHERE l.job_task_id = t.id AND l.confirmation_no IS NULL)), 0);
$$;
REVOKE ALL ON FUNCTION public.ers_wo_planned_cost(uuid) FROM public, anon, authenticated;

-- Orders the value gate does not apply to.
CREATE OR REPLACE FUNCTION public.ers_wo_cost_exempt(p_priority text, p_recurring text, p_company uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT upper(coalesce(p_priority, '')) IN ('EMERGENCY', 'P1', 'CRITICAL')
        OR (nullif(trim(coalesce(p_recurring, '')), '') IS NOT NULL
            AND coalesce((SELECT s.wo_exempt_plan_generated FROM public.approval_settings s WHERE s.company_id = p_company), true));
$$;
REVOKE ALL ON FUNCTION public.ers_wo_cost_exempt(text, text, uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enforce_wo_cost_release()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    old_s  text := upper(coalesce(OLD.status::text, ''));
    new_s  text := upper(coalesce(NEW.status::text, ''));
    v_cost numeric;
BEGIN
    IF public.session_is_internal() THEN RETURN NEW; END IF;

    -- The approval stamp is written by the approval functions, never by a client.
    IF coalesce(current_setting('ers.cost_approval', true), '') <> 'on' THEN
        NEW.cost_approved_at     := OLD.cost_approved_at;
        NEW.cost_approved_by     := OLD.cost_approved_by;
        NEW.cost_approved_amount := OLD.cost_approved_amount;
    END IF;

    -- Release: leaving planning for the schedule or the job site.
    IF old_s IN ('OPEN', 'PLAN') AND new_s IN ('SCHED', 'WIP')
       AND NOT public.ers_wo_cost_exempt(NEW.priority_code, NEW.recurring_work_id, NEW.company_id)
       AND NOT public.is_admin() THEN
        v_cost := public.ers_wo_planned_cost(NEW.id);
        IF v_cost > public.approval_caller_authority('WORK_ORDER')
           AND v_cost > coalesce(NEW.cost_approved_amount, 0) THEN
            RAISE EXCEPTION 'RELEASE_REQUIRED: the planned cost of % is above what you may release. Request a cost release on the order; it can be scheduled once the approval steps are signed.', OLD.wo_number
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_wo_cost_release ON public.work_orders;
CREATE TRIGGER trg_enforce_wo_cost_release
    BEFORE UPDATE ON public.work_orders
    FOR EACH ROW EXECUTE FUNCTION public.enforce_wo_cost_release();

-- Chain complete → stamp the order.
CREATE OR REPLACE FUNCTION public.ers_wo_stamp_cost_approval(p_wo uuid, p_amount numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    PERFORM set_config('ers.cost_approval', 'on', true);
    UPDATE public.work_orders
       SET cost_approved_amount = p_amount, cost_approved_by = public.caller_user_id(), cost_approved_at = now()
     WHERE id = p_wo;
    PERFORM set_config('ers.cost_approval', '', true);
END $$;
REVOKE ALL ON FUNCTION public.ers_wo_stamp_cost_approval(uuid, numeric) FROM public, anon, authenticated;

-- What the order page shows. Amounts only for callers who may see costs.
CREATE OR REPLACE FUNCTION public.ers_wo_release_state(p_wo uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    w        public.work_orders%ROWTYPE;
    v_cost   numeric;
    v_auth   numeric;
    v_open   boolean;
    v_costs  boolean;
    v_exempt boolean;
    v_next   uuid;
    v_chain  jsonb;
BEGIN
    SELECT * INTO w FROM public.work_orders WHERE id = p_wo;
    IF NOT FOUND OR w.company_id IS DISTINCT FROM public.caller_company() THEN RETURN NULL; END IF;
    v_cost   := public.ers_wo_planned_cost(p_wo);
    v_auth   := public.approval_caller_authority('WORK_ORDER');
    v_exempt := public.ers_wo_cost_exempt(w.priority_code, w.recurring_work_id, w.company_id);
    v_open   := upper(w.status::text) IN ('OPEN', 'PLAN') AND NOT v_exempt;
    v_costs  := public.caller_can('workOrders', 'viewCosts') OR public.is_admin();

    SELECT id INTO v_next FROM public.approval_steps
     WHERE doc_type = 'WORK_ORDER' AND doc_id = p_wo AND status = 'PENDING' ORDER BY step_order LIMIT 1;

    SELECT coalesce(jsonb_agg(jsonb_build_object(
               'step', s.step_order, 'roles', to_jsonb(s.roles), 'status', s.status, 'via', s.via,
               'decided_by', (SELECT coalesce(u.username, u.email) FROM public.users u WHERE u.id = s.decided_by),
               'on_behalf_of', (SELECT coalesce(u.username, u.email) FROM public.users u WHERE u.id = s.on_behalf_of),
               'decided_at', s.decided_at,
               'overdue', s.status = 'PENDING' AND s.activated_at IS NOT NULL
                          AND now() >= s.activated_at + make_interval(hours => s.notify_after_hours)
           ) ORDER BY s.step_order), '[]'::jsonb)
      INTO v_chain
      FROM public.approval_steps s
     WHERE s.doc_type = 'WORK_ORDER' AND s.doc_id = p_wo AND s.status <> 'SUPERSEDED';

    RETURN jsonb_build_object(
        'needs_release', v_open AND v_cost > v_auth AND v_cost > coalesce(w.cost_approved_amount, 0),
        'awaiting_approval', v_open AND v_next IS NOT NULL AND v_cost > coalesce(w.cost_approved_amount, 0),
        'can_approve', v_open AND v_next IS NOT NULL AND public.approval_can_sign(v_next) IS NOT NULL,
        'exempt', v_exempt,
        'chain', v_chain,
        'requested_at', w.cost_release_requested_at,
        'requested_by', (SELECT coalesce(u.username, u.email) FROM public.users u WHERE u.id = w.cost_release_requested_by),
        'approved_at', w.cost_approved_at,
        'approved_by', (SELECT coalesce(u.username, u.email) FROM public.users u WHERE u.id = w.cost_approved_by),
        'planned_cost', CASE WHEN v_costs THEN v_cost END,
        'my_limit', CASE WHEN v_costs THEN least(v_auth, 999999999) END,
        'approved_amount', CASE WHEN v_costs THEN w.cost_approved_amount END
    );
END $$;
REVOKE ALL ON FUNCTION public.ers_wo_release_state(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ers_wo_release_state(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.ers_request_wo_cost_release(p_wo uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_cost numeric;
BEGIN
    IF NOT (public.caller_can('workOrders', 'edit') OR public.is_admin()) THEN
        RAISE EXCEPTION 'Not authorized: workOrders.edit is required to request a cost release';
    END IF;
    UPDATE public.work_orders
       SET cost_release_requested_at = now(), cost_release_requested_by = public.caller_user_id()
     WHERE id = p_wo AND company_id = public.caller_company();
    IF NOT FOUND THEN RAISE EXCEPTION 'work order % not found', p_wo; END IF;
    v_cost := public.ers_wo_planned_cost(p_wo);
    IF public.approval_open('WORK_ORDER', p_wo, v_cost) = 0 THEN
        PERFORM public.ers_wo_stamp_cost_approval(p_wo, v_cost);
    END IF;
    RETURN public.ers_wo_release_state(p_wo);
END $$;
REVOKE ALL ON FUNCTION public.ers_request_wo_cost_release(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ers_request_wo_cost_release(uuid) TO authenticated;

-- Sign the caller's step. An approver above the line needs no edit right on
-- orders: the chain decides who may sign.
CREATE OR REPLACE FUNCTION public.ers_approve_wo_cost(p_wo uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_cost  numeric;
    v_round numeric;
    v_left  integer;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.work_orders WHERE id = p_wo AND company_id = public.caller_company()) THEN
        RAISE EXCEPTION 'work order % not found', p_wo;
    END IF;
    v_cost := public.ers_wo_planned_cost(p_wo);
    SELECT max(amount) INTO v_round FROM public.approval_steps
     WHERE doc_type = 'WORK_ORDER' AND doc_id = p_wo AND status = 'PENDING';
    IF v_round IS NULL THEN
        RAISE EXCEPTION 'NOTHING_PENDING: no cost release is waiting on this order' USING ERRCODE = 'check_violation';
    END IF;
    IF v_cost > v_round THEN
        RAISE EXCEPTION 'PLAN_CHANGED: the planned cost has grown since the release was requested. The planner must request it again.'
            USING ERRCODE = 'check_violation';
    END IF;
    v_left := public.approval_sign('WORK_ORDER', p_wo);
    IF v_left = 0 THEN
        PERFORM public.ers_wo_stamp_cost_approval(p_wo, v_round);
    END IF;
    RETURN public.ers_wo_release_state(p_wo);
END $$;
REVOKE ALL ON FUNCTION public.ers_approve_wo_cost(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ers_approve_wo_cost(uuid) TO authenticated;

-- ── F. Purchase orders: the chain at authorisation ──────────────────────────
-- 0371's function. New: the order total runs the PURCHASE_ORDER chain. A call
-- signs the caller's step(s); while steps remain it returns {pending: true}
-- and the order is NOT authorised. The last signature authorises it.
CREATE OR REPLACE FUNCTION public.ers_authorize_purchase_order(p_po uuid, p_override_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_check jsonb;
    v_user  text;
    v_email text;
    v_po    public.purchase_orders%ROWTYPE;
    v_total numeric;
    v_round numeric;
    v_left  integer;
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

    -- 0401: the approval chain on the order total. The first approver to act
    -- opens it (and holds their own step and those below); later approvers
    -- sign what is theirs. A changed total starts the chain again.
    SELECT coalesce(sum(l.line_total), 0) INTO v_total FROM public.purchase_order_lines l WHERE l.po_id = p_po;
    SELECT max(amount) INTO v_round FROM public.approval_steps
     WHERE doc_type = 'PURCHASE_ORDER' AND doc_id = p_po AND status = 'PENDING';
    IF v_round IS NULL OR v_round <> v_total THEN
        v_left := public.approval_open('PURCHASE_ORDER', p_po, v_total);
    ELSE
        v_left := public.approval_sign('PURCHASE_ORDER', p_po);
    END IF;
    IF v_left > 0 THEN
        RETURN jsonb_build_object(
            'pending', true,
            'steps_left', v_left,
            'waiting_on', (SELECT to_jsonb(s.roles) FROM public.approval_steps s
                            WHERE s.doc_type = 'PURCHASE_ORDER' AND s.doc_id = p_po AND s.status = 'PENDING'
                            ORDER BY s.step_order LIMIT 1));
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

-- ── G. Admin › Approvals ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ers_get_approval_chain(p_doc text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT jsonb_build_object(
        'is_default', NOT EXISTS (SELECT 1 FROM public.approval_bands b
                                   WHERE b.company_id = public.caller_company() AND b.doc_type = p_doc),
        'exempt_plan_generated', coalesce((SELECT s.wo_exempt_plan_generated FROM public.approval_settings s
                                            WHERE s.company_id = public.caller_company()), true),
        'steps', coalesce((SELECT jsonb_agg(jsonb_build_object(
                        'step_order', c.step_order, 'roles', to_jsonb(c.roles), 'up_to_amount', c.up_to_amount,
                        'notify_after_hours', c.notify_after_hours, 'takeover_after_hours', c.takeover_after_hours)
                        ORDER BY c.step_order)
                    FROM public.approval_chain(public.caller_company(), p_doc) c), '[]'::jsonb));
$$;
REVOKE ALL ON FUNCTION public.ers_get_approval_chain(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ers_get_approval_chain(text) TO authenticated;

-- Replace a document type's bands. Steps are renumbered 1..n in the order
-- given; amounts must rise and each takeover allowance must not be shorter
-- than its notice allowance.
CREATE OR REPLACE FUNCTION public.ers_save_approval_chain(p_doc text, p_steps jsonb, p_exempt_plan_generated boolean DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_company uuid := public.caller_company();
    r         record;
    v_prev    numeric := 0;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Not authorized: only an administrator can change the approval chain' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_doc NOT IN ('WORK_ORDER', 'PURCHASE_ORDER') THEN RAISE EXCEPTION 'unknown document type %', p_doc; END IF;
    IF jsonb_typeof(p_steps) <> 'array' OR jsonb_array_length(p_steps) = 0 THEN
        RAISE EXCEPTION 'The chain needs at least one step' USING ERRCODE = 'check_violation';
    END IF;

    DELETE FROM public.approval_bands WHERE company_id = v_company AND doc_type = p_doc;
    FOR r IN
        SELECT ord::integer AS n, (e ->> 'up_to_amount')::numeric AS amt,
               coalesce((e ->> 'notify_after_hours')::integer, 24) AS nh,
               coalesce((e ->> 'takeover_after_hours')::integer, 48) AS th,
               ARRAY(SELECT upper(trim(x)) FROM jsonb_array_elements_text(e -> 'roles') x WHERE trim(x) <> '') AS roles
          FROM jsonb_array_elements(p_steps) WITH ORDINALITY t(e, ord)
         ORDER BY ord
    LOOP
        IF r.amt IS NULL OR r.amt <= v_prev THEN
            RAISE EXCEPTION 'Step %: the amount must be higher than the step before it', r.n USING ERRCODE = 'check_violation';
        END IF;
        IF cardinality(r.roles) = 0 THEN
            RAISE EXCEPTION 'Step %: choose at least one role', r.n USING ERRCODE = 'check_violation';
        END IF;
        IF r.th < r.nh THEN
            RAISE EXCEPTION 'Step %: the takeover allowance cannot be shorter than the notice allowance', r.n USING ERRCODE = 'check_violation';
        END IF;
        INSERT INTO public.approval_bands (company_id, doc_type, step_order, roles, up_to_amount, notify_after_hours, takeover_after_hours)
        VALUES (v_company, p_doc, r.n, r.roles, r.amt, r.nh, r.th);
        v_prev := r.amt;
    END LOOP;

    IF p_exempt_plan_generated IS NOT NULL THEN
        INSERT INTO public.approval_settings (company_id, wo_exempt_plan_generated)
        VALUES (v_company, p_exempt_plan_generated)
        ON CONFLICT (company_id) DO UPDATE SET wo_exempt_plan_generated = EXCLUDED.wo_exempt_plan_generated, updated_at = now();
    END IF;
    RETURN public.ers_get_approval_chain(p_doc);
END $$;
REVOKE ALL ON FUNCTION public.ers_save_approval_chain(text, jsonb, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ers_save_approval_chain(text, jsonb, boolean) TO authenticated;

-- ── H. Escalation: a late step is reported to the next level ────────────────
CREATE OR REPLACE FUNCTION public.ers_approval_escalation_sweep()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    s      record;
    v_done integer := 0;
BEGIN
    FOR s IN
        SELECT id FROM public.approval_steps
         WHERE status = 'PENDING' AND activated_at IS NOT NULL AND notified_at IS NULL
           AND now() >= activated_at + make_interval(hours => notify_after_hours)
    LOOP
        PERFORM public.approval_notify(s.id, 'LATE');
        UPDATE public.approval_steps SET notified_at = now() WHERE id = s.id;
        v_done := v_done + 1;
    END LOOP;
    RETURN v_done;
END $$;
REVOKE ALL ON FUNCTION public.ers_approval_escalation_sweep() FROM public, anon, authenticated;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RAISE NOTICE '0401: pg_cron absent — approval-escalation-sweep not registered on this project.';
        RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'approval-escalation-sweep') THEN
        PERFORM cron.unschedule('approval-escalation-sweep');
    END IF;
    PERFORM cron.schedule('approval-escalation-sweep', '*/15 * * * *', 'SELECT public.ers_approval_escalation_sweep()');
END $$;

COMMIT;

-- VERIFY (after apply):
--   SELECT public.ers_get_approval_chain('WORK_ORDER');      -- as an authenticated user: the default three steps
--   SELECT tgname FROM pg_trigger WHERE tgname = 'trg_enforce_wo_cost_release';
--   SELECT jobname, schedule FROM cron.job WHERE jobname = 'approval-escalation-sweep';
--   SELECT has_function_privilege('authenticated', 'public.ers_wo_planned_cost(uuid)', 'EXECUTE');   -- false
