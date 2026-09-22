-- 0383 — the live-link spine: targets, outbox, runs; the object map widened.
--
-- Until now IREAMS has reached SAP by file: the cockpit ZIP for PM objects
-- (Send to SAP) and the finance CSV lane (ErpExportService), plus the
-- Specialist's writeback_log for agent proposals. Three half-spines, each with
-- its own idea of "sent". This migration lays the one spine the live link
-- runs on (docs/SAP-Live-Link-Plan.md §2). Nothing here talks to SAP; it is
-- the state the worker (erp-sync) and the simulator (sap-sim) will keep.
--
--   erp_targets    one row per connected system per tenant: where it is, how
--                  to authenticate (by SECRET NAME — a credential value is
--                  refused at the constraint), which families flow which way
--                  and who owns each, and the watermark per family per
--                  direction.
--   erp_outbox     every document the link sends or receives, verbatim, with
--                  its outcome. The exception queue is this table filtered to
--                  failed/conflict. The exactly-once guarantee lives in its
--                  unique indexes, not in worker code.
--   erp_runs       one row per worker run; the partial unique index on
--                  (target_id) WHERE running is the lease that stops two
--                  workers processing the same watermark window.
--   erp_object_map gains etag (S/4 optimistic concurrency) and external_type
--                  (an IREAMS asset may be an EQUI or an IFLOT), and its
--                  entity_type list grows to the PM objects.
--
-- Exactly-once, made precise. The plan wrote "UNIQUE (target, family,
-- document) WHERE sent". That is right for finance, where a posting is
-- immutable and must land once, and wrong for master data, where the same
-- equipment is legitimately sent again after it changes. So there are two
-- indexes: finance is unique per document; every other family is unique per
-- document VERSION (the source row's updated_at at capture). A retried send
-- of the same version cannot deliver twice; a new version can.
--
-- Reliability writes need a person. An interval change to a live maintenance
-- plan is not a background job (plan §2.7): a reliability row cannot reach
-- 'sent' without approved_at, and the constraint says so, not the worker.
--
-- Tenancy follows 0364 exactly: company_id defaults to the caller's claim,
-- aa_stamp_tenant covers service-role inserts, every policy carries the
-- tenant conjunct first, and the G4 gate runs before this file returns.

-- ── 1. Targets ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.erp_families_valid(p jsonb)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog
AS $$
    SELECT p IS NOT NULL
       AND jsonb_typeof(p) = 'object'
       AND NOT EXISTS (
            SELECT 1 FROM jsonb_each(p) e
             WHERE e.key NOT IN ('master_data', 'condition', 'work', 'reliability', 'finance')
                OR jsonb_typeof(e.value) <> 'object'
                OR coalesce(e.value ->> 'direction', 'off') NOT IN ('in', 'out', 'both', 'off')
                OR coalesce(e.value ->> 'owner', 'sap') NOT IN ('sap', 'ireams'))
$$;

COMMENT ON FUNCTION public.erp_families_valid(jsonb) IS
    'Shape check for erp_targets.families: {family: {direction: in|out|both|off, owner: sap|ireams}} over the five families of the live-link plan.';

CREATE TABLE IF NOT EXISTS public.erp_targets (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id    uuid NOT NULL DEFAULT public.caller_company()
                  REFERENCES public.companies(id) ON DELETE CASCADE,
    name          text NOT NULL,
    system        text NOT NULL DEFAULT 'sap_s4'
                  CHECK (system IN ('sap_s4', 'sap_sim', 'generic')),
    base_url      text NOT NULL,
    -- {mode, secret_name, token_url, client_id, username}. The VALUE of a
    -- credential is never here: it lives in the edge-function secret the
    -- name points at. The constraint refuses the usual keys outright.
    auth          jsonb NOT NULL DEFAULT '{"mode": "none"}'::jsonb
                  CHECK (jsonb_typeof(auth) = 'object'
                         AND coalesce(auth ->> 'mode', 'none') IN ('none', 'basic', 'bearer', 'oauth2_client_credentials')
                         AND NOT (auth ?| ARRAY['secret', 'password', 'client_secret', 'token', 'api_key'])),
    families      jsonb NOT NULL DEFAULT '{}'::jsonb
                  CHECK (public.erp_families_valid(families)),
    poll_interval_minutes integer NOT NULL DEFAULT 5 CHECK (poll_interval_minutes >= 1),
    -- Dry-run is the default. A target sends nothing until a person turns
    -- this off, and is_active on as well.
    dry_run       boolean NOT NULL DEFAULT true,
    is_active     boolean NOT NULL DEFAULT false,
    -- {family: {in: timestamptz, out: timestamptz}} — advanced by the worker
    -- only after the run's outbox rows are committed (plan §2.2).
    watermarks    jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(watermarks) = 'object'),
    last_run_at   timestamptz,
    last_status   text,
    last_error    text,
    created_by    uuid,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT erp_targets_company_name_uq UNIQUE (company_id, name)
);

