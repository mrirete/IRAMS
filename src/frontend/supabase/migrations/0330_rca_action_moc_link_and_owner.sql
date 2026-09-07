-- 0330 — RCA corrective action → MOC link; MOC numbering; action owner backfill.
--
-- 1. moc_request_id on ers_rca_corrective_actions. An action that changes the asset
--    or how it is run raises a management-of-change request and cannot raise work
--    until that request is approved (UI gate, lib/rcaActions.mocGate). The MOC row
--    points back through its existing polymorphic pair: entity_type =
--    'rca_corrective_action', entity_id = the action.
-- 2. moc_requests.moc_number was inserted as '' by the page, whose comment assumed a
--    trigger that never existed. Number them here: MOC-YYMM-NNNN from a sequence, and
--    backfill the blanks in creation order.
-- 3. assignee_id backfill: actions whose free-text assigned_to matches a user's
--    username/email or a contact's name in the same tenant get the id. assigned_to
--    stays as the display name.
BEGIN;

-- ── 1. Link column ─────────────────────────────────────────────────────────
ALTER TABLE public.ers_rca_corrective_actions
  ADD COLUMN IF NOT EXISTS moc_request_id UUID REFERENCES public.moc_requests(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.ers_rca_corrective_actions.moc_request_id IS
  'Management-of-change request raised for this action (0330). Work may be raised only once it is approved.';
CREATE INDEX IF NOT EXISTS idx_rca_actions_moc ON public.ers_rca_corrective_actions(moc_request_id);

-- ── 2. MOC numbering ───────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.moc_number_seq;

CREATE OR REPLACE FUNCTION public.moc_requests_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.moc_number IS NULL OR btrim(NEW.moc_number) = '' THEN
    NEW.moc_number := 'MOC-' || to_char(now(), 'YYMM') || '-' || lpad(nextval('public.moc_number_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_moc_requests_number ON public.moc_requests;
CREATE TRIGGER trg_moc_requests_number
  BEFORE INSERT ON public.moc_requests
  FOR EACH ROW EXECUTE FUNCTION public.moc_requests_number();

-- Backfill: every blank number, oldest first, so the sequence reads in creation order.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id, created_at FROM public.moc_requests
            WHERE moc_number IS NULL OR btrim(moc_number) = ''
            ORDER BY created_at, id
  LOOP
    UPDATE public.moc_requests
       SET moc_number = 'MOC-' || to_char(coalesce(r.created_at, now()), 'YYMM') || '-' || lpad(nextval('public.moc_number_seq')::text, 4, '0')
     WHERE id = r.id;
  END LOOP;
END $$;

-- ── 3. Owner backfill ──────────────────────────────────────────────────────
UPDATE public.ers_rca_corrective_actions a
   SET assignee_id = u.id
  FROM public.users u
 WHERE a.assignee_id IS NULL
   AND a.assigned_to IS NOT NULL
   AND u.company_id = a.company_id
   AND (lower(u.username) = lower(btrim(a.assigned_to)) OR lower(u.email) = lower(btrim(a.assigned_to)));

UPDATE public.ers_rca_corrective_actions a
   SET assignee_id = c.id
  FROM public.contacts c
 WHERE a.assignee_id IS NULL
   AND a.assigned_to IS NOT NULL
   AND c.company_id = a.company_id
   AND lower(c.name) = lower(btrim(a.assigned_to));

COMMIT;
