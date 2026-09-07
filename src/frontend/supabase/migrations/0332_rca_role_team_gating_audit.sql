-- 0332 — RCA: roles and the team gate writes; closing needs a sign-off; every write is audited.
--
-- Found by the 2026-09-07 team walkthrough (docs/Process-Test-RCA-Team.md):
--   * every ers_rca_* write/delete policy was tenant-only ("AND true"), so a
--     view-only technician could rewrite, commit, delete or close an investigation;
--   * collaborator roles (owner / editor / reviewer / viewer) were labels nothing read;
--   * "Close Investigation" needed no sign-off and no effectiveness verdict;
--   * no audit row was written by any page write path.
--
-- Model:
--   read     — tenant-wide (the app's reliability.view permission gates the module);
--   create   — reliability.create / reliability.edit (role template) or admin;
--   edit     — admin, reliability.edit, the creator, or a team member with role
--              owner / editor (the team IS an access list now);
--   close    — admin, the creator, or a team member with role owner / reviewer,
--              and only once an effectiveness verdict is recorded;
--   delete   — investigation: admin only; child rows: whoever may edit.
--   audit    — one ers_rca_audit_log row per insert / meaningful update / delete,
--              written by a SECURITY DEFINER trigger so it cannot be skipped.
BEGIN;

-- ── Who is the caller on this investigation? ────────────────────────────────
CREATE OR REPLACE FUNCTION public.rca_caller_team_role(p_inv uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c->>'role'
    FROM public.ers_rca_investigations i
    JOIN public.users u ON u.id = auth.uid()
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(i.collaborators, '[]'::jsonb)) c
   WHERE i.id = p_inv
     AND c->>'type' = 'contact'
     AND u.contact_id IS NOT NULL
     AND (c->>'ref_id')::uuid = u.contact_id
   ORDER BY CASE c->>'role' WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 WHEN 'reviewer' THEN 2 ELSE 3 END
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.rca_can_edit(p_inv uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin()
      OR public.caller_can('reliability', 'edit')
      OR EXISTS (SELECT 1 FROM public.ers_rca_investigations i WHERE i.id = p_inv AND i.created_by = auth.uid())
      OR public.rca_caller_team_role(p_inv) IN ('owner', 'editor')
$$;

CREATE OR REPLACE FUNCTION public.rca_can_close(p_inv uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin()
      OR EXISTS (SELECT 1 FROM public.ers_rca_investigations i WHERE i.id = p_inv AND i.created_by = auth.uid())
      OR public.rca_caller_team_role(p_inv) IN ('owner', 'reviewer')
$$;

GRANT EXECUTE ON FUNCTION public.rca_caller_team_role(uuid), public.rca_can_edit(uuid), public.rca_can_close(uuid) TO authenticated;

-- ── Policies ────────────────────────────────────────────────────────────────
DO $$
DECLARE
  tenant constant text := 'company_id = (SELECT public.caller_company())';
  t text; p record; inv_col text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ers_rca_investigations','ers_rca_nodes','ers_rca_evidence','ers_rca_corrective_actions','ers_rca_barriers','ers_rca_team_members','ers_rca_node_evidence'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, t);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (%s)', 'rca_select_' || t, t, tenant);

    IF t = 'ers_rca_investigations' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (%s AND (public.is_admin() OR public.caller_can(''reliability'',''create'') OR public.caller_can(''reliability'',''edit'')))', 'rca_insert_' || t, t, tenant);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (%s AND public.rca_can_edit(id)) WITH CHECK (%s AND public.rca_can_edit(id))', 'rca_update_' || t, t, tenant, tenant);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (%s AND public.is_admin())', 'rca_delete_' || t, t, tenant);
    ELSIF t = 'ers_rca_node_evidence' THEN
      -- links carry node_id, not investigation_id: resolve through the node
      inv_col := '(SELECT n.investigation_id FROM public.ers_rca_nodes n WHERE n.id = node_id)';
      EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (%s AND public.rca_can_edit(%s))', 'rca_insert_' || t, t, tenant, inv_col);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (%s AND public.rca_can_edit(%s)) WITH CHECK (%s AND public.rca_can_edit(%s))', 'rca_update_' || t, t, tenant, inv_col, tenant, inv_col);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (%s AND public.rca_can_edit(%s))', 'rca_delete_' || t, t, tenant, inv_col);
    ELSE
      EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (%s AND public.rca_can_edit(investigation_id))', 'rca_insert_' || t, t, tenant);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (%s AND public.rca_can_edit(investigation_id)) WITH CHECK (%s AND public.rca_can_edit(investigation_id))', 'rca_update_' || t, t, tenant, tenant);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (%s AND public.rca_can_edit(investigation_id))', 'rca_delete_' || t, t, tenant);
    END IF;
  END LOOP;
END $$;

-- ── Closing needs a sign-off and a verdict ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.rca_investigation_close_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'closed' AND OLD.status IS DISTINCT FROM 'closed' THEN
    IF NOT public.rca_can_close(NEW.id) THEN
      RAISE EXCEPTION 'RCA_CLOSE_DENIED: closing needs the investigation owner, a reviewer on its team, or an administrator'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF coalesce(NEW.effectiveness_status, 'pending') = 'pending' THEN
      RAISE EXCEPTION 'RCA_CLOSE_DENIED: record the effectiveness verdict (effective / ineffective / recurred) before closing'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.closed_at := coalesce(NEW.closed_at, now());
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_rca_investigation_close_guard ON public.ers_rca_investigations;
CREATE TRIGGER trg_rca_investigation_close_guard
  BEFORE UPDATE OF status ON public.ers_rca_investigations
  FOR EACH ROW EXECUTE FUNCTION public.rca_investigation_close_guard();