COMMENT ON TABLE public.erp_targets IS
    'A connected ERP per tenant for the live link (docs/SAP-Live-Link-Plan.md). Credentials by secret name only; per-family direction and owner; watermarks per family per direction. Replaces writeback_targets and the finance CSV lane over phases 1-3.';
COMMENT ON COLUMN public.erp_targets.families IS
    'Which families flow and who wins on conflict: {"master_data":{"direction":"both","owner":"sap"},"condition":{"direction":"out","owner":"ireams"},...}. Owner decides the conflict rule and which side''s UI marks the field read-only.';
COMMENT ON COLUMN public.erp_targets.watermarks IS
    'Last-change timestamp already processed, per family per direction. Advanced only after a run commits its outbox rows, so a crashed run replays and the outbox makes the replay harmless.';

DROP TRIGGER IF EXISTS aa_stamp_tenant ON public.erp_targets;
CREATE TRIGGER aa_stamp_tenant BEFORE INSERT ON public.erp_targets
    FOR EACH ROW EXECUTE FUNCTION public.stamp_tenant();
DROP TRIGGER IF EXISTS set_updated_at ON public.erp_targets;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.erp_targets
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_col();

ALTER TABLE public.erp_targets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_targets_select ON public.erp_targets;
CREATE POLICY erp_targets_select ON public.erp_targets
    FOR SELECT TO authenticated
    USING (company_id = (SELECT public.caller_company()));
DROP POLICY IF EXISTS erp_targets_admin_insert ON public.erp_targets;
CREATE POLICY erp_targets_admin_insert ON public.erp_targets
    FOR INSERT TO authenticated
    WITH CHECK (company_id = (SELECT public.caller_company()) AND (SELECT public.is_admin()));
DROP POLICY IF EXISTS erp_targets_admin_update ON public.erp_targets;
CREATE POLICY erp_targets_admin_update ON public.erp_targets
    FOR UPDATE TO authenticated
    USING (company_id = (SELECT public.caller_company()) AND (SELECT public.is_admin()))
    WITH CHECK (company_id = (SELECT public.caller_company()) AND (SELECT public.is_admin()));
DROP POLICY IF EXISTS erp_targets_admin_delete ON public.erp_targets;
CREATE POLICY erp_targets_admin_delete ON public.erp_targets
    FOR DELETE TO authenticated
    USING (company_id = (SELECT public.caller_company()) AND (SELECT public.is_admin()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.erp_targets TO authenticated;
GRANT ALL ON public.erp_targets TO service_role;

-- The worker runs as the service role, where caller_company() is NULL and
-- stamp_tenant() knows nothing about targets. A row that names its target
-- names its tenant: fill company_id from the target when nothing else did.
CREATE OR REPLACE FUNCTION public.erp_stamp_from_target()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.company_id IS NULL AND NEW.target_id IS NOT NULL THEN
        SELECT t.company_id INTO NEW.company_id FROM public.erp_targets t WHERE t.id = NEW.target_id;
    END IF;
    RETURN NEW;
END;
$$;

-- ── 2. Outbox ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_outbox (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id    uuid NOT NULL DEFAULT public.caller_company()
                  REFERENCES public.companies(id) ON DELETE CASCADE,
    target_id     uuid NOT NULL REFERENCES public.erp_targets(id) ON DELETE CASCADE,
    family        text NOT NULL
                  CHECK (family IN ('master_data', 'condition', 'work', 'reliability', 'finance')),
    direction     text NOT NULL DEFAULT 'OUT' CHECK (direction IN ('OUT', 'IN')),
    -- The canonical document kind: equipment, functional_location,
    -- measuring_point, measurement_document, notification, order,
    -- pm_cycle_revision, cost_posting, goods_movement, goods_receipt,
    -- supplier_invoice … the emitter for a family owns this list.
    document_type text NOT NULL,
    -- The IREAMS row the document was built from (OUT) or lands on (IN).
    document_id   uuid NOT NULL,
    -- The source row's updated_at when the document was captured. The unit of
    -- idempotency for every family but finance.
    document_version timestamptz NOT NULL DEFAULT now(),
    -- What a person would quote: the tag, the order number, the reading time.
    document_key  text,
    status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'sent', 'failed', 'dry_run', 'skipped', 'conflict')),
    attempts      integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz,
    payload       jsonb NOT NULL,          -- verbatim, what went over the wire (SOX evidence)
    response      jsonb,                   -- verbatim, what came back
    http_status   integer,
    external_key  text,                    -- the number SAP assigned or matched
    etag          text,
    error         text,
    reason        text,                    -- for conflict / skipped: why, in words
    approved_by   uuid,
    approved_at   timestamptz,
    resolved_by   uuid,
    resolved_at   timestamptz,
    sent_at       timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    -- A reliability write (interval change, criticality) cannot be sent
    -- without a person's approval on the row (plan §2.7).
    CONSTRAINT erp_outbox_reliability_needs_approval
        CHECK (family <> 'reliability' OR status <> 'sent' OR approved_at IS NOT NULL),
    -- A row that says sent must say when.
    CONSTRAINT erp_outbox_sent_has_time
        CHECK (status <> 'sent' OR sent_at IS NOT NULL)
);

