-- ═══════════════════════════════════════════════════════════════
-- 0250 — External keys: the join between our records and theirs.
--
-- Every ERP integration needs one thing before it can move a single
-- document: a stable answer to "which of their records is this one of
-- ours?". Without it a sync can only match on name or code, which breaks
-- the first time someone renames a vendor — and re-creates duplicates on
-- every run, because nothing can recognise what it already sent.
--
-- Modelled as ONE mapping table rather than an `external_id` column on
-- every master table, because:
--   • a tenant can be connected to more than one system (SAP today, a
--     procurement portal tomorrow) and the same vendor has an id in each;
--   • the mapping needs its own metadata — when it was last synced, which
--     direction is authoritative, whether it is still trusted — and none
--     of that belongs in a column on `vendors`;
--   • it can be populated and audited without touching, or locking, the
--     master tables it maps.
--
-- WHO MASTERS WHAT is recorded here too (`ownership`), because it is the
-- question that actually decides conflict resolution, and leaving it
-- implicit is how two systems quietly overwrite each other. It defaults to
-- EXTERNAL for a reason: if their finance system knows about an object at
-- all, it usually owns it, and defaulting the other way loses their edits.
--
-- Nothing syncs yet. This is the schema the adapter will need, put in
-- place while it is cheap, and it is inert until something writes to it.
--
-- Rollback:
--   DROP VIEW IF EXISTS sem_erp_mapping_health;
--   DROP TABLE IF EXISTS erp_object_map;
--   ALTER TABLE cost_centers DROP COLUMN IF EXISTS gl_account;
-- ═══════════════════════════════════════════════════════════════
BEGIN;

CREATE TABLE IF NOT EXISTS public.erp_object_map (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Which external system. 'SAP' today; a tenant may connect several.
    system        TEXT NOT NULL DEFAULT 'SAP',

    -- Our side: the table name and row id, kept loose on purpose. A hard FK
    -- per entity would mean one column set per table and a migration every
    -- time a new object becomes mappable.
    entity_type   TEXT NOT NULL
                  CHECK (entity_type IN (
                      'vendor', 'cost_center', 'wbs_element', 'gl_account',
                      'inventory_item', 'purchase_order', 'purchase_order_line',
                      'goods_receipt', 'work_order', 'cost_allocation', 'asset', 'company'
                  )),
    entity_id     UUID NOT NULL,

    -- Their side. `external_key` is the business key a human would quote
    -- (vendor 100234, cost centre 1000-MAINT); `external_ref` is any second
    -- identifier the API needs, e.g. an OData entity key or a document year.
    external_key  TEXT NOT NULL,
    external_ref  TEXT,

    -- Who wins on conflict. The single most important field here.
    ownership     TEXT NOT NULL DEFAULT 'EXTERNAL'
                  CHECK (ownership IN ('EXTERNAL', 'LOCAL', 'BIDIRECTIONAL')),

    last_synced_at TIMESTAMPTZ,
    last_direction TEXT CHECK (last_direction IN ('IN', 'OUT')),
    last_error     TEXT,
    active         BOOLEAN NOT NULL DEFAULT TRUE,

    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- One mapping per object per system, in both directions. These two
    -- constraints are the whole anti-duplication story: a re-run cannot
    -- create a second mapping, and two of our records cannot claim the
    -- same external object.
    UNIQUE (system, entity_type, entity_id),
    UNIQUE (system, entity_type, external_key)
);

COMMENT ON TABLE public.erp_object_map IS
    'Identity map between IREAMS records and external ERP objects. Nothing syncs yet — this is the key layer an adapter needs to be idempotent.';
COMMENT ON COLUMN public.erp_object_map.ownership IS
    'Who wins on conflict: EXTERNAL (their system masters it), LOCAL (we do), BIDIRECTIONAL (needs a field-level rule). Defaults to EXTERNAL — if their finance system knows an object, it usually owns it.';
COMMENT ON COLUMN public.erp_object_map.external_key IS
    'The business key a human would quote — vendor number, cost centre code, PO number.';

CREATE INDEX IF NOT EXISTS idx_erp_map_entity   ON public.erp_object_map (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_erp_map_external ON public.erp_object_map (system, entity_type, external_key);
CREATE INDEX IF NOT EXISTS idx_erp_map_stale    ON public.erp_object_map (system, last_synced_at) WHERE active;

-- Integration mappings are configuration, not operational data: readable by
-- the app, written only by the adapter running as the service role.
ALTER TABLE public.erp_object_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "erp_map_read" ON public.erp_object_map;
CREATE POLICY "erp_map_read" ON public.erp_object_map
    FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "erp_map_service_write" ON public.erp_object_map;
CREATE POLICY "erp_map_service_write" ON public.erp_object_map
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ───────────────────────────────────────────────────────────────
-- The one G/L field that belongs on a master record
-- ───────────────────────────────────────────────────────────────
-- Movement types carry a G/L account (0245) and PO lines carry one (0248);
-- a cost centre needs its default expense account too, or every posting
-- has to name one. Unseeded, like the others — the chart of accounts is
-- the customer's.
ALTER TABLE public.cost_centers
    ADD COLUMN IF NOT EXISTS gl_account TEXT;

COMMENT ON COLUMN public.cost_centers.gl_account IS
    'Default expense account for postings to this cost centre. Mapped per tenant at ERP onboarding — intentionally unseeded.';

-- ───────────────────────────────────────────────────────────────
-- What is mapped, and what is not
-- ───────────────────────────────────────────────────────────────
-- The gap list an onboarding works through: every master object that would
-- need to reach SAP, with how many of them have no external key yet.
CREATE OR REPLACE VIEW public.sem_erp_mapping_health AS
WITH counts AS (
    SELECT 'vendor'         AS entity_type, COUNT(*) AS total FROM public.vendors
    UNION ALL SELECT 'cost_center',    COUNT(*) FROM public.cost_centers
    UNION ALL SELECT 'inventory_item', COUNT(*) FROM public.inventory_items
    UNION ALL SELECT 'work_order',     COUNT(*) FROM public.work_orders
    UNION ALL SELECT 'purchase_order', COUNT(*) FROM public.purchase_orders
    UNION ALL SELECT 'asset',          COUNT(*) FROM public.assets
)
SELECT c.entity_type,
       c.total                                            AS records,
       COALESCE(m.mapped, 0)                              AS mapped,
       c.total - COALESCE(m.mapped, 0)                    AS unmapped,
       CASE WHEN c.total = 0 THEN 100
            ELSE ROUND(100.0 * COALESCE(m.mapped, 0) / c.total, 1)
       END                                                AS mapped_pct
FROM counts c
LEFT JOIN (
    SELECT entity_type, COUNT(*) AS mapped
    FROM public.erp_object_map WHERE active
    GROUP BY entity_type
) m ON m.entity_type = c.entity_type;

COMMENT ON VIEW public.sem_erp_mapping_health IS
    'How much of each master object has an external key. The onboarding checklist for an ERP integration; 0% everywhere until an adapter runs.';

GRANT SELECT ON public.erp_object_map        TO authenticated, service_role;
GRANT SELECT ON public.sem_erp_mapping_health TO authenticated, service_role;

COMMIT;
