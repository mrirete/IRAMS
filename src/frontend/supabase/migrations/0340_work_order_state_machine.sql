-- 0340 — the database defends the work order lifecycle.
--
-- Found by the 2026-09-08 five-role assurance run (docs/Process-Test-Work-
-- Management-Run-2026-09-08.md, P0-B, P0-C, P1-8, P1-9, P1-12): terminal
-- states, the cost freeze and the append-only journal were page conventions
-- only. A technician reopened a financially CLOSED order through the API,
-- edited posted hours, rewrote its title, cancelled and self-assigned someone
-- else's scheduled order, posted time after close, and deleted a system
-- journal row. Every update policy was `workOrders.edit`, tenant-wide, with
-- no state check; freeze_costs_on_close (0284) guarded the cost columns only.
--
-- RULES (BEFORE triggers, so they hold for every client and every page):
--   work_orders   · a CLOSED / cost-frozen order changes only by an admin;
--                 · entering CANC/CANCELLED needs workOrders.approve, CLOSED needs finops.edit;
--                 · changing assigned_to needs workOrders.assign or
--                   scheduling.assign (order-level responsibility is set by
--                   planners and supervisors; technicians tick themselves on
--                   task steps, which stays allowed).
--   labour/parts  · no insert, update or delete under a frozen order.
--   journal       · update/delete: admins, or the author of a non-system
--                   entry while the parent order is still open; audited.
-- Service-role and internal (no JWT) sessions bypass: automation, imports
-- and the tenant runner keep working; admins bypass the lock only.

-- ── Caller identity ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.caller_contact_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT u.contact_id FROM public.users u WHERE u.id = public.caller_user_id() LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.caller_contact_id() TO authenticated;

/** True when the request carries no authenticated user (service role, cron, runner). */
CREATE OR REPLACE FUNCTION public.session_is_internal()
RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT coalesce(auth.role(), '') <> 'authenticated';
$$;

-- ── work_orders ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_wo_state_machine()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    old_s text := upper(coalesce(OLD.status::text, ''));
    new_s text := upper(coalesce(NEW.status::text, ''));
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

    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ab_enforce_wo_state ON public.work_orders;
CREATE TRIGGER ab_enforce_wo_state
    BEFORE UPDATE ON public.work_orders
    FOR EACH ROW EXECUTE FUNCTION public.enforce_wo_state_machine();

-- ── labour and parts under a frozen order ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.refuse_child_write_when_frozen()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_wo uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.wo_id ELSE NEW.wo_id END;
    v_frozen boolean;
    v_no text;
BEGIN
    IF public.session_is_internal() OR public.is_admin() THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;
    SELECT coalesce(cost_frozen, false) OR upper(coalesce(status::text, '')) = 'CLOSED', wo_number
      INTO v_frozen, v_no FROM public.work_orders WHERE id = v_wo;
    IF v_frozen THEN
        RAISE EXCEPTION 'COST_FROZEN: Work order % is financially closed; no labour or parts can be posted or changed.', v_no
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

DROP TRIGGER IF EXISTS ab_refuse_frozen ON public.work_order_labor;
CREATE TRIGGER ab_refuse_frozen BEFORE INSERT OR UPDATE OR DELETE ON public.work_order_labor
    FOR EACH ROW EXECUTE FUNCTION public.refuse_child_write_when_frozen();
DROP TRIGGER IF EXISTS ab_refuse_frozen ON public.work_order_parts;
CREATE TRIGGER ab_refuse_frozen BEFORE INSERT OR UPDATE OR DELETE ON public.work_order_parts
    FOR EACH ROW EXECUTE FUNCTION public.refuse_child_write_when_frozen();

-- ── journal_entries: append-only in practice ────────────────────────────────
/** The caller wrote this entry, it is not a system entry, and its work order is still open. */
CREATE OR REPLACE FUNCTION public.journal_is_own_open(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1
          FROM public.journal_entries j
          JOIN public.users u ON u.id = public.caller_user_id()
          LEFT JOIN public.work_orders w ON w.id = j.entity_id AND j.entity_type IN ('WORK_ORDER', 'WO')
         WHERE j.id = p_id
           AND coalesce(j.is_system, false) = false
           AND (j.created_by = u.id
                OR lower(coalesce(j.author_name, '')) IN (lower(coalesce(u.username, '')), lower(coalesce(u.email, ''))))
           AND (w.id IS NULL OR upper(coalesce(w.status::text, '')) NOT IN ('TECO', 'CLOSED', 'CANC', 'CANCELLED'))
    );
$$;
GRANT EXECUTE ON FUNCTION public.journal_is_own_open(uuid) TO authenticated;

DROP POLICY IF EXISTS finops_update_journal_entries ON public.journal_entries;
DROP POLICY IF EXISTS finops_delete_journal_entries ON public.journal_entries;
DROP POLICY IF EXISTS scoped_update_journal_entries ON public.journal_entries;
DROP POLICY IF EXISTS scoped_delete_journal_entries ON public.journal_entries;
CREATE POLICY scoped_update_journal_entries ON public.journal_entries
    FOR UPDATE TO authenticated
    USING (company_id = (SELECT public.caller_company()) AND ((SELECT public.is_admin()) OR public.journal_is_own_open(id)))
    WITH CHECK (company_id = (SELECT public.caller_company()) AND coalesce(is_system, false) = false);
CREATE POLICY scoped_delete_journal_entries ON public.journal_entries
    FOR DELETE TO authenticated
    USING (company_id = (SELECT public.caller_company()) AND ((SELECT public.is_admin()) OR public.journal_is_own_open(id)));

DROP TRIGGER IF EXISTS audit_journal_changes ON public.journal_entries;
CREATE TRIGGER audit_journal_changes AFTER INSERT OR UPDATE OR DELETE ON public.journal_entries
    FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

COMMENT ON FUNCTION public.enforce_wo_state_machine() IS
    '0340: CLOSED/frozen orders change only by admins; CANC needs workOrders.approve, CLOSED needs finops.edit; assigned_to needs an Assign permission. Internal (no-JWT) sessions bypass.';
