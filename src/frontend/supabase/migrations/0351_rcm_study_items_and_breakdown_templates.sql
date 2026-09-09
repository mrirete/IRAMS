-- 0351 — RCM: the equipment breakdown belongs to the study, and can be kept as a template.
--
-- Until now a study read its components and parts live from the register
-- (child assets ≤3 levels + asset_bom) on every load. A study on a manual tag,
-- or on an asset with no children and no BOM, had nothing to pin modes to,
-- nothing to name spares on, and nothing the Specialist could draft through.
-- An RCM-only tenant could never say what the equipment is made of.
--
--   (1) ers_rcm_study_items — the maintainable items of THIS study: subunits,
--       components, parts. Seeded from the register where it exists, typed in
--       where it does not, applied from a template for the next asset of the
--       same class. Edited like the worksheet; frozen while approved.
--   (2) ers_rcm_failure_modes.study_item_id — the pin target. The register
--       links (component_asset_id / bom_item_id) stay for items that came from
--       the register; a manual item has none.
--   (3) ers_rcm_breakdown_templates — a breakdown saved by class and type,
--       offered to the next study on that class. company_id NULL = shipped library.
--   (4) Backfill: every existing study with a register asset gets its items
--       from the register, and its pinned modes point at them.
BEGIN;

-- ── (1) study items ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ers_rcm_study_items (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    study_id                  uuid NOT NULL REFERENCES public.ers_rcm_studies(id) ON DELETE CASCADE,
    parent_item_id            uuid REFERENCES public.ers_rcm_study_items(id) ON DELETE SET NULL,
    kind                      text NOT NULL DEFAULT 'component' CHECK (kind IN ('subunit', 'component', 'part')),
    tag                       text,
    name                      text NOT NULL,
    critical                  boolean NOT NULL DEFAULT false,
    qty                       numeric,
    uom                       text,
    replacement_interval_days int,
    asset_id                  uuid REFERENCES public.assets(id) ON DELETE SET NULL,
    bom_item_id               uuid REFERENCES public.asset_bom(id) ON DELETE SET NULL,
    inventory_item_id         uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL,
    source                    text NOT NULL DEFAULT 'manual' CHECK (source IN ('register', 'bom', 'manual', 'template', 'specialist')),
    template_id               uuid,
    sort_order                int  NOT NULL DEFAULT 0,
    notes                     text,
    created_at                timestamptz NOT NULL DEFAULT now(),
    updated_at                timestamptz NOT NULL DEFAULT now(),
    -- a typed item has no asset to derive the tenant from: the caller's company is the default
    company_id                uuid DEFAULT public.caller_company()
);
CREATE INDEX IF NOT EXISTS idx_ers_rcm_study_items_study ON public.ers_rcm_study_items(study_id, sort_order);
COMMENT ON TABLE public.ers_rcm_study_items IS '0351: the maintainable items (ISO 14224 subunits / components / parts) an RCM study analyses. Seeded from the register, typed by hand, or applied from a breakdown template.';

ALTER TABLE public.ers_rcm_study_items ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE tenant constant text := 'company_id = (SELECT public.caller_company())'; p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ers_rcm_study_items' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.ers_rcm_study_items', p.policyname);
  END LOOP;
  EXECUTE format('CREATE POLICY rcm_select_ers_rcm_study_items ON public.ers_rcm_study_items FOR SELECT TO authenticated USING (%s)', tenant);
  EXECUTE format('CREATE POLICY rcm_insert_ers_rcm_study_items ON public.ers_rcm_study_items FOR INSERT TO authenticated WITH CHECK (%s AND public.rcm_can_edit(study_id))', tenant);
  EXECUTE format('CREATE POLICY rcm_update_ers_rcm_study_items ON public.ers_rcm_study_items FOR UPDATE TO authenticated USING (%s AND public.rcm_can_edit(study_id)) WITH CHECK (%s AND public.rcm_can_edit(study_id))', tenant, tenant);
  EXECUTE format('CREATE POLICY rcm_delete_ers_rcm_study_items ON public.ers_rcm_study_items FOR DELETE TO authenticated USING (%s AND public.rcm_can_edit(study_id))', tenant);
END $$;

