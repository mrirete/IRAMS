-- 0337 — RCM: the plan is chased and the study stays alive.
--
-- After 0336 an approved study has owners and dates, but nothing reminds an
-- owner, nothing tells the facilitator that the asset is failing in ways the
-- study did not predict, and a planner could not attach the PM to its RCM
-- strategy package (maintenance_strategies / strategy_packages are admin-only
-- under 0186 — the attach silently returned a 403).
--
--   (1) rcm_decision_implemented(decision) — ONE rule, the same the Maintenance
--       Plan uses per step: point + (sensor feed if sensor-read) + (PM if a person
--       reads it or no feed exists); PM for time-based / failure-finding; work
--       order for redesign; named spares for run-to-failure. sem_rcm_coverage
--       reads it, so the strip and the page agree.
--   (2) ers_rcm_evidence_flags — what the asset did after approval that the
--       study did not foresee: a coded failure not among its modes, a linked
--       point in alarm. Raised by the sweep, shown on the Overview, cleared
--       when the study is revised.
--   (3) rcm_implementation_sweep() — daily (pg_cron): overdue owners get one
--       reminder a day, the facilitator one summary a day; evidence flags are
--       raised and the facilitator told once per flag.
--   (4) rcm_attach_strategy_package(...) — SECURITY DEFINER for callers with
--       pm.edit: upsert the "RCM — <tag>" strategy and its package, link the PM.
BEGIN;

-- ── (1) implemented, once ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rcm_decision_implemented(p_decision_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH d AS (
    SELECT d.*, m.bom_item_id,
           lower(coalesce(nullif(d.on_condition_technology, ''), d.ai_recommendation ->> 'suggested_technology', '')) AS tech
      FROM public.ers_rcm_decisions d
      JOIN public.ers_rcm_failure_modes m ON m.id = d.failure_mode_id
     WHERE d.id = p_decision_id
  ),
  f AS (
    SELECT d.*,
           (d.tech ~* '\m(online|on-line|continuous|permanent|installed|fixed|wireless|iot|telemetry|scada|dcs|plc|transmitter|sensor|sensors|probe|streaming|real[- ]?time)\M') AS sensor,
           (d.tech ~* '\m(oil\s+(sampl\w*|analys\w*)|lab(oratory)?\s+analys\w*|sampl(e|es|ing)|thermograph\w*|infrared|handheld|hand-held|portable|visual|inspect\w*|manual(ly)?|round|route|walk-?down|ultrason\w*|borescope|dye\s+penetrant|spot\s+check|gauge\s+read\w*)\M') AS person,
           (d.reading_definition_id IS NOT NULL AND (
              EXISTS (SELECT 1 FROM public.reading_definitions r WHERE r.id = d.reading_definition_id AND r.sensor_tag IS NOT NULL)
              OR EXISTS (SELECT 1 FROM public.reading_logs l WHERE l.definition_id = d.reading_definition_id
                            AND (l.entered_by ILIKE 'connector:%' OR l.entered_by ILIKE 'collector:%' OR l.entered_by ILIKE 'sensor:%' OR l.entered_by ILIKE 'predict:%')
                            AND l.created_at > now() - interval '30 days')
           )) AS feed
      FROM d
  )
  SELECT COALESCE((
    SELECT CASE
      WHEN f.recommended_strategy_code IS NULL THEN false
      WHEN f.recommended_strategy_code = 'REDESIGN' THEN f.work_order_id IS NOT NULL
      WHEN f.recommended_strategy_code = 'RTF' THEN jsonb_array_length(COALESCE(f.spares_requirements, '[]'::jsonb)) > 0 OR f.bom_item_id IS NOT NULL
      WHEN f.recommended_strategy_code = 'PM_TIME' THEN f.recurring_work_id IS NOT NULL
      WHEN f.recommended_strategy_code IN ('PM_CONDITION', 'PM_PREDICTIVE') AND f.task_type_code = 'FAILURE_FINDING' THEN f.recurring_work_id IS NOT NULL
      WHEN f.recommended_strategy_code IN ('PM_CONDITION', 'PM_PREDICTIVE') THEN
           f.reading_definition_id IS NOT NULL
           AND (NOT f.sensor OR f.feed)
           AND (NOT (NOT f.sensor OR f.person OR NOT f.feed) OR f.recurring_work_id IS NOT NULL)
      ELSE false
    END FROM f), false)
$$;
GRANT EXECUTE ON FUNCTION public.rcm_decision_implemented(uuid) TO authenticated, service_role;

-- the view counts unresolved evidence flags, so the table comes first
CREATE TABLE IF NOT EXISTS public.ers_rcm_evidence_flags (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    study_id     uuid NOT NULL REFERENCES public.ers_rcm_studies(id) ON DELETE CASCADE,
    kind         text NOT NULL CHECK (kind IN ('unanalysed_failure', 'reading_alarm')),
    ref          text NOT NULL,                       -- failure-mode code, or reading_definition id
    label        text,                                -- what a person reads
    count        int  NOT NULL DEFAULT 1,
    first_seen   timestamptz NOT NULL DEFAULT now(),
    last_seen    timestamptz NOT NULL DEFAULT now(),
    notified_at  timestamptz,
    resolved_at  timestamptz,
    company_id   uuid NOT NULL,
    UNIQUE (study_id, kind, ref)
);
ALTER TABLE public.ers_rcm_evidence_flags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rcm_select_ers_rcm_evidence_flags ON public.ers_rcm_evidence_flags;
CREATE POLICY rcm_select_ers_rcm_evidence_flags ON public.ers_rcm_evidence_flags FOR SELECT TO authenticated USING (company_id = (SELECT public.caller_company()));

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
    c.next_due                              AS next_due_date,
    (SELECT count(*) FROM public.ers_rcm_evidence_flags e WHERE e.study_id = s.id AND e.resolved_at IS NULL)::int AS evidence_flag_count
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
      LEFT JOIN LATERAL (SELECT public.rcm_decision_implemented(d.id) AS implemented) x ON true
     WHERE f.study_id = s.id
) c ON true
WHERE s.company_id = (SELECT public.caller_company());
GRANT SELECT ON public.sem_rcm_coverage TO authenticated, service_role;
COMMENT ON VIEW public.sem_rcm_coverage IS 'RCM coverage per study (tenant-scoped): worksheet, decision and implementation counts. implemented = rcm_decision_implemented() (the Maintenance Plan rule); overdue = open past impl_due_date; evidence_flag_count = unresolved living-study flags.';

