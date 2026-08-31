-- ============================================================================
-- 0303 — Reliability engineers may run history imports (RF-01 item 11, the
--         "middle path" ruling)
--
-- On the reliability tier, the person who lives on imported data is the RE —
-- and the recurring rhythm (quarterly history refresh, failure-code catalog
-- updates, delta files where the Sync API isn't wired) shouldn't require an
-- admin. The wizard route was never the lock (module-gated, not role-gated);
-- import_batches RLS was.
--
-- The ruling, deliberately partial:
--   • CREATE/UPDATE batches: admin OR caller_can('reliability','create') —
--     the matrix's own predicate (role + per-user overrides, fail-closed),
--     which today grants exactly RELIABILITY_ENG beyond the admins.
--   • DELETE (= batch rollback deleting work orders/assets) stays ADMIN-ONLY:
--     bulk deletion remains the governance line (0186 posture). An RE who
--     needs an undo calls the admin — the batch makes that a one-click favor.
--   • The Migration Center's structural imports (register, catalogs) keep
--     their admin page gate — master data governed, transactional history
--     refreshable. The SAP separation plants expect.
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS admin_insert_import_batches ON public.import_batches;
CREATE POLICY admin_insert_import_batches ON public.import_batches
    FOR INSERT TO authenticated
    WITH CHECK (
        company_id = (SELECT public.caller_company())
        AND ((SELECT public.is_admin()) OR public.caller_can('reliability', 'create'))
    );

DROP POLICY IF EXISTS admin_update_import_batches ON public.import_batches;
CREATE POLICY admin_update_import_batches ON public.import_batches
    FOR UPDATE TO authenticated
    USING (
        company_id = (SELECT public.caller_company())
        AND ((SELECT public.is_admin()) OR public.caller_can('reliability', 'create'))
    )
    WITH CHECK (
        company_id = (SELECT public.caller_company())
        AND ((SELECT public.is_admin()) OR public.caller_can('reliability', 'create'))
    );

-- DELETE policy deliberately untouched: rollback stays admin-only.

COMMENT ON TABLE public.import_batches IS
    'CMMS import batches (wizard + sync API). Reads: tenant. Create/update: admin or reliability.create (0303 — REs run history refreshes). Delete/rollback: admin only — bulk deletion is the governance line.';

COMMIT;

-- VERIFY (after apply):
--   SELECT policyname, cmd, with_check FROM pg_policies WHERE tablename='import_batches';
--   -- as a RELIABILITY_ENG session: INSERT INTO import_batches (source_system, file_name)
--   --   VALUES ('spreadsheet','rls-smoke') RETURNING id;   -- succeeds; DELETE fails
