-- ============================================================
-- 0358: Reliability Modelling — writes are gated by role, approval is a
--       record the database enforces, and the seams that let a wrong number
--       reach a maintenance record are closed.
--
-- Found by the 2026-09-10 three-role test run
-- (docs/Process-Test-Reliability-Modelling.md):
--   M-5/M-7  ers_reliability_analyses / _studies / ers_rbd_models /
--            ers_pid_configurations policies were tenant-only "AND true" for
--            every verb (studies even bound to PUBLIC) — a view-only
--            technician rewrote, approved and deleted the engineer's study over
--            REST; a requester inserted a study straight into 'approved'.
--   M-8      approved_by held a typed display name; the author approved their
--            own study in one click; approved studies were not frozen.
--   M-6      recurring_work INSERT was "AND true" — a technician created a PM
--            program from the Weibull tab.
--   M-19     ers_agent_actions INSERT had no role check while UPDATE needed
--            reliability.edit — anyone could write an 'applied' ROI ledger row.
--   M-21     linked_pm_id was a uuid with no FK (recurring_work.id is TEXT);
--            a forged all-zero id rendered as a live link.
--   M-22     any tenant member could read every saved analysis, including
--            failure data they cannot see at source.
--
-- Model (mirrors 0332/0335 for RCA/RCM):
--   read     — tenant + reliability.view (or admin);
--   create   — reliability.create / reliability.edit or admin; a new study
--              always starts 'active' (status on insert is ignored);
--   edit     — admin, reliability.edit, or the creator; nothing under an
--              approved study changes except the PM link;
--   approve  — admin, or reliability.approve held by someone OTHER than the
--   reopen      creator (four-eyes); reopening bumps the revision and clears
--              the stamps; approver stamps are set by the trigger, not the client;
--   delete   — study: admin, or the creator while not approved;
--              analysis / model: admin, reliability.edit, or the creator.
-- ============================================================
BEGIN;

-- ── Columns ───────────────────────────────────────────────────────────────
ALTER TABLE public.ers_reliability_studies
    ADD COLUMN IF NOT EXISTS created_by_user_id  uuid,
    ADD COLUMN IF NOT EXISTS approved_by_user_id uuid,
    ADD COLUMN IF NOT EXISTS revision            integer NOT NULL DEFAULT 1;
COMMENT ON COLUMN public.ers_reliability_studies.created_by_user_id  IS 'auth.uid() of the author (trigger-stamped); created_by keeps the display name.';
COMMENT ON COLUMN public.ers_reliability_studies.approved_by_user_id IS 'auth.uid() of the approver (trigger-stamped on approval, cleared on reopen).';
COMMENT ON COLUMN public.ers_reliability_studies.revision            IS 'Bumped every time an approved study is reopened.';

ALTER TABLE public.ers_reliability_analyses ADD COLUMN IF NOT EXISTS created_by_user_id uuid;
ALTER TABLE public.ers_rbd_models          ADD COLUMN IF NOT EXISTS created_by_user_id uuid;
ALTER TABLE public.ers_pid_configurations  ADD COLUMN IF NOT EXISTS created_by_user_id uuid;

-- M-21: the PM link points at recurring_work, whose id is TEXT. A deleted PM
-- clears the link instead of leaving a dangling id that renders as a link.
ALTER TABLE public.ers_reliability_analyses
    ALTER COLUMN linked_pm_id TYPE text USING linked_pm_id::text;
UPDATE public.ers_reliability_analyses a
   SET linked_pm_id = NULL
 WHERE linked_pm_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.recurring_work r WHERE r.id = a.linked_pm_id);
ALTER TABLE public.ers_reliability_analyses
    DROP CONSTRAINT IF EXISTS ers_reliability_analyses_linked_pm_fkey;
ALTER TABLE public.ers_reliability_analyses
    ADD CONSTRAINT ers_reliability_analyses_linked_pm_fkey
    FOREIGN KEY (linked_pm_id) REFERENCES public.recurring_work(id) ON DELETE SET NULL;

