-- ════════════════════════════════════════════════════════════════════════════
-- 0266 — Tenancy Phase 4a, contract half: the narrow keys go
--
-- 0265 added (company_id, …) alongside three narrow keys rather than replacing
-- them, because the deployed frontend inferred ON CONFLICT against the narrow
-- ones and would have started failing the moment they changed shape.
--
--     cost_centers          onConflict 'code'  →  'company_id,code'
--     jsa_templates         onConflict 'name'  →  'company_id,name'   (×2)
--     notification_channels onConflict 'type'  →  'company_id,type'
--
-- The frontend carrying the new targets is deployed and verified live — the
-- new strings are present in the served bundle and the old bare ones are gone.
-- So the narrow keys have nothing left depending on them.
--
-- Until this runs, tenancy is only HALF done for these three: the narrow key
-- still forbids two customers from both having a cost centre called CC-MNT-01.
--
-- ── The order this had to happen in ─────────────────────────────────────────
-- expand (0265) → deploy → contract (0266). Not because it is tidy, but
-- because migrating before deploying broke this app twice in this workstream:
-- error logging died for non-admins, and FinancialsTab rendered empty. Both
-- times the migration was correct and the running code was not ready for it.
-- ════════════════════════════════════════════════════════════════════════════

-- Guard: refuse to drop the narrow keys if the widened ones are not actually
-- there. Dropping both would leave these tables with no uniqueness at all, and
-- duplicate cost centre codes are far worse than a failed migration.
DO $$
DECLARE missing text;
BEGIN
    SELECT string_agg(x.name, ', ') INTO missing
      FROM (VALUES
        ('uq_cost_centers_company_code'),
        ('uq_jsa_templates_company_name'),
        ('uq_notification_channels_company_type')
      ) AS x(name)
     WHERE NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conname = x.name);

    IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'widened key(s) absent: % — 0265 did not complete, refusing to drop the narrow keys', missing;
    END IF;
END $$;

ALTER TABLE public.cost_centers          DROP CONSTRAINT IF EXISTS cost_centers_code_key;
ALTER TABLE public.jsa_templates         DROP CONSTRAINT IF EXISTS jsa_templates_name_key;
ALTER TABLE public.notification_channels DROP CONSTRAINT IF EXISTS notification_channels_type_key;

-- ── Prove the end state ─────────────────────────────────────────────────────
-- 18 narrow keys should remain, and every one should be deliberate: 15 in
-- class B (unique through a tenant-scoped uuid parent) and 3 in class C
-- (secrets that must stay globally unique — invite_token, key_hash, token).
DO $$
DECLARE
    remaining int;
    leftovers text;
BEGIN
    SELECT count(*), string_agg(DISTINCT t.relname, ', ')
      INTO remaining, leftovers
      FROM pg_index i
      JOIN pg_class t     ON t.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public' AND i.indisunique AND NOT i.indisprimary
       AND t.relname NOT IN ('users', 'companies')
       AND EXISTS (SELECT 1 FROM information_schema.columns c
                    WHERE c.table_schema = 'public' AND c.table_name = t.relname
                      AND c.column_name = 'company_id')
       AND NOT EXISTS (SELECT 1 FROM unnest(i.indkey) k
                         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k
                        WHERE a.attname = 'company_id');

    RAISE NOTICE 'narrow unique keys remaining: % (%)', remaining, leftovers;

    IF remaining <> 18 THEN
        RAISE EXCEPTION 'expected 18 (15 parent-scoped + 3 secrets), found % — re-classify before trusting this', remaining;
    END IF;
END $$;

COMMENT ON CONSTRAINT uq_cost_centers_company_code ON public.cost_centers IS
    'Tenant-scoped cost centre code. The narrow cost_centers_code_key was dropped by 0266 once the frontend upsert moved to onConflict company_id,code.';
