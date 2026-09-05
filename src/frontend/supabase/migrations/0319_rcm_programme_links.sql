-- 0319: RCM decisions become an executable programme, and the study becomes a record
--
-- (1) ers_rcm_decisions.task_library_item_id — a decision may carry a job plan
--     from the Task Library, so the PM it generates has steps, a craft and parts
--     instead of a title (gap G3 of the 2026-09-04 Reliability Loop Audit).
-- (2) ers_rcm_studies.revision — approval freezes the worksheet and the
--     decisions; editing again means "Revise", which bumps the revision and
--     returns the study to in_progress. PMs stamp the revision they came from
--     so a plan generated from revision 1 can be told apart from revision 2.
-- (3) Freeze trigger — while a study is approved, its functions, failure modes
--     and decisions refuse edits (the one exception: linking a decision to the
--     PM that implements it, which is the approved plan being carried out).
-- (4) sem_rcm_coverage — one row per study with the asset's criticality and the
--     study's counts, tenant-scoped. Feeds the RCM landing page coverage strip,
--     the asset dossier, the maturity say-do proxies and the Specialist's
--     get_rcm_coverage tool.

BEGIN;

-- ── (1) job plan link ───────────────────────────────────────────────────────
ALTER TABLE public.ers_rcm_decisions
    ADD COLUMN IF NOT EXISTS task_library_item_id uuid REFERENCES public.task_library_items(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.ers_rcm_decisions.task_library_item_id IS
    '0319: the Task Library job plan this decision executes with. Copied into the generated PM''s templates (steps, roles, parts) so the work order a technician receives carries the plan, not just the title.';

-- ── (2) study revision ──────────────────────────────────────────────────────
ALTER TABLE public.ers_rcm_studies
    ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
COMMENT ON COLUMN public.ers_rcm_studies.revision IS
    '0319: bumped by "Revise" on an approved study. Generated PMs stamp origin.study_revision.';

-- ── (3) freeze at approved ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rcm_study_is_approved(p_study_id uuid)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_catalog'
AS $$
    SELECT EXISTS (SELECT 1 FROM public.ers_rcm_studies WHERE id = p_study_id AND status = 'approved');
$$;

CREATE OR REPLACE FUNCTION public.rcm_refuse_edit_when_approved()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
    v_study uuid;
    v_old jsonb;
    v_new jsonb;
BEGIN
    IF TG_TABLE_NAME = 'ers_rcm_functions' THEN
        v_study := COALESCE(NEW.study_id, OLD.study_id);
    ELSIF TG_TABLE_NAME = 'ers_rcm_failure_modes' THEN
        SELECT f.study_id INTO v_study FROM public.ers_rcm_functions f WHERE f.id = COALESCE(NEW.function_id, OLD.function_id);
    ELSE
        SELECT f.study_id INTO v_study
          FROM public.ers_rcm_failure_modes m
          JOIN public.ers_rcm_functions f ON f.id = m.function_id
         WHERE m.id = COALESCE(NEW.failure_mode_id, OLD.failure_mode_id);
    END IF;

    IF v_study IS NULL OR NOT public.rcm_study_is_approved(v_study) THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    -- Implementing the approved plan is allowed: only the PM link may change.
    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'ers_rcm_decisions' THEN
        v_old := to_jsonb(OLD) - 'recurring_work_id' - 'updated_at';
        v_new := to_jsonb(NEW) - 'recurring_work_id' - 'updated_at';
        IF v_old = v_new THEN
            RETURN NEW;
        END IF;
    END IF;

    RAISE EXCEPTION 'RCM study is approved — choose Revise on the study to edit it (0319)'
        USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_rcm_freeze_functions ON public.ers_rcm_functions;
CREATE TRIGGER trg_rcm_freeze_functions
    BEFORE INSERT OR UPDATE OR DELETE ON public.ers_rcm_functions
    FOR EACH ROW EXECUTE FUNCTION public.rcm_refuse_edit_when_approved();

DROP TRIGGER IF EXISTS trg_rcm_freeze_failure_modes ON public.ers_rcm_failure_modes;
CREATE TRIGGER trg_rcm_freeze_failure_modes
    BEFORE INSERT OR UPDATE OR DELETE ON public.ers_rcm_failure_modes
    FOR EACH ROW EXECUTE FUNCTION public.rcm_refuse_edit_when_approved();

DROP TRIGGER IF EXISTS trg_rcm_freeze_decisions ON public.ers_rcm_decisions;
CREATE TRIGGER trg_rcm_freeze_decisions
    BEFORE INSERT OR UPDATE OR DELETE ON public.ers_rcm_decisions
    FOR EACH ROW EXECUTE FUNCTION public.rcm_refuse_edit_when_approved();

-- ── (4) coverage view ───────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.sem_rcm_coverage AS
SELECT
    s.id            AS study_id,
    s.title,
    s.status,
    s.revision,
    s.asset_id,
    a.tag           AS asset_tag,
    a.name          AS asset_name,
    a.criticality,
    s.approved_at,
    s.updated_at,
    (SELECT count(*) FROM public.ers_rcm_functions f WHERE f.study_id = s.id)::int AS function_count,
    COALESCE(c.fm_count, 0)::int        AS failure_mode_count,
    COALESCE(c.decided_count, 0)::int   AS decided_count,
    COALESCE(c.strategy_count, 0)::int  AS strategy_count,
    COALESCE(c.proactive_count, 0)::int AS proactive_count,
    COALESCE(c.pm_count, 0)::int        AS pm_count
FROM public.ers_rcm_studies s
LEFT JOIN public.assets a ON a.id::text = s.asset_id
LEFT JOIN LATERAL (
    SELECT count(m.id)                          AS fm_count,
           count(d.consequence_code)            AS decided_count,
           count(d.recommended_strategy_code)   AS strategy_count,
           count(d.id) FILTER (WHERE d.recommended_strategy_code IN ('PM_TIME','PM_CONDITION','PM_PREDICTIVE')) AS proactive_count,
           count(d.recurring_work_id)           AS pm_count
      FROM public.ers_rcm_functions f
      JOIN public.ers_rcm_failure_modes m ON m.function_id = f.id
      LEFT JOIN public.ers_rcm_decisions d ON d.failure_mode_id = m.id
     WHERE f.study_id = s.id
) c ON true
WHERE s.company_id = (SELECT public.caller_company());

GRANT SELECT ON public.sem_rcm_coverage TO authenticated, service_role;

INSERT INTO public.semantic_catalog
  (object_name, column_name, title, description, tags, owner, source_tables, iso_standard)
VALUES
  ('sem_rcm_coverage', NULL, 'RCM Coverage',
   'One row per RCM study with the asset it covers (tag, criticality) and the study''s progress: failure modes, consequences classified (Q5), strategies chosen (Q6-Q7), proactive decisions and how many of them reached Work Management as a PM. Tenant-scoped. Answers "how much of our critical plant has an approved study, and how much of it is implemented in the CMMS" - the level-3-vs-4 distinction of the maturity question on RCM/FMEA programmes.',
   ARRAY['reliability','rcm','coverage','canonical'], 'Reliability Engineering',
   ARRAY['ers_rcm_studies','ers_rcm_functions','ers_rcm_failure_modes','ers_rcm_decisions','assets'], 'SAE JA1011')
ON CONFLICT DO NOTHING;

COMMIT;

-- VERIFY (after apply):
--   SELECT study_id, asset_tag, criticality, failure_mode_count, proactive_count, pm_count FROM sem_rcm_coverage;
--   UPDATE ers_rcm_studies SET status='approved' WHERE id='<x>'; UPDATE ers_rcm_decisions SET task_description='y' WHERE ...;  -- expect 23514
