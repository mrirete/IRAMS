-- 0355 — the failed equipment item is a link on the RCA, its corrective actions
-- and the defect-elimination task; one view drills into an item's history.
--
-- The item is known at the start of the chain (the work order's
-- wo_failure_data.subunit_code / object_part, seeded by the PM since 0353) and
-- at the end (the RCM failure mode pinned to a study item), and lost in the
-- middle where the investigation happens: an RCA carried a free-text "Failed
-- component" and a DE task only the asset.
--
--   * ers_rca_investigations / ers_rca_corrective_actions /
--     ers_defect_elimination_tasks gain the same three link columns a failure
--     mode has (study_item_id, component_asset_id, bom_item_id) and item_label.
--   * sem_equipment_item_history(asset, item…) — work orders coded to the item,
--     RCAs and DE tasks on it, RCM modes pinned to it with strategy and PM —
--     read by the RCA "This item" panel, the DE recurrence and the agents.
BEGIN;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ers_rca_investigations', 'ers_rca_corrective_actions', 'ers_defect_elimination_tasks'] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS study_item_id uuid REFERENCES public.ers_rcm_study_items(id) ON DELETE SET NULL', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS component_asset_id uuid REFERENCES public.assets(id) ON DELETE SET NULL', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS bom_item_id uuid REFERENCES public.asset_bom(id) ON DELETE SET NULL', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS item_label text', t);
    EXECUTE format('COMMENT ON COLUMN public.%I.item_label IS ''0355: the failed equipment item as a person reads it (tag — name); the *_id columns are the links when the item is registered or listed on an RCM study.''', t);
  END LOOP;
END $$;

