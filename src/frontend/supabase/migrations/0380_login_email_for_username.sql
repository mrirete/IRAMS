-- 0380 — signing in with a username resolves to the address the login was registered under
--
-- WHAT WAS WRONG
--   Since the company-e-mail launch rule, Add Person registers the auth account
--   under the person's real e-mail. The Login page never learned that: a bare
--   username is still turned into <username>@cainergy.com, an address nobody
--   owns, so every person created since then fails to sign in by username and
--   sees "check your password" for a password that is correct.
--
-- WHAT THIS DOES
--   One small SECURITY DEFINER lookup, callable signed-out (the Login page has
--   no session yet): username in, login e-mail out, nothing else. Since 0361
--   anon cannot read public.users, and this does not change that — the function
--   exposes exactly one column for an exact, case-insensitive username match.
--
--   Trade-off, stated: given a valid username, this confirms the account
--   exists and returns its e-mail. That is what signing in by username costs;
--   the same fact was already derivable from the legacy @cainergy.com scheme.
--   Password checking stays with Supabase Auth.
--
-- SAFE TO RE-RUN.

BEGIN;

CREATE OR REPLACE FUNCTION public.login_email_for_username(p_username text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
    SELECT u.email
      FROM public.users u
     WHERE lower(u.username) = lower(trim(p_username))
       AND u.email IS NOT NULL
     LIMIT 1;
$$;

COMMENT ON FUNCTION public.login_email_for_username(text) IS
    'Login page helper (0380): the e-mail a username signs in with, or NULL. Exposes only that column, for an exact case-insensitive match. Password verification stays with Auth.';

REVOKE ALL ON FUNCTION public.login_email_for_username(text) FROM public;
GRANT EXECUTE ON FUNCTION public.login_email_for_username(text) TO anon, authenticated;

COMMIT;

-- VERIFY
--   SELECT public.login_email_for_username('Stan.test');   -- expect: the e-mail on the form
--   SELECT has_function_privilege('anon','public.login_email_for_username(text)','EXECUTE');  -- t
--   SELECT prosecdef, proconfig FROM pg_proc WHERE proname = 'login_email_for_username';   -- t, {search_path=public,pg_catalog}
