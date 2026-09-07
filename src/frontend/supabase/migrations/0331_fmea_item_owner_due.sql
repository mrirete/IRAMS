-- 0331 — ers_fmea_items: who owns the recommended action, and by when.
--
-- An FMEA row carried recommended_action + action_status but no owner or date, so
-- an RCA corrective action pushed onto the worksheet (f694567) lost both. Add them.
-- owner is the display name; owner_id is users.id / contacts.id (no FK, same policy
-- as ers_rca_corrective_actions.assignee_id).
BEGIN;

ALTER TABLE public.ers_fmea_items
  ADD COLUMN IF NOT EXISTS owner    TEXT,
  ADD COLUMN IF NOT EXISTS owner_id UUID,
  ADD COLUMN IF NOT EXISTS due_date DATE;

COMMENT ON COLUMN public.ers_fmea_items.owner    IS 'Display name of who owns the recommended action (0331).';
COMMENT ON COLUMN public.ers_fmea_items.owner_id IS 'users.id or contacts.id behind owner (0331). No FK by design.';
COMMENT ON COLUMN public.ers_fmea_items.due_date IS 'When the recommended action is due (0331).';

COMMIT;
