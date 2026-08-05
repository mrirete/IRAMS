-- ════════════════════════════════════════════════════════════════════════════
-- 0272 — create_auth_user: the guard learns who it is actually guarding against
--
-- 0181's guard is `IF NOT public.is_admin()`. is_admin() is fail-closed: with
-- no JWT it returns false. Correct for every request that arrives through
-- PostgREST — and it just blocked tenant provisioning, which runs over the
-- Management API as postgres, a context with no JWT at all.
--
-- Think about what the guard is FOR. It stops a signed-in non-admin from
-- minting accounts. It cannot stop a superuser: postgres can INSERT INTO
-- auth.users directly, guard or no guard. So refusing the sessionless context
-- protects nothing — it only forces provisioning scripts to either reimplement
-- the auth-user insert (two copies of GoTrue's row shape to keep in sync) or
-- impersonate an admin via request.jwt.claims (an auth bypass hidden in a
-- script instead of a rule stated in the schema).
--
-- New rule, stated where it belongs:
--   • a REQUEST context (auth.uid() present) must be an admin — unchanged
--   • a SESSIONLESS context (no auth.uid) is the DBA/migration path — allowed,
--     because it could already do everything this function does
--
-- The anon key cannot reach the sessionless branch: anon requests still carry
-- a JWT with no sub → auth.uid() IS NULL… careful. Verified below: PostgREST
-- exposes functions to `anon` only if granted EXECUTE, and create_auth_user
-- has no grant to anon. Belt and braces, the function is revoked from anon
-- explicitly here — the sessionless branch is reachable only by roles that
-- bypass PostgREST entirely.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE def text;
BEGIN
    SELECT pg_get_functiondef(p.oid) INTO def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'create_auth_user';

    -- Surgical: replace the guard clause, keep the body 0182 shipped. A full
    -- CREATE OR REPLACE transcribed by hand is how function bodies drift.
    IF def NOT LIKE '%Not authorized: administrators only%' THEN
        RAISE EXCEPTION 'create_auth_user guard text not found — the function changed, update 0272';
    END IF;

    def := replace(def,
        'IF NOT public.is_admin() THEN',
        'IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN');

    EXECUTE def;
END $$;

-- Belt and braces: PostgREST must never route anon/authenticated callers here
-- except through the admin path the app already uses.
REVOKE ALL ON FUNCTION public.create_auth_user(text, text, text, text, uuid) FROM public, anon;

COMMENT ON FUNCTION public.create_auth_user(text, text, text, text, uuid) IS
    'Provisions an auth user + linked public.users row (0141/0181/0182). Request contexts require an admin; a sessionless DBA context (no auth.uid) is allowed since 0272 — it could already write auth.users directly, and blocking it only pushed provisioning scripts toward claim-impersonation hacks.';

-- Prove both directions of the new rule.
DO $$
DECLARE v uuid;
BEGIN
    -- Sessionless (this migration itself): must be allowed.
    v := public.create_auth_user('__probe_0272__@internal.test', 'Probe-0272!x', '__probe_0272__', 'TECHNICIAN');
    DELETE FROM auth.users   WHERE id = v;        -- identities cascade
    DELETE FROM public.users WHERE id = v;

    -- Request context without admin: must still refuse. Simulated the way
    -- PostgREST presents it — a claims blob whose sub is a real non-admin.
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub', (SELECT id FROM public.users WHERE email = 'bea@cainergy.com'))::text,
        true);
    BEGIN
        PERFORM public.create_auth_user('__probe2_0272__@internal.test', 'Probe-0272!x', '__probe2_0272__', 'TECHNICIAN');
        RAISE EXCEPTION 'guard FAILED: a non-admin request context provisioned a user';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM NOT LIKE '%administrators only%' THEN RAISE; END IF;
    END;
    PERFORM set_config('request.jwt.claims', NULL, true);

    RAISE NOTICE 'guard verified: sessionless allowed, non-admin request refused';
END $$;