-- ── (2) evidence flags ──────────────────────────────────────────────────────
-- writes: the sweep (SECURITY DEFINER) and the revise trigger only.

-- Revising the study answers the flags.
CREATE OR REPLACE FUNCTION public.rcm_study_resolve_flags()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status = 'approved' AND NEW.status IS DISTINCT FROM 'approved' THEN
    UPDATE public.ers_rcm_evidence_flags SET resolved_at = now() WHERE study_id = NEW.id AND resolved_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_rcm_study_resolve_flags ON public.ers_rcm_studies;
CREATE TRIGGER trg_rcm_study_resolve_flags
  AFTER UPDATE OF status ON public.ers_rcm_studies
  FOR EACH ROW EXECUTE FUNCTION public.rcm_study_resolve_flags();

-- ── (3) the daily sweep ─────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.rcm_implementation_sweep();
CREATE FUNCTION public.rcm_implementation_sweep()
RETURNS TABLE(out_study_id uuid, action text, n int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s record; d record; fl record;
  v_user uuid; v_fac uuid; v_n int; v_asset_tag text;
BEGIN
  FOR s IN
    SELECT st.id, st.title, st.asset_id, st.company_id, st.created_by, st.approved_at,
           a.tag AS asset_tag
      FROM public.ers_rcm_studies st
      LEFT JOIN public.assets a ON a.id::text = st.asset_id
     WHERE st.status IN ('approved', 'in_progress', 'review')
  LOOP
    v_asset_tag := coalesce(s.asset_tag, s.title);
    v_fac := s.created_by;

    -- (a) overdue owners: one reminder a day each
    v_n := 0;
    FOR d IN
      SELECT dd.id, dd.impl_owner_contact_id, dd.impl_due_date, m.failure_mode_description
        FROM public.ers_rcm_decisions dd
        JOIN public.ers_rcm_failure_modes m ON m.id = dd.failure_mode_id
        JOIN public.ers_rcm_functions f ON f.id = m.function_id
       WHERE f.study_id = s.id
         AND dd.recommended_strategy_code IS NOT NULL
         AND dd.impl_due_date < current_date
         AND NOT public.rcm_decision_implemented(dd.id)
    LOOP
      v_n := v_n + 1;
      SELECT coalesce(c.user_id, u.id) INTO v_user
        FROM public.contacts c LEFT JOIN public.users u ON u.contact_id = c.id
       WHERE c.id = d.impl_owner_contact_id LIMIT 1;
      IF v_user IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM public.notifications n
           WHERE n.recipient_id = v_user::text AND n.entity_id = d.id::text
             AND n.notification_type = 'ESCALATION' AND n.created_at > now() - interval '23 hours')
      THEN
        INSERT INTO public.notifications
            (recipient_id, title, message, severity, notification_type, module,
             entity_id, entity_type, entity_number, action_link, action_required, company_id)
        VALUES
            (v_user::text,
             '⏰ RCM implementation overdue: ' || v_asset_tag,
             left(d.failure_mode_description, 140) || ' — due ' || to_char(d.impl_due_date, 'DD Mon') ||
               ' (' || (current_date - d.impl_due_date) || ' days ago). Open the Maintenance Plan and create the PM, point, sensor or work order.',
             'WARNING', 'ESCALATION', 'rcm',
             d.id::text, 'RCM_DECISION', s.title, '/rcm/' || s.id::text, true, s.company_id);
      END IF;
    END LOOP;
    IF v_n > 0 THEN
      out_study_id := s.id; action := 'overdue reminders'; n := v_n; RETURN NEXT;
      -- facilitator summary, once a day
      IF v_fac IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM public.notifications nn
           WHERE nn.recipient_id = v_fac::text AND nn.entity_id = s.id::text
             AND nn.notification_type = 'ESCALATION' AND nn.created_at > now() - interval '23 hours')
      THEN
        INSERT INTO public.notifications
            (recipient_id, title, message, severity, notification_type, module,
             entity_id, entity_type, entity_number, action_link, action_required, company_id)
        VALUES
            (v_fac::text,
             '⏰ ' || v_n || ' RCM implementation' || CASE WHEN v_n <> 1 THEN 's' ELSE '' END || ' overdue: ' || v_asset_tag,
             'The approved plan for "' || s.title || '" has ' || v_n || ' step' || CASE WHEN v_n <> 1 THEN 's' ELSE '' END || ' past due. Owners were reminded.',
             'WARNING', 'ESCALATION', 'rcm',
             s.id::text, 'RCM_STUDY', s.title, '/rcm/' || s.id::text, false, s.company_id);
      END IF;
    END IF;

    -- (b) living study — only for approved studies on a register asset
    IF s.approved_at IS NULL OR s.asset_id IS NULL OR s.asset_id !~* '^[0-9a-f-]{36}$' THEN CONTINUE; END IF;

    -- coded failures since approval that the study does not list
    INSERT INTO public.ers_rcm_evidence_flags (study_id, kind, ref, label, count, first_seen, last_seen, company_id)
    SELECT s.id, 'unanalysed_failure', g.code,
           coalesce((SELECT rc.description FROM public.reference_codes rc WHERE upper(rc.code) = g.code AND (rc.company_id IS NULL OR rc.company_id = s.company_id) AND coalesce(rc.active, true) ORDER BY (rc.company_id IS NULL) LIMIT 1), g.code),
           g.n, g.first_at, g.last_at, s.company_id
      FROM (
        SELECT upper(fd.failure_mode_code) AS code, count(*) AS n, min(w.created_at) AS first_at, max(w.created_at) AS last_at
          FROM public.work_orders w
          JOIN public.wo_failure_data fd ON fd.wo_id = w.id
         WHERE w.asset_id::text = s.asset_id
           AND w.created_at > s.approved_at
           AND coalesce(fd.failure_mode_code, '') <> ''
           -- not among the study's modes: neither by code nor, for drafted modes
           -- that carry no code yet, by the dictionary description in the mode text
           AND NOT EXISTS (
                 SELECT 1 FROM public.ers_rcm_failure_modes m
                   JOIN public.ers_rcm_functions f ON f.id = m.function_id
                  WHERE f.study_id = s.id
                    AND (upper(coalesce(m.failure_mode_code, '')) = upper(fd.failure_mode_code)
                         -- free-text codes ("Bearing Failure") named in the mode text
                         OR (length(fd.failure_mode_code) >= 4 AND lower(m.failure_mode_description) LIKE '%' || lower(fd.failure_mode_code) || '%')
                         -- ISO abbreviations (BRD, LCK) through the reference description
                         OR EXISTS (SELECT 1 FROM public.reference_codes rc
                                     WHERE upper(rc.code) = upper(fd.failure_mode_code)
                                       AND (rc.company_id IS NULL OR rc.company_id = s.company_id)
                                       AND length(coalesce(rc.description, '')) >= 4
                                       AND lower(m.failure_mode_description) LIKE '%' || lower(split_part(rc.description, ' / ', 1)) || '%')))
         GROUP BY upper(fd.failure_mode_code)
      ) g
    ON CONFLICT (study_id, kind, ref) DO UPDATE
       SET count = EXCLUDED.count, last_seen = EXCLUDED.last_seen,
           resolved_at = CASE WHEN EXCLUDED.last_seen > coalesce(ers_rcm_evidence_flags.resolved_at, 'epoch'::timestamptz) THEN NULL ELSE ers_rcm_evidence_flags.resolved_at END;

    -- linked points in alarm since approval
    INSERT INTO public.ers_rcm_evidence_flags (study_id, kind, ref, label, count, first_seen, last_seen, company_id)
    SELECT s.id, 'reading_alarm', r.id::text, r.name, count(*), min(l.created_at), max(l.created_at), s.company_id
      FROM public.ers_rcm_decisions dd
      JOIN public.ers_rcm_failure_modes m ON m.id = dd.failure_mode_id
      JOIN public.ers_rcm_functions f ON f.id = m.function_id
      JOIN public.reading_definitions r ON r.id = dd.reading_definition_id
      JOIN public.reading_logs l ON l.definition_id = r.id AND l.is_alarm IS TRUE AND l.created_at > s.approved_at
     WHERE f.study_id = s.id
     GROUP BY r.id, r.name
    ON CONFLICT (study_id, kind, ref) DO UPDATE
       SET count = EXCLUDED.count, last_seen = EXCLUDED.last_seen,
           resolved_at = CASE WHEN EXCLUDED.last_seen > coalesce(ers_rcm_evidence_flags.resolved_at, 'epoch'::timestamptz) THEN NULL ELSE ers_rcm_evidence_flags.resolved_at END;

    -- tell the facilitator once per flag
    v_n := 0;
    FOR fl IN SELECT * FROM public.ers_rcm_evidence_flags e WHERE e.study_id = s.id AND e.resolved_at IS NULL AND e.notified_at IS NULL LOOP
      v_n := v_n + 1;
      IF v_fac IS NOT NULL THEN
        INSERT INTO public.notifications
            (recipient_id, title, message, severity, notification_type, module,
             entity_id, entity_type, entity_number, action_link, action_required, company_id)
        VALUES
            (v_fac::text,
             CASE WHEN fl.kind = 'unanalysed_failure' THEN '🔎 Failure the RCM study did not predict: ' ELSE '🔔 Monitored point in alarm: ' END || v_asset_tag,
             CASE WHEN fl.kind = 'unanalysed_failure'
                  THEN fl.count || ' work order' || CASE WHEN fl.count <> 1 THEN 's' ELSE '' END || ' coded ' || coalesce(fl.label, fl.ref) || ' since approval — not among the study''s failure modes. Review the Evidence tab; revise the study if the mode is real.'
                  ELSE fl.count || ' alarm reading' || CASE WHEN fl.count <> 1 THEN 's' ELSE '' END || ' on ' || coalesce(fl.label, fl.ref) || ' since approval. Check the P-F interval and the task that reads it.' END,
             'WARNING', 'ASSIGNMENT', 'rcm',
             s.id::text, 'RCM_STUDY', s.title, '/rcm/' || s.id::text, true, s.company_id);
      END IF;
      UPDATE public.ers_rcm_evidence_flags SET notified_at = now() WHERE id = fl.id;
    END LOOP;
    IF v_n > 0 THEN out_study_id := s.id; action := 'evidence flags raised'; n := v_n; RETURN NEXT; END IF;
  END LOOP;
  RETURN;
