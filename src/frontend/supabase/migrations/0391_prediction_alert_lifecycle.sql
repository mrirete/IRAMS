-- 0391 — Every prediction alert ends with a recorded outcome.
--
-- WHY
-- An alert was created and then just sat there. `acknowledged` existed but no
-- screen set it; the only way to work on one was an AI draft that became an
-- OPEN work order directly (no request, no link back); and "was it real?" was
-- an optional Actionable / False-alarm click. So nothing closed, the queue
-- could not be triaged, and alert precision rested on voluntary clicks
-- (ISO 17359 §4 ends the monitoring loop with a review of the outcome; ISO
-- 13374's advisory layer is only useful when its advice is dispositioned).
--
-- WHAT
--   1. Lifecycle on ers_prediction_alerts:
--        new → acknowledged → in_progress (work raised) → closed + outcome
--      outcome ∈ confirmed_fault | no_fault_found | known_condition | duplicate.
--      closed ⇔ an outcome is recorded (CHECK). The screen writes the verdict
--      into ers_prediction_feedback too, so the precision number keeps one
--      source: confirmed_fault / known_condition = actionable,
--      no_fault_found = false alarm, duplicate = not counted.
--   2. Links: work_request_id (service_requests) and work_order_id
--      (work_orders); work_done_at is stamped when that work closes.
--   3. Who may close (or reopen): reliability.edit OR workOrders.approve —
--      reliability engineers and supervisors (plus admins). Anyone in the
--      tenant may acknowledge or raise work. Enforced here, not only in the
--      screen; a refusal RAISES (42501) instead of silently updating 0 rows.
--   4. A trigger on work_orders (same shape as 0328's RCA loop): a converted
--      request stamps work_order_id onto its alert; the WO closing stamps
--      work_done_at ("Work done — record the outcome"); a cancelled WO clears it.
--
-- Backfill: acknowledged alerts → 'acknowledged'. Alerts already marked
-- false_alarm → closed / no_fault_found (that was a verdict). Alerts marked
-- actionable stay open as 'acknowledged' — the fault was confirmed, the work
-- is unknown, so a person records the outcome.
BEGIN;

-- ── 1. Columns ─────────────────────────────────────────────────────────────
ALTER TABLE public.ers_prediction_alerts
  ADD COLUMN IF NOT EXISTS status          TEXT NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS outcome         TEXT,
  ADD COLUMN IF NOT EXISTS outcome_notes   TEXT,
  ADD COLUMN IF NOT EXISTS closed_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_by       UUID,
  ADD COLUMN IF NOT EXISTS work_request_id UUID REFERENCES public.service_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS work_order_id   UUID REFERENCES public.work_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS work_done_at    TIMESTAMPTZ;

-- Backfill before the CHECKs so existing rows satisfy them.
UPDATE public.ers_prediction_alerts
   SET status = 'closed', outcome = 'no_fault_found',
       closed_at = coalesce(acknowledged_at, created_at, now()),
       outcome_notes = coalesce(outcome_notes, 'Marked false alarm before alert outcomes existed (0391 backfill).')
 WHERE feedback_status = 'false_alarm' AND status = 'new';

UPDATE public.ers_prediction_alerts
   SET status = 'acknowledged'
 WHERE status = 'new' AND (acknowledged IS TRUE OR feedback_status = 'actionable');

ALTER TABLE public.ers_prediction_alerts DROP CONSTRAINT IF EXISTS ers_prediction_alerts_status_check;
ALTER TABLE public.ers_prediction_alerts ADD CONSTRAINT ers_prediction_alerts_status_check
  CHECK (status IN ('new', 'acknowledged', 'in_progress', 'closed'));

ALTER TABLE public.ers_prediction_alerts DROP CONSTRAINT IF EXISTS ers_prediction_alerts_outcome_check;
ALTER TABLE public.ers_prediction_alerts ADD CONSTRAINT ers_prediction_alerts_outcome_check
  CHECK (outcome IS NULL OR outcome IN ('confirmed_fault', 'no_fault_found', 'known_condition', 'duplicate'));

ALTER TABLE public.ers_prediction_alerts DROP CONSTRAINT IF EXISTS ers_prediction_alerts_closed_has_outcome;
ALTER TABLE public.ers_prediction_alerts ADD CONSTRAINT ers_prediction_alerts_closed_has_outcome
  CHECK ((status = 'closed') = (outcome IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_pred_alerts_company_status ON public.ers_prediction_alerts(company_id, status);
CREATE INDEX IF NOT EXISTS idx_pred_alerts_work_request   ON public.ers_prediction_alerts(work_request_id);
CREATE INDEX IF NOT EXISTS idx_pred_alerts_work_order     ON public.ers_prediction_alerts(work_order_id);

COMMENT ON COLUMN public.ers_prediction_alerts.status IS
  'new → acknowledged → in_progress → closed (0391). Closed needs an outcome.';
COMMENT ON COLUMN public.ers_prediction_alerts.outcome IS
  'confirmed_fault | no_fault_found | known_condition | duplicate (0391). Feeds alert precision via ers_prediction_feedback.';
COMMENT ON COLUMN public.ers_prediction_alerts.work_done_at IS
  'Set by trg_alert_follow_work_order when the linked work order closes (0391).';

-- ── 2. Guard: lifecycle bookkeeping + who may close ─────────────────────────
CREATE OR REPLACE FUNCTION public.prediction_alert_lifecycle_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_closing  BOOLEAN := NEW.status = 'closed' AND OLD.status IS DISTINCT FROM 'closed';
  v_reopening BOOLEAN := OLD.status = 'closed' AND NEW.status IS DISTINCT FROM 'closed';
BEGIN
  -- Backend jobs (no signed-in user) are not gated.
  IF (v_closing OR v_reopening) AND auth.uid() IS NOT NULL THEN
    IF NOT ((SELECT public.caller_can('reliability', 'edit')) OR (SELECT public.caller_can('workOrders', 'approve'))) THEN
      RAISE EXCEPTION 'Closing or reopening an alert needs a reliability engineer or supervisor (reliability edit or work-order approve rights).'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_closing THEN
    NEW.closed_at := coalesce(NEW.closed_at, now());
    NEW.closed_by := coalesce(NEW.closed_by, public.caller_user_id());
  ELSIF v_reopening THEN
    NEW.outcome := NULL;
    NEW.outcome_notes := NULL;
    NEW.closed_at := NULL;
    NEW.closed_by := NULL;
  END IF;

  -- Any move past 'new' counts as acknowledged (keeps the legacy flag true).
  IF NEW.status <> 'new' AND NEW.acknowledged IS NOT TRUE THEN
    NEW.acknowledged := TRUE;
    NEW.acknowledged_at := coalesce(NEW.acknowledged_at, now());
    NEW.acknowledged_by := coalesce(NEW.acknowledged_by, public.caller_user_id());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prediction_alert_lifecycle_guard ON public.ers_prediction_alerts;
CREATE TRIGGER trg_prediction_alert_lifecycle_guard
  BEFORE UPDATE ON public.ers_prediction_alerts
  FOR EACH ROW EXECUTE FUNCTION public.prediction_alert_lifecycle_guard();

-- ── 3. Alerts follow the work raised for them (mirrors 0328) ───────────────
-- SECURITY DEFINER with an explicit company_id match: the technician closing
-- the WO need not hold write rights on alerts, and no other tenant's row can
-- be touched because every UPDATE is bound to NEW.company_id.
CREATE OR REPLACE FUNCTION public.alert_follow_work_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT := upper(coalesce(NEW.status::text, ''));
  v_done   BOOLEAN := v_status IN ('CLOSED', 'CLSD', 'TECO', 'COMP', 'COMPLETED');
  v_void   BOOLEAN := v_status IN ('CANCELLED', 'CANCELED', 'CANC');
BEGIN
  -- A request raised from an alert has been converted: link the order.
  IF NEW.request_id IS NOT NULL THEN
    UPDATE ers_prediction_alerts
       SET work_order_id = NEW.id,
           status = CASE WHEN status IN ('new', 'acknowledged') THEN 'in_progress' ELSE status END
     WHERE work_request_id = NEW.request_id
       AND work_order_id IS NULL
       AND company_id = NEW.company_id;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF v_done THEN
    UPDATE ers_prediction_alerts
       SET work_done_at = coalesce(work_done_at, now())
     WHERE work_order_id = NEW.id
       AND status <> 'closed'
       AND company_id = NEW.company_id;
  ELSIF v_void THEN
    UPDATE ers_prediction_alerts
       SET work_done_at = NULL
     WHERE work_order_id = NEW.id
       AND status <> 'closed'
       AND company_id = NEW.company_id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.alert_follow_work_order() FROM public;

DROP TRIGGER IF EXISTS trg_alert_follow_work_order ON public.work_orders;
CREATE TRIGGER trg_alert_follow_work_order
  AFTER INSERT OR UPDATE OF status, request_id ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.alert_follow_work_order();

COMMENT ON TRIGGER trg_alert_follow_work_order ON public.work_orders IS
  '0391: prediction alerts follow the work orders raised for them (link on conversion, work_done_at on close).';

COMMIT;
