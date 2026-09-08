-- 0348 — permit to work: who may do what, enforced where it counts.
--
-- Found 2026-09-08: ptw_permits / ptw_approvals carried a tenant-only
-- "authenticated_access" policy and the screen checked nothing, so one
-- technician could raise a permit, approve all four approval roles, mark it
-- approved, issue it and start work under it. With 0347 the matrix says who
-- may act; these triggers make the database say the same.
--
--   raise (INSERT)            safety.create            created_by := caller
--   submit  DRAFT→PENDING     creator, or safety.edit
--   approve step (decision)   safety.approve AND not the creator (four-eyes)
--                             approver_id := caller
--   approve PENDING→APPROVED  safety.approve AND not the creator, all steps approved
--   reject  PENDING→REJECTED  safety.approve AND not the creator
--   issue   APPROVED→ISSUED   safety.approve AND not the creator; toolbox talk done
--   start   ISSUED→ACTIVE     creator / permit holder / receiver, or safety.approve
--   suspend ACTIVE→SUSPENDED  safety.approve
--   resume  SUSPENDED→ACTIVE  safety.approve
--   return  →RETURNED         creator / holder / receiver, or safety.approve
--   close   RETURNED→CLOSED   safety.approve
-- Admins and internal (no-JWT) sessions bypass.

CREATE OR REPLACE FUNCTION public.enforce_ptw_permit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    me uuid := public.caller_user_id();
    old_s text := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE upper(coalesce(OLD.status::text, '')) END;
    new_s text := upper(coalesce(NEW.status::text, ''));
    is_creator boolean;
    is_holder boolean;
    can_approve boolean;
    n_pending int;
BEGIN
    IF public.session_is_internal() OR public.is_admin() THEN
        IF TG_OP = 'INSERT' AND NEW.created_by IS NULL THEN NEW.created_by := me::text; END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NOT public.caller_can('safety', 'create') THEN
            RAISE EXCEPTION 'SAFETY_CREATE_REQUIRED: Your role cannot raise a permit to work (needs Safety · Create).' USING ERRCODE = 'insufficient_privilege';
        END IF;
        NEW.created_by := me::text;                 -- the requester is the session, whatever was sent
        IF new_s NOT IN ('', 'DRAFT') THEN NEW.status := 'DRAFT'; END IF;  -- a permit is born a draft
        RETURN NEW;
    END IF;

    is_creator := (OLD.created_by::text = me::text);
    is_holder := (OLD.permit_holder_id::text = me::text OR OLD.receiver_id::text = me::text);
    can_approve := public.caller_can('safety', 'approve');

    IF new_s IS NOT DISTINCT FROM old_s THEN
        -- Editing the body of a permit: creator, or safety.edit, or an approver.
        IF NOT (is_creator OR public.caller_can('safety', 'edit') OR can_approve) THEN
            RAISE EXCEPTION 'SAFETY_EDIT_REQUIRED: Only the person who raised permit % or a safety editor can change it.', OLD.permit_number USING ERRCODE = 'insufficient_privilege';
        END IF;
        NEW.created_by := OLD.created_by;           -- the requester cannot be rewritten
        RETURN NEW;
    END IF;

    -- Status transitions
    IF old_s = 'DRAFT' AND new_s = 'PENDING' THEN
        IF NOT (is_creator OR public.caller_can('safety', 'edit')) THEN
            RAISE EXCEPTION 'PTW_SUBMIT: Only the person who raised permit % (or a safety editor) can submit it for approval.', OLD.permit_number USING ERRCODE = 'insufficient_privilege';
        END IF;
    ELSIF old_s = 'PENDING' AND new_s IN ('APPROVED', 'REJECTED') THEN
        IF NOT can_approve THEN
            RAISE EXCEPTION 'PTW_APPROVE: Your role cannot approve or reject permit % (needs Safety · Approve).', OLD.permit_number USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF is_creator THEN
            RAISE EXCEPTION 'PTW_FOUR_EYES: You raised permit %; someone else must approve it.', OLD.permit_number USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF new_s = 'APPROVED' THEN
            SELECT count(*) INTO n_pending FROM public.ptw_approvals a WHERE a.permit_id = OLD.id AND upper(coalesce(a.decision, 'PENDING')) <> 'APPROVED';
            IF n_pending > 0 THEN
                RAISE EXCEPTION 'PTW_APPROVALS_OPEN: Permit % still has % approval step(s) open.', OLD.permit_number, n_pending USING ERRCODE = 'check_violation';
            END IF;
        END IF;
    ELSIF old_s = 'APPROVED' AND new_s = 'ISSUED' THEN
        IF NOT can_approve OR is_creator THEN
            RAISE EXCEPTION 'PTW_ISSUE: Permit % is issued by the issuing authority (Safety · Approve, not the person who raised it).', OLD.permit_number USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF NOT coalesce(OLD.toolbox_talk_completed, false) AND NOT coalesce(NEW.toolbox_talk_completed, false) THEN
            RAISE EXCEPTION 'PTW_TOOLBOX: Permit % cannot be issued before the toolbox talk is recorded.', OLD.permit_number USING ERRCODE = 'check_violation';
        END IF;
        NEW.issuer_id := me::text;
    ELSIF old_s = 'ISSUED' AND new_s = 'ACTIVE' THEN
        IF NOT (is_creator OR is_holder OR can_approve) THEN
            RAISE EXCEPTION 'PTW_ACCEPT: Permit % is accepted by the person who raised it or the permit holder.', OLD.permit_number USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF OLD.receiver_id IS NULL THEN NEW.receiver_id := me::text; END IF;
    ELSIF old_s = 'ACTIVE' AND new_s = 'SUSPENDED' THEN
        IF NOT can_approve THEN
            RAISE EXCEPTION 'PTW_SUSPEND: Suspending permit % needs Safety · Approve.', OLD.permit_number USING ERRCODE = 'insufficient_privilege';
        END IF;
    ELSIF old_s = 'SUSPENDED' AND new_s = 'ACTIVE' THEN
        IF NOT can_approve THEN
            RAISE EXCEPTION 'PTW_RESUME: Resuming permit % needs Safety · Approve.', OLD.permit_number USING ERRCODE = 'insufficient_privilege';
        END IF;
    ELSIF old_s IN ('ACTIVE', 'SUSPENDED') AND new_s = 'RETURNED' THEN
        IF NOT (is_creator OR is_holder OR can_approve) THEN
            RAISE EXCEPTION 'PTW_RETURN: Permit % is returned by the person who raised it, the permit holder, or an approver.', OLD.permit_number USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF NEW.returned_by IS NULL THEN NEW.returned_by := me::text; END IF;
    ELSIF old_s = 'RETURNED' AND new_s = 'CLOSED' THEN
        IF NOT can_approve THEN
            RAISE EXCEPTION 'PTW_CLOSE: Closing permit % needs Safety · Approve.', OLD.permit_number USING ERRCODE = 'insufficient_privilege';
        END IF;
    ELSE
        RAISE EXCEPTION 'PTW_TRANSITION: Permit % cannot go from % to %.', OLD.permit_number, old_s, new_s USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_by := OLD.created_by;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ab_enforce_ptw_permit ON public.ptw_permits;
