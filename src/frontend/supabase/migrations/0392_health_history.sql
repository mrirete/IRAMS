-- 0392 — Health and remaining-life history: a trend instead of one overwritten number.
--
-- WHY
-- ers_twin_states and ers_rul_estimates hold ONE row per asset, overwritten on
-- every Update twin. So Predict could not show how health moved, could not fit
-- a projection to anything but a fixed decay rate, and could not show whether
-- the remaining-life estimate is steady or jumping (ISO 13381-1 prognostics
-- rest on a condition history; ISO 17359 §8 reviews trends, not snapshots).
--
-- WHAT
--   ers_health_history — one row per asset × metric × UTC hour:
--     metric 'health_index' (from ers_twin_states) or 'rul_days' (from
--     ers_rul_estimates), value, basis (the RUL's distribution_type, or 'twin').
--   Two AFTER triggers copy every write of those tables into it, so history is
--   caught from every screen, the automatic run and any future job — the
--   screens do nothing new. Several writes in the same hour keep the latest
--   (ON CONFLICT … DO UPDATE), so a busy page cannot flood the table.
--   Read: tenant-scoped like the tables it copies. Write: the triggers only
--   (SECURITY DEFINER bound to NEW.company_id); no insert/update policy for users.
--   Backfill: one point per asset from today's twin / RUL rows, so every trend
--   starts with the value already on screen.
BEGIN;

CREATE TABLE IF NOT EXISTS public.ers_health_history (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id  UUID NOT NULL DEFAULT public.caller_company(),
    asset_id    UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
    metric      TEXT NOT NULL CHECK (metric IN ('health_index', 'rul_days')),
    value       NUMERIC(10, 2) NOT NULL,
    basis       TEXT,
    bucket      TIMESTAMP WITHOUT TIME ZONE NOT NULL,   -- UTC hour
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ers_health_history_one_per_hour UNIQUE (asset_id, metric, bucket)
);

CREATE INDEX IF NOT EXISTS idx_health_history_asset_metric_time
    ON public.ers_health_history (asset_id, metric, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_health_history_company ON public.ers_health_history (company_id);

COMMENT ON TABLE public.ers_health_history IS
    'Health index and RUL over time, one row per asset × metric × UTC hour (0392). Written only by triggers on ers_twin_states / ers_rul_estimates.';

ALTER TABLE public.ers_health_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_select_health_history" ON public.ers_health_history;
CREATE POLICY "tenant_select_health_history" ON public.ers_health_history
    FOR SELECT TO authenticated
    USING (company_id = (SELECT public.caller_company()));
REVOKE ALL ON public.ers_health_history FROM anon;
GRANT SELECT ON public.ers_health_history TO authenticated;

-- ── Triggers ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.health_history_from_twin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_at TIMESTAMPTZ := coalesce(NEW.updated_at, now());
BEGIN
    IF NEW.health_index IS NULL THEN RETURN NEW; END IF;
    INSERT INTO ers_health_history (company_id, asset_id, metric, value, basis, bucket, recorded_at)
    VALUES (NEW.company_id, NEW.asset_id, 'health_index', NEW.health_index, 'twin',
            date_trunc('hour', v_at AT TIME ZONE 'UTC'), v_at)
    ON CONFLICT (asset_id, metric, bucket)
    DO UPDATE SET value = EXCLUDED.value, basis = EXCLUDED.basis, recorded_at = EXCLUDED.recorded_at;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.health_history_from_rul()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_at TIMESTAMPTZ := coalesce(NEW.computed_at, NEW.created_at, now());
BEGIN
    IF NEW.rul_days IS NULL THEN RETURN NEW; END IF;
    INSERT INTO ers_health_history (company_id, asset_id, metric, value, basis, bucket, recorded_at)
    VALUES (NEW.company_id, NEW.asset_id, 'rul_days', NEW.rul_days, NEW.distribution_type,
            date_trunc('hour', v_at AT TIME ZONE 'UTC'), v_at)
    ON CONFLICT (asset_id, metric, bucket)
    DO UPDATE SET value = EXCLUDED.value, basis = EXCLUDED.basis, recorded_at = EXCLUDED.recorded_at;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.health_history_from_twin() FROM public;
REVOKE ALL ON FUNCTION public.health_history_from_rul() FROM public;

DROP TRIGGER IF EXISTS trg_health_history_from_twin ON public.ers_twin_states;
CREATE TRIGGER trg_health_history_from_twin
    AFTER INSERT OR UPDATE OF health_index, updated_at ON public.ers_twin_states
    FOR EACH ROW EXECUTE FUNCTION public.health_history_from_twin();

DROP TRIGGER IF EXISTS trg_health_history_from_rul ON public.ers_rul_estimates;
CREATE TRIGGER trg_health_history_from_rul
    AFTER INSERT OR UPDATE OF rul_days, computed_at ON public.ers_rul_estimates
    FOR EACH ROW EXECUTE FUNCTION public.health_history_from_rul();

-- ── Backfill: today's values become each trend's first point ────────────────
INSERT INTO public.ers_health_history (company_id, asset_id, metric, value, basis, bucket, recorded_at)
SELECT t.company_id, t.asset_id, 'health_index', t.health_index, 'twin',
       date_trunc('hour', coalesce(t.updated_at, t.created_at, now()) AT TIME ZONE 'UTC'),
       coalesce(t.updated_at, t.created_at, now())
  FROM public.ers_twin_states t
 WHERE t.health_index IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.assets a WHERE a.id = t.asset_id)
ON CONFLICT (asset_id, metric, bucket) DO NOTHING;

INSERT INTO public.ers_health_history (company_id, asset_id, metric, value, basis, bucket, recorded_at)
SELECT r.company_id, r.asset_id, 'rul_days', r.rul_days, r.distribution_type,
       date_trunc('hour', coalesce(r.computed_at, r.created_at, now()) AT TIME ZONE 'UTC'),
       coalesce(r.computed_at, r.created_at, now())
  FROM public.ers_rul_estimates r
 WHERE r.rul_days IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.assets a WHERE a.id = r.asset_id)
ON CONFLICT (asset_id, metric, bucket) DO NOTHING;

COMMIT;