-- ── Audit every write ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rca_audit_row()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inv uuid; v_company uuid; v_who text; v_action text; v_details jsonb := '{}'::jsonb;
  r record;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  v_who := coalesce(auth.jwt() ->> 'email', 'system');
  IF TG_TABLE_NAME = 'ers_rca_investigations' THEN
    v_inv := r.id;
    IF TG_OP = 'UPDATE' THEN
      -- Only meaningful changes; current_step / updated_at churn is noise.
      IF NEW.title IS NOT DISTINCT FROM OLD.title AND NEW.problem_statement IS NOT DISTINCT FROM OLD.problem_statement
         AND NEW.method IS NOT DISTINCT FROM OLD.method AND NEW.status IS NOT DISTINCT FROM OLD.status
         AND NEW.effectiveness_status IS NOT DISTINCT FROM OLD.effectiveness_status
         AND NEW.root_cause_summary IS NOT DISTINCT FROM OLD.root_cause_summary
         AND NEW.collaborators IS NOT DISTINCT FROM OLD.collaborators
         AND NEW.asset_id IS NOT DISTINCT FROM OLD.asset_id AND NEW.trigger_type IS NOT DISTINCT FROM OLD.trigger_type THEN
        RETURN NULL;
      END IF;
      v_action := CASE
        WHEN NEW.status = 'closed' AND OLD.status IS DISTINCT FROM 'closed' THEN 'closed'
        WHEN NEW.method IS DISTINCT FROM OLD.method THEN 'method_' || coalesce(NEW.method, 'cleared')
        WHEN NEW.effectiveness_status IS DISTINCT FROM OLD.effectiveness_status THEN 'effectiveness_' || coalesce(NEW.effectiveness_status, 'pending')
        WHEN NEW.collaborators IS DISTINCT FROM OLD.collaborators THEN 'team_changed'
        ELSE 'definition_updated' END;
      v_details := jsonb_strip_nulls(jsonb_build_object(
        'title', CASE WHEN NEW.title IS DISTINCT FROM OLD.title THEN NEW.title END,
        'status', CASE WHEN NEW.status IS DISTINCT FROM OLD.status THEN NEW.status END,
        'method', CASE WHEN NEW.method IS DISTINCT FROM OLD.method THEN NEW.method END,
        'effectiveness', CASE WHEN NEW.effectiveness_status IS DISTINCT FROM OLD.effectiveness_status THEN NEW.effectiveness_status END,
        'team', CASE WHEN NEW.collaborators IS DISTINCT FROM OLD.collaborators THEN (SELECT jsonb_agg(c->>'name' || ' (' || (c->>'role') || ')') FROM jsonb_array_elements(coalesce(NEW.collaborators,'[]'::jsonb)) c) END));
    ELSE
      v_action := CASE TG_OP WHEN 'INSERT' THEN 'created' ELSE 'deleted' END;
      v_details := jsonb_build_object('title', r.title);
    END IF;
  ELSE
    v_inv := r.investigation_id;
    v_action := lower(TG_OP) || '_' || CASE TG_TABLE_NAME
      WHEN 'ers_rca_nodes' THEN 'cause' WHEN 'ers_rca_evidence' THEN 'evidence'
      WHEN 'ers_rca_corrective_actions' THEN 'action' WHEN 'ers_rca_barriers' THEN 'barrier' ELSE TG_TABLE_NAME END;
    v_details := jsonb_strip_nulls(jsonb_build_object(
      'id', r.id,
      'text', left(coalesce(to_jsonb(r)->>'description', to_jsonb(r)->>'title', to_jsonb(r)->>'action_description', to_jsonb(r)->>'barrier_description'), 200),
      'status', to_jsonb(r)->>'status',
      'grade', to_jsonb(r)->>'quality_grade'));
  END IF;
  v_company := r.company_id;
  INSERT INTO public.ers_rca_audit_log (investigation_id, action, changed_by, details, company_id)
  VALUES (v_inv, v_action, v_who, v_details, v_company);
  RETURN NULL;
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ers_rca_investigations','ers_rca_nodes','ers_rca_evidence','ers_rca_corrective_actions','ers_rca_barriers'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS trg_rca_audit ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_rca_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.rca_audit_row()', t);
  END LOOP;
END $$;

-- The audit log must accept the trigger's rows for the caller's tenant and stay append-only.
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='ers_rca_audit_log' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.ers_rca_audit_log', p.policyname);
  END LOOP;
  ALTER TABLE public.ers_rca_audit_log ENABLE ROW LEVEL SECURITY;
  CREATE POLICY rca_audit_select ON public.ers_rca_audit_log FOR SELECT TO authenticated
    USING (company_id = (SELECT public.caller_company()));
  -- Direct inserts are no longer needed (the trigger writes as definer); admins keep it for repairs.
  CREATE POLICY rca_audit_insert_admin ON public.ers_rca_audit_log FOR INSERT TO authenticated
    WITH CHECK (company_id = (SELECT public.caller_company()) AND public.is_admin());
END $$;

COMMIT;
