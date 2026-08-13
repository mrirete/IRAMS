-- 0291: System functions — the dependency model as DATA (Systems-Thinking
--       Phase 3; docs/Systems-Thinking-Failure-Analysis-Plan.md)
--
-- A system function ("Cooling water supply", "Unit 1100 lube oil") is
-- delivered by member assets arranged as SERIES groups of PARALLEL sets:
-- every group must work; within a group, k of its n members must work
-- (2×100% pumps → group of 2 with k=1; 2oo3 transmitters → group of 3, k=2).
-- This is the Reliability Block Diagram rebuilt as data instead of a
-- hand-drawn sketch: availability math runs on LIVE per-asset numbers
-- (sem_asset_reliability), "weakest link" importance ranking falls out, and
-- "backup coverage" reads member status from open work orders in real time.
--
-- k_required lives on the member rows and applies per (function, group_no);
-- readers take MAX(k_required) per group. Duplicating it beats a third table
-- until an editing UX demands one — documented trade-off, not an accident.

CREATE TABLE IF NOT EXISTS public.system_functions (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name              text NOT NULL,
    description       text,
    hierarchy_node_id uuid REFERENCES public.assets(id) ON DELETE SET NULL,  -- optional SYSTEM-level anchor
    active            boolean NOT NULL DEFAULT true,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    company_id        uuid NOT NULL DEFAULT public.caller_company()
);

CREATE TABLE IF NOT EXISTS public.system_function_members (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    function_id uuid NOT NULL REFERENCES public.system_functions(id) ON DELETE CASCADE,
    asset_id    uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
    group_no    int  NOT NULL DEFAULT 1,   -- series position: every group must work
    k_required  int  NOT NULL DEFAULT 1,   -- of the group's members, how many must work
    created_at  timestamptz NOT NULL DEFAULT now(),
    company_id  uuid NOT NULL DEFAULT public.caller_company(),
    UNIQUE (function_id, asset_id)
);

CREATE INDEX IF NOT EXISTS system_function_members_fn_idx
    ON public.system_function_members (function_id, group_no);

COMMENT ON TABLE public.system_functions IS
    'Functions the plant must deliver, modelled as series groups of parallel (k-of-n) member assets. The RBD as data: one dependency model feeding availability math, weakest-link ranking, live backup coverage, and (later) cascade-vs-model validation.';

-- Tenant policies HAND-WRITTEN (post-0261a tables). Reads tenant-scoped;
-- writes need the asset-register edit permission — defining what a system is
-- made of is register work.
ALTER TABLE public.system_functions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "system_functions_read" ON public.system_functions;
CREATE POLICY "system_functions_read" ON public.system_functions
    FOR SELECT TO authenticated
    USING (company_id = (SELECT public.caller_company()));
DROP POLICY IF EXISTS "system_functions_write" ON public.system_functions;
CREATE POLICY "system_functions_write" ON public.system_functions
    FOR ALL TO authenticated
    USING (company_id = (SELECT public.caller_company()) AND public.caller_can('assets', 'edit'))
    WITH CHECK (company_id = (SELECT public.caller_company()) AND public.caller_can('assets', 'edit'));

ALTER TABLE public.system_function_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "system_function_members_read" ON public.system_function_members;
CREATE POLICY "system_function_members_read" ON public.system_function_members
    FOR SELECT TO authenticated
    USING (company_id = (SELECT public.caller_company()));
DROP POLICY IF EXISTS "system_function_members_write" ON public.system_function_members;
CREATE POLICY "system_function_members_write" ON public.system_function_members
    FOR ALL TO authenticated
    USING (company_id = (SELECT public.caller_company()) AND public.caller_can('assets', 'edit'))
    WITH CHECK (company_id = (SELECT public.caller_company()) AND public.caller_can('assets', 'edit'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.system_functions, public.system_function_members TO authenticated;
GRANT ALL ON public.system_functions, public.system_function_members TO service_role;

INSERT INTO public.semantic_catalog
  (object_name, column_name, title, description, tags, owner, source_tables, iso_standard)
VALUES
  ('system_functions', NULL, 'System Functions (dependency model)',
   'The plant''s functions modelled as series groups of parallel (k-of-n) member assets — the RBD as data. Availability composes from sem_asset_reliability per member; rankings are trustworthy, absolute percentages are approximations (calendar-hour MTBF basis) and are labelled as such wherever shown.',
   ARRAY['reliability','systems','canonical'], 'Reliability Engineering',
   ARRAY['system_functions','system_function_members','sem_asset_reliability'], NULL)
ON CONFLICT DO NOTHING;