END;
$$;
REVOKE ALL ON FUNCTION public.rcm_implementation_sweep() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rcm_implementation_sweep() TO service_role;

-- Daily at 04:40, after the PM autogen sweep (04:20).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'rcm-implementation-sweep';
    PERFORM cron.schedule('rcm-implementation-sweep', '40 4 * * *', 'SELECT count(*) FROM public.rcm_implementation_sweep()');
  END IF;
END $$;

-- ── (4) strategy package attach for non-admins ──────────────────────────────
CREATE OR REPLACE FUNCTION public.rcm_attach_strategy_package(p_pm_id text, p_strategy_name text, p_label text, p_interval_days int, p_description text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company uuid := public.caller_company();
  v_strat uuid;
BEGIN
  IF NOT (public.is_admin() OR public.caller_can('pm', 'edit') OR public.caller_can('reliability', 'edit')) THEN
    RAISE EXCEPTION 'RCM_PACKAGE_DENIED: attaching a PM to a strategy package needs pm.edit' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.recurring_work w WHERE w.id = p_pm_id AND w.company_id = v_company) THEN
    RAISE EXCEPTION 'RCM_PACKAGE_DENIED: PM % is not in your company', p_pm_id USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT id INTO v_strat FROM public.maintenance_strategies WHERE company_id = v_company AND name = p_strategy_name LIMIT 1;
  IF v_strat IS NULL THEN
    INSERT INTO public.maintenance_strategies (name, description, active, company_id)
    VALUES (p_strategy_name, p_description, true, v_company) RETURNING id INTO v_strat;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.strategy_packages p WHERE p.strategy_id = v_strat AND p.label = p_label) THEN
    INSERT INTO public.strategy_packages (strategy_id, label, interval_days, task_count, sort_order, company_id)
    VALUES (v_strat, p_label, p_interval_days, 1, p_interval_days, v_company);
  END IF;
  UPDATE public.recurring_work SET strategy_id = v_strat, strategy_package = p_label WHERE id = p_pm_id AND company_id = v_company;
  RETURN p_label;
END;
$$;
GRANT EXECUTE ON FUNCTION public.rcm_attach_strategy_package(text, text, text, int, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