-- ── Who may do what ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rel_can_write()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin()
      OR public.caller_can('reliability', 'edit')
      OR public.caller_can('reliability', 'create')
$$;

CREATE OR REPLACE FUNCTION public.rel_can_view()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin() OR public.caller_can('reliability', 'view')
$$;

CREATE OR REPLACE FUNCTION public.rel_study_can_edit(p_study uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin()
      OR public.caller_can('reliability', 'edit')
      OR EXISTS (SELECT 1 FROM public.ers_reliability_studies s
                  WHERE s.id = p_study AND s.created_by_user_id = auth.uid())
$$;

-- Four-eyes: the author never approves their own study; an administrator may.
CREATE OR REPLACE FUNCTION public.rel_study_can_approve(p_study uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin()
      OR (public.caller_can('reliability', 'approve')
          AND NOT EXISTS (SELECT 1 FROM public.ers_reliability_studies s
                           WHERE s.id = p_study AND s.created_by_user_id = auth.uid()))
$$;

CREATE OR REPLACE FUNCTION public.rel_study_is_frozen(p_study uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT s.status = 'approved' FROM public.ers_reliability_studies s WHERE s.id = p_study), false)
$$;

GRANT EXECUTE ON FUNCTION public.rel_can_write(), public.rel_can_view(), public.rel_study_can_edit(uuid),
                          public.rel_study_can_approve(uuid), public.rel_study_is_frozen(uuid) TO authenticated;

-- ── Author stamp (all four tables) ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rel_stamp_author()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.created_by_user_id := coalesce(NEW.created_by_user_id, auth.uid());
  IF NEW.created_by IS NULL OR NEW.created_by = '' THEN
    NEW.created_by := coalesce(auth.jwt() ->> 'email', NEW.created_by);
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ers_reliability_studies','ers_reliability_analyses','ers_rbd_models','ers_pid_configurations'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS ab_rel_stamp_author ON public.%I', t);
    EXECUTE format('CREATE TRIGGER ab_rel_stamp_author BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.rel_stamp_author()', t);
  END LOOP;
END $$;

-- ── Study lifecycle guard ─────────────────────────────────────────────────
-- A new study starts 'active' whatever the client sent (M-7: a requester
-- inserted status='approved' directly). Approval/reopen/freeze on update.
CREATE OR REPLACE FUNCTION public.rel_study_insert_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.status := 'active';
  NEW.approved_by := NULL; NEW.approved_at := NULL; NEW.approved_by_user_id := NULL;
  NEW.revision := 1;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_rel_study_insert_guard ON public.ers_reliability_studies;
CREATE TRIGGER trg_rel_study_insert_guard
  BEFORE INSERT ON public.ers_reliability_studies
  FOR EACH ROW EXECUTE FUNCTION public.rel_study_insert_guard();

