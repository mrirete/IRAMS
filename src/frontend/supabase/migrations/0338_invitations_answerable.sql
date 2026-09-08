-- 0338 — Invitations that can be answered.
--
-- What was wrong (walkthrough 2026-09-07, J.test1 on a maturity assessment):
--   * audit_assessment_collaborators has had pending/accepted/declined and an
--     invite_token since 0147, but nothing ever read the token or changed the
--     status. An invite stayed "Pending" forever on the inviter's side and the
--     invitee had nowhere to accept or decline.
--   * access was granted at INVITE time, from the inviter's browser, as full
--     audits rights (create/edit/delete/approve) — even for a "viewer".
--   * the table's only policy was USING (true): every tenant could read every
--     tenant's invitations.
--   * on RCM / RCA studies the team is an access list (0332/0335), so there is
--     nothing to accept — but a member also had no way to leave: the update
--     policy and the RCM guard refuse a viewer's write to `collaborators`.
--
-- This migration:
--   1. scopes audit_assessment_collaborators to the tenant; inviter/admin/
--      audits-editor may invite and withdraw; the answer goes only through
--      respond_to_assessment_invite(), which checks the row is the caller's.
--   2. moves the audits grant to ACCEPTANCE, sized to the role: view for a
--      viewer, view+edit for a contributor. Never delete, never approve.
--   3. get_assessment_invite(token) resolves a shared link for a signed-in user.
--   4. rcm_leave_study() / rca_leave_investigation(): a member removes only
--      their own entries; the RCM approval guard learns to tell "I left" from
--      "someone edited the team".

BEGIN;

-- ── 0. Who is calling, by the email the invitation was addressed to ──────────
CREATE OR REPLACE FUNCTION public.caller_email()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT lower(coalesce(
    (SELECT u.email FROM public.users u WHERE u.id = auth.uid()),
    auth.jwt() ->> 'email'
  ));
$$;
REVOKE ALL ON FUNCTION public.caller_email() FROM public;
GRANT EXECUTE ON FUNCTION public.caller_email() TO authenticated;
COMMENT ON FUNCTION public.caller_email() IS
  'Lower-cased email of the caller: users.email for auth.uid(), else the JWT claim. Invitations are addressed to an email, so this is how a row is matched to a person (0338).';

-- ── 1. audit_assessment_collaborators: tenant-scoped, answered via RPC ────────
ALTER TABLE public.audit_assessment_collaborators
  ADD COLUMN IF NOT EXISTS responded_at timestamptz;
COMMENT ON COLUMN public.audit_assessment_collaborators.responded_at IS
  'When the invitee accepted or declined (0338). accepted_at is set only on acceptance.';

CREATE OR REPLACE FUNCTION public.assessment_caller_is_contributor(p_assessment uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.audit_assessment_collaborators c
     WHERE c.assessment_id = p_assessment
       AND c.status = 'accepted' AND c.role = 'contributor'
       AND lower(c.email) = public.caller_email());
$$;
GRANT EXECUTE ON FUNCTION public.assessment_caller_is_contributor(uuid) TO authenticated;

DROP POLICY IF EXISTS "collab_full_access" ON public.audit_assessment_collaborators;
DROP POLICY IF EXISTS collab_select ON public.audit_assessment_collaborators;
DROP POLICY IF EXISTS collab_insert ON public.audit_assessment_collaborators;
DROP POLICY IF EXISTS collab_delete ON public.audit_assessment_collaborators;

CREATE POLICY collab_select ON public.audit_assessment_collaborators
  FOR SELECT TO authenticated
  USING (company_id = (SELECT public.caller_company()));

-- Who may invite: an administrator, anyone who may create or edit assessments,
-- or an accepted contributor on this assessment.
CREATE POLICY collab_insert ON public.audit_assessment_collaborators
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = (SELECT public.caller_company())
    AND (
      (SELECT public.is_admin())
      OR (SELECT public.caller_can('audits', 'create'))
      OR (SELECT public.caller_can('audits', 'edit'))
      OR (SELECT public.assessment_caller_is_contributor(assessment_id))
    )
  );

-- Withdrawing an invitation: the inviter, an administrator, or an audits editor.
CREATE POLICY collab_delete ON public.audit_assessment_collaborators
  FOR DELETE TO authenticated
  USING (
    company_id = (SELECT public.caller_company())
    AND (
      (SELECT public.is_admin())
      OR lower(coalesce(invited_by, '')) = (SELECT public.caller_email())
      OR (SELECT public.caller_can('audits', 'edit'))
    )
  );
-- No UPDATE policy on purpose: the only legitimate update is the invitee's
-- answer, and that goes through respond_to_assessment_invite().

