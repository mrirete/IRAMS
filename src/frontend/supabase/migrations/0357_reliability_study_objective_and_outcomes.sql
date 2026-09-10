-- ============================================================
-- 0357: A reliability study is FOR a decision, and it ENDS in work.
--
-- Two gaps this closes:
--
--  1. A study was a folder with no purpose. Every study offered all five
--     tools, so nothing told a user which ones their decision actually
--     needed. `objective` states the decision the study exists to make;
--     the UI derives the study's step plan from it.
--
--  2. A study had no visible exit. Weibull → Create PM stamped
--     linked_pm_id on ONE analysis; Spares → Apply min level wrote an
--     ers_agent_actions row; Send to RCM navigated away. None of it was
--     recorded against the study, so a finished study looked like a
--     dead-end calculation rather than a decision that changed the plant.
--     ers_reliability_study_outcomes is that record: what left the study,
--     where it landed, and who actualised it.
--
-- Note on scope: the pre-existing policies on ers_reliability_studies and
-- ers_reliability_analyses are tenant-only and role-blind (audit M-7/M-8)
-- and are NOT touched here — that needs its own migration in the 0335
-- pattern. The new table is gated correctly from the start.
-- ============================================================

BEGIN;

-- ── (1) The decision the study exists to make ───────────────────────────
ALTER TABLE public.ers_reliability_studies
    ADD COLUMN IF NOT EXISTS objective TEXT NOT NULL DEFAULT 'general';

ALTER TABLE public.ers_reliability_studies
    DROP CONSTRAINT IF EXISTS ers_reliability_studies_objective_check;

ALTER TABLE public.ers_reliability_studies
    ADD CONSTRAINT ers_reliability_studies_objective_check
    CHECK (objective IN ('interval', 'downtime', 'spares', 'weak_link', 'general'));

COMMENT ON COLUMN public.ers_reliability_studies.objective IS
    '0357: the decision this study is for — interval (set a maintenance interval), downtime (cut downtime on a bad actor), spares (right-size a stock holding), weak_link (find the weak link / justify redundancy), general. Drives which tools the study asks for and which outcome it is expected to produce.';

-- ── (2) What actually left the study ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ers_reliability_study_outcomes (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    study_id    uuid NOT NULL REFERENCES public.ers_reliability_studies(id) ON DELETE CASCADE,
    -- What kind of work the decision became.
    kind        TEXT NOT NULL CHECK (kind IN ('pm', 'spares', 'rcm', 'rca', 'wo')),
    -- The record it became, in that module's own id space (recurring_work.id
    -- is TEXT, inventory_items.id is a uuid string, …) — kept as TEXT so one
    -- table can point at all of them without five nullable FK columns.
    ref_id      TEXT,
    ref_label   TEXT NOT NULL,
    -- Free context: the number applied, the basis, the asset it was for.
    detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
    analysis_id uuid REFERENCES public.ers_reliability_analyses(id) ON DELETE SET NULL,
    created_by  TEXT,
    created_at  timestamptz NOT NULL DEFAULT now(),
    company_id  uuid
);

CREATE INDEX IF NOT EXISTS idx_rel_study_outcomes_study ON public.ers_reliability_study_outcomes(study_id);

COMMENT ON TABLE public.ers_reliability_study_outcomes IS
    '0357: the work a reliability study produced — a PM program, an inventory min level, an RCM strategy, an RCA, a work order. Written only after the underlying write is CONFIRMED (see audit M-4: Apply min level used to report success on an RLS-filtered 0-row update), so this table answers "what did this study change?" honestly.';

-- Stamp the tenant and the author server-side; a client cannot forge either.
CREATE OR REPLACE FUNCTION public.reliability_outcome_stamp()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    NEW.company_id := coalesce(NEW.company_id, public.caller_company());
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reliability_outcome_stamp ON public.ers_reliability_study_outcomes;
CREATE TRIGGER trg_reliability_outcome_stamp
    BEFORE INSERT ON public.ers_reliability_study_outcomes
    FOR EACH ROW EXECUTE FUNCTION public.reliability_outcome_stamp();

ALTER TABLE public.ers_reliability_study_outcomes ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE p record;
BEGIN
    FOR p IN SELECT policyname FROM pg_policies
             WHERE schemaname = 'public' AND tablename = 'ers_reliability_study_outcomes' LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.ers_reliability_study_outcomes', p.policyname);
    END LOOP;

    CREATE POLICY rel_outcome_select ON public.ers_reliability_study_outcomes FOR SELECT TO authenticated
        USING (company_id = (SELECT public.caller_company()));

    CREATE POLICY rel_outcome_insert ON public.ers_reliability_study_outcomes FOR INSERT TO authenticated
        WITH CHECK (
            (public.is_admin()
             OR public.caller_can('reliability', 'edit')
             OR public.caller_can('reliability', 'create'))
            AND EXISTS (
                SELECT 1 FROM public.ers_reliability_studies s
                WHERE s.id = study_id AND s.company_id = (SELECT public.caller_company())
            )
        );

    -- An outcome is a record of something that happened; it is not edited.
    CREATE POLICY rel_outcome_delete ON public.ers_reliability_study_outcomes FOR DELETE TO authenticated
        USING (company_id = (SELECT public.caller_company())
               AND (public.is_admin() OR public.caller_can('reliability', 'edit')));
END $$;

COMMIT;
