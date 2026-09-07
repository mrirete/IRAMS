-- 0336 — RCM: every implementation step has an owner and a due date, and the
-- coverage view says how much of each approved plan was actually carried out.
--
-- After 0335 an approved study is a checklist nobody is accountable for: the
-- K-601 walkthrough left five decisions "ready to implement" with no owner, no
-- date, and a landing strip that counted them as proactive coverage.
--
--   * ers_rcm_decisions.impl_owner_contact_id / impl_due_date / impl_assigned_at /
--     impl_assigned_by — who carries the decision into Work Management, by when;
--   * the 0319 freeze exempts them (implementing ≠ editing), like the PM,
--     point and work-order links;
--   * approving a study gives every unowned decision the facilitator and a
--     due date 30 days out — a study approved over REST is never undated;
--   * sem_rcm_coverage gains implemented / open / overdue / unassigned counts.
--     "Implemented" here is the database's coarse view (the PM, the work
--     order, a point with a sensor tag, or named spares for run-to-failure);
--     the Maintenance Plan keeps the finer per-step logic.
BEGIN;

ALTER TABLE public.ers_rcm_decisions
    ADD COLUMN IF NOT EXISTS impl_owner_contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS impl_due_date date,
    ADD COLUMN IF NOT EXISTS impl_assigned_at timestamptz,
    ADD COLUMN IF NOT EXISTS impl_assigned_by uuid;
COMMENT ON COLUMN public.ers_rcm_decisions.impl_owner_contact_id IS '0336: the person who carries this decision into Work Management (PM / point / sensor / work order / spares).';
COMMENT ON COLUMN public.ers_rcm_decisions.impl_due_date IS '0336: when the implementation is due; defaulted to approval + 30 days when unset.';
CREATE INDEX IF NOT EXISTS idx_ers_rcm_decisions_impl_owner ON public.ers_rcm_decisions(impl_owner_contact_id) WHERE impl_owner_contact_id IS NOT NULL;

-- ── Freeze exemption: implementing an approved study is allowed ─────────────
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

    -- Implementing the approved plan is allowed: the PM link (0319), the
    -- reading-point link (0324), the redesign work-order link (0326) and the
    -- implementation owner / due date (0336) may change.
    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'ers_rcm_decisions' THEN
        v_old := to_jsonb(OLD) - 'recurring_work_id' - 'reading_definition_id' - 'work_order_id' - 'updated_at'
                 - 'impl_owner_contact_id' - 'impl_due_date' - 'impl_assigned_at' - 'impl_assigned_by';
        v_new := to_jsonb(NEW) - 'recurring_work_id' - 'reading_definition_id' - 'work_order_id' - 'updated_at'
                 - 'impl_owner_contact_id' - 'impl_due_date' - 'impl_assigned_at' - 'impl_assigned_by';
        IF v_old = v_new THEN
            RETURN NEW;
        END IF;
    END IF;

    RAISE EXCEPTION 'RCM study is approved — choose Revise on the study to edit it (0319)'
        USING ERRCODE = 'check_violation';
END;
$$;

-- ── Approval defaults: no decision leaves approval without an owner and a date ─
CREATE OR REPLACE FUNCTION public.rcm_study_default_implementation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_owner uuid;
BEGIN
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    SELECT u.contact_id INTO v_owner FROM public.users u WHERE u.id = NEW.created_by;
    UPDATE public.ers_rcm_decisions d
       SET impl_owner_contact_id = COALESCE(d.impl_owner_contact_id, v_owner),
           impl_due_date         = COALESCE(d.impl_due_date, (COALESCE(NEW.approved_at, now()) + interval '30 days')::date),
           impl_assigned_at      = COALESCE(d.impl_assigned_at, now()),
           impl_assigned_by      = COALESCE(d.impl_assigned_by, auth.uid())
      FROM public.ers_rcm_failure_modes m
      JOIN public.ers_rcm_functions f ON f.id = m.function_id
     WHERE d.failure_mode_id = m.id
       AND f.study_id = NEW.id
       AND d.recommended_strategy_code IS NOT NULL
       AND (d.impl_owner_contact_id IS NULL OR d.impl_due_date IS NULL);
  END IF;
  RETURN NEW;
END;
$$;
-- AFTER the approval guard has accepted the status (BEFORE triggers fire in name order; this one runs after the row is written).
DROP TRIGGER IF EXISTS trg_rcm_study_default_implementation ON public.ers_rcm_studies;
CREATE TRIGGER trg_rcm_study_default_implementation
  AFTER UPDATE OF status ON public.ers_rcm_studies
  FOR EACH ROW EXECUTE FUNCTION public.rcm_study_default_implementation();