-- ── one history per item ────────────────────────────────────────────────────
-- Matching by label text as well as by link, because work orders carry the item
-- as text (subunit_code / object_part) and older rows have no link at all.
CREATE OR REPLACE FUNCTION public.equipment_item_history(
    p_asset_id uuid,
    p_study_item_id uuid DEFAULT NULL,
    p_component_asset_id uuid DEFAULT NULL,
    p_bom_item_id uuid DEFAULT NULL,
    p_label text DEFAULT NULL,
    p_months int DEFAULT 12
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company uuid := public.caller_company();
  v_tag text; v_name text; v_keys text[]; v_since timestamptz := now() - make_interval(months => coalesce(p_months, 12));
  v_wos jsonb; v_all_cm int; v_item_cm int; v_rcas jsonb; v_des jsonb; v_modes jsonb; v_points jsonb;
BEGIN
  -- the words this item goes by: tag and name of the register asset / BOM line / study item, plus the label given
  SELECT a.tag, regexp_replace(a.name, '\s*\([^)]*\)\s*$', '') INTO v_tag, v_name FROM public.assets a WHERE a.id = p_component_asset_id;
  IF v_tag IS NULL AND p_bom_item_id IS NOT NULL THEN SELECT b.part_number, b.description INTO v_tag, v_name FROM public.asset_bom b WHERE b.id = p_bom_item_id; END IF;
  IF v_tag IS NULL AND p_study_item_id IS NOT NULL THEN SELECT i.tag, i.name INTO v_tag, v_name FROM public.ers_rcm_study_items i WHERE i.id = p_study_item_id; END IF;
  v_keys := ARRAY(SELECT DISTINCT lower(k) FROM unnest(ARRAY[v_tag, v_name, p_label, split_part(coalesce(p_label, ''), ' — ', 1), split_part(coalesce(p_label, ''), ' — ', 2)]) k WHERE coalesce(k, '') <> '' AND length(k) >= 3);

  -- work orders on the asset, those coded to this item
  SELECT count(*) INTO v_all_cm FROM public.work_orders w WHERE w.asset_id = p_asset_id AND w.company_id = v_company AND upper(coalesce(w.type, '')) IN ('CM', 'EM', 'BREAKDOWN', 'CORRECTIVE') AND w.created_at >= v_since;
  SELECT count(*), coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'wo_number', w.wo_number, 'title', w.title, 'type', w.type, 'status', w.status, 'created_at', w.created_at, 'failure_mode_code', f.failure_mode_code, 'subunit_code', f.subunit_code, 'object_part', f.object_part) ORDER BY w.created_at DESC), '[]'::jsonb)
    INTO v_item_cm, v_wos
    FROM public.work_orders w JOIN public.wo_failure_data f ON f.wo_id = w.id
   WHERE w.asset_id = p_asset_id AND w.company_id = v_company AND w.created_at >= v_since
     AND (lower(coalesce(f.subunit_code, '')) = ANY(v_keys) OR lower(coalesce(f.object_part, '')) = ANY(v_keys)
          OR (p_component_asset_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.assets c WHERE c.id = p_component_asset_id AND (lower(c.tag) = lower(coalesce(f.subunit_code, '')) OR lower(c.tag) = lower(coalesce(f.object_part, ''))))));

  SELECT coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'title', r.title, 'status', r.status, 'method', r.method, 'root_cause_summary', r.root_cause_summary, 'created_at', r.created_at, 'closed_at', r.closed_at) ORDER BY r.created_at DESC), '[]'::jsonb) INTO v_rcas
    FROM public.ers_rca_investigations r
   WHERE r.company_id = v_company AND r.asset_id::text = p_asset_id::text
     AND ((p_study_item_id IS NOT NULL AND r.study_item_id = p_study_item_id) OR (p_component_asset_id IS NOT NULL AND r.component_asset_id = p_component_asset_id)
          OR (p_bom_item_id IS NOT NULL AND r.bom_item_id = p_bom_item_id) OR lower(coalesce(r.item_label, '')) = ANY(v_keys) OR lower(coalesce(r.event_what, '')) = ANY(v_keys));

  SELECT coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title, 'status', d.status, 'priority', d.priority, 'annual_cost', d.annual_cost, 'created_at', d.created_at) ORDER BY d.created_at DESC), '[]'::jsonb) INTO v_des
    FROM public.ers_defect_elimination_tasks d
   WHERE d.company_id = v_company AND d.asset_id::text = p_asset_id::text
     AND ((p_study_item_id IS NOT NULL AND d.study_item_id = p_study_item_id) OR (p_component_asset_id IS NOT NULL AND d.component_asset_id = p_component_asset_id)
          OR (p_bom_item_id IS NOT NULL AND d.bom_item_id = p_bom_item_id) OR lower(coalesce(d.item_label, '')) = ANY(v_keys));

  -- RCM: modes pinned to the item (by study item, or by the register link), with strategy and PM
  SELECT coalesce(jsonb_agg(jsonb_build_object('study_id', s.id, 'study_title', s.title, 'study_status', s.status, 'failure_mode_id', m.id, 'failure_mode', m.failure_mode_description, 'failure_mode_code', m.failure_mode_code,
            'strategy', dc.recommended_strategy_code, 'task', dc.task_description, 'interval', dc.task_interval, 'consequence', dc.consequence_code, 'recurring_work_id', dc.recurring_work_id, 'reading_definition_id', dc.reading_definition_id) ORDER BY s.approved_at DESC NULLS LAST, m.sort_order), '[]'::jsonb) INTO v_modes
    FROM public.ers_rcm_failure_modes m
    JOIN public.ers_rcm_functions f ON f.id = m.function_id
    JOIN public.ers_rcm_studies s ON s.id = f.study_id
    LEFT JOIN public.ers_rcm_decisions dc ON dc.failure_mode_id = m.id
    LEFT JOIN public.ers_rcm_study_items i ON i.id = m.study_item_id
   WHERE s.company_id = v_company AND s.asset_id::text = p_asset_id::text
     AND ((p_study_item_id IS NOT NULL AND m.study_item_id = p_study_item_id) OR (p_component_asset_id IS NOT NULL AND (m.component_asset_id = p_component_asset_id OR i.asset_id = p_component_asset_id))
          OR (p_bom_item_id IS NOT NULL AND (m.bom_item_id = p_bom_item_id OR i.bom_item_id = p_bom_item_id)) OR lower(coalesce(i.tag, '')) = ANY(v_keys) OR lower(coalesce(i.name, '')) = ANY(v_keys));

  -- condition: the latest reading on points linked to those modes
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', rd.id, 'name', rd.name, 'unit', rd.unit, 'last_value', l.reading_value, 'last_at', l.created_at, 'is_alarm', l.is_alarm, 'max_warning', rd.max_warning, 'max_critical', rd.max_critical)), '[]'::jsonb) INTO v_points
    FROM public.reading_definitions rd
    LEFT JOIN LATERAL (SELECT reading_value, created_at, is_alarm FROM public.reading_logs x WHERE x.definition_id = rd.id ORDER BY x.created_at DESC LIMIT 1) l ON true
   WHERE rd.id IN (SELECT (e ->> 'reading_definition_id')::uuid FROM jsonb_array_elements(v_modes) e WHERE coalesce(e ->> 'reading_definition_id', '') <> '');

  RETURN jsonb_build_object('keys', to_jsonb(v_keys), 'months', coalesce(p_months, 12), 'asset_cm_count', coalesce(v_all_cm, 0), 'item_cm_count', coalesce(v_item_cm, 0),
                            'work_orders', v_wos, 'rcas', v_rcas, 'de_tasks', v_des, 'rcm_modes', v_modes, 'points', v_points);
END;
$$;
GRANT EXECUTE ON FUNCTION public.equipment_item_history(uuid, uuid, uuid, uuid, text, int) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