COMMENT ON TABLE public.erp_outbox IS
    'Every document the live link sends or receives, verbatim, with its outcome. failed/conflict rows ARE the exception queue. Exactly-once is enforced by the unique indexes below, not by the worker.';
COMMENT ON COLUMN public.erp_outbox.document_version IS
    'Source row updated_at at capture. Idempotency unit for master data, condition, work and reliability: one successful send per version, so a changed record is sent again and a retried one is not.';

-- Finance lands once per document, full stop.
CREATE UNIQUE INDEX IF NOT EXISTS erp_outbox_finance_sent_once
    ON public.erp_outbox (target_id, family, document_id)
    WHERE status = 'sent' AND family = 'finance';
-- Everything else lands once per version.
CREATE UNIQUE INDEX IF NOT EXISTS erp_outbox_version_sent_once
    ON public.erp_outbox (target_id, family, document_id, document_version)
    WHERE status = 'sent' AND family <> 'finance';
-- One live row per version: capture is INSERT … ON CONFLICT DO NOTHING, and a
-- retry re-queues the failed row rather than adding a second one.
CREATE UNIQUE INDEX IF NOT EXISTS erp_outbox_one_live_row
    ON public.erp_outbox (target_id, family, document_id, document_version)
    WHERE status IN ('pending', 'failed', 'conflict');

