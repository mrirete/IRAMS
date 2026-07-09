-- 0191 — Work center crew membership (the people ↔ work-center bridge).
--
-- Org units say WHO YOU ARE (administrative home, reporting, access scope);
-- work centers say WHO DOES THE WORK (capacity, rates, cost settlement).
-- This bridge is the operational assignment between them: a work center has a
-- crew of people (contacts), a person can serve on several crews, and each
-- crew can flag its LEAD (routing/escalation later). Unlocks "my crew's work
-- orders", crew-aware dispatch, and work_center Discussion threads (0189
-- already reserves thread_type 'work_center').
--
-- Direction of assignment: people are assigned TO work centers. Membership is
-- operational and fast-changing; it deliberately does NOT touch the org chart.
--
-- RLS: reads open to authenticated; writes admin-only — same governance tier
-- as work_centers itself (0186).
-- Atomic: wrap in a txn.
BEGIN;

CREATE TABLE IF NOT EXISTS public.work_center_members (
  work_center_id UUID NOT NULL REFERENCES public.work_centers(id) ON DELETE CASCADE,
  contact_id     UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  role           TEXT NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('MEMBER','LEAD')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (work_center_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_wcm_contact ON public.work_center_members(contact_id);

ALTER TABLE public.work_center_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p2_select_wcm ON public.work_center_members;
CREATE POLICY p2_select_wcm ON public.work_center_members
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS p2_admin_write_wcm ON public.work_center_members;
CREATE POLICY p2_admin_write_wcm ON public.work_center_members
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

INSERT INTO public.semantic_catalog
  (object_name, column_name, title, description, tags, owner, source_tables, iso_standard)
VALUES
  ('work_center_members', NULL, 'Work Center Crew',
   'Operational assignment of people (contacts) to work centers — the bridge between the org chart (administrative home) and work centers (execution resources with capacity and rates). A person may serve on several crews; one member per crew may be flagged LEAD. Independent of org-unit membership by design: re-orgs must not corrupt dispatch or costing.',
   ARRAY['work-centers','people','crew'], 'Maintenance',
   ARRAY['work_center_members','work_centers','contacts'], NULL)
ON CONFLICT DO NOTHING;

COMMIT;
