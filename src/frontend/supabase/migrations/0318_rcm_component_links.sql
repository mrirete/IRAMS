-- ============================================================================
-- 0318 — RCM failure modes pinned to the asset's physical breakdown
--
-- ISO 14224 subdivides an equipment unit (L6) into subunits (L7),
-- maintainable items (L8) and parts (L9). The register already holds that
-- breakdown — child assets at SUBUNIT/COMPONENT level and asset_bom lines —
-- but an RCM failure mode could not say WHICH component or part it was about,
-- so the worksheet could never answer JA1011's "were all reasonably likely
-- failure modes identified?" per component, and a decision's task could not
-- name the spare it consumes.
--
-- Two nullable links on the failure mode: a registered child asset, and/or a
-- BOM line. ON DELETE SET NULL — removing a component from the register must
-- not delete the analysis that was written about it.
-- ============================================================================

BEGIN;

ALTER TABLE public.ers_rcm_failure_modes
    ADD COLUMN IF NOT EXISTS component_asset_id uuid REFERENCES public.assets(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS bom_item_id        uuid REFERENCES public.asset_bom(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_rcm_fm_component ON public.ers_rcm_failure_modes (component_asset_id) WHERE component_asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rcm_fm_bom_item  ON public.ers_rcm_failure_modes (bom_item_id)        WHERE bom_item_id IS NOT NULL;

COMMENT ON COLUMN public.ers_rcm_failure_modes.component_asset_id IS
    'The registered child asset (ISO 14224 subunit L7 / component L8) this failure mode belongs to. NULL = pinned to the study asset as a whole.';
COMMENT ON COLUMN public.ers_rcm_failure_modes.bom_item_id IS
    'The asset_bom line (maintainable item / part, ISO 14224 L8–L9) this failure mode is about — the spare a task replaces or inspects.';

-- catalogue (WHERE NOT EXISTS — see 0317 for why not ON CONFLICT)
INSERT INTO public.semantic_catalog (object_name, column_name, title, description, tags, owner, source_tables, iso_standard)
SELECT 'ers_rcm_failure_modes', 'component_asset_id', 'Failure mode → component',
       'Which registered subunit/component (child asset of the study asset) the failure mode belongs to. Lets the study report coverage per component: which parts of the machine have no failure mode yet.',
       ARRAY['rcm','iso14224','breakdown','coverage'], 'Reliability Engineering', ARRAY['ers_rcm_failure_modes','assets'], 'ISO 14224:2016 §8.2 / SAE JA1011 §5.3'
WHERE NOT EXISTS (SELECT 1 FROM public.semantic_catalog WHERE object_name = 'ers_rcm_failure_modes' AND column_name = 'component_asset_id');

INSERT INTO public.semantic_catalog (object_name, column_name, title, description, tags, owner, source_tables, iso_standard)
SELECT 'ers_rcm_failure_modes', 'bom_item_id', 'Failure mode → BOM line',
       'The asset BOM line (maintainable item / spare) the failure mode is about. Joins RCM decisions to the parts a task consumes.',
       ARRAY['rcm','bom','spares'], 'Reliability Engineering', ARRAY['ers_rcm_failure_modes','asset_bom'], 'ISO 14224:2016 §8.2'
WHERE NOT EXISTS (SELECT 1 FROM public.semantic_catalog WHERE object_name = 'ers_rcm_failure_modes' AND column_name = 'bom_item_id');

DO $$
BEGIN
    PERFORM 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ers_rcm_failure_modes' AND column_name = 'component_asset_id';
    IF NOT FOUND THEN RAISE EXCEPTION 'ers_rcm_failure_modes.component_asset_id missing'; END IF;
    PERFORM 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ers_rcm_failure_modes' AND column_name = 'bom_item_id';
    IF NOT FOUND THEN RAISE EXCEPTION 'ers_rcm_failure_modes.bom_item_id missing'; END IF;
    RAISE NOTICE '0318 ok';
END $$;

COMMIT;