-- ── (2) the pin target ──────────────────────────────────────────────────────
ALTER TABLE public.ers_rcm_failure_modes
    ADD COLUMN IF NOT EXISTS study_item_id uuid REFERENCES public.ers_rcm_study_items(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ers_rcm_failure_modes_study_item ON public.ers_rcm_failure_modes(study_item_id) WHERE study_item_id IS NOT NULL;
COMMENT ON COLUMN public.ers_rcm_failure_modes.study_item_id IS '0351: the study item (subunit / component / part) this mode belongs to. component_asset_id / bom_item_id stay as the register links when the item came from there.';

-- ── (3) breakdown templates ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ers_rcm_breakdown_templates (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name             text NOT NULL,
    asset_class      text,
    asset_type_code  text,
    items            jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{key, parent_key, kind, tag, name, critical, qty, uom, replacement_interval_days, notes}]
    scope            text NOT NULL DEFAULT 'tenant' CHECK (scope IN ('tenant', 'library')),
    from_study_id    uuid,
    version          int  NOT NULL DEFAULT 1,
    created_by       uuid,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    company_id       uuid                                  -- NULL = shipped library
);
CREATE INDEX IF NOT EXISTS idx_ers_rcm_breakdown_templates_class ON public.ers_rcm_breakdown_templates(asset_class, asset_type_code);
COMMENT ON TABLE public.ers_rcm_breakdown_templates IS '0351: an equipment breakdown saved by ISO 14224 class/type and offered to the next study on that class. company_id NULL = library shipped with the product.';
DROP TRIGGER IF EXISTS set_rcm_breakdown_templates_updated_at ON public.ers_rcm_breakdown_templates;
CREATE TRIGGER set_rcm_breakdown_templates_updated_at BEFORE UPDATE ON public.ers_rcm_breakdown_templates FOR EACH ROW EXECUTE FUNCTION public.update_rcm_updated_at();

CREATE OR REPLACE FUNCTION public.rcm_template_stamp()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.scope = 'tenant' THEN NEW.company_id := coalesce(NEW.company_id, public.caller_company()); END IF;
  NEW.created_by := coalesce(NEW.created_by, auth.uid());
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_rcm_template_stamp ON public.ers_rcm_breakdown_templates;
CREATE TRIGGER trg_rcm_template_stamp BEFORE INSERT ON public.ers_rcm_breakdown_templates FOR EACH ROW EXECUTE FUNCTION public.rcm_template_stamp();

ALTER TABLE public.ers_rcm_breakdown_templates ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ers_rcm_breakdown_templates' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.ers_rcm_breakdown_templates', p.policyname);
  END LOOP;
  CREATE POLICY rcm_select_ers_rcm_breakdown_templates ON public.ers_rcm_breakdown_templates FOR SELECT TO authenticated
    USING (company_id IS NULL OR company_id = (SELECT public.caller_company()));
  CREATE POLICY rcm_insert_ers_rcm_breakdown_templates ON public.ers_rcm_breakdown_templates FOR INSERT TO authenticated
    WITH CHECK (scope = 'tenant' AND (public.is_admin() OR public.caller_can('reliability', 'edit') OR public.caller_can('reliability', 'create')));
  CREATE POLICY rcm_update_ers_rcm_breakdown_templates ON public.ers_rcm_breakdown_templates FOR UPDATE TO authenticated
    USING (company_id = (SELECT public.caller_company()) AND (public.is_admin() OR public.caller_can('reliability', 'edit')))
    WITH CHECK (company_id = (SELECT public.caller_company()) AND scope = 'tenant');
  CREATE POLICY rcm_delete_ers_rcm_breakdown_templates ON public.ers_rcm_breakdown_templates FOR DELETE TO authenticated
    USING (company_id = (SELECT public.caller_company()) AND (public.is_admin() OR public.caller_can('reliability', 'edit')));
END $$;

