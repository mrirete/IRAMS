-- 0375 — rolling back an import is one transaction, and it says what it will destroy
--
-- WHAT WAS WRONG
--   rollbackBatch() ran six-plus statements from the browser with no transaction
--   around them. It deleted the batch's work orders FIRST and unconditionally,
--   then tried the assets. When an asset was refused — and one reading is enough
--   to refuse it — the orders were already gone, the assets stayed, and the batch
--   still read 'committed'. Half a rollback, and no way to tell from the record
--   which half.
--
--   Reviewing that client code against the schema turned up something worse. It
--   checked four possible blockers. There are six NO ACTION references onto
--   assets — parent_id, functional_location_id, reading_logs, reading_definitions,
--   service_requests, work_orders — plus equipment_installations. A batch blocked
--   by a maintenance request or a functional-location reference was reported with
--   the generic "refused by a reference outside this batch", naming nothing.
--
--   And the reverse. Roughly thirty tables CASCADE from assets. Deleting an
--   imported asset silently takes its criticality assessment, RCA investigations,
--   FMEA and SMEA worksheets, RBI assessments, inspections, CMLs, warranties,
--   LOTO permits, BOM and financials with it. "Roll back this import" reads like
--   undo. It can destroy months of engineering done ON the imported assets, and
--   nothing said so.
--
-- WHAT THIS DOES
--   One SECURITY DEFINER function, one transaction, all or nothing.
--
--   Blockers are computed BEFORE anything is deleted. If the batch cannot be
--   removed completely, nothing is removed at all and the caller gets a reason
--   per asset. A partial rollback is not a state anyone can reason about, so it
--   is not a state this produces.
--
--   Collateral is counted and returned either way, so a confirmation can say
--   "this also deletes 2 RCA investigations" before the engineer agrees rather
--   than after.
--
--   p_dry_run = true computes both and changes nothing. The UI uses it to build
--   the confirmation.
--
-- SAFE TO RE-RUN.

BEGIN;

