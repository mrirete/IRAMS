-- ═══════════════════════════════════════════════════════════════
-- 0229 — Durable AI spend budget (per user, per day)
--
-- Before this, the only thing standing between a user and an unbounded
-- Gemini bill was an in-memory dict in the FastAPI proxy
-- (ers-ai/service.py: _rate_limits, 20 req/60s). It reset on every Railway
-- restart and was per-process, so it did nothing across replicas. The
-- agent-run Edge Function — where the live agents run — had no limit at all.
--
-- Enforcement moves into Postgres so both callers obey exactly one rule,
-- and so the counter survives restarts and is shared across every replica.
--
-- Two-phase by design: reserve a request slot BEFORE the model call (so a
-- burst can't slip through while N calls are in flight), then record the
-- actual tokens after. Token overshoot on the final call of a day is
-- accepted — the next reserve() is what refuses.
--
-- Note this is a *budget*, not the old per-minute rate limiter. The proxy
-- keeps its 60s burst limiter for abuse; this adds the daily ceiling that
-- actually bounds spend.
-- ═══════════════════════════════════════════════════════════════
BEGIN;

-- ── Policy: 'default' plus optional per-user overrides ──────────────────
CREATE TABLE IF NOT EXISTS ers_ai_budget_policy (
    id                   TEXT PRIMARY KEY,     -- 'default', or a user UUID as text
    max_requests_per_day INTEGER NOT NULL CHECK (max_requests_per_day > 0),
    max_tokens_per_day   BIGINT  NOT NULL CHECK (max_tokens_per_day > 0),
    note                 TEXT,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Opening ceiling. Sized off the estimator already in service.py (~4 chars
-- per token): a Specialist review round-trip is roughly 2–4k tokens, so
-- 400k/day is ~100–200 substantial reviews per person per day — generous for
-- real use, and a hard stop on a runaway loop. Tune in this table, not code.
INSERT INTO ers_ai_budget_policy (id, max_requests_per_day, max_tokens_per_day, note)
VALUES ('default', 250, 400000, 'Opening default — raise per user via a row keyed on their UUID.')
ON CONFLICT (id) DO NOTHING;

-- ── Counters: one row per user per UTC day ──────────────────────────────
CREATE TABLE IF NOT EXISTS ers_ai_usage_daily (
    user_id       UUID NOT NULL,
    usage_date    DATE NOT NULL,
    requests      INTEGER NOT NULL DEFAULT 0,
    tokens        BIGINT  NOT NULL DEFAULT 0,
    blocked       INTEGER NOT NULL DEFAULT 0,   -- refusals, so we can see who is hitting the wall
    first_call_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_call_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, usage_date)
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_daily_date ON ers_ai_usage_daily (usage_date DESC);

-- ── Reserve: called BEFORE the model call ───────────────────────────────
-- Atomic under concurrency: the row is locked FOR UPDATE, so two in-flight
-- requests cannot both read "one slot left" and both take it.
CREATE OR REPLACE FUNCTION public.ers_ai_budget_reserve(p_user_id UUID)
RETURNS TABLE (
    allowed        BOOLEAN,
    requests_today INTEGER,
    tokens_today   BIGINT,
    max_requests   INTEGER,
    max_tokens     BIGINT,
    reason         TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_today   DATE := (NOW() AT TIME ZONE 'UTC')::DATE;
    v_max_req INTEGER;
    v_max_tok BIGINT;
    v_req     INTEGER;
    v_tok     BIGINT;
BEGIN
    -- A row keyed on the user's UUID wins over 'default'.
    SELECT p.max_requests_per_day, p.max_tokens_per_day
      INTO v_max_req, v_max_tok
      FROM ers_ai_budget_policy p
     WHERE p.id IN (p_user_id::TEXT, 'default')
     ORDER BY (p.id = 'default')   -- FALSE (the user's own row) sorts first
     LIMIT 1;

    -- No policy at all = fail open. A missing config row must not take the
    -- product offline; the ceiling is a cost guard, not a security control.
    IF v_max_req IS NULL THEN
        RETURN QUERY SELECT TRUE, 0, 0::BIGINT, 0, 0::BIGINT, 'no budget policy configured'::TEXT;
        RETURN;
    END IF;

    -- DO UPDATE rather than DO NOTHING: it always returns the row AND locks it
    -- for the rest of this transaction, which is what serialises the check and
    -- the increment below. DO NOTHING can leave a concurrently-inserted row
    -- invisible to our snapshot, which would read as "no usage yet".
    INSERT INTO ers_ai_usage_daily (user_id, usage_date)
    VALUES (p_user_id, v_today)
    ON CONFLICT (user_id, usage_date)
      DO UPDATE SET last_call_at = NOW()
    RETURNING requests, tokens INTO v_req, v_tok;

    IF v_req >= v_max_req THEN
        UPDATE ers_ai_usage_daily u SET blocked = u.blocked + 1
         WHERE u.user_id = p_user_id AND u.usage_date = v_today;
        RETURN QUERY SELECT FALSE, v_req, v_tok, v_max_req, v_max_tok,
            format('daily AI request limit reached (%s requests)', v_max_req);
        RETURN;
    END IF;

    IF v_tok >= v_max_tok THEN
        UPDATE ers_ai_usage_daily u SET blocked = u.blocked + 1
         WHERE u.user_id = p_user_id AND u.usage_date = v_today;
        RETURN QUERY SELECT FALSE, v_req, v_tok, v_max_req, v_max_tok,
            format('daily AI token budget reached (%s tokens)', v_max_tok);
        RETURN;
    END IF;

    UPDATE ers_ai_usage_daily u
       SET requests = u.requests + 1, last_call_at = NOW()
     WHERE u.user_id = p_user_id AND u.usage_date = v_today
     RETURNING u.requests, u.tokens INTO v_req, v_tok;

    RETURN QUERY SELECT TRUE, v_req, v_tok, v_max_req, v_max_tok, NULL::TEXT;
END;
$$;

-- ── Record: called AFTER the model call, with the real token count ──────
CREATE OR REPLACE FUNCTION public.ers_ai_budget_record(p_user_id UUID, p_tokens INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    UPDATE ers_ai_usage_daily u
       SET tokens = u.tokens + GREATEST(COALESCE(p_tokens, 0), 0),
           last_call_at = NOW()
     WHERE u.user_id = p_user_id
       AND u.usage_date = (NOW() AT TIME ZONE 'UTC')::DATE;
END;
$$;

-- ── Status: what the signed-in user has left today (for a UI meter) ─────
CREATE OR REPLACE FUNCTION public.ers_ai_budget_status()
RETURNS TABLE (
    requests_today INTEGER,
    tokens_today   BIGINT,
    max_requests   INTEGER,
    max_tokens     BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid     UUID := auth.uid();
    v_max_req INTEGER;
    v_max_tok BIGINT;
BEGIN
    IF v_uid IS NULL THEN RETURN; END IF;

    SELECT p.max_requests_per_day, p.max_tokens_per_day
      INTO v_max_req, v_max_tok
      FROM ers_ai_budget_policy p
     WHERE p.id IN (v_uid::TEXT, 'default')
     ORDER BY (p.id = 'default')
     LIMIT 1;

    RETURN QUERY
    SELECT COALESCE(u.requests, 0),
           COALESCE(u.tokens, 0::BIGINT),
           v_max_req,
           v_max_tok
      FROM (SELECT 1) _
      LEFT JOIN ers_ai_usage_daily u
             ON u.user_id = v_uid AND u.usage_date = (NOW() AT TIME ZONE 'UTC')::DATE;
END;
$$;

-- ── Access ──────────────────────────────────────────────────────────────
-- reserve/record are server-side only: they are the enforcement, and a client
-- that could call record() directly could also drain someone's budget.
REVOKE ALL ON FUNCTION public.ers_ai_budget_reserve(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ers_ai_budget_record(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ers_ai_budget_reserve(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.ers_ai_budget_record(UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.ers_ai_budget_status() TO authenticated;

-- Tables are reachable only through the functions above (service_role bypasses
-- RLS); admins keep read access for a spend dashboard.
ALTER TABLE ers_ai_usage_daily    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ers_ai_budget_policy  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_select_ai_usage_daily   ON ers_ai_usage_daily;
DROP POLICY IF EXISTS admin_select_ai_budget_policy ON ers_ai_budget_policy;
DROP POLICY IF EXISTS admin_write_ai_budget_policy  ON ers_ai_budget_policy;

CREATE POLICY admin_select_ai_usage_daily ON ers_ai_usage_daily
    FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY admin_select_ai_budget_policy ON ers_ai_budget_policy
    FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY admin_write_ai_budget_policy ON ers_ai_budget_policy
    FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

COMMIT;
