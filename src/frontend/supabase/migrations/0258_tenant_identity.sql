-- ════════════════════════════════════════════════════════════════════════════
-- 0258 — Tenancy Phase 0: give a request a tenant
--
-- Nothing consumes this yet, on purpose. The mechanism lands and is proved
-- against real tokens BEFORE any policy depends on it, so a mistake here is a
-- failing gate rather than an app that will not load. Same shape as 0241, which
-- landed caller_can() inert and caught a real semantics bug at its gate.
--
-- Today there is no path from a logged-in user to their tenant at all:
--   • public.users has no company link
--   • assets.company_id exists and is NULL on 69/69 rows — added, never used
--   • the contact → organization_unit → company chain is intact at org level
--     (10/10 units) but broken at person level (1 of 11 contacts is linked)
--
-- ── Why the claim, not a lookup ─────────────────────────────────────────────
-- Tenancy will be a predicate on EVERY table, evaluated on every statement.
-- 0243 measured what a table-touching function costs in that position:
-- is_admin() bare 3,013 ms vs 20 ms wrapped, on 200k rows. Reading a JWT claim
-- touches no table at all — it is the cheapest predicate available, and the one
-- that has to be cheapest.
--
-- users.company_id stays the source of truth; the claim is a cache the auth
-- hook refreshes whenever a token is minted.
--
-- ── Deliberately NO fallback ────────────────────────────────────────────────
-- caller_company() does not fall back to a table lookup when the claim is
-- missing. A fallback would fire for every row of every query for anyone
-- holding a pre-hook token — a silent performance cliff, exactly the class 0243
-- was about. Missing claim → NULL → denied. Fail-closed and fast.
--
-- Consequence to know: enabling the hook does not retro-fit existing sessions.
-- Tokens minted before it resolve to NULL. That is harmless now (nothing reads
-- this function) and must be true again before Phase 2 — by then the hook will
-- have been live long enough for every session to have turned over.
-- ════════════════════════════════════════════════════════════════════════════

-- ── The column ──────────────────────────────────────────────────────────────
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);

CREATE INDEX IF NOT EXISTS idx_users_company_id ON public.users (company_id);

COMMENT ON COLUMN public.users.company_id IS
    'The tenant this user belongs to. Source of truth; mirrored into the JWT as app_metadata.company_id by custom_access_token_hook (0258).';

-- Backfill: one company exists, so every current user belongs to it. Written as
-- a lookup rather than a literal so this is correct on a freshly provisioned
-- project too, where the id differs.
UPDATE public.users u
   SET company_id = (
       SELECT c.id FROM public.companies c
        WHERE c.active IS TRUE
        ORDER BY c.created_at ASC
        LIMIT 1
   )
 WHERE u.company_id IS NULL;

-- ── Who is the caller's tenant? ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.caller_company()
RETURNS uuid
LANGUAGE sql STABLE
SET search_path = public
AS $$
    SELECT nullif(auth.jwt() -> 'app_metadata' ->> 'company_id', '')::uuid
$$;

COMMENT ON FUNCTION public.caller_company() IS
    'The caller''s tenant, read from the JWT app_metadata claim — no table touched. In RLS ALWAYS wrap: USING (company_id = (SELECT public.caller_company())). Returns NULL when the claim is absent, which must deny (fail-closed). No table fallback on purpose (0258).';

REVOKE ALL ON FUNCTION public.caller_company() FROM public;
GRANT EXECUTE ON FUNCTION public.caller_company() TO authenticated;

-- ── The hook that mints the claim ───────────────────────────────────────────
-- Supabase calls this whenever an access token is issued. It receives the event
-- (user_id + claims) and returns it with claims modified.
--
-- SECURITY DEFINER so the auth admin role does not need SELECT on public.users
-- — it runs as the owner and reads the row itself.
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company uuid;
    v_claims  jsonb;
BEGIN
    SELECT u.company_id INTO v_company
      FROM public.users u
     WHERE u.id = (event ->> 'user_id')::uuid;

    v_claims := coalesce(event -> 'claims', '{}'::jsonb);

    IF v_company IS NOT NULL THEN
        -- app_metadata may be absent on a fresh claim set; create it first.
        IF v_claims -> 'app_metadata' IS NULL THEN
            v_claims := jsonb_set(v_claims, '{app_metadata}', '{}'::jsonb);
        END IF;
        v_claims := jsonb_set(v_claims, '{app_metadata,company_id}', to_jsonb(v_company::text));
    END IF;

    RETURN jsonb_set(event, '{claims}', v_claims);
END;
$$;

COMMENT ON FUNCTION public.custom_access_token_hook(jsonb) IS
    'Supabase custom access token hook — copies users.company_id into app_metadata.company_id so caller_company() can read the tenant without touching a table (0258). Must stay registered in Auth settings; if it is disabled, new tokens carry no tenant and every tenant-scoped policy denies.';

-- The auth admin invokes the hook; nobody else should be able to.
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, public;
