-- ════════════════════════════════════════════════════════════════════════════
-- 0280 — the narrow reference_codes key survived 0268; shadowing was broken
--
-- Found by the dictionary-manager E2E: inserting a tenant copy of the global
-- FAULT_TYPE/OTH — the exact thing "Customised" is for — returned 23505 on a
-- unique (category, code) WITHOUT company_id. 0268 ran
-- `DROP CONSTRAINT IF EXISTS reference_codes_category_code_key` and that
-- no-opped silently: the survivor is a BARE UNIQUE INDEX, not a constraint.
-- 0265 recorded this exact trap for task_library_items and uq_rag_source_chunk
-- ("two are bare unique INDEXes rather than constraints, so they drop
-- differently"); reference_codes had an index-shaped twin nobody counted.
--
-- Blast radius while it lived: ADDING new tenant codes worked (GBX proved
-- that), but SHADOWING any existing global — customising a standard entry, the
-- centrepiece of the 0267 model — failed with a duplicate-key error on
-- reference_codes only. dictionaries was genuinely fixed (0268's inline probe
-- covered it); manufacturers and tax_codes are audited here rather than
-- assumed.
--
-- Why every gate missed it: the 0266 uniqueness audits count keys on
-- TENANT-OWNED tables (the ones with an `id` + company_id in the operational
-- sense); the four config tables live outside that universe, and
-- verify-baseline faithfully mirrors whatever the origin has — including its
-- bugs. The fix is therefore DYNAMIC — drop every unique constraint or index
-- on the config tables that does not include company_id — and the proof is an
-- actual shadow insert, not a name check.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE r record; n int := 0;
BEGIN
    FOR r IN
        SELECT t.relname AS tbl, ic.relname AS idx, con.conname AS cons
        FROM pg_class t
        JOIN pg_namespace ns ON ns.oid = t.relnamespace
        JOIN pg_index i ON i.indrelid = t.oid AND i.indisunique AND NOT i.indisprimary
        JOIN pg_class ic ON ic.oid = i.indexrelid
        LEFT JOIN pg_constraint con ON con.conindid = i.indexrelid
        WHERE ns.nspname = 'public'
          AND t.relname IN ('dictionaries', 'reference_codes', 'manufacturers', 'tax_codes')
          AND NOT EXISTS (SELECT 1 FROM unnest(i.indkey) k
                            JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k
                           WHERE a.attname = 'company_id')
    LOOP
        IF r.cons IS NOT NULL THEN
            EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', r.tbl, r.cons);
        ELSE
            EXECUTE format('DROP INDEX public.%I', r.idx);
        END IF;
        RAISE NOTICE 'dropped narrow key %.% (%)', r.tbl, coalesce(r.cons, r.idx),
                     CASE WHEN r.cons IS NULL THEN 'bare index' ELSE 'constraint' END;
        n := n + 1;
    END LOOP;
    RAISE NOTICE '% narrow key(s) dropped', n;
END $$;

-- ── prove shadowing actually works now ──────────────────────────────────────
-- The failing operation itself, with an explicit tenant (sessionless
-- caller_company() is NULL, which would collide with the global on the wide
-- key): insert a copy of a known global, then remove it.
DO $$
DECLARE v_co uuid; v_id uuid; remaining int;
BEGIN
    SELECT id INTO v_co FROM public.companies WHERE active ORDER BY created_at LIMIT 1;

    INSERT INTO public.reference_codes (category, code, description, is_locked, active, company_id)
    VALUES ('FAULT_TYPE', 'OTH', '__0280_shadow_probe__', false, true, v_co)
    RETURNING id INTO v_id;
    DELETE FROM public.reference_codes WHERE id = v_id;

    -- and nothing narrow may remain on any of the four
    SELECT count(*) INTO remaining
    FROM pg_class t
    JOIN pg_namespace ns ON ns.oid = t.relnamespace
    JOIN pg_index i ON i.indrelid = t.oid AND i.indisunique AND NOT i.indisprimary
    WHERE ns.nspname = 'public'
      AND t.relname IN ('dictionaries', 'reference_codes', 'manufacturers', 'tax_codes')
      AND NOT EXISTS (SELECT 1 FROM unnest(i.indkey) k
                        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k
                       WHERE a.attname = 'company_id');
    IF remaining > 0 THEN
        RAISE EXCEPTION '% narrow unique key(s) still present on config tables', remaining;
    END IF;

    RAISE NOTICE 'shadow insert of a global succeeded and was cleaned up; 0 narrow keys remain';
END $$;
