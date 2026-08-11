-- 0285: WO journals become queryable records + ISO 14224 detection/object-part
--       coding + sem_work_orders invoker hardening
--
-- 1. JOURNALS. Work-order journals lived ONLY inside work_orders.properties
--    JSONB — unindexed, unqueryable, invisible to cross-WO search, and the
--    closeout gate scored "documented" off an editable blob. The real
--    public.journal_entries table (0001) existed all along; only Contacts
--    used it. This migration:
--      • adds client_id (idempotency key for the app's dual-write; journal
--        ids in the blob are strings like 'j-171...' not uuids) and
--        author_name (the blob stored usernames, created_by is a uuid);
--      • backfills every existing properties->journals entry into
--        journal_entries (entity_type WORK_ORDER), insert-only, re-runnable.
--    The app keeps properties.journals as the offline write-through cache;
--    DatabaseService now mirrors it into journal_entries on every save
--    (insert-only — rows are never updated or deleted from the app), and the
--    read path prefers the table. UI edit/delete of persisted entries is
--    removed: corrections are follow-up notes, per record-integrity practice.
--
-- 2. DETECTION & OBJECT PART. wo_failure_data gains detection_code (how the
--    failure was found — ISO 14224 Table B.4 / SAP catalog; the single most
--    valuable field for proving PM effectiveness) and object_part (which
--    component failed — SAP catalog B analogue, free text against the mode
--    catalogue's granularity). DETECTION_METHOD dictionary seeded.
--
-- 3. sem_work_orders: the one-line security_invoker treatment 0259 gave the
--    other sem views and explicitly flagged as missing here. The 0261a tenant
--    WHERE stays (harmless double filter); with invoker semantics the base
--    table's RLS now applies to readers as well.

-- ── 1a. journal_entries columns for the WO mirror ──────────────────────────
ALTER TABLE public.journal_entries
    ADD COLUMN IF NOT EXISTS client_id   text,
    ADD COLUMN IF NOT EXISTS author_name text;

-- Full (not partial) unique index: PostgREST upsert cannot name a partial
-- index's predicate in its ON CONFLICT target. NULL client_ids never
-- conflict (SQL NULL semantics), and the app always supplies one.
CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_entity_client_key
    ON public.journal_entries (entity_id, client_id);

CREATE INDEX IF NOT EXISTS journal_entries_entity_idx
    ON public.journal_entries (entity_type, entity_id, created_at DESC);

-- ── 1b. Backfill existing WO journals from the JSONB blobs ─────────────────
-- created_at: only trust ISO-shaped strings; locale-formatted legacy stamps
-- ("8/11/2026, 3:04 PM") fall back to the WO's own created_at.
INSERT INTO public.journal_entries
    (entity_id, entity_type, entry_type, entry, created_at, is_system, client_id, author_name, company_id)
SELECT
    w.id,
    'WORK_ORDER',
    COALESCE(NULLIF(j->>'type', ''), 'Note'),
    COALESCE(NULLIF(j->>'entry', ''), NULLIF(j->>'comments', '')),
    COALESCE(
        CASE WHEN (j->>'createdAt') ~ '^\d{4}-\d{2}-\d{2}T' THEN (j->>'createdAt')::timestamptz END,
        CASE WHEN (j->>'date')      ~ '^\d{4}-\d{2}-\d{2}T' THEN (j->>'date')::timestamptz END,
        w.created_at
    ),
    COALESCE((j->>'isSystem')::boolean, false),
    COALESCE(NULLIF(j->>'id', ''),
             md5(COALESCE(j->>'entry', j->>'comments', '') || COALESCE(j->>'createdAt', ''))),
    COALESCE(NULLIF(j->>'createdBy', ''), NULLIF(j->>'author', '')),
    w.company_id
FROM public.work_orders w
CROSS JOIN LATERAL jsonb_array_elements(w.properties->'journals') AS j
WHERE jsonb_typeof(w.properties->'journals') = 'array'
  AND COALESCE(NULLIF(j->>'entry', ''), NULLIF(j->>'comments', '')) IS NOT NULL
ON CONFLICT (entity_id, client_id) DO NOTHING;

-- ── 2a. Detection & object part on the failure record ──────────────────────
ALTER TABLE public.wo_failure_data
    ADD COLUMN IF NOT EXISTS detection_code text,
    ADD COLUMN IF NOT EXISTS object_part    text;

COMMENT ON COLUMN public.wo_failure_data.detection_code
    IS 'How the failure was detected (DETECTION_METHOD dictionary; ISO 14224 Table B.4). Key input for PM-effectiveness analysis.';
COMMENT ON COLUMN public.wo_failure_data.object_part
    IS 'Maintainable item / component that failed (SAP catalog B analogue). Free text until a part catalogue ships.';

-- ── 2b. DETECTION_METHOD dictionary (ISO 14224 Table B.4) ──────────────────
INSERT INTO public.reference_codes (category, code, description, is_locked, active, category_ref) VALUES
    ('DETECTION_METHOD', 'PM_ROUTINE',  'Periodic maintenance / servicing',          false, true, NULL),
    ('DETECTION_METHOD', 'FUNC_TEST',   'Functional / proof test',                   false, true, NULL),
    ('DETECTION_METHOD', 'INSPECTION',  'Periodic inspection',                       false, true, NULL),
    ('DETECTION_METHOD', 'CBM_PERIODIC','Periodic condition monitoring',             false, true, NULL),
    ('DETECTION_METHOD', 'CBM_CONT',    'Continuous condition monitoring',           false, true, NULL),
    ('DETECTION_METHOD', 'PROD_UPSET',  'Production interference / process upset',   false, true, NULL),
    ('DETECTION_METHOD', 'OBSERVATION', 'Casual observation (operator/technician)',  false, true, NULL),
    ('DETECTION_METHOD', 'ALARM',       'Alarm / automatic protection trip',         false, true, NULL),
    ('DETECTION_METHOD', 'ON_DEMAND',   'Failure on demand / attempted start',       false, true, NULL),
    ('DETECTION_METHOD', 'CORR_MAINT',  'Found during other corrective maintenance', false, true, NULL),
    ('DETECTION_METHOD', 'OTHER',       'Other detection method',                    false, true, NULL)
-- Tenancy replaced the old (category, code) unique with
-- uq_reference_codes_tenant_category_code (company_id, category, code)
-- NULLS NOT DISTINCT; migration-context inserts land as global rows
-- (company_id NULL), same as the 0279 ISO seed.
ON CONFLICT (company_id, category, code) DO NOTHING;

-- ── 3. sem_work_orders invoker hardening (0259's deferred one-liner) ───────
ALTER VIEW public.sem_work_orders SET (security_invoker = true);

-- ── Catalog notes ──────────────────────────────────────────────────────────
INSERT INTO public.semantic_catalog
  (object_name, column_name, title, description, tags, owner, source_tables, iso_standard)
VALUES
  ('journal_entries', NULL, 'Work Journals',
   'Append-only journal records. Work-order journals (entity_type WORK_ORDER) are mirrored here from the execution UI — status changes, findings, observations, handovers. Insert-only from the application; corrections are follow-up entries, never edits.',
   ARRAY['work_management','records'], 'Maintenance',
   ARRAY['journal_entries','work_orders'], 'ISO 14224'),
  ('wo_failure_data', 'detection_code', 'Detection Method',
   'How the failure was found (ISO 14224 Table B.4). PM_ROUTINE/INSPECTION/CBM_* detections prove the proactive program is catching failures; OBSERVATION/PROD_UPSET/ALARM detections are escapes.',
   ARRAY['work_management','reliability','iso14224'], 'Reliability Engineering',
   ARRAY['wo_failure_data'], 'ISO 14224')
ON CONFLICT DO NOTHING;