-- ── Coverage: how much of the plan is real ──────────────────────────────────
DROP VIEW IF EXISTS public.sem_rcm_coverage;
CREATE VIEW public.sem_rcm_coverage AS
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
    COALESCE(c.fm_count, 0)::int            AS failure_mode_count,
    COALESCE(c.decided_count, 0)::int       AS decided_count,
    COALESCE(c.strategy_count, 0)::int      AS strategy_count,
    COALESCE(c.proactive_count, 0)::int     AS proactive_count,
    COALESCE(c.pm_count, 0)::int            AS pm_count,
    COALESCE(c.cbm_count, 0)::int           AS cbm_count,
    COALESCE(c.reading_point_count, 0)::int AS reading_point_count,
    COALESCE(c.implemented_count, 0)::int   AS implemented_count,
    COALESCE(c.open_count, 0)::int          AS open_count,
    COALESCE(c.overdue_count, 0)::int       AS overdue_count,
    COALESCE(c.unassigned_count, 0)::int    AS unassigned_count,
    c.next_due                              AS next_due_date
FROM public.ers_rcm_studies s
LEFT JOIN public.assets a ON a.id::text = s.asset_id
LEFT JOIN LATERAL (
    SELECT count(m.id)                                   AS fm_count,
           count(d.consequence_code)                     AS decided_count,
           count(d.recommended_strategy_code)            AS strategy_count,
           count(d.id) FILTER (WHERE d.recommended_strategy_code IN ('PM_TIME','PM_CONDITION','PM_PREDICTIVE')) AS proactive_count,
           count(d.recurring_work_id)                    AS pm_count,
           count(d.id) FILTER (WHERE d.recommended_strategy_code IN ('PM_CONDITION','PM_PREDICTIVE')) AS cbm_count,
           count(d.reading_definition_id) FILTER (WHERE d.recommended_strategy_code IN ('PM_CONDITION','PM_PREDICTIVE')) AS reading_point_count,
           count(d.id) FILTER (WHERE x.implemented)                                             AS implemented_count,
           count(d.id) FILTER (WHERE d.recommended_strategy_code IS NOT NULL AND NOT x.implemented) AS open_count,
           count(d.id) FILTER (WHERE d.recommended_strategy_code IS NOT NULL AND NOT x.implemented AND d.impl_due_date < current_date) AS overdue_count,
           count(d.id) FILTER (WHERE d.recommended_strategy_code IS NOT NULL AND NOT x.implemented AND d.impl_owner_contact_id IS NULL) AS unassigned_count,
           min(d.impl_due_date) FILTER (WHERE d.recommended_strategy_code IS NOT NULL AND NOT x.implemented) AS next_due
      FROM public.ers_rcm_functions f
      JOIN public.ers_rcm_failure_modes m ON m.function_id = f.id
      LEFT JOIN public.ers_rcm_decisions d ON d.failure_mode_id = m.id
      LEFT JOIN LATERAL (
        SELECT CASE
          WHEN d.recommended_strategy_code IS NULL THEN false
          WHEN d.recommended_strategy_code = 'REDESIGN' THEN d.work_order_id IS NOT NULL
          WHEN d.recommended_strategy_code = 'RTF' THEN jsonb_array_length(COALESCE(d.spares_requirements, '[]'::jsonb)) > 0 OR m.bom_item_id IS NOT NULL
          WHEN d.recommended_strategy_code = 'PM_TIME' THEN d.recurring_work_id IS NOT NULL
          -- condition-based: a PM that reads it, or a point an instrument feeds
          ELSE d.recurring_work_id IS NOT NULL
               OR EXISTS (SELECT 1 FROM public.reading_definitions r WHERE r.id = d.reading_definition_id AND r.sensor_tag IS NOT NULL)
        END AS implemented
      ) x ON true
     WHERE f.study_id = s.id
) c ON true
WHERE s.company_id = (SELECT public.caller_company());
GRANT SELECT ON public.sem_rcm_coverage TO authenticated, service_role;
COMMENT ON VIEW public.sem_rcm_coverage IS 'RCM coverage per study (tenant-scoped): worksheet, decision and implementation counts. implemented = PM / work order / instrument-fed point / named spares; overdue = open past impl_due_date.';

NOTIFY pgrst, 'reload schema';
COMMIT;
