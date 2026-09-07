-- 0333 — 0332 follow-up, found by re-running the team walkthrough:
--   1. ers_rca_audit_log.action has a CHECK vocabulary (0080). The 0332 audit trigger
--      wrote 'insert_action' etc., so EVERY write to the RCA tables failed with 23514
--      the moment 0332 landed. Speak the vocabulary (and extend it a little).
--   2. A team reviewer must be able to record the effectiveness verdict and sign off,
--      but rca_can_edit is (rightly) false for a reviewer, so the UPDATE policy refused
--      them. Allow closers to UPDATE, and let the guard trigger restrict a non-editor
--      to the sign-off columns only.
BEGIN;

-- ── 1. Vocabulary ───────────────────────────────────────────────────────────
ALTER TABLE public.ers_rca_audit_log DROP CONSTRAINT IF EXISTS ers_rca_audit_log_action_check;
ALTER TABLE public.ers_rca_audit_log ADD CONSTRAINT ers_rca_audit_log_action_check CHECK (action = ANY (ARRAY[
  'created','deleted','step_advanced','definition_updated','method_changed',
  'cause_added','cause_updated','cause_removed',
  'action_added','action_updated','action_removed',
  'barrier_added','barrier_updated','barrier_removed',
  'evidence_added','evidence_updated','evidence_removed',
  'team_changed','status_changed','closed','effectiveness_reviewed','reopened'
]::text[]));

CREATE OR REPLACE FUNCTION public.rca_audit_row()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inv uuid; v_who text; v_action text; v_details jsonb := '{}'::jsonb; v_kind text;
  r record;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  v_who := coalesce(auth.jwt() ->> 'email', 'system');
  IF TG_TABLE_NAME = 'ers_rca_investigations' THEN
    v_inv := r.id;
    IF TG_OP = 'UPDATE' THEN
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
        WHEN OLD.status = 'closed' AND NEW.status IS DISTINCT FROM 'closed' THEN 'reopened'
        WHEN NEW.status IS DISTINCT FROM OLD.status THEN 'status_changed'
        WHEN NEW.method IS DISTINCT FROM OLD.method THEN 'method_changed'
        WHEN NEW.effectiveness_status IS DISTINCT FROM OLD.effectiveness_status THEN 'effectiveness_reviewed'
        WHEN NEW.collaborators IS DISTINCT FROM OLD.collaborators THEN 'team_changed'
        ELSE 'definition_updated' END;
      v_details := jsonb_strip_nulls(jsonb_build_object(
        'title', CASE WHEN NEW.title IS DISTINCT FROM OLD.title THEN NEW.title END,
        'status', CASE WHEN NEW.status IS DISTINCT FROM OLD.status THEN NEW.status END,
        'method', CASE WHEN NEW.method IS DISTINCT FROM OLD.method THEN NEW.method END,
        'effectiveness', CASE WHEN NEW.effectiveness_status IS DISTINCT FROM OLD.effectiveness_status THEN NEW.effectiveness_status END,
        'team', CASE WHEN NEW.collaborators IS DISTINCT FROM OLD.collaborators THEN (SELECT jsonb_agg((c->>'name') || ' (' || (c->>'role') || ')') FROM jsonb_array_elements(coalesce(NEW.collaborators,'[]'::jsonb)) c) END));
    ELSE
      v_action := CASE TG_OP WHEN 'INSERT' THEN 'created' ELSE 'deleted' END;
      v_details := jsonb_build_object('title', r.title);
    END IF;
  ELSE
    v_inv := r.investigation_id;
    v_kind := CASE TG_TABLE_NAME
      WHEN 'ers_rca_nodes' THEN 'cause' WHEN 'ers_rca_evidence' THEN 'evidence'
      WHEN 'ers_rca_corrective_actions' THEN 'action' WHEN 'ers_rca_barriers' THEN 'barrier' ELSE 'cause' END;
    v_action := v_kind || CASE TG_OP WHEN 'INSERT' THEN '_added' WHEN 'UPDATE' THEN '_updated' ELSE '_removed' END;
    v_details := jsonb_strip_nulls(jsonb_build_object(
      'id', r.id,
      'text', left(coalesce(to_jsonb(r)->>'description', to_jsonb(r)->>'title', to_jsonb(r)->>'action_description', to_jsonb(r)->>'barrier_description'), 200),
      'status', to_jsonb(r)->>'status',
      'grade', to_jsonb(r)->>'quality_grade'));
  END IF;
  INSERT INTO public.ers_rca_audit_log (investigation_id, action, changed_by, details, company_id)
  VALUES (v_inv, v_action, v_who, v_details, r.company_id);
  RETURN NULL;
END;
$$;

-- ── 2. Reviewer sign-off ────────────────────────────────────────────────────
DROP POLICY IF EXISTS rca_update_ers_rca_investigations ON public.ers_rca_investigations;
CREATE POLICY rca_update_ers_rca_investigations ON public.ers_rca_investigations FOR UPDATE TO authenticated
  USING (company_id = (SELECT public.caller_company()) AND (public.rca_can_edit(id) OR public.rca_can_close(id)))
  WITH CHECK (company_id = (SELECT public.caller_company()) AND (public.rca_can_edit(id) OR public.rca_can_close(id)));

CREATE OR REPLACE FUNCTION public.rca_investigation_close_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- A closer who is not an editor may touch the sign-off columns only.
  IF NOT public.rca_can_edit(NEW.id) THEN
    IF NEW.title IS DISTINCT FROM OLD.title OR NEW.problem_statement IS DISTINCT FROM OLD.problem_statement
       OR NEW.method IS DISTINCT FROM OLD.method OR NEW.method_locked_at IS DISTINCT FROM OLD.method_locked_at
       OR NEW.collaborators IS DISTINCT FROM OLD.collaborators OR NEW.asset_id IS DISTINCT FROM OLD.asset_id
       OR NEW.asset_ref IS DISTINCT FROM OLD.asset_ref OR NEW.event_what IS DISTINCT FROM OLD.event_what
       OR NEW.event_how IS DISTINCT FROM OLD.event_how OR NEW.event_how_much IS DISTINCT FROM OLD.event_how_much
       OR NEW.event_date IS DISTINCT FROM OLD.event_date OR NEW.event_location IS DISTINCT FROM OLD.event_location
       OR NEW.rca_category IS DISTINCT FROM OLD.rca_category OR NEW.investigation_type IS DISTINCT FROM OLD.investigation_type
       OR NEW.trigger_type IS DISTINCT FROM OLD.trigger_type OR NEW.work_order_id IS DISTINCT FROM OLD.work_order_id THEN
      RAISE EXCEPTION 'RCA_EDIT_DENIED: a reviewer may record the effectiveness verdict and sign off, not edit the investigation'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
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
  BEFORE UPDATE ON public.ers_rca_investigations
  FOR EACH ROW EXECUTE FUNCTION public.rca_investigation_close_guard();

COMMIT;
