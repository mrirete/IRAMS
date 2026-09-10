-- 0356 — an RCA investigation can be deleted again.
--
-- rca_audit_row() (0332) wrote an audit row AFTER DELETE on
-- ers_rca_investigations, referencing the id just removed; the FK
-- (ON DELETE CASCADE) refused it with 23503 and the delete rolled back — from
-- the page's Delete as much as from SQL. The log for a deleted investigation
-- cascades away; nothing to record.
BEGIN;
CREATE OR REPLACE FUNCTION public.rca_audit_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inv uuid; v_who text; v_action text; v_details jsonb := '{}'::jsonb; v_kind text;
  r record;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  -- 0356: deleting an investigation cascades its own audit log; a row written
  -- here would reference an id that no longer exists (23503) and the delete
  -- failed for everyone, from the page and from SQL alike.
  IF TG_OP = 'DELETE' AND TG_TABLE_NAME = 'ers_rca_investigations' THEN RETURN NULL; END IF;
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
$function$
;
COMMIT;