-- ── 2. The answer, and the grant that follows it ─────────────────────────────
CREATE OR REPLACE FUNCTION public.respond_to_assessment_invite(
  p_accept boolean,
  p_assessment uuid DEFAULT NULL,
  p_token text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me     text := public.caller_email();
  v_row    public.audit_assessment_collaborators%ROWTYPE;
  v_status text := CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END;
  v_grant  jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_me IS NULL THEN
    RAISE EXCEPTION 'INVITE_DENIED: sign in to answer an invitation'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_token IS NOT NULL AND p_token <> '' THEN
    SELECT * INTO v_row FROM public.audit_assessment_collaborators WHERE invite_token = p_token;
  ELSIF p_assessment IS NOT NULL THEN
    SELECT * INTO v_row FROM public.audit_assessment_collaborators
     WHERE assessment_id = p_assessment AND lower(email) = v_me
     ORDER BY invited_at DESC LIMIT 1;
  END IF;

  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF lower(v_row.email) <> v_me THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_yours', 'email', v_row.email);
  END IF;

  IF v_row.status = v_status THEN
    RETURN jsonb_build_object('ok', true, 'unchanged', true, 'status', v_row.status,
      'assessment_id', v_row.assessment_id, 'role', v_row.role, 'invited_by', v_row.invited_by);
  END IF;

  UPDATE public.audit_assessment_collaborators
     SET status = v_status,
         accepted_at = CASE WHEN p_accept THEN now() ELSE NULL END,
         responded_at = now()
   WHERE id = v_row.id;

  IF p_accept THEN
    -- The grant is the size of the role. It merges into the person's existing
    -- overrides and never adds delete or approve.
    v_grant := CASE WHEN v_row.role = 'contributor'
                    THEN '{"view": true, "edit": true}'::jsonb
                    ELSE '{"view": true}'::jsonb END;
    UPDATE public.users u
       SET permission_overrides = coalesce(u.permission_overrides, '{}'::jsonb)
           || jsonb_build_object('audits', coalesce(u.permission_overrides -> 'audits', '{}'::jsonb) || v_grant)
     WHERE u.id = auth.uid();
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', v_status,
    'assessment_id', v_row.assessment_id, 'role', v_row.role, 'invited_by', v_row.invited_by);