CREATE TRIGGER ab_enforce_ptw_permit
    BEFORE INSERT OR UPDATE ON public.ptw_permits
    FOR EACH ROW EXECUTE FUNCTION public.enforce_ptw_permit();

CREATE OR REPLACE FUNCTION public.enforce_ptw_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    me uuid := public.caller_user_id();
    creator text;
BEGIN
    IF public.session_is_internal() OR public.is_admin() THEN RETURN NEW; END IF;
    IF TG_OP = 'INSERT' THEN
        -- Steps are created with the permit, undecided.
        NEW.decision := 'PENDING'; NEW.approver_id := NULL; NEW.decided_at := NULL;
        RETURN NEW;
    END IF;
    IF upper(coalesce(NEW.decision, 'PENDING')) IS DISTINCT FROM upper(coalesce(OLD.decision, 'PENDING'))
       OR NEW.approver_id IS DISTINCT FROM OLD.approver_id THEN
        IF NOT public.caller_can('safety', 'approve') THEN
            RAISE EXCEPTION 'PTW_APPROVE: Your role cannot decide a permit approval step (needs Safety · Approve).' USING ERRCODE = 'insufficient_privilege';
        END IF;
        SELECT p.created_by INTO creator FROM public.ptw_permits p WHERE p.id = NEW.permit_id;
        IF creator = me::text THEN
            RAISE EXCEPTION 'PTW_FOUR_EYES: You raised this permit; someone else must approve it.' USING ERRCODE = 'insufficient_privilege';
        END IF;
        NEW.approver_id := me::text;                -- the decision carries the session, whatever was sent
        NEW.decided_at := coalesce(NEW.decided_at, now());
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ab_enforce_ptw_approval ON public.ptw_approvals;
CREATE TRIGGER ab_enforce_ptw_approval
    BEFORE INSERT OR UPDATE ON public.ptw_approvals
    FOR EACH ROW EXECUTE FUNCTION public.enforce_ptw_approval();

COMMENT ON FUNCTION public.enforce_ptw_permit() IS '0348: permit lifecycle gated on the safety matrix with four-eyes between requester and approver/issuer.';