-- ── (4) backfill: items from the register, pins onto them ───────────────────
DO $$
DECLARE s record; v_depth int; v_frontier uuid[]; v_next uuid[]; v_n int := 0;
BEGIN
  FOR s IN SELECT id, asset_id::uuid AS asset_uuid, company_id FROM public.ers_rcm_studies WHERE asset_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' LOOP
    IF EXISTS (SELECT 1 FROM public.ers_rcm_study_items i WHERE i.study_id = s.id) THEN CONTINUE; END IF;
    v_frontier := ARRAY[s.asset_uuid];
    FOR v_depth IN 1..3 LOOP
      EXIT WHEN v_frontier IS NULL OR array_length(v_frontier, 1) IS NULL;
      INSERT INTO public.ers_rcm_study_items (study_id, kind, tag, name, critical, asset_id, source, sort_order, company_id)
      SELECT s.id,
             CASE WHEN upper(coalesce(a.hierarchy_level, '')) = 'SUBUNIT' THEN 'subunit' ELSE 'component' END,
             a.tag, a.name, upper(coalesce(a.criticality::text, '')) = 'A', a.id, 'register', v_depth * 100, s.company_id
        FROM public.assets a
       WHERE a.parent_id = ANY(v_frontier)
         AND upper(coalesce(a.hierarchy_level, '')) NOT IN ('SITE', 'AREA', 'UNIT', 'SYSTEM', 'SUBSYSTEM')
         AND NOT EXISTS (SELECT 1 FROM public.ers_rcm_study_items i WHERE i.study_id = s.id AND i.asset_id = a.id);
      SELECT array_agg(a.id) INTO v_next FROM public.assets a WHERE a.parent_id = ANY(v_frontier)
         AND upper(coalesce(a.hierarchy_level, '')) NOT IN ('SITE', 'AREA', 'UNIT', 'SYSTEM', 'SUBSYSTEM');
      v_frontier := v_next;
    END LOOP;
    -- parents: a register child's parent item is the item of its parent asset
    UPDATE public.ers_rcm_study_items i SET parent_item_id = pi.id
      FROM public.assets a, public.ers_rcm_study_items pi
     WHERE i.study_id = s.id AND i.asset_id = a.id AND i.parent_item_id IS NULL
       AND pi.study_id = i.study_id AND pi.asset_id = a.parent_id;
    INSERT INTO public.ers_rcm_study_items (study_id, kind, tag, name, critical, qty, uom, replacement_interval_days, bom_item_id, inventory_item_id, source, sort_order, company_id)
    SELECT s.id, 'part', b.part_number, coalesce(nullif(b.description, ''), b.part_number, 'Part'), coalesce(b.is_critical, false),
           b.quantity, b.uom, b.replacement_interval_days, b.id, b.inventory_item_id, 'bom', 900, s.company_id
      FROM public.asset_bom b WHERE b.asset_id = s.asset_uuid;
    v_n := v_n + 1;
  END LOOP;
  -- pins: the mode's register link → its study item. Approved studies are frozen
  -- (0319); this is a backfill of a new column, not an edit — lift the freeze for it.
  ALTER TABLE public.ers_rcm_failure_modes DISABLE TRIGGER trg_rcm_freeze_failure_modes;
  UPDATE public.ers_rcm_failure_modes m SET study_item_id = i.id
    FROM public.ers_rcm_functions f, public.ers_rcm_study_items i
   WHERE f.id = m.function_id AND i.study_id = f.study_id AND m.study_item_id IS NULL
     AND ((m.component_asset_id IS NOT NULL AND i.asset_id = m.component_asset_id)
       OR (m.bom_item_id IS NOT NULL AND i.bom_item_id = m.bom_item_id));
  ALTER TABLE public.ers_rcm_failure_modes ENABLE TRIGGER trg_rcm_freeze_failure_modes;
  RAISE NOTICE 'rcm study items backfilled for % studies', v_n;
END $$;

-- ── triggers, after the backfill (the freeze would refuse rows for approved studies; the tenant stamp has no caller here) ──
DROP TRIGGER IF EXISTS aa_stamp_tenant ON public.ers_rcm_study_items;
CREATE TRIGGER aa_stamp_tenant BEFORE INSERT ON public.ers_rcm_study_items FOR EACH ROW EXECUTE FUNCTION public.stamp_tenant();
DROP TRIGGER IF EXISTS set_rcm_study_items_updated_at ON public.ers_rcm_study_items;
CREATE TRIGGER set_rcm_study_items_updated_at BEFORE UPDATE ON public.ers_rcm_study_items FOR EACH ROW EXECUTE FUNCTION public.update_rcm_updated_at();

-- Editing the breakdown is analysis: frozen while the study is approved.
CREATE OR REPLACE FUNCTION public.rcm_refuse_item_edit_when_approved()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_catalog' AS $$
BEGIN
  IF public.rcm_study_is_approved(COALESCE(NEW.study_id, OLD.study_id)) THEN
    RAISE EXCEPTION 'RCM study is approved — choose Revise on the study to edit it (0319)' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS trg_rcm_freeze_items ON public.ers_rcm_study_items;
CREATE TRIGGER trg_rcm_freeze_items BEFORE INSERT OR UPDATE OR DELETE ON public.ers_rcm_study_items
  FOR EACH ROW EXECUTE FUNCTION public.rcm_refuse_item_edit_when_approved();

NOTIFY pgrst, 'reload schema';
COMMIT;
