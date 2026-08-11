-- 0287: Failure records reach the maintainable component (ISO 14224 level 8/9)
--
-- A failure could be coded down to mode/cause/detection, but WHERE the fault
-- sat — which component of the equipment — was free text at best. The asset
-- BOM (asset_bom, SAP Material Master parity) already lists exactly the
-- maintainable components of each asset, including Text-BOM lines for real
-- components that aren't individually purchased. This links the failure
-- record to that line:
--
--   failed_bom_item_id — FK to asset_bom (SET NULL on BOM cleanup so history
--                        survives register maintenance)
--   failed_part_no     — part-number snapshot taken at coding time; with
--                        object_part (description snapshot, 0285) the record
--                        stays human-readable even if the BOM line goes away
--
-- Payoffs wired in the app alongside this migration: the technician picks
-- the failed component from the asset's BOM at closeout; a follow-up
-- corrective WO pre-loads that part as a planned part line; recurring failing
-- parts surface next to recurring failure modes in the reliability cards.

ALTER TABLE public.wo_failure_data
    ADD COLUMN IF NOT EXISTS failed_bom_item_id uuid REFERENCES public.asset_bom(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS failed_part_no     text;

CREATE INDEX IF NOT EXISTS wo_failure_data_failed_bom_item_idx
    ON public.wo_failure_data (failed_bom_item_id)
    WHERE failed_bom_item_id IS NOT NULL;

COMMENT ON COLUMN public.wo_failure_data.failed_bom_item_id
    IS 'The asset_bom line (maintainable component / part) the diagnosed fault was found on. ISO 14224 level 8/9 via the BOM rather than the register.';
COMMENT ON COLUMN public.wo_failure_data.failed_part_no
    IS 'Part-number snapshot at coding time; survives BOM edits. Description snapshot lives in object_part.';

INSERT INTO public.semantic_catalog
  (object_name, column_name, title, description, tags, owner, source_tables, iso_standard)
VALUES
  ('wo_failure_data', 'failed_bom_item_id', 'Failed Component (BOM line)',
   'Which maintainable component of the asset the diagnosed fault was found on, as a link to the asset BOM. Join asset_bom → inventory_items for part-level failure rates (spares optimisation). object_part / failed_part_no carry the human-readable snapshot.',
   ARRAY['work_management','reliability','iso14224','spares'], 'Reliability Engineering',
   ARRAY['wo_failure_data','asset_bom','inventory_items'], 'ISO 14224')
ON CONFLICT DO NOTHING;
