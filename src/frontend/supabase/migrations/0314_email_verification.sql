-- 0314_email_verification.sql
-- Self-serve signup: verify the admin's email before the first sign-in
-- (launch review LR-01, open item "signup email verification").
--
-- Model (mirrors the invite pattern of 0190, with hashed tokens):
--   signup-tenant creates the admin (create_auth_user confirms the email at
--   insert), then — when it can send mail — calls begin_email_verification
--   which UN-confirms the auth user and records a sha256 token hash. The raw
--   token goes out by email as {APP_URL}/verify-email?token=... . The page
--   calls complete_email_verification (anon-callable, token-gated), which
--   confirms the email again; GoTrue refuses password sign-in until then
--   ("Email not confirmed"). Resend = begin_email_verification without force:
--   it refuses to un-confirm an already-verified account.
--
-- Platform table (no company_id) like signup_throttle: service role and the
-- definer functions are the only readers/writers.

CREATE TABLE IF NOT EXISTS public.email_verifications (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    email       text        NOT NULL,
    token_hash  text        NOT NULL UNIQUE,
    expires_at  timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_verifications_user_idx ON public.email_verifications(user_id);
ALTER TABLE public.email_verifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_verifications FROM public, anon, authenticated;
COMMENT ON TABLE public.email_verifications IS
    'Platform table (0314): pending email-verification tokens (sha256 hex). No RLS policies on purpose — only the service role and the definer functions touch it.';

-- Start (or restart) verification for an auth user. Returns the user id, or
-- NULL when no such user exists or the account is already verified and
-- p_force is false. Service role only.
CREATE OR REPLACE FUNCTION public.begin_email_verification(
    p_email text, p_token_hash text, p_force boolean DEFAULT false, p_ttl interval DEFAULT interval '24 hours'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions AS $$
DECLARE
    v_user uuid;
    v_confirmed timestamptz;
BEGIN
    SELECT id, email_confirmed_at INTO v_user, v_confirmed
      FROM auth.users WHERE lower(email) = lower(p_email) LIMIT 1;
    IF v_user IS NULL THEN RETURN NULL; END IF;
    IF v_confirmed IS NOT NULL AND NOT p_force THEN RETURN NULL; END IF;

    UPDATE auth.users SET email_confirmed_at = NULL, updated_at = now() WHERE id = v_user;
    UPDATE public.email_verifications SET consumed_at = now()
     WHERE user_id = v_user AND consumed_at IS NULL;                 -- supersede older links
    INSERT INTO public.email_verifications (user_id, email, token_hash, expires_at)
    VALUES (v_user, lower(p_email), p_token_hash, now() + p_ttl);
    RETURN v_user;
END $$;
REVOKE ALL ON FUNCTION public.begin_email_verification(text, text, boolean, interval) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_email_verification(text, text, boolean, interval) TO service_role;

-- Consume a raw token: confirms the auth user and returns the verified email,
-- or NULL when the token is unknown, expired or already used. Callable
-- without a session (the verify page has none); the 256-bit token is the gate.
CREATE OR REPLACE FUNCTION public.complete_email_verification(p_token text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions AS $$
DECLARE
    v_hash text;
    v_row  public.email_verifications%ROWTYPE;
BEGIN
    IF p_token IS NULL OR length(p_token) < 32 THEN RETURN NULL; END IF;
    v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
    SELECT * INTO v_row FROM public.email_verifications
     WHERE token_hash = v_hash AND consumed_at IS NULL AND expires_at > now()
     FOR UPDATE;
    IF NOT FOUND THEN RETURN NULL; END IF;

    UPDATE public.email_verifications SET consumed_at = now() WHERE id = v_row.id;
    UPDATE auth.users SET email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now()
     WHERE id = v_row.user_id;
    RETURN v_row.email;
END $$;
REVOKE ALL ON FUNCTION public.complete_email_verification(text) FROM public;
GRANT EXECUTE ON FUNCTION public.complete_email_verification(text) TO anon, authenticated, service_role;

-- Housekeeping: expired or consumed tokens older than 30 days are noise.
CREATE OR REPLACE FUNCTION public.email_verifications_prune() RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    WITH d AS (DELETE FROM public.email_verifications
                WHERE (consumed_at IS NOT NULL OR expires_at < now()) AND created_at < now() - interval '30 days'
                RETURNING 1)
    SELECT count(*)::int FROM d;
$$;
REVOKE ALL ON FUNCTION public.email_verifications_prune() FROM public, anon, authenticated;

-- Prove the round trip on a throwaway auth user.
DO $$
DECLARE
    v uuid; v_tok text := encode(extensions.gen_random_bytes(32), 'hex'); v_hash text; got text; conf timestamptz;
BEGIN
    v := public.create_auth_user('__probe_0314__@internal.test', 'Probe-0314!xyz', '__probe_0314__', 'TECHNICIAN');
    v_hash := encode(extensions.digest(v_tok, 'sha256'), 'hex');
    IF public.begin_email_verification('__probe_0314__@internal.test', v_hash, true) IS NULL THEN
        RAISE EXCEPTION 'begin_email_verification returned NULL for a fresh user';
    END IF;
    SELECT email_confirmed_at INTO conf FROM auth.users WHERE id = v;
    IF conf IS NOT NULL THEN RAISE EXCEPTION 'user still confirmed after begin'; END IF;
    IF public.complete_email_verification('wrong-token-wrong-token-wrong-token') IS NOT NULL THEN
        RAISE EXCEPTION 'wrong token accepted';
    END IF;
    got := public.complete_email_verification(v_tok);
    IF got IS DISTINCT FROM '__probe_0314__@internal.test' THEN RAISE EXCEPTION 'complete returned %', got; END IF;
    SELECT email_confirmed_at INTO conf FROM auth.users WHERE id = v;
    IF conf IS NULL THEN RAISE EXCEPTION 'user not confirmed after complete'; END IF;
    IF public.complete_email_verification(v_tok) IS NOT NULL THEN RAISE EXCEPTION 'token replay accepted'; END IF;
    -- resend without force on a verified account must refuse
    IF public.begin_email_verification('__probe_0314__@internal.test', 'x' || v_hash, false) IS NOT NULL THEN
        RAISE EXCEPTION 'resend un-confirmed a verified account';
    END IF;
    DELETE FROM auth.users WHERE id = v;   -- identities + verifications cascade
    DELETE FROM public.users WHERE id = v;
    RAISE NOTICE 'email verification round trip verified';
END $$;