CREATE INDEX IF NOT EXISTS idx_erp_outbox_worker
    ON public.erp_outbox (target_id, status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_erp_outbox_queue
    ON public.erp_outbox (company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_erp_outbox_document
    ON public.erp_outbox (document_id);

DROP TRIGGER IF EXISTS aa_stamp_tenant ON public.erp_outbox;
CREATE TRIGGER aa_stamp_tenant BEFORE INSERT ON public.erp_outbox
    FOR EACH ROW EXECUTE FUNCTION public.stamp_tenant();
DROP TRIGGER IF EXISTS ab_stamp_from_target ON public.erp_outbox;
CREATE TRIGGER ab_stamp_from_target BEFORE INSERT ON public.erp_outbox
    FOR EACH ROW EXECUTE FUNCTION public.erp_stamp_from_target();
DROP TRIGGER IF EXISTS set_updated_at ON public.erp_outbox;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.erp_outbox
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_col();

ALTER TABLE public.erp_outbox ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_outbox_select ON public.erp_outbox;
CREATE POLICY erp_outbox_select ON public.erp_outbox
    FOR SELECT TO authenticated
    USING (company_id = (SELECT public.caller_company()));
-- Queueing a document from the browser (Send to SAP, approve an interval
-- change) and working the exception queue (Retry / Skip) are administrative
-- for now; the worker writes under the service role, which bypasses RLS.
-- No DELETE for anyone but the service role: the trail is evidence.
DROP POLICY IF EXISTS erp_outbox_admin_insert ON public.erp_outbox;
CREATE POLICY erp_outbox_admin_insert ON public.erp_outbox
    FOR INSERT TO authenticated
    WITH CHECK (company_id = (SELECT public.caller_company()) AND (SELECT public.is_admin()));
DROP POLICY IF EXISTS erp_outbox_admin_update ON public.erp_outbox;
CREATE POLICY erp_outbox_admin_update ON public.erp_outbox
    FOR UPDATE TO authenticated
    USING (company_id = (SELECT public.caller_company()) AND (SELECT public.is_admin()))
    WITH CHECK (company_id = (SELECT public.caller_company()) AND (SELECT public.is_admin()));

GRANT SELECT, INSERT, UPDATE ON public.erp_outbox TO authenticated;
GRANT ALL ON public.erp_outbox TO service_role;

-- ── 3. Runs: history and the lease ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_runs (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id    uuid NOT NULL DEFAULT public.caller_company()
                  REFERENCES public.companies(id) ON DELETE CASCADE,
    target_id     uuid NOT NULL REFERENCES public.erp_targets(id) ON DELETE CASCADE,
    direction     text NOT NULL DEFAULT 'BOTH' CHECK (direction IN ('OUT', 'IN', 'BOTH')),
    status        text NOT NULL DEFAULT 'running'
                  CHECK (status IN ('running', 'done', 'failed')),
    dry_run       boolean NOT NULL DEFAULT true,
    worker        text,
    lease_until   timestamptz NOT NULL,
    started_at    timestamptz NOT NULL DEFAULT now(),
    finished_at   timestamptz,
    stats         jsonb NOT NULL DEFAULT '{}'::jsonb,
    error         text
);

-- The lease. Two workers cannot both be running against one target.
CREATE UNIQUE INDEX IF NOT EXISTS erp_runs_one_running
    ON public.erp_runs (target_id)
    WHERE status = 'running';
CREATE INDEX IF NOT EXISTS idx_erp_runs_history
    ON public.erp_runs (target_id, started_at DESC);

COMMENT ON TABLE public.erp_runs IS
    'One row per live-link worker run. The partial unique index on (target_id) WHERE running is the per-target lease (plan §2.4); erp_claim_run() takes it and expires a stale one.';

DROP TRIGGER IF EXISTS aa_stamp_tenant ON public.erp_runs;
CREATE TRIGGER aa_stamp_tenant BEFORE INSERT ON public.erp_runs
    FOR EACH ROW EXECUTE FUNCTION public.stamp_tenant();
DROP TRIGGER IF EXISTS ab_stamp_from_target ON public.erp_runs;
CREATE TRIGGER ab_stamp_from_target BEFORE INSERT ON public.erp_runs
    FOR EACH ROW EXECUTE FUNCTION public.erp_stamp_from_target();

ALTER TABLE public.erp_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_runs_select ON public.erp_runs;
CREATE POLICY erp_runs_select ON public.erp_runs
    FOR SELECT TO authenticated
    USING (company_id = (SELECT public.caller_company()));

GRANT SELECT ON public.erp_runs TO authenticated;
GRANT ALL ON public.erp_runs TO service_role;

-- Take the lease for a target, or return NULL if another worker holds it.
-- A run whose lease has lapsed is closed as failed first, so a crashed
-- worker never holds a target hostage. company_id is derived from the
-- target, never trusted from the caller (the 0261 rule).
CREATE OR REPLACE FUNCTION public.erp_claim_run(
    p_target    uuid,
    p_direction text DEFAULT 'BOTH',
    p_worker    text DEFAULT NULL,
    p_lease     interval DEFAULT interval '10 minutes'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_company uuid;
    v_dry     boolean;
    v_id      uuid;
BEGIN
    SELECT t.company_id, t.dry_run INTO v_company, v_dry
      FROM public.erp_targets t WHERE t.id = p_target;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'erp_claim_run: target % not found', p_target;
    END IF;

    UPDATE public.erp_runs
       SET status = 'failed', finished_at = now(),
           error = coalesce(error, 'lease expired without a finish — worker presumed dead')
     WHERE target_id = p_target AND status = 'running' AND lease_until < now();

    INSERT INTO public.erp_runs (company_id, target_id, direction, dry_run, worker, lease_until)
    VALUES (v_company, p_target, p_direction, v_dry, p_worker, now() + p_lease)
    ON CONFLICT (target_id) WHERE status = 'running' DO NOTHING
    RETURNING id INTO v_id;

    RETURN v_id;   -- NULL when another worker holds the lease
END;
$$;

CREATE OR REPLACE FUNCTION public.erp_finish_run(
    p_run    uuid,
    p_status text,
    p_stats  jsonb DEFAULT '{}'::jsonb,
    p_error  text  DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_status NOT IN ('done', 'failed') THEN
        RAISE EXCEPTION 'erp_finish_run: status must be done or failed, got %', p_status;
    END IF;
    UPDATE public.erp_runs
       SET status = p_status, finished_at = now(), stats = coalesce(p_stats, '{}'::jsonb), error = p_error
     WHERE id = p_run AND status = 'running';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'erp_finish_run: run % is not running', p_run;
    END IF;
    UPDATE public.erp_targets t
       SET last_run_at = now(), last_status = p_status, last_error = p_error
      FROM public.erp_runs r
     WHERE r.id = p_run AND t.id = r.target_id;
END;
$$;

-- Worker-only. The browser reaches these through the erp-sync edge function,
-- never directly (the 0361 lesson: a DEFINER function granted wide is a
-- hole through RLS).
REVOKE ALL ON FUNCTION public.erp_claim_run(uuid, text, text, interval) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.erp_finish_run(uuid, text, jsonb, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erp_claim_run(uuid, text, text, interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.erp_finish_run(uuid, text, jsonb, text) TO service_role;
REVOKE ALL ON FUNCTION public.erp_families_valid(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.erp_families_valid(jsonb) TO authenticated, service_role;

-- ── 4. The object map, widened ─────────────────────────────────────────────
ALTER TABLE public.erp_object_map
    ADD COLUMN IF NOT EXISTS etag          text,
    ADD COLUMN IF NOT EXISTS external_type text;

COMMENT ON COLUMN public.erp_object_map.etag IS
    'S/4 OData ETag from the last read or write. Sent as If-Match; a 412 means SAP changed it since and the conflict rule decides.';
COMMENT ON COLUMN public.erp_object_map.external_type IS
    'The external system''s object type where entity_type is not enough: an IREAMS asset maps to EQUI (equipment) or IFLOT (functional location); a recurring_work row to MPLA (plan) or MPOS (item).';

-- The CHECK was created inline in 0250, so its name is the generated one;
-- look it up rather than assume, then widen it to the PM objects.
DO $$
DECLARE c text;
BEGIN
    FOR c IN
        SELECT conname FROM pg_constraint
         WHERE conrelid = 'public.erp_object_map'::regclass
           AND contype = 'c'
           AND pg_get_constraintdef(oid) LIKE '%entity_type%'
    LOOP
        EXECUTE format('ALTER TABLE public.erp_object_map DROP CONSTRAINT %I', c);
    END LOOP;
END $$;

ALTER TABLE public.erp_object_map
    ADD CONSTRAINT erp_object_map_entity_type_check CHECK (entity_type IN (
        -- finance and materials (0250)
        'vendor', 'cost_center', 'wbs_element', 'gl_account',
        'inventory_item', 'purchase_order', 'purchase_order_line',
        'goods_receipt', 'work_order', 'cost_allocation', 'asset', 'company',
        -- the live link's PM objects (0383)
        'reading_definition',      -- measuring point
        'reading_log',             -- measurement document
        'recurring_work',          -- maintenance plan / item
        'job_plan',                -- task list
        'request',                 -- notification
        'work_center',
        'inventory_transaction',   -- goods movement
        'supplier_invoice'
    ));

-- ── 5. Prove the boundary before returning ─────────────────────────────────
DO $$
DECLARE n int; sample text;
BEGIN
    SELECT count(*), min(object_name) INTO n, sample FROM public.tenancy_policy_gaps();
    IF n > 0 THEN
        RAISE EXCEPTION 'G4 reports % gap(s), e.g. % — refusing to commit', n, sample;
    END IF;
END $$;

-- VERIFY (after apply):
--   SELECT indexname FROM pg_indexes WHERE tablename = 'erp_outbox' ORDER BY 1;
--     -- expect erp_outbox_finance_sent_once, erp_outbox_version_sent_once, erp_outbox_one_live_row
--   SELECT count(*) FROM public.tenancy_policy_gaps();   -- 0
