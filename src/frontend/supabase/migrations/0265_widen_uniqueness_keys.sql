-- ════════════════════════════════════════════════════════════════════════════
-- 0265 — Tenancy Phase 4a: uniqueness keys learn about the tenant
--
-- `assets.tag` is UNIQUE. One customer's "P-101" therefore forbids every other
-- customer from ever having a "P-101". Same for work order numbers, cost centre
-- codes, part numbers, contact codes. These are keys the CUSTOMER chooses, and
-- two customers choosing the same string is not a conflict — it is Tuesday.
--
-- Customer #2 would hit this on their first import, loudly. That is the good
-- case; the bad case is that it never happens because nobody tried, and the
-- collision lands in front of a paying customer instead.
--
-- ── 44 unique keys, and only 23 of them should change ───────────────────────
-- This is the migration where a blind sweep does damage, so all 44 were
-- classified and only one class is touched.
--
--   A · WIDEN (23) — customer-chosen natural keys: tag, wo_number, code,
--       part_number, grn_number. Genuinely per-tenant. Handled here.
--
--   B · LEAVE (15) — already tenant-safe through a parent. audit_responses is
--       unique on (audit_id, question_id); audit_id is a uuid on a
--       tenant-scoped table, so two tenants cannot produce the same pair. All
--       ten parents were checked and every primary key is a uuid — if any were
--       a per-tenant sequence this reasoning would collapse, so it was verified
--       rather than assumed. Widening these would cost writes and buy nothing.
--       It would also break their upserts: onConflict 'asset_id',
--       'audit_id,question_id', 'item_id,location_id' and 'node_id,evidence_id'
--       all infer against exactly these indexes.
--
--   C · MUST STAY GLOBAL (3) — audit_assessment_collaborators.invite_token,
--       ers_collector_keys.key_hash, user_invites.token. Widening a SECRET is
--       a security regression, not a fix: two tenants could then hold the same
--       invite token, and a token presented at the door would no longer
--       identify one row. These stay globally unique on purpose.
--
-- ── Expand now, contract in 0266 ────────────────────────────────────────────
-- Widening a key changes ON CONFLICT inference. `ON CONFLICT (code)` stops
-- matching once the only index is (company_id, code), and fails outright —
-- "no unique or exclusion constraint matching the ON CONFLICT specification".
-- Three deployed call sites infer against keys in list A:
--
--     cost_centers          onConflict 'code'   FinOpsService
--     jsa_templates         onConflict 'name'   DatabaseService (×2)
--     notification_channels onConflict 'type'   DatabaseService
--
-- Applying migrations before shipping the frontend already broke this app
-- twice in this workstream. So those three get their widened key ADDED
-- alongside the narrow one — both valid, since with a single tenant the narrow
-- key implies the wide one. The old code keeps working, the new code works,
-- and 0266 drops the narrow keys once the frontend is deployed.
--
-- The other 20 have no ON CONFLICT depending on them and are swapped outright,
-- atomically, inside this migration's transaction.
--
-- ── NULL semantics stay exactly as they are ─────────────────────────────────
-- Plain UNIQUE, not UNIQUE NULLS NOT DISTINCT. 0262 uses the latter and it is
-- tempting to match, but `assets.equipment_number` is NULL on 27 of 69 rows:
-- NULLS NOT DISTINCT would permit exactly one such row per tenant and reject
-- the other 26 on the way in. Default semantics preserve today's behaviour.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. The 20 with no upsert depending on them — swap outright ──────────────
DO $$
DECLARE
    r        record;
    n        int := 0;
    targets  constant text[][] := ARRAY[
        ['assets',               'assets_equipment_number_key',                'equipment_number'],
        ['assets',               'assets_tag_key',                             'tag'],
        ['audit_assessments',    'audit_assessments_assessment_number_key',    'assessment_number'],
        ['audit_templates',      'audit_templates_code_key',                   'code'],
        ['audits',               'audits_audit_number_key',                    'audit_number'],
        ['contacts',             'contacts_code_key',                          'code'],
        ['ers_cmls',             'ers_cmls_cml_number_key',                    'cml_number'],
        ['ers_prediction_alerts','ers_prediction_alerts_alert_id_key',         'alert_id'],
        ['goods_receipts',       'goods_receipts_grn_number_key',              'grn_number'],
        ['insurance_incidents',  'insurance_incidents_incident_number_key',    'incident_number'],
        ['inventory_items',      'inventory_items_material_number_key',        'material_number'],
        ['inventory_items',      'inventory_items_part_number_key',            'part_number'],
        ['invoice_matches',      'invoice_matches_vendor_number_uq',           'vendor_id, invoice_number'],
        ['service_requests',     'service_requests_request_number_key',        'request_number'],
        ['warranty_claims',      'warranty_claims_claim_number_key',           'claim_number'],
        ['wbs_elements',         'wbs_elements_code_key',                      'code'],
        ['work_centers',         'work_centers_code_key',                      'code'],
        ['work_orders',          'work_orders_wo_number_key',                  'wo_number']
    ];
    t text[];
