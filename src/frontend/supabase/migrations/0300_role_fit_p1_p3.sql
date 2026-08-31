-- ============================================================================
-- 0300 — Role-fit builds, DB layer (RF-01 register items 2, 4, 6)
--
-- 1. DOWNTIME IN DOLLARS: owners think in money; every surface said "hours".
--    The per-asset rate ALREADY exists — asset_financials.downtime_cost_per_hour,
--    editable on the asset's Financials tab — but nothing on the reliability
--    surfaces consumed it. This adds only the missing per-company DEFAULT
--    (effective rate = asset_financials value ?? company default). Surfaces
--    multiply recorded downtime hours by it and ALWAYS label the rate used —
--    where no rate is set they keep showing hours, never invented currency.
--
-- 2. SHIFT HANDOVER: the supervisor's 6am ritual gets a structured home —
--    the outgoing shift's note plus an auto-assembled snapshot, acknowledged
--    by the incoming shift.
--
-- 3. FAILURE REVIEW (FRACAS): wo_failure_data learns who reviewed the coding
--    and when, so "failures since last review, uncoded first" is a queue that
--    can empty (ISO 14224 coding discipline with a workflow home).
-- ============================================================================

BEGIN;

-- ── 1. Production-loss rate: company default only ───────────────────────────
-- (Per-asset rate = asset_financials.downtime_cost_per_hour, pre-existing.)
ALTER TABLE public.companies
    ADD COLUMN IF NOT EXISTS downtime_cost_per_hour NUMERIC(12,2);

COMMENT ON COLUMN public.companies.downtime_cost_per_hour IS
    'Tenant-default production loss per downtime hour (currency/hr). asset_financials.downtime_cost_per_hour overrides per asset; both NULL/0 = surfaces show hours only. Display must always name the rate used — estimated money, honestly labelled.';
COMMENT ON COLUMN public.asset_financials.downtime_cost_per_hour IS
    'Production loss per downtime hour for this asset. 0/NULL = fall back to companies.downtime_cost_per_hour. Consumed by cost-of-unreliability figures (RF-01), which always label the rate used.';

-- ── 2. Shift handovers ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shift_handovers (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_date    DATE NOT NULL DEFAULT CURRENT_DATE,
    shift_label   TEXT NOT NULL DEFAULT 'DAY',          -- DAY / NIGHT / free text
    author_name   TEXT NOT NULL,
    notes         TEXT,                                  -- the human part
    -- Auto-assembled at write time: counts + headline items since the previous
    -- handover (completed WOs, new breakdowns, open criticals, journal count).
    -- A snapshot, deliberately frozen — the handover records what was SAID.
    snapshot      JSONB NOT NULL DEFAULT '{}',
    ack_by        TEXT,
    ack_at        TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    company_id    UUID NOT NULL DEFAULT public.caller_company() REFERENCES public.companies(id)
);

CREATE INDEX IF NOT EXISTS idx_shift_handovers_company_date
    ON public.shift_handovers (company_id, shift_date DESC, created_at DESC);

ALTER TABLE public.shift_handovers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shift_handovers_select ON public.shift_handovers;
CREATE POLICY shift_handovers_select ON public.shift_handovers
    FOR SELECT TO authenticated
    USING (company_id = (SELECT public.caller_company()));

DROP POLICY IF EXISTS shift_handovers_insert ON public.shift_handovers;
CREATE POLICY shift_handovers_insert ON public.shift_handovers
    FOR INSERT TO authenticated
    WITH CHECK (company_id = (SELECT public.caller_company()));

-- Update is for acknowledgement (and author typo fixes) — tenant-scoped.
DROP POLICY IF EXISTS shift_handovers_update ON public.shift_handovers;
CREATE POLICY shift_handovers_update ON public.shift_handovers
    FOR UPDATE TO authenticated
    USING (company_id = (SELECT public.caller_company()))
    WITH CHECK (company_id = (SELECT public.caller_company()));

GRANT SELECT, INSERT, UPDATE ON public.shift_handovers TO authenticated;
GRANT ALL ON public.shift_handovers TO service_role;

COMMENT ON TABLE public.shift_handovers IS
    'Structured shift handover (RF-01): outgoing note + frozen activity snapshot, acknowledged by the incoming shift. Append-mostly; updates only for acknowledgement.';

-- ── 3. Failure review (FRACAS) ──────────────────────────────────────────────
ALTER TABLE public.wo_failure_data
    ADD COLUMN IF NOT EXISTS reviewed_by TEXT,
    ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.wo_failure_data.reviewed_at IS
    'When a reliability engineer confirmed this event''s coding in the failure-review queue (RF-01/FRACAS). NULL = not yet reviewed; the queue lists isFailure events without it, uncoded first.';

INSERT INTO public.semantic_catalog
  (object_name, column_name, title, description, tags, owner, source_tables, iso_standard)
VALUES
  ('asset_financials', 'downtime_cost_per_hour', 'Production-loss rate',
   'Estimated production loss per downtime hour for this asset; falls back to companies.downtime_cost_per_hour. Cost-of-unreliability figures are downtime hours × this rate and must always display the rate they used. Not a measured financial actual — an owner-legible estimate, honestly labelled.',
   ARRAY['finance','downtime','kpi'], 'Asset Management',
   ARRAY['asset_financials','companies'], NULL),
  ('wo_failure_data', 'reviewed_at', 'Failure review stamp',
   'FRACAS discipline: set when an engineer confirms the failure coding in the review queue. The queue = isFailure work orders whose sidecar lacks this stamp, uncoded events first.',
   ARRAY['reliability','fracas','data-quality'], 'Reliability Engineering',
   ARRAY['wo_failure_data','work_orders'], 'ISO 14224')
ON CONFLICT (object_name, COALESCE(column_name, '·')) DO UPDATE
  SET description = EXCLUDED.description,
      tags        = EXCLUDED.tags,
      updated_at  = now();

COMMIT;

-- VERIFY (after apply):
--   SELECT downtime_cost_per_hour FROM companies LIMIT 1;
--   SELECT reviewed_at FROM wo_failure_data LIMIT 1;
--   INSERT INTO shift_handovers (author_name, notes) VALUES ('smoke','x') RETURNING id;  -- then delete
