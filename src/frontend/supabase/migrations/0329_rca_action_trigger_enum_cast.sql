-- 0329 — 0328's trigger compared the wo_status ENUM with '' and called upper() on it,
-- so EVERY work-order insert/status update failed with 22P02 the moment 0328 landed.
-- Same function, with the enum cast to text before any comparison. Nothing else changes.
BEGIN;

CREATE OR REPLACE FUNCTION public.rca_action_follow_work_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- work_orders.status is the wo_status enum: cast before comparing, never coalesce to ''.
  v_status    TEXT := upper(coalesce(NEW.status::text, ''));
  v_done      BOOLEAN := v_status IN ('CLOSED', 'CLSD', 'TECO', 'COMP', 'COMPLETED');
  v_active    BOOLEAN := v_status IN ('WIP', 'SCHEDULED', 'PLAN', 'REL', 'INPRG');
  v_void      BOOLEAN := v_status IN ('CANCELLED', 'CANCELED', 'CANC');
  v_de_task   UUID;
  v_de_status TEXT;
  v_open_wos  INT;
  v_active_wos INT;
BEGIN
  -- (a) A request that was raised from an action has just been converted:
  --     the WO now carries request_id, so stamp it onto the action.
  IF NEW.request_id IS NOT NULL THEN
    UPDATE ers_rca_corrective_actions
       SET work_order_id = NEW.id,
           status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END
     WHERE work_request_id = NEW.request_id
       AND work_order_id IS NULL
       AND company_id = NEW.company_id;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- (b) The action follows its work order.
  IF v_done THEN
    UPDATE ers_rca_corrective_actions
       SET status = 'completed',
           completion_date = coalesce(completion_date, current_date),
           completion_notes = coalesce(completion_notes, 'Completed via work order ' || coalesce(NEW.wo_number, NEW.id::text))
     WHERE work_order_id = NEW.id
       AND status NOT IN ('completed', 'cancelled')
       AND company_id = NEW.company_id;
  ELSIF v_active THEN
    UPDATE ers_rca_corrective_actions
       SET status = 'in_progress'
     WHERE work_order_id = NEW.id
       AND status = 'open'
       AND company_id = NEW.company_id;
  ELSIF v_void THEN
    -- The work was cancelled; the action is open again and needs a new plan.
    UPDATE ers_rca_corrective_actions
       SET status = 'open',
           completion_notes = coalesce(completion_notes, 'Work order ' || coalesce(NEW.wo_number, NEW.id::text) || ' was cancelled')
     WHERE work_order_id = NEW.id
       AND status = 'in_progress'
       AND company_id = NEW.company_id;
  END IF;

  -- (c) The DE task follows all of its work orders (properties.de_task_id, stamped
  --     by generateWOFromDE). All closed → resolved; any active → in_progress.
  v_de_task := NULLIF(NEW.properties->>'de_task_id', '')::uuid;
  IF v_de_task IS NOT NULL THEN
    SELECT status INTO v_de_status
      FROM ers_defect_elimination_tasks
     WHERE id = v_de_task AND company_id = NEW.company_id;
    IF v_de_status IN ('identified', 'in_progress') THEN
      SELECT count(*) FILTER (WHERE upper(status::text) NOT IN ('CLOSED','CLSD','TECO','COMP','COMPLETED','CANCELLED','CANCELED','CANC')),
             count(*) FILTER (WHERE upper(status::text) IN ('WIP','SCHEDULED','PLAN','REL','INPRG'))
        INTO v_open_wos, v_active_wos
        FROM work_orders
       WHERE properties->>'de_task_id' = v_de_task::text
         AND company_id = NEW.company_id;
      IF v_open_wos = 0 AND v_done THEN
        UPDATE ers_defect_elimination_tasks
           SET status = 'resolved', updated_at = now()
         WHERE id = v_de_task AND company_id = NEW.company_id;
      ELSIF v_active_wos > 0 AND v_de_status = 'identified' THEN
        UPDATE ers_defect_elimination_tasks
           SET status = 'in_progress', updated_at = now()
         WHERE id = v_de_task AND company_id = NEW.company_id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
