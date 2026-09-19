-- 0374 — ingest keys can expire
--
-- WHAT WAS WRONG
--   ers_collector_keys (0236) has `is_active` and nothing else. A key minted for
--   a three-week commissioning trial, a contractor's gateway or a one-off
--   migration stayed valid until somebody remembered to go and revoke it by
--   hand. Nobody remembers. The Admin › API keys screen offered mint and revoke
--   and no way to say "this should stop working on its own", which is the normal
--   way a credential of this kind is issued.
--
--   The key is a bearer credential for two public ingest endpoints. An
--   indefinite one is the kind of finding an assessor writes up.
--
-- WHAT THIS DOES
--   Adds a NULLABLE expires_at. NULL keeps today's behaviour exactly — a key
--   that does not expire — so every existing key is unaffected and nothing has
--   to be re-issued. Callers that set a date get a key that stops working on
--   its own.
--
--   Enforcement is in the two edge functions, which add
--   `or(expires_at.is.null,expires_at.gt.<now>)` to the key lookup. The view
--   below is the same rule expressed once in SQL so the UI and any future
--   consumer cannot drift from it.
--
-- SAFE TO RE-RUN.

BEGIN;

ALTER TABLE public.ers_collector_keys
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

COMMENT ON COLUMN public.ers_collector_keys.expires_at IS
    'When this key stops being accepted. NULL = never expires (the pre-0374 behaviour). Enforced in ingest-readings and ingest-work-orders alongside is_active.';

-- Partial index: the ingest path filters on hash first, but the admin list and
-- any expiry sweep scan by date, and only dated keys are interesting.
CREATE INDEX IF NOT EXISTS ers_collector_keys_expires_at_idx
    ON public.ers_collector_keys (expires_at)
    WHERE expires_at IS NOT NULL;

-- One definition of "usable", so the UI badge and the ingest check agree.
CREATE OR REPLACE VIEW public.ers_collector_keys_status AS
SELECT
    k.*,
    (k.is_active AND (k.expires_at IS NULL OR k.expires_at > now())) AS is_usable,
    CASE
        WHEN NOT k.is_active                                   THEN 'revoked'
        WHEN k.expires_at IS NOT NULL AND k.expires_at <= now() THEN 'expired'
        WHEN k.expires_at IS NOT NULL AND k.expires_at <= now() + interval '7 days' THEN 'expiring'
        ELSE 'active'
    END AS usability
FROM public.ers_collector_keys k;

COMMENT ON VIEW public.ers_collector_keys_status IS
    'ers_collector_keys plus a derived usability state (active / expiring / expired / revoked). The single definition of whether a key still works (0374).';

-- The view runs as its caller, so the table's own admin-only policy applies and
-- this adds no new read path.
ALTER VIEW public.ers_collector_keys_status SET (security_invoker = true);

GRANT SELECT ON public.ers_collector_keys_status TO authenticated;

COMMIT;

-- VERIFY
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'ers_collector_keys' AND column_name = 'expires_at';   -- 1 row
--   SELECT usability, count(*) FROM public.ers_collector_keys_status GROUP BY 1;
--   -- existing keys: all 'active' (expires_at NULL), nothing re-issued
