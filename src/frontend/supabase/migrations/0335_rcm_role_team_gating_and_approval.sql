-- 0335 — RCM: the study team persists and gates writes; approval and reopening
-- are records the database enforces, not page state.
--
-- Found by the 2026-09-07 K-601 team walkthrough (docs/Process-Test-RCM-Team.md):
--   * the Study Team drawer wrote ers_rcm_studies.collaborators, a column that
--     never existed (only ers_rca_investigations got it in 0025a) — every
--     invite failed silently and the team vanished on reload;
--   * every ers_rcm_* write/delete policy was tenant-only ("AND true"), so a
--     view-only technician, supervisor or planner could rewrite, delete or
--     approve a study with a bare PATCH;
--   * the JA1012 completeness gate lived only in the page, approved_by held a
--     display name, and nobody recorded who created the study;
--   * ers_rcm_studies had no freeze trigger: anyone could flip an approved
--     study back to in_progress (no revision bump) and edit it.
--
-- Model (mirrors 0332/0333 for RCA):
--   read     — tenant-wide (the app's reliability.view permission gates the module);
--   create   — reliability.create / reliability.edit (role template) or admin;
--   edit     — admin, reliability.edit, the creator, or a team owner / editor;
--   approve  — admin, the creator, or a team owner / reviewer, and only when
--   reopen      every failure mode is classified (Q5) and has a strategy (Q6–Q7);
--              reopening an approved study bumps the revision;
--   delete   — study: admin only; child rows: whoever may edit.
BEGIN;

ALTER TABLE public.ers_rcm_studies ADD COLUMN IF NOT EXISTS collaborators jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.ers_rcm_studies ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.ers_rcm_studies ADD COLUMN IF NOT EXISTS approved_by_user_id uuid;
COMMENT ON COLUMN public.ers_rcm_studies.collaborators IS 'Study team: [{id,type:contact|org_unit,ref_id,name,role:owner|editor|reviewer|viewer,...}] — an access list (rcm_can_edit / rcm_can_approve), not a label.';
COMMENT ON COLUMN public.ers_rcm_studies.created_by IS 'auth.uid() of the facilitator who created the study (stamped by trigger).';
COMMENT ON COLUMN public.ers_rcm_studies.approved_by_user_id IS 'auth.uid() of the approver (stamped by trigger); approved_by keeps the display name.';

-- ── Who is the caller on this study? ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rcm_caller_team_role(p_study uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c->>'role'
    FROM public.ers_rcm_studies s
    JOIN public.users u ON u.id = auth.uid()
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(s.collaborators, '[]'::jsonb)) c
   WHERE s.id = p_study
     AND c->>'type' = 'contact'
     AND u.contact_id IS NOT NULL
     AND (c->>'ref_id')::uuid = u.contact_id
   ORDER BY CASE c->>'role' WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 WHEN 'reviewer' THEN 2 ELSE 3 END
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.rcm_can_edit(p_study uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin()
      OR public.caller_can('reliability', 'edit')
      OR EXISTS (SELECT 1 FROM public.ers_rcm_studies s WHERE s.id = p_study AND s.created_by = auth.uid())
      OR public.rcm_caller_team_role(p_study) IN ('owner', 'editor')
$$;

CREATE OR REPLACE FUNCTION public.rcm_can_approve(p_study uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin()
      OR EXISTS (SELECT 1 FROM public.ers_rcm_studies s WHERE s.id = p_study AND s.created_by = auth.uid())
      OR public.rcm_caller_team_role(p_study) IN ('owner', 'reviewer')
$$;

GRANT EXECUTE ON FUNCTION public.rcm_caller_team_role(uuid), public.rcm_can_edit(uuid), public.rcm_can_approve(uuid) TO authenticated;

-- ── Policies ────────────────────────────────────────────────────────────────
DO $$
DECLARE
  tenant constant text := 'company_id = (SELECT public.caller_company())';
  t text; p record; study_col text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ers_rcm_studies','ers_rcm_functions','ers_rcm_failure_modes','ers_rcm_decisions'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, t);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (%s)', 'rcm_select_' || t, t, tenant);

    IF t = 'ers_rcm_studies' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (%s AND (public.is_admin() OR public.caller_can(''reliability'',''create'') OR public.caller_can(''reliability'',''edit'')))', 'rcm_insert_' || t, t, tenant);
      -- Editors edit; approvers may also update (the guard trigger limits them to the sign-off columns).
      EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (%s AND (public.rcm_can_edit(id) OR public.rcm_can_approve(id))) WITH CHECK (%s AND (public.rcm_can_edit(id) OR public.rcm_can_approve(id)))', 'rcm_update_' || t, t, tenant, tenant);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (%s AND public.is_admin())', 'rcm_delete_' || t, t, tenant);
      CONTINUE;
    END IF;

    study_col := CASE t
      WHEN 'ers_rcm_functions' THEN 'study_id'
      WHEN 'ers_rcm_failure_modes' THEN '(SELECT f.study_id FROM public.ers_rcm_functions f WHERE f.id = function_id)'
      ELSE '(SELECT f.study_id FROM public.ers_rcm_failure_modes m JOIN public.ers_rcm_functions f ON f.id = m.function_id WHERE m.id = failure_mode_id)'
    END;
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (%s AND public.rcm_can_edit(%s))', 'rcm_insert_' || t, t, tenant, study_col);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (%s AND public.rcm_can_edit(%s)) WITH CHECK (%s AND public.rcm_can_edit(%s))', 'rcm_update_' || t, t, tenant, study_col, tenant, study_col);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (%s AND public.rcm_can_edit(%s))', 'rcm_delete_' || t, t, tenant, study_col);
  END LOOP;
END $$;

-- ── Creator stamp ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rcm_study_stamp_creator()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.created_by := coalesce(NEW.created_by, auth.uid());
  NEW.collaborators := coalesce(NEW.collaborators, '[]'::jsonb);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_rcm_study_stamp_creator ON public.ers_rcm_studies;
CREATE TRIGGER trg_rcm_study_stamp_creator
  BEFORE INSERT ON public.ers_rcm_studies
  FOR EACH ROW EXECUTE FUNCTION public.rcm_study_stamp_creator();

-- ── Approval guard: who may approve or reopen, and what a study needs first ─
CREATE OR REPLACE FUNCTION public.rcm_study_approval_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_modes int; v_unclassified int; v_unstrategised int;
BEGIN
  -- An approver who is not an editor may touch the sign-off columns only.
  IF NOT public.rcm_can_edit(NEW.id) THEN
    IF NEW.title IS DISTINCT FROM OLD.title OR NEW.asset_id IS DISTINCT FROM OLD.asset_id
       OR NEW.operating_context IS DISTINCT FROM OLD.operating_context OR NEW.study_type IS DISTINCT FROM OLD.study_type
       OR NEW.facilitator IS DISTINCT FROM OLD.facilitator OR NEW.notes IS DISTINCT FROM OLD.notes
       OR NEW.collaborators IS DISTINCT FROM OLD.collaborators OR NEW.context_snapshot IS DISTINCT FROM OLD.context_snapshot
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
DROP TRIGGER IF EXISTS trg_rcm_study_approval_guard ON public.ers_rcm_studies;
CREATE TRIGGER trg_rcm_study_approval_guard
  BEFORE UPDATE ON public.ers_rcm_studies
  FOR EACH ROW EXECUTE FUNCTION public.rcm_study_approval_guard();

-- Coverage view and agent tools read approved studies; nothing else changes shape.
NOTIFY pgrst, 'reload schema';
COMMIT;