CREATE OR REPLACE FUNCTION public.rollback_import_batch(
    p_batch_id uuid,
    p_dry_run  boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
    v_company    uuid;
    v_batch      record;
    v_blockers   jsonb := '[]'::jsonb;
    v_collateral jsonb := '{}'::jsonb;
    v_wo_count   bigint := 0;
    v_asset_count bigint := 0;
    v_deleted    bigint := 0;
    v_pass       int;
    v_removed    bigint;
    v_tbl        text;
    v_n          bigint;
    -- CASCADE children that represent human work rather than derived data.
    -- Telemetry (sensor readings, rollups, twin states, prediction alerts) is
    -- regenerable and deliberately not listed — it would drown the real warning.
    c_work_tables text[] := ARRAY[
        'asset_bom', 'warranties', 'asset_financials', 'asset_insurance',
        'ers_criticality_assessments', 'ers_rca_investigations',
        'ers_fmea_worksheets', 'ers_smea_worksheets', 'ers_rbi_assessments',
        'ers_ffs_assessments', 'ers_inspections', 'ers_cmls', 'loto_permits'
    ];
BEGIN
    -- ── Guard ────────────────────────────────────────────────────────────────
    -- SECURITY DEFINER bypasses RLS, so the tenant check is made here by hand.
    v_company := public.caller_company();
    IF v_company IS NULL THEN
        RAISE EXCEPTION 'No tenant on this session' USING ERRCODE = '42501';
    END IF;
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Rolling back an import is an administrator action' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_batch FROM import_batches
     WHERE id = p_batch_id AND company_id = v_company;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Import batch not found in this workspace' USING ERRCODE = 'P0002';
    END IF;

    -- ── Blockers: every NO ACTION reference from OUTSIDE the batch ───────────
    --
    -- Deliberately not temp tables. A temp table created inside a function lives
    -- until commit, so a second call in the same transaction would fail on
    -- "relation already exists". Everything below reads the batch directly.
    SELECT coalesce(jsonb_agg(jsonb_build_object('tag', tag, 'reason', reason) ORDER BY tag), '[]'::jsonb)
      INTO v_blockers
      FROM (
        SELECT coalesce(b.tag, b.id::text) AS tag,
               string_agg(x.why, ', ' ORDER BY x.why) AS reason
          FROM assets b
          CROSS JOIN LATERAL (
              SELECT 'child asset still present' AS why
               WHERE EXISTS (SELECT 1 FROM assets c
                              WHERE c.parent_id = b.id
                                AND c.import_batch_id IS DISTINCT FROM p_batch_id)
              UNION ALL
              SELECT 'used as a functional location'
               WHERE EXISTS (SELECT 1 FROM assets c
                              WHERE c.functional_location_id = b.id
                                AND c.import_batch_id IS DISTINCT FROM p_batch_id)
              UNION ALL
              SELECT 'has ' || count(*) || ' reading' || CASE WHEN count(*) = 1 THEN '' ELSE 's' END
                FROM reading_logs r WHERE r.asset_id = b.id HAVING count(*) > 0
              UNION ALL
              SELECT 'has ' || count(*) || ' reading point' || CASE WHEN count(*) = 1 THEN '' ELSE 's' END
                FROM reading_definitions rd WHERE rd.asset_id = b.id HAVING count(*) > 0
              UNION ALL
              SELECT 'has ' || count(*) || ' maintenance request' || CASE WHEN count(*) = 1 THEN '' ELSE 's' END
                FROM service_requests sr WHERE sr.asset_id = b.id HAVING count(*) > 0
              UNION ALL
              SELECT 'has ' || count(*) || ' work order' || CASE WHEN count(*) = 1 THEN '' ELSE 's' END || ' from outside this import'
                FROM work_orders w WHERE w.asset_id = b.id
                  AND w.import_batch_id IS DISTINCT FROM p_batch_id HAVING count(*) > 0
              UNION ALL
              SELECT 'is an installation location'
               WHERE EXISTS (SELECT 1 FROM equipment_installations e WHERE e.functional_location_id = b.id)
          ) x
         WHERE b.import_batch_id = p_batch_id
         GROUP BY coalesce(b.tag, b.id::text)
      ) q;

    -- ── Collateral: CASCADE children that are somebody's work ───────────────
    FOREACH v_tbl IN ARRAY c_work_tables LOOP
        IF EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = v_tbl AND column_name = 'asset_id') THEN
            EXECUTE format(
                'SELECT count(*) FROM public.%I t JOIN public.assets a ON a.id = t.asset_id'
                || ' WHERE a.import_batch_id = $1', v_tbl)
              INTO v_n USING p_batch_id;
            IF v_n > 0 THEN
                v_collateral := v_collateral || jsonb_build_object(v_tbl, v_n);
            END IF;
        END IF;
    END LOOP;

    SELECT count(*) INTO v_wo_count    FROM work_orders WHERE import_batch_id = p_batch_id;
    SELECT count(*) INTO v_asset_count FROM assets      WHERE import_batch_id = p_batch_id;

    -- ── Decide ───────────────────────────────────────────────────────────────
    IF p_dry_run OR jsonb_array_length(v_blockers) > 0 THEN
        RETURN jsonb_build_object(
            'ok',                    jsonb_array_length(v_blockers) = 0,
            'dry_run',               p_dry_run,
            'work_orders_to_delete', v_wo_count,
            'assets_to_delete',      v_asset_count,
            'work_orders_deleted',   0,
            'assets_deleted',        0,
            'blockers',              v_blockers,
            'collateral',            v_collateral
        );
    END IF;

    -- ── Remove, leaf-first. Nothing outside the batch points at these. ──────
    DELETE FROM work_orders WHERE import_batch_id = p_batch_id;
    GET DIAGNOSTICS v_wo_count = ROW_COUNT;

    -- Each pass removes the assets that are currently leaves; the next pass
    -- sees the ones they were holding up. 64 is far beyond any real hierarchy.
    FOR v_pass IN 1..64 LOOP
        DELETE FROM assets a
         WHERE a.import_batch_id = p_batch_id
           AND NOT EXISTS (SELECT 1 FROM assets c WHERE c.parent_id = a.id)
           AND NOT EXISTS (SELECT 1 FROM assets c WHERE c.functional_location_id = a.id);
        GET DIAGNOSTICS v_removed = ROW_COUNT;
        v_deleted := v_deleted + v_removed;
        EXIT WHEN v_removed = 0;
    END LOOP;

    -- Rows left with no blocker to explain them means a parent cycle. Refuse the
    -- whole transaction rather than report a rollback that did not happen.
    IF EXISTS (SELECT 1 FROM assets WHERE import_batch_id = p_batch_id) THEN
        RAISE EXCEPTION 'Rollback left assets behind with no external reference — the batch may contain a parent cycle'
            USING ERRCODE = '55000';
    END IF;

    UPDATE import_batches
       SET status = 'rolled_back',
           notes  = concat_ws(' ', notes,
                    'Rolled back ' || to_char(now(), 'YYYY-MM-DD HH24:MI') ||
                    ': ' || v_deleted || ' asset(s), ' || v_wo_count || ' work order(s).')
     WHERE id = p_batch_id;

    RETURN jsonb_build_object(
        'ok', true, 'dry_run', false,
        'work_orders_to_delete', v_wo_count, 'assets_to_delete', v_deleted,
        'work_orders_deleted',   v_wo_count, 'assets_deleted',   v_deleted,
        'blockers', '[]'::jsonb, 'collateral', v_collateral
    );
END;
$$;

COMMENT ON FUNCTION public.rollback_import_batch(uuid, boolean) IS
    'Removes everything an import batch created, in one transaction, all or nothing (0375). Computes blockers before deleting and returns them instead of leaving a half-rollback. Also returns a count of CASCADE children that represent human work (RCA, FMEA, RBI, inspections, warranties…) so the caller can warn before destroying them. p_dry_run changes nothing.';

REVOKE ALL ON FUNCTION public.rollback_import_batch(uuid, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rollback_import_batch(uuid, boolean) TO authenticated;

COMMIT;

-- VERIFY
--   SELECT public.rollback_import_batch('<batch id>', true);   -- dry run, changes nothing
--   -- expect: ok true/false, blockers [] or a reason per asset, collateral counts
--   SELECT prosecdef, proconfig FROM pg_proc WHERE proname = 'rollback_import_batch';
--   -- expect: t, {search_path=public,pg_catalog}
--   SELECT has_function_privilege('anon','public.rollback_import_batch(uuid,boolean)','EXECUTE');
--   -- expect: f