CREATE OR REPLACE FUNCTION public.rel_study_approval_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  content_changed boolean;
BEGIN
  content_changed :=
       NEW.name IS DISTINCT FROM OLD.name
    OR NEW.description IS DISTINCT FROM OLD.description
    OR NEW.asset_id IS DISTINCT FROM OLD.asset_id
    OR NEW.asset_tag IS DISTINCT FROM OLD.asset_tag
    OR NEW.asset_name IS DISTINCT FROM OLD.asset_name
    OR NEW.objective IS DISTINCT FROM OLD.objective
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
    OR NEW.company_id IS DISTINCT FROM OLD.company_id;

  -- Someone who may approve but not edit touches the sign-off columns only.
  IF NOT public.rel_study_can_edit(NEW.id) THEN
    IF content_changed OR (NEW.findings IS DISTINCT FROM OLD.findings AND NEW.status IS NOT DISTINCT FROM OLD.status) THEN
      RAISE EXCEPTION 'REL_EDIT_DENIED: a reviewer may approve or reopen the study, not edit it'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- The client never writes the approver stamps.
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    NEW.approved_by := OLD.approved_by;
    NEW.approved_at := OLD.approved_at;
    NEW.approved_by_user_id := OLD.approved_by_user_id;
    NEW.revision := OLD.revision;
  END IF;

  -- An approved study is frozen: only the status may move (reopen below).
  IF OLD.status = 'approved' AND NEW.status = 'approved' AND (content_changed OR NEW.findings IS DISTINCT FROM OLD.findings) THEN
    RAISE EXCEPTION 'REL_STUDY_FROZEN: the study is approved — reopen it to change it'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Entering approved: the right person.
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    IF NOT public.rel_study_can_approve(NEW.id) THEN
      RAISE EXCEPTION 'REL_APPROVE_DENIED: approval needs someone with reliability approval rights other than the author, or an administrator'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.approved_at := now();
    NEW.approved_by := coalesce(auth.jwt() ->> 'email', 'approver');
    NEW.approved_by_user_id := auth.uid();
  END IF;

  -- Leaving approved is a revision.
  IF OLD.status = 'approved' AND NEW.status IS DISTINCT FROM 'approved' THEN
    IF NOT public.rel_study_can_approve(NEW.id) AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'REL_REOPEN_DENIED: reopening an approved study needs an approver or an administrator'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.revision := coalesce(OLD.revision, 1) + 1;
    NEW.approved_by := NULL; NEW.approved_at := NULL; NEW.approved_by_user_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_rel_study_approval_guard ON public.ers_reliability_studies;
CREATE TRIGGER trg_rel_study_approval_guard
  BEFORE UPDATE ON public.ers_reliability_studies
  FOR EACH ROW EXECUTE FUNCTION public.rel_study_approval_guard();

