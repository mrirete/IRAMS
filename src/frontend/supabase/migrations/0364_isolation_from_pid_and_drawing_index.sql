-- 0364 — Isolation points proposed from the P&ID + a drawing index for the register
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY
-- The P&ID graph (0081, pidGraph.ts) can already answer "which valves isolate
-- P-101" for the agent (query_pid isolate). The permit's LOTO plan
-- (ptw_isolation_points) is typed by hand. Nothing connects them, so the one
-- place a plant manager would recognise the graph's value in ten seconds —
-- the permit — never sees it.
--
-- And the drawings a customer uploads to derive a register (pidTagExtract)
-- leave no trace once the assets exist: "which sheet shows P-101" is a
-- question a technician asks at the job and today has no answer.
--
-- WHAT
--   1. ptw_isolation_points gains source / pid_config_id / pid_node_id, and
--      a PROPOSED status. A proposal comes from a drawing; a supervisor
--      accepts it (→ PENDING) or discards it. Nothing auto-verifies.
--   2. ers_drawing_tags — every tag the extractor kept, per drawing and page,
--      written by the Migration Center at import. The index behind "Drawings"
--      on the asset and the work order.

BEGIN;

-- ── 1. Isolation points can come from a drawing ────────────────────────────
ALTER TABLE public.ptw_isolation_points
    ADD COLUMN IF NOT EXISTS source        text NOT NULL DEFAULT 'manual',
    ADD COLUMN IF NOT EXISTS pid_config_id uuid REFERENCES public.ers_pid_configurations(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS pid_node_id   text;

ALTER TABLE public.ptw_isolation_points DROP CONSTRAINT IF EXISTS ptw_isolation_points_source_check;
ALTER TABLE public.ptw_isolation_points
    ADD CONSTRAINT ptw_isolation_points_source_check CHECK (source IN ('manual', 'pid'));

-- Status was never CHECKed (PENDING → ISOLATED → VERIFIED → DE_ISOLATED by
-- convention). PROPOSED sits before PENDING and is the only state a drawing
-- may write. Pin the vocabulary now that there are five.
ALTER TABLE public.ptw_isolation_points DROP CONSTRAINT IF EXISTS ptw_isolation_points_status_check;
ALTER TABLE public.ptw_isolation_points
    ADD CONSTRAINT ptw_isolation_points_status_check
    CHECK (status IN ('PROPOSED', 'PENDING', 'ISOLATED', 'VERIFIED', 'DE_ISOLATED'));

COMMENT ON COLUMN public.ptw_isolation_points.source IS
    'manual = typed on the permit; pid = proposed by walking the P&ID graph (pidIsolation.ts) — must be accepted by a person before it becomes PENDING.';

-- ── 2. Drawing index ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ers_drawing_tags (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    drawing_name  text NOT NULL,
    page          integer,
    tag           text NOT NULL,
    kind          text,                 -- equipment | instrument | valve | line | unknown
    created_at    timestamptz NOT NULL DEFAULT now(),
    company_id    uuid NOT NULL DEFAULT public.caller_company()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_drawing_tags_company_drawing_page_tag
    ON public.ers_drawing_tags (company_id, drawing_name, COALESCE(page, 0), upper(tag));
CREATE INDEX IF NOT EXISTS idx_drawing_tags_company_tag
    ON public.ers_drawing_tags (company_id, upper(tag));

COMMENT ON TABLE public.ers_drawing_tags IS
    'Tags found on uploaded drawings (pidTagExtract), per drawing and page. Answers "which sheets show this asset". Written by the Migration Center at import; never authoritative.';

ALTER TABLE public.ers_drawing_tags ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS aa_stamp_tenant ON public.ers_drawing_tags;
CREATE TRIGGER aa_stamp_tenant BEFORE INSERT ON public.ers_drawing_tags
    FOR EACH ROW EXECUTE FUNCTION public.stamp_tenant();

DROP POLICY IF EXISTS drawing_tags_select ON public.ers_drawing_tags;
CREATE POLICY drawing_tags_select ON public.ers_drawing_tags
    FOR SELECT TO authenticated
    USING (company_id = (SELECT public.caller_company()));

DROP POLICY IF EXISTS drawing_tags_insert ON public.ers_drawing_tags;
CREATE POLICY drawing_tags_insert ON public.ers_drawing_tags
    FOR INSERT TO authenticated
    WITH CHECK (company_id = (SELECT public.caller_company())
                AND (public.is_admin() OR public.caller_can('assets', 'create') OR public.caller_can('assets', 'edit')));

DROP POLICY IF EXISTS drawing_tags_delete ON public.ers_drawing_tags;
CREATE POLICY drawing_tags_delete ON public.ers_drawing_tags
    FOR DELETE TO authenticated
    USING (company_id = (SELECT public.caller_company())
           AND (public.is_admin() OR public.caller_can('assets', 'create') OR public.caller_can('assets', 'edit')));

GRANT SELECT, INSERT, DELETE ON public.ers_drawing_tags TO authenticated;
GRANT ALL ON public.ers_drawing_tags TO service_role;

-- ── Ask the gate (0270) ────────────────────────────────────────────────────
DO $$
DECLARE n int; sample text;
BEGIN
    SELECT count(*), min(object_name) INTO n, sample FROM public.tenancy_policy_gaps();
    IF n > 0 THEN
        RAISE EXCEPTION 'G4 reports % gap(s), e.g. % — refusing to commit', n, sample;
    END IF;
END $$;

COMMIT;

-- VERIFY (after apply):
--   SELECT conname FROM pg_constraint WHERE conrelid = 'public.ptw_isolation_points'::regclass AND conname LIKE '%check';
--   node tests/rls/tenant-completeness.mjs     -- expect "G4 GREEN"
