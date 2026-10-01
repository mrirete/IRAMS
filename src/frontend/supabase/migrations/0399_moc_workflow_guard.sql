-- ════════════════════════════════════════════════════════════════════════════
-- 0399 — Management of Change: the workflow is enforced by the database
--
-- Until now every rule lived in the page. The table's UPDATE policy is
-- tenant-only (auth_update_moc_requests: company_id = caller_company()), so
-- any signed-in user could set status = 'APPROVED' on any change with one
-- REST call, and the page itself let the person who raised a change submit,
-- review, approve, implement and close it alone. A change to a safety
-- parameter or a PM interval approved by its own author is not a control.
--
-- A BEFORE UPDATE trigger now holds the rules:
--
--   DRAFT ───submit───▶ SUBMITTED ──review──▶ UNDER_REVIEW ──approve──▶ APPROVED
--     ▲                  │   │                    │                        │
--     │                  │   └──reject──┐         └──reject──┐             implement
--     └──return to draft─┴──────────────┴─ REJECTED ◀────────┘             ▼
--                                                                     IMPLEMENTED
--   cancel: DRAFT, SUBMITTED, REJECTED, APPROVED ──▶ CANCELLED            │ close
--   CLOSED and CANCELLED are final.                                        ▼
--                                                                       CLOSED
--
--   * review, approve and reject need moc.approve; every other move needs
--     moc.edit (caller_can, the same matrix the page reads);
--   * four-eyes: the requester cannot approve their own change;
--   * a rejection needs a reason;
--   * who and when are stamped here (reviewed_by/at, approved_by/at,
--     submitted/implemented/closed_at) — a client can no longer write them;
--   * requested_by cannot be rewritten after the fact;
--   * once APPROVED, what was approved (title, description, values,
--     justification, change type, linked entity) is frozen.
--
-- Permission and four-eyes checks apply to end users (a JWT is present).
-- Server jobs and migrations (no JWT) still obey the transition map and the
-- rejection-reason rule.
--
-- Inserts: a request starts as DRAFT; requested_by defaults to the caller.
-- Both writers (the MOC page and RCA's raiseMocForAction) already insert
-- DRAFT, so nothing that works today is refused.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.moc_requests_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    old_s  text := upper(coalesce(OLD.status, 'DRAFT'));
    new_s  text := upper(coalesce(NEW.status, 'DRAFT'));
    me     uuid := public.caller_user_id();
    is_end_user boolean := auth.uid() IS NOT NULL;
    allowed text[];
BEGIN
    NEW.status := new_s;
    -- Who raised it is history.
    NEW.requested_by := OLD.requested_by;

    -- What was approved stays what was approved.
    IF old_s IN ('APPROVED', 'IMPLEMENTED', 'CLOSED') AND (
           NEW.title          IS DISTINCT FROM OLD.title
        OR NEW.description    IS DISTINCT FROM OLD.description
        OR NEW.change_type    IS DISTINCT FROM OLD.change_type
        OR NEW.current_value  IS DISTINCT FROM OLD.current_value
        OR NEW.proposed_value IS DISTINCT FROM OLD.proposed_value
        OR NEW.justification  IS DISTINCT FROM OLD.justification
        OR NEW.entity_type    IS DISTINCT FROM OLD.entity_type
        OR NEW.entity_id      IS DISTINCT FROM OLD.entity_id
    ) THEN
        RAISE EXCEPTION 'Change % is %: what was approved cannot be edited. Raise a new change instead.', OLD.moc_number, old_s
            USING ERRCODE = 'check_violation';
    END IF;

    IF new_s = old_s THEN
        RETURN NEW;
    END IF;

    allowed := CASE old_s
        WHEN 'DRAFT'        THEN ARRAY['SUBMITTED', 'CANCELLED']
        WHEN 'SUBMITTED'    THEN ARRAY['UNDER_REVIEW', 'REJECTED', 'DRAFT', 'CANCELLED']
        WHEN 'UNDER_REVIEW' THEN ARRAY['APPROVED', 'REJECTED']
        WHEN 'APPROVED'     THEN ARRAY['IMPLEMENTED', 'CANCELLED']
        WHEN 'IMPLEMENTED'  THEN ARRAY['CLOSED']
        WHEN 'REJECTED'     THEN ARRAY['DRAFT', 'CANCELLED']
        ELSE ARRAY[]::text[]                       -- CLOSED, CANCELLED: final
    END;
    IF NOT (new_s = ANY (allowed)) THEN
        RAISE EXCEPTION 'A change cannot move from % to %.', old_s, new_s
            USING ERRCODE = 'check_violation';
    END IF;

    IF new_s = 'REJECTED' AND btrim(coalesce(NEW.rejection_reason, '')) = '' THEN
        RAISE EXCEPTION 'Rejecting a change needs a reason.' USING ERRCODE = 'check_violation';
    END IF;

    IF is_end_user THEN
        IF new_s IN ('UNDER_REVIEW', 'APPROVED', 'REJECTED') THEN
            IF NOT public.caller_can('moc', 'approve') THEN
                RAISE EXCEPTION 'Reviewing, approving or rejecting a change needs Management of Change · Approve.'
                    USING ERRCODE = 'insufficient_privilege';
            END IF;
        ELSIF NOT public.caller_can('moc', 'edit') THEN
            RAISE EXCEPTION 'Moving a change on needs Management of Change · Edit.'
                USING ERRCODE = 'insufficient_privilege';
        END IF;

        IF new_s = 'APPROVED' AND me IS NOT DISTINCT FROM OLD.requested_by THEN
            RAISE EXCEPTION 'You raised change %; someone else must approve it.', OLD.moc_number
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;

    -- Stamps: set here, never trusted from the client.
    CASE new_s
        WHEN 'SUBMITTED'    THEN NEW.submitted_at   := now();
        WHEN 'UNDER_REVIEW' THEN NEW.reviewed_by    := me;  NEW.reviewed_at := now();
        WHEN 'APPROVED'     THEN NEW.approved_by    := me;  NEW.approved_at := now();
        WHEN 'IMPLEMENTED'  THEN NEW.implemented_at := now();
        WHEN 'CLOSED'       THEN NEW.closed_at      := now();
        ELSE NULL;
    END CASE;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.moc_requests_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF upper(coalesce(NEW.status, 'DRAFT')) <> 'DRAFT' THEN
        RAISE EXCEPTION 'A change is raised as DRAFT and submitted from there (got %).', NEW.status
            USING ERRCODE = 'check_violation';
    END IF;
    NEW.status := 'DRAFT';
    NEW.requested_by := coalesce(NEW.requested_by, public.caller_user_id());
    -- No approval or review stamps on a new request.
    NEW.reviewed_by := NULL; NEW.reviewed_at := NULL;
    NEW.approved_by := NULL; NEW.approved_at := NULL;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.moc_requests_guard()        FROM public;
REVOKE ALL ON FUNCTION public.moc_requests_insert_guard() FROM public;

DROP TRIGGER IF EXISTS aa_moc_requests_guard ON public.moc_requests;
CREATE TRIGGER aa_moc_requests_guard
    BEFORE UPDATE ON public.moc_requests
    FOR EACH ROW EXECUTE FUNCTION public.moc_requests_guard();

DROP TRIGGER IF EXISTS aa_moc_requests_insert_guard ON public.moc_requests;
CREATE TRIGGER aa_moc_requests_insert_guard
    BEFORE INSERT ON public.moc_requests
    FOR EACH ROW EXECUTE FUNCTION public.moc_requests_insert_guard();

-- ── Proof (runs as the migration role: no JWT, so transition rules only) ────
DO $$
DECLARE
    v_company uuid;
    v_id uuid;
    refused boolean;
BEGIN
    SELECT id INTO v_company FROM public.companies ORDER BY created_at NULLS LAST LIMIT 1;
    IF v_company IS NULL THEN
        RAISE NOTICE '0399: no company row — proof skipped';
        RETURN;
    END IF;

    INSERT INTO public.moc_requests (moc_number, title, change_type, justification, status, company_id)
    VALUES ('', '0399 proof', 'OTHER', 'proof', 'DRAFT', v_company)
    RETURNING id INTO v_id;

    refused := false;
    BEGIN
        UPDATE public.moc_requests SET status = 'APPROVED' WHERE id = v_id;
    EXCEPTION WHEN check_violation THEN refused := true;
    END;
    IF NOT refused THEN RAISE EXCEPTION '0399 proof: DRAFT → APPROVED was allowed'; END IF;

    UPDATE public.moc_requests SET status = 'SUBMITTED' WHERE id = v_id;
    IF (SELECT submitted_at FROM public.moc_requests WHERE id = v_id) IS NULL THEN
        RAISE EXCEPTION '0399 proof: submitted_at not stamped';
    END IF;

    refused := false;
    BEGIN
        UPDATE public.moc_requests SET status = 'REJECTED' WHERE id = v_id;
    EXCEPTION WHEN check_violation THEN refused := true;
    END;
    IF NOT refused THEN RAISE EXCEPTION '0399 proof: rejection without a reason was allowed'; END IF;

    UPDATE public.moc_requests SET status = 'REJECTED', rejection_reason = 'proof' WHERE id = v_id;
    UPDATE public.moc_requests SET status = 'DRAFT' WHERE id = v_id;

    DELETE FROM public.moc_requests WHERE id = v_id;
    RAISE NOTICE '0399: MOC workflow-guard proof passed';
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