BEGIN
    FOREACH t SLICE 1 IN ARRAY targets LOOP
        -- Idempotent: skip anything already carrying company_id.
        IF EXISTS (
            SELECT 1 FROM pg_constraint c
             WHERE c.conname = t[2] AND c.conrelid = format('public.%I', t[1])::regclass)
        THEN
            EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', t[1], t[2]);
            EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE (company_id, %s)',
                           t[1], t[2], t[3]);
            n := n + 1;
        END IF;
    END LOOP;
    RAISE NOTICE 'widened % constraint(s)', n;
END $$;

-- Two are bare unique INDEXes rather than constraints, so they drop differently.
DROP INDEX IF EXISTS public.uq_rag_source_chunk;
CREATE UNIQUE INDEX IF NOT EXISTS uq_rag_source_chunk
    ON public.ers_rag_documents (company_id, source, chunk_index);

DROP INDEX IF EXISTS public.task_library_items_code_key;
CREATE UNIQUE INDEX IF NOT EXISTS task_library_items_code_key
    ON public.task_library_items (company_id, code);

-- ── 2. The 3 with deployed upserts — add alongside, drop in 0266 ────────────
-- New names, because the narrow ones still exist until the frontend ships.
ALTER TABLE public.cost_centers
    ADD CONSTRAINT uq_cost_centers_company_code UNIQUE (company_id, code);

ALTER TABLE public.jsa_templates
    ADD CONSTRAINT uq_jsa_templates_company_name UNIQUE (company_id, name);

ALTER TABLE public.notification_channels
    ADD CONSTRAINT uq_notification_channels_company_type UNIQUE (company_id, type);

COMMENT ON CONSTRAINT uq_cost_centers_company_code ON public.cost_centers IS
    'Tenant-scoped cost centre code. The narrow cost_centers_code_key still exists until the frontend upsert moves to onConflict company_id,code — 0266 drops it.';

-- ── 3. Prove it ─────────────────────────────────────────────────────────────
DO $$
DECLARE widened int; remaining int;
BEGIN
    SELECT count(*) INTO widened
      FROM pg_index i
      JOIN pg_class t  ON t.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public' AND i.indisunique AND NOT i.indisprimary
       AND EXISTS (SELECT 1 FROM unnest(i.indkey) k
                     JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k
                    WHERE a.attname = 'company_id');

    -- What is left without a tenant column: the 15 in class B, the 3 secrets in
    -- class C, and the 3 narrow keys 0266 removes.
    SELECT count(*) INTO remaining
      FROM pg_index i
      JOIN pg_class t  ON t.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public' AND i.indisunique AND NOT i.indisprimary
       AND t.relname NOT IN ('users', 'companies')
       AND EXISTS (SELECT 1 FROM information_schema.columns c
                    WHERE c.table_schema = 'public' AND c.table_name = t.relname
                      AND c.column_name = 'company_id')
       AND NOT EXISTS (SELECT 1 FROM unnest(i.indkey) k
                         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k
                        WHERE a.attname = 'company_id');

    RAISE NOTICE 'tenant-scoped unique keys: %, still narrow: % (expect 21 = 15 class B + 3 secrets + 3 awaiting 0266)', widened, remaining;

    IF remaining <> 21 THEN
        RAISE EXCEPTION 'expected 21 narrow keys to remain, found % — the classification no longer matches the schema', remaining;
    END IF;
END $$;