END;
$$;
REVOKE ALL ON FUNCTION public.respond_to_assessment_invite(boolean, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.respond_to_assessment_invite(boolean, uuid, text) TO authenticated;
COMMENT ON FUNCTION public.respond_to_assessment_invite(boolean, uuid, text) IS
  'The invitee accepts (true) or declines (false) an assessment invitation addressed to their email — by assessment id or by shared-link token. Acceptance grants audits view (viewer) or view+edit (contributor) via permission_overrides; nothing is granted before that (0338).';

-- ── 3. Resolve a shared link for a signed-in user ────────────────────────────
CREATE OR REPLACE FUNCTION public.get_assessment_invite(p_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.audit_assessment_collaborators%ROWTYPE;
  v_number text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'INVITE_DENIED: sign in first' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_row FROM public.audit_assessment_collaborators WHERE invite_token = p_token;
  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;
  SELECT assessment_number INTO v_number FROM public.audit_assessments WHERE id = v_row.assessment_id;
  RETURN jsonb_build_object(
    'found', true,
    'assessment_id', v_row.assessment_id,
    'assessment_number', v_number,
    'role', v_row.role,
    'status', v_row.status,
    'email', v_row.email,
    'invited_by', v_row.invited_by,
    'mine', lower(v_row.email) = public.caller_email());
END;
$$;
REVOKE ALL ON FUNCTION public.get_assessment_invite(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_assessment_invite(text) TO authenticated;

-- ── 4. Leaving a study team ──────────────────────────────────────────────────
-- A team (RCM study, RCA investigation) is an access list, so joining needs no
-- answer — but a member must be able to leave, and only a facilitator/editor
-- may otherwise touch the list. These strip the CALLER's own contact entries.
CREATE OR REPLACE FUNCTION public.team_without_caller(p_team jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(t.c ORDER BY t.n), '[]'::jsonb)
    FROM jsonb_array_elements(coalesce(p_team, '[]'::jsonb)) WITH ORDINALITY AS t(c, n)
   WHERE NOT (
     t.c ->> 'type' = 'contact'
     AND t.c ->> 'ref_id' = (SELECT u.contact_id::text FROM public.users u WHERE u.id = auth.uid())
   );
$$;
GRANT EXECUTE ON FUNCTION public.team_without_caller(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.team_change_is_self_leave(p_old jsonb, p_new jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_new IS DISTINCT FROM p_old
     AND coalesce(p_new, '[]'::jsonb) = public.team_without_caller(p_old);
$$;
GRANT EXECUTE ON FUNCTION public.team_change_is_self_leave(jsonb, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.rcm_leave_study(p_study uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old jsonb; v_new jsonb;
BEGIN
  SELECT collaborators INTO v_old FROM public.ers_rcm_studies
   WHERE id = p_study AND company_id = public.caller_company();
  IF NOT FOUND THEN RETURN false; END IF;
  v_new := public.team_without_caller(v_old);
  IF v_new = coalesce(v_old, '[]'::jsonb) THEN RETURN false; END IF;
  UPDATE public.ers_rcm_studies SET collaborators = v_new WHERE id = p_study;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.rcm_leave_study(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.rcm_leave_study(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.rca_leave_investigation(p_inv uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old jsonb; v_new jsonb;
BEGIN
  SELECT collaborators INTO v_old FROM public.ers_rca_investigations
   WHERE id = p_inv AND company_id = public.caller_company();
  IF NOT FOUND THEN RETURN false; END IF;
  v_new := public.team_without_caller(v_old);
  IF v_new = coalesce(v_old, '[]'::jsonb) THEN RETURN false; END IF;
  UPDATE public.ers_rca_investigations SET collaborators = v_new WHERE id = p_inv;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.rca_leave_investigation(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.rca_leave_investigation(uuid) TO authenticated;

-- The RCM approval guard (0335) refuses any team change by someone who cannot
-- edit. A member leaving is the one team change that is theirs to make.
CREATE OR REPLACE FUNCTION public.rcm_study_approval_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_modes int; v_unclassified int; v_unstrategised int;
BEGIN
  -- An approver who is not an editor may touch the sign-off columns only —
  -- and may remove themselves from the team (0338).
  IF NOT public.rcm_can_edit(NEW.id) THEN
    IF NEW.title IS DISTINCT FROM OLD.title OR NEW.asset_id IS DISTINCT FROM OLD.asset_id
       OR NEW.operating_context IS DISTINCT FROM OLD.operating_context OR NEW.study_type IS DISTINCT FROM OLD.study_type
       OR NEW.facilitator IS DISTINCT FROM OLD.facilitator OR NEW.notes IS DISTINCT FROM OLD.notes
       OR (NEW.collaborators IS DISTINCT FROM OLD.collaborators
           AND NOT public.team_change_is_self_leave(OLD.collaborators, NEW.collaborators))
       OR NEW.context_snapshot IS DISTINCT FROM OLD.context_snapshot
       OR NEW.criticality_rank IS DISTINCT FROM OLD.criticality_rank OR NEW.rcm_source IS DISTINCT FROM OLD.rcm_source
       OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'RCM_EDIT_DENIED: a reviewer may approve or reopen the study, not edit it'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- Entering approved: the right person, and every question answered.
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    IF NOT public.rcm_can_approve(NEW.id) THEN
      RAISE EXCEPTION 'RCM_APPROVE_DENIED: approval needs the study facilitator, a reviewer on its team, or an administrator'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT count(m.id),
           count(m.id) FILTER (WHERE coalesce(d.consequence_code, '') = ''),
           count(m.id) FILTER (WHERE coalesce(d.recommended_strategy_code, '') = '')
      INTO v_modes, v_unclassified, v_unstrategised
      FROM public.ers_rcm_functions f
      JOIN public.ers_rcm_failure_modes m ON m.function_id = f.id
      LEFT JOIN public.ers_rcm_decisions d ON d.failure_mode_id = m.id
     WHERE f.study_id = NEW.id;
    IF coalesce(v_modes, 0) = 0 THEN
      RAISE EXCEPTION 'RCM_APPROVE_DENIED: a worksheet with at least one function and failure mode is needed before approval'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_unclassified > 0 OR v_unstrategised > 0 THEN
      RAISE EXCEPTION 'RCM_APPROVE_DENIED: % failure mode(s) without a consequence class (Q5) and % without a strategy (Q6-Q7)', v_unclassified, v_unstrategised
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.approved_at := coalesce(NEW.approved_at, now());
    NEW.approved_by := coalesce(nullif(NEW.approved_by, ''), auth.jwt() ->> 'email', 'approver');
    NEW.approved_by_user_id := auth.uid();
  END IF;

  -- Leaving approved (other than closing) is a revision: the right person, and a bump.
  IF OLD.status = 'approved' AND NEW.status IS DISTINCT FROM 'approved' THEN
    IF NOT public.rcm_can_approve(NEW.id) THEN
      RAISE EXCEPTION 'RCM_REOPEN_DENIED: reopening an approved study needs the study facilitator, a reviewer on its team, or an administrator'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.status <> 'closed' THEN
      IF coalesce(NEW.revision, 1) <= coalesce(OLD.revision, 1) THEN
        NEW.revision := coalesce(OLD.revision, 1) + 1;
      END IF;
      NEW.approved_by := NULL;
      NEW.approved_at := NULL;
      NEW.approved_by_user_id := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
