-- 0328 — Close the RCA corrective-action ↔ Work Management loop.
--
-- Before this, an action could raise a work order (work_order_id was stamped on the
-- action) and that was the end of it: nothing on the work order pointed back, and
-- closing the work order changed nothing on the action, so "Implement" and "Track
-- Effectiveness" were self-reported. The DE task table had the same shape, plus a
-- client-side auto-advance function that nothing ever called.
--
-- This migration:
--   1. gives an action a work_request_id (a technician may only raise a request;
--      the planner converts it, and the conversion stamps work_orders.request_id),
--      an assignee_id for notifications, and a real FK on work_order_id;
--   2. adds one trigger on work_orders that (a) links a converted request's WO back
--      to the action, (b) moves the action to in_progress / completed as the WO
--      moves to WIP / closed, and (c) advances the DE task the WO belongs to —
--      the same rule checkAndAdvanceDEStatus encoded in TypeScript, now where it
--      actually runs.
--
-- SECURITY DEFINER with an explicit company_id match: the caller (a technician
-- closing a WO) need not hold write rights on RCA rows, and no row from another
-- tenant can ever be touched because every UPDATE is bound to NEW.company_id.
BEGIN;

-- ── 1. Columns ─────────────────────────────────────────────────────────────
ALTER TABLE public.ers_rca_corrective_actions
  ADD COLUMN IF NOT EXISTS work_request_id UUID REFERENCES public.service_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assignee_id     UUID;

COMMENT ON COLUMN public.ers_rca_corrective_actions.work_request_id IS
  'Maintenance request raised for this action (0328). When it converts, the trigger stamps work_order_id.';
COMMENT ON COLUMN public.ers_rca_corrective_actions.assignee_id IS
  'users.id or contacts.id of the owner named in assigned_to (0328). Used for notifications; assigned_to keeps the display name.';

-- Orphans first, then the FK the column should always have had.
UPDATE public.ers_rca_corrective_actions a
   SET work_order_id = NULL
 WHERE work_order_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.work_orders w WHERE w.id = a.work_order_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ers_rca_corrective_actions_work_order_id_fkey') THEN
    ALTER TABLE public.ers_rca_corrective_actions
      ADD CONSTRAINT ers_rca_corrective_actions_work_order_id_fkey
      FOREIGN KEY (work_order_id) REFERENCES public.work_orders(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rca_actions_wo  ON public.ers_rca_corrective_actions(work_order_id);
CREATE INDEX IF NOT EXISTS idx_rca_actions_req ON public.ers_rca_corrective_actions(work_request_id);

-- ── 2. Trigger ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rca_action_follow_work_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status    TEXT := upper(coalesce(NEW.status, ''));
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
      SELECT count(*) FILTER (WHERE upper(status) NOT IN ('CLOSED','CLSD','TECO','COMP','COMPLETED','CANCELLED','CANCELED','CANC')),
             count(*) FILTER (WHERE upper(status) IN ('WIP','SCHEDULED','PLAN','REL','INPRG'))
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

REVOKE ALL ON FUNCTION public.rca_action_follow_work_order() FROM public;

DROP TRIGGER IF EXISTS trg_rca_action_follow_work_order ON public.work_orders;
CREATE TRIGGER trg_rca_action_follow_work_order
  AFTER INSERT OR UPDATE OF status, request_id ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.rca_action_follow_work_order();

COMMENT ON TRIGGER trg_rca_action_follow_work_order ON public.work_orders IS
  '0328: RCA corrective actions and DE tasks follow the state of the work orders raised for them.';

COMMIT;