-- Analyses under an approved study are frozen (the PM link may still be stamped —
-- a PM created from an approved study's fit is exactly the intended exit).
CREATE OR REPLACE FUNCTION public.rel_analysis_freeze_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_study uuid; only_link boolean;
BEGIN
  v_study := coalesce(CASE WHEN TG_OP = 'DELETE' THEN OLD.study_id ELSE NEW.study_id END,
                      CASE WHEN TG_OP = 'UPDATE' THEN OLD.study_id END);
  IF v_study IS NULL OR NOT public.rel_study_is_frozen(v_study) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    only_link := NEW.title IS NOT DISTINCT FROM OLD.title
             AND NEW.inputs IS NOT DISTINCT FROM OLD.inputs
             AND NEW.results IS NOT DISTINCT FROM OLD.results
             AND NEW.notes IS NOT DISTINCT FROM OLD.notes
             AND NEW.study_id IS NOT DISTINCT FROM OLD.study_id
             AND NEW.asset_id IS NOT DISTINCT FROM OLD.asset_id
             AND NEW.root_id IS NOT DISTINCT FROM OLD.root_id
             AND NEW.version IS NOT DISTINCT FROM OLD.version;
    IF only_link THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'REL_STUDY_FROZEN: this analysis belongs to an approved study — reopen the study first'
    USING ERRCODE = 'check_violation';
END;
$$;
DROP TRIGGER IF EXISTS trg_rel_analysis_freeze_guard ON public.ers_reliability_analyses;
CREATE TRIGGER trg_rel_analysis_freeze_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.ers_reliability_analyses
  FOR EACH ROW EXECUTE FUNCTION public.rel_analysis_freeze_guard();

-- ── Policies ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  tenant constant text := 'company_id = (SELECT public.caller_company())';
  t text; p record;
BEGIN
  FOREACH t IN ARRAY ARRAY['ers_reliability_studies','ers_reliability_analyses','ers_rbd_models','ers_pid_configurations'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, t);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (%s AND public.rel_can_view())', 'rel_select_' || t, t, tenant);

    IF t = 'ers_reliability_studies' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (%s AND public.rel_can_write())', 'rel_insert_' || t, t, tenant);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (%s AND (public.rel_study_can_edit(id) OR public.rel_study_can_approve(id))) WITH CHECK (%s AND (public.rel_study_can_edit(id) OR public.rel_study_can_approve(id)))', 'rel_update_' || t, t, tenant, tenant);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (%s AND (public.is_admin() OR (created_by_user_id = auth.uid() AND status <> ''approved'')))', 'rel_delete_' || t, t, tenant);
      CONTINUE;
    END IF;

    IF t = 'ers_reliability_analyses' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (%s AND public.rel_can_write() AND (study_id IS NULL OR public.rel_study_can_edit(study_id)))', 'rel_insert_' || t, t, tenant);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (%s AND (public.is_admin() OR public.caller_can(''reliability'',''edit'') OR (public.rel_can_write() AND created_by_user_id = auth.uid()))) WITH CHECK (%s AND (public.is_admin() OR public.caller_can(''reliability'',''edit'') OR (public.rel_can_write() AND created_by_user_id = auth.uid())))', 'rel_update_' || t, t, tenant, tenant);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (%s AND (public.is_admin() OR public.caller_can(''reliability'',''edit'') OR (public.rel_can_write() AND created_by_user_id = auth.uid())))', 'rel_delete_' || t, t, tenant);
      CONTINUE;
    END IF;

    -- RBD models and P&ID configurations
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (%s AND public.rel_can_write())', 'rel_insert_' || t, t, tenant);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (%s AND (public.is_admin() OR public.caller_can(''reliability'',''edit'') OR (public.rel_can_write() AND created_by_user_id = auth.uid()))) WITH CHECK (%s AND (public.is_admin() OR public.caller_can(''reliability'',''edit'') OR (public.rel_can_write() AND created_by_user_id = auth.uid())))', 'rel_update_' || t, t, tenant, tenant);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (%s AND (public.is_admin() OR public.caller_can(''reliability'',''edit'') OR (public.rel_can_write() AND created_by_user_id = auth.uid())))', 'rel_delete_' || t, t, tenant);
  END LOOP;
END $$;

-- 0357's outcomes table joins the same read rule (tenant + reliability.view);
-- its insert/delete rules already follow the reliability.edit/create pattern.
DROP POLICY IF EXISTS rel_outcome_select ON public.ers_reliability_study_outcomes;
CREATE POLICY rel_outcome_select ON public.ers_reliability_study_outcomes FOR SELECT TO authenticated
  USING (company_id = (SELECT public.caller_company()) AND public.rel_can_view());

-- M-19: an 'applied' ledger row is a record of a change someone was allowed to
-- make; proposals (pending_review …) stay open to every role the Specialist serves.
DROP POLICY IF EXISTS agent_actions_insert ON public.ers_agent_actions;
CREATE POLICY agent_actions_insert ON public.ers_agent_actions FOR INSERT TO authenticated
  WITH CHECK (
    company_id = (SELECT public.caller_company())
    AND (status IS DISTINCT FROM 'applied'
         OR public.is_admin()
         OR public.caller_can('reliability', 'edit')
         OR public.caller_can('inventory', 'edit')
         OR public.caller_can('pm', 'edit'))
  );

-- M-6: creating a PM program needs pm.create / pm.edit (the role templates
-- already say so; the policy did not). The PM autopilot and RCM/import paths
-- run as SECURITY DEFINER or as roles that hold it.
DROP POLICY IF EXISTS p2_insert_recurring_work ON public.recurring_work;
CREATE POLICY p2_insert_recurring_work ON public.recurring_work FOR INSERT TO authenticated
  WITH CHECK (
    company_id = (SELECT public.caller_company())
    AND (public.is_admin() OR public.caller_can('pm', 'create') OR public.caller_can('pm', 'edit'))
  );

NOTIFY pgrst, 'reload schema';
COMMIT;
