-- 0179 — Responsible work group (work center) on the asset master.
-- SAP PM parity: the equipment / functional location carries a responsible work
-- centre, which defaults onto notifications/orders raised against it. Requests,
-- WOs and PMs raised from an asset pre-fill their work group from this.
-- ON DELETE SET NULL so retiring a work centre never orphans an asset. Nullable.
-- Atomic: Supabase's SQL editor runs statements individually, so wrap in a txn.
BEGIN;

ALTER TABLE assets
    ADD COLUMN IF NOT EXISTS responsible_work_center_id UUID REFERENCES work_centers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_assets_responsible_work_center ON assets(responsible_work_center_id);

COMMENT ON COLUMN assets.responsible_work_center_id IS
    'Responsible work group (work_centers.id) — SAP Main Work Center on the equipment master. Defaults onto work raised from this asset. NULL = unassigned.';

COMMIT;
