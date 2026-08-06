-- ════════════════════════════════════════════════════════════════════════════
-- 0279 — the ISO 14224 failure-mode catalogue, and the tables self-serve
--        signup stands on
--
-- ── 1. The catalogue ────────────────────────────────────────────────────────
-- The functional-failure picker (FunctionalFailureSelector, "ISO 14224
-- functional-failure picker") reads reference_codes category FAULT_TYPE
-- through the effective view. It has 12 house-coded rows (FAIL_START,
-- LEAK_EXT, …) — ISO-inspired names, non-standard codes. This adds the
-- STANDARD ISO 14224:2016 Annex B failure-mode set beside them, with the
-- standard three-letter codes, tagged with their provenance in properties so
-- they are identifiable, filterable, and prunable.
--
-- They are GLOBAL rows: the migration runs sessionless, caller_company() is
-- NULL, the DEFAULT stamps NULL, and NULL means "the product's row" (0267).
-- Since 0267/0268 every tenant can ADD their own codes beside these and
-- SHADOW any of them by (category, code) — "let users add theirs separately"
-- was built there; this migration supplies the content it was waiting for.
--
-- The house codes are left untouched: they may be referenced by existing
-- data, and a reliability engineer pruning duplicates is a product curation
-- task, not a migration's call.
--
-- ── 2. product_seed_rows ────────────────────────────────────────────────────
-- provision_tenant() clones seed rows BY ID LIST. create-tenant.mjs extracts
-- the list from baseline/seed.sql on the operator's machine — an edge
-- function has no filesystem, so self-serve signup needs the list IN the
-- database. This table is that list: a registry of which rows are the
-- product's per-tenant seed set, populated from the origin's current rows
-- (which the seed.sql extraction verified equal, 118 rows, every provisioning
-- run since 6a). If the seed set grows, the migration that grows it must
-- INSERT here too — the signup function fails loudly on an empty registry.
--
-- ── 3. signup_throttle ──────────────────────────────────────────────────────
-- Self-serve signup is a public, unauthenticated endpoint that creates real
-- tenants. The v1 abuse guard is an IP throttle with an audit trail. Both
-- tables are service-role only: RLS enabled, zero policies — PostgREST
-- callers get nothing.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. ISO 14224 Annex B failure modes ─────────────────────────────────────
INSERT INTO public.reference_codes (category, code, description, is_locked, active, properties)
VALUES
    ('FAULT_TYPE', 'AIR', 'Abnormal instrument reading',                    false, true, '{"source":"ISO 14224:2016 Annex B"}'),
    ('FAULT_TYPE', 'BRD', 'Breakdown — serious damage, total loss of function', false, true, '{"source":"ISO 14224:2016 Annex B"}'),
    ('FAULT_TYPE', 'DOP', 'Delayed operation',                              false, true, '{"source":"ISO 14224:2016 Annex B"}'),
    ('FAULT_TYPE', 'ELP', 'External leakage — process medium',              false, true, '{"source":"ISO 14224:2016 Annex B"}'),
    ('FAULT_TYPE', 'ELU', 'External leakage — utility medium',              false, true, '{"source":"ISO 14224:2016 Annex B"}'),
    ('FAULT_TYPE', 'ERO', 'Erratic output',                                 false, true, '{"source":"ISO 14224:2016 Annex B"}'),
    ('FAULT_TYPE', 'FTC', 'Fail to close on demand',                        false, true, '{"source":"ISO 14224:2016 Annex B"}'),
    ('FAULT_TYPE', 'FTF', 'Fail to function on demand',                     false, true, '{"source":"ISO 14224:2016 Annex B"}'),
    ('FAULT_TYPE', 'FTO', 'Fail to open on demand',                         false, true, '{"source":"ISO 14224:2016 Annex B"}'),
    ('FAULT_TYPE', 'FTS', 'Fail to start on demand',                        false, true, '{"source":"ISO 14224:2016 Annex B"}'),
    ('FAULT_TYPE', 'HIO', 'High output',                                    false, true, '{"source":"ISO 14224:2016 Annex B"}'),
    ('FAULT_TYPE', 'INL', 'Internal leakage',                               false, true, '{"source":"ISO 14224:2016 Annex B"}'),
    ('FAULT_TYPE', 'LCP', 'Leakage in closed position',                     false, true, '{"source":"ISO 14224:2016 Annex B"}'),
    ('FAULT_TYPE', 'LOO', 'Low output',                                     false, true, '{"source":"ISO 14224:2016 Annex B"}'),
    ('FAULT_TYPE', 'NOI', 'Noise',                                          false, true, '{"source":"ISO 14224:2016 Annex B"}'),
    ('FAULT_TYPE', 'OHE', 'Overheating',                                    false, true, '{"source":"ISO 14224:2016 Annex B"}'),
    ('FAULT_TYPE', 'OTH', 'Other',                                          false, true, '{"source":"ISO 14224:2016 Annex B"}'),
    ('FAULT_TYPE', 'PDE', 'Parameter deviation',                            false, true, '{"source":"ISO 14224:2016 Annex B"}'),
    ('FAULT_TYPE', 'PLU', 'Plugged / choked',                               false, true, '{"source":"ISO 14224:2016 Annex B"}'),
    ('FAULT_TYPE', 'SER', 'Minor in-service problems',                      false, true, '{"source":"ISO 14224:2016 Annex B"}'),
    ('FAULT_TYPE', 'SPO', 'Spurious operation',                             false, true, '{"source":"ISO 14224:2016 Annex B"}'),
    ('FAULT_TYPE', 'STD', 'Structural deficiency',                          false, true, '{"source":"ISO 14224:2016 Annex B"}'),
    ('FAULT_TYPE', 'STP', 'Fail to stop on demand',                         false, true, '{"source":"ISO 14224:2016 Annex B"}'),
    ('FAULT_TYPE', 'UNK', 'Unknown',                                        false, true, '{"source":"ISO 14224:2016 Annex B"}'),
    ('FAULT_TYPE', 'UST', 'Spurious stop',                                  false, true, '{"source":"ISO 14224:2016 Annex B"}'),
    ('FAULT_TYPE', 'VIB', 'Vibration',                                      false, true, '{"source":"ISO 14224:2016 Annex B"}')
ON CONFLICT (company_id, category, code) DO NOTHING;

-- ── 2. the seed registry ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.product_seed_rows (
    id         uuid PRIMARY KEY,
    table_name text NOT NULL,
    added_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.product_seed_rows ENABLE ROW LEVEL SECURITY;
-- no policies on purpose: service-role only

INSERT INTO public.product_seed_rows (id, table_name)
SELECT id, t FROM (
    SELECT id, 'audit_templates'          AS t FROM public.audit_templates          WHERE company_id = (SELECT id FROM public.companies WHERE active ORDER BY created_at LIMIT 1)
    UNION ALL SELECT id, 'audit_template_sections'  FROM public.audit_template_sections  WHERE company_id = (SELECT id FROM public.companies WHERE active ORDER BY created_at LIMIT 1)
    UNION ALL SELECT id, 'audit_template_questions' FROM public.audit_template_questions WHERE company_id = (SELECT id FROM public.companies WHERE active ORDER BY created_at LIMIT 1)
    UNION ALL SELECT id, 'notification_rules'       FROM public.notification_rules       WHERE company_id = (SELECT id FROM public.companies WHERE active ORDER BY created_at LIMIT 1)
    UNION ALL SELECT id, 'notification_channels'    FROM public.notification_channels    WHERE company_id = (SELECT id FROM public.companies WHERE active ORDER BY created_at LIMIT 1)
    UNION ALL SELECT id, 'message_templates'        FROM public.message_templates        WHERE company_id = (SELECT id FROM public.companies WHERE active ORDER BY created_at LIMIT 1)
) q
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.product_seed_rows IS
    'Which rows are the product''s per-tenant seed set — the id list provision_tenant() clones for a new tenant. Maintained by migration: a migration that adds seed content MUST insert its ids here, or self-serve signups stop receiving it. create-tenant.mjs independently extracts the same list from baseline/seed.sql; the signup edge function reads this table because it has no filesystem.';

-- ── 3. the throttle ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.signup_throttle (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ip         text NOT NULL,
    email      text,
    outcome    text NOT NULL DEFAULT 'attempt',
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_signup_throttle_recent ON public.signup_throttle (ip, created_at);
ALTER TABLE public.signup_throttle ENABLE ROW LEVEL SECURITY;
-- no policies on purpose: service-role only. Doubles as the signup audit log.

-- ── prove ───────────────────────────────────────────────────────────────────
DO $$
DECLARE n int; m int;
BEGIN
    SELECT count(*) INTO n FROM public.reference_codes WHERE category = 'FAULT_TYPE' AND company_id IS NULL;
    IF n < 30 THEN  -- 12 house + 26 ISO
        RAISE EXCEPTION 'FAULT_TYPE catalogue has % global rows — expected the house set plus the ISO set', n;
    END IF;
    SELECT count(*) INTO m FROM public.product_seed_rows;
    IF m < 100 THEN
        RAISE EXCEPTION 'product_seed_rows holds % ids — the seed registry did not populate', m;
    END IF;
    RAISE NOTICE 'catalogue: % global FAULT_TYPE rows; seed registry: % ids', n, m;
END $$;
