-- ════════════════════════════════════════════════════════════════════════════
-- 0397 — Insurance incidents: the keys they never had, and a claim lifecycle
--        (P3c of the FinOps audit)
--
-- ── 1. Keys ─────────────────────────────────────────────────────────────────
-- 0034 created insurance_incidents first, so 0044's FK-bearing CREATE TABLE
-- IF NOT EXISTS was a no-op and asset_id / work_order_id were never keys.
-- Consequences seen: orphans survive asset and WO deletes, and PostgREST
-- cannot embed assets(...) — the P2 Insurance tab failed on exactly that.
--   asset_id      → assets       ON DELETE RESTRICT  (NOT NULL column; an
--                   incident is insurance history, so deleting an asset that
--                   has one is refused, as 0394 refuses posted depreciation)
--   work_order_id → work_orders  ON DELETE SET NULL
-- Added NOT VALID (existing orphans cannot block the migration), then
-- validated when the data allows — the notice says which.
--
-- ── 2. Claim lifecycle ──────────────────────────────────────────────────────
-- The table had claim_reference, claim_submitted_date, claim_amount,
-- settlement_amount, settlement_date and a claim_status — and nothing ever
-- wrote any of them except claim_status = 'OPEN'. The flow is now:
--     OPEN ──submit──▶ SUBMITTED ──settle──▶ SETTLED ──close──▶ CLOSED
--       └────────────close (no claim)───────────────────────────▲
--                      SUBMITTED ──close (declined / withdrawn)─┘
-- A BEFORE UPDATE trigger holds the rules, so no client can skip a step:
--   submit needs a claim amount > 0 (date defaults to today);
--   settle needs a settlement amount ≥ 0 and ≤ the amount claimed (date
--   defaults to today); CLOSED is final.
--
-- ── 3. Recorded, not posted ─────────────────────────────────────────────────
-- A settlement is NOT written to cost_allocations. An insurance payout is
-- usually treated as income, not as a reduction of maintenance cost —
-- posting it would make the maintenance budget look underspent. (A warranty
-- credit IS posted: that is money back on a repair.) Decided with the user
-- 2026-10-01; switching it on later is a source value and one insert.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. keys ─────────────────────────────────────────────────────────────────
DO $$
DECLARE n_asset int; n_wo int;
BEGIN
    SELECT COUNT(*) INTO n_asset FROM public.insurance_incidents i
     WHERE NOT EXISTS (SELECT 1 FROM public.assets a WHERE a.id = i.asset_id);
    SELECT COUNT(*) INTO n_wo FROM public.insurance_incidents i
     WHERE i.work_order_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.work_orders w WHERE w.id = i.work_order_id);
    RAISE NOTICE '0397: % incident(s) point at a missing asset, % at a missing work order', n_asset, n_wo;

    -- A dangling work-order reference carries no information; clear it so the key can validate.
    IF n_wo > 0 THEN
        UPDATE public.insurance_incidents i SET work_order_id = NULL
         WHERE i.work_order_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.work_orders w WHERE w.id = i.work_order_id);
    END IF;
END $$;

ALTER TABLE public.insurance_incidents DROP CONSTRAINT IF EXISTS insurance_incidents_asset_id_fkey;
ALTER TABLE public.insurance_incidents
    ADD CONSTRAINT insurance_incidents_asset_id_fkey
    FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON DELETE RESTRICT NOT VALID;

ALTER TABLE public.insurance_incidents DROP CONSTRAINT IF EXISTS insurance_incidents_work_order_id_fkey;
ALTER TABLE public.insurance_incidents
    ADD CONSTRAINT insurance_incidents_work_order_id_fkey
    FOREIGN KEY (work_order_id) REFERENCES public.work_orders(id) ON DELETE SET NULL NOT VALID;

DO $$
BEGIN
    BEGIN
        ALTER TABLE public.insurance_incidents VALIDATE CONSTRAINT insurance_incidents_asset_id_fkey;
        RAISE NOTICE '0397: asset key validated';
    EXCEPTION WHEN foreign_key_violation THEN
        RAISE NOTICE '0397: asset key left NOT VALID — incidents reference deleted assets (counted above); new rows are checked';
    END;
    ALTER TABLE public.insurance_incidents VALIDATE CONSTRAINT insurance_incidents_work_order_id_fkey;
END $$;

CREATE INDEX IF NOT EXISTS idx_insurance_incidents_work_order_id ON public.insurance_incidents (work_order_id);

-- ── 2. values ───────────────────────────────────────────────────────────────
ALTER TABLE public.insurance_incidents DROP CONSTRAINT IF EXISTS chk_insurance_incident_status;
ALTER TABLE public.insurance_incidents
    ADD CONSTRAINT chk_insurance_incident_status
    CHECK (claim_status IN ('OPEN', 'SUBMITTED', 'SETTLED', 'CLOSED')) NOT VALID;
ALTER TABLE public.insurance_incidents DROP CONSTRAINT IF EXISTS chk_insurance_incident_amounts;
ALTER TABLE public.insurance_incidents
    ADD CONSTRAINT chk_insurance_incident_amounts
    CHECK ((claim_amount IS NULL OR claim_amount >= 0) AND (settlement_amount IS NULL OR settlement_amount >= 0)) NOT VALID;

-- ── 3. the lifecycle ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ers_guard_insurance_claim()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
    old_s text := COALESCE(OLD.claim_status, 'OPEN');
    new_s text := COALESCE(NEW.claim_status, 'OPEN');
BEGIN
    IF old_s = new_s THEN
        -- No move. A closed or settled record keeps its claim figures.
        IF old_s IN ('SETTLED', 'CLOSED') AND (
               NEW.claim_amount      IS DISTINCT FROM OLD.claim_amount
            OR NEW.settlement_amount IS DISTINCT FROM OLD.settlement_amount
            OR NEW.settlement_date   IS DISTINCT FROM OLD.settlement_date) THEN
            RAISE EXCEPTION 'Incident % is %: its claim and settlement figures are final.', OLD.incident_number, old_s
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;

    IF NOT (
           (old_s = 'OPEN'      AND new_s IN ('SUBMITTED', 'CLOSED'))
        OR (old_s = 'SUBMITTED' AND new_s IN ('SETTLED', 'CLOSED'))
        OR (old_s = 'SETTLED'   AND new_s = 'CLOSED')
    ) THEN
        RAISE EXCEPTION 'An insurance claim cannot move from % to %.', old_s, new_s
            USING ERRCODE = 'check_violation';
    END IF;

    IF new_s = 'SUBMITTED' THEN
        IF NEW.claim_amount IS NULL OR NEW.claim_amount <= 0 THEN
            RAISE EXCEPTION 'Submitting a claim needs the amount claimed.' USING ERRCODE = 'check_violation';
        END IF;
        NEW.claim_submitted_date := COALESCE(NEW.claim_submitted_date, CURRENT_DATE);
    END IF;

    IF new_s = 'SETTLED' THEN
        IF NEW.settlement_amount IS NULL OR NEW.settlement_amount < 0 THEN
            RAISE EXCEPTION 'Settling a claim needs the amount the insurer paid (0 if nothing).' USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.settlement_amount > COALESCE(NEW.claim_amount, OLD.claim_amount) THEN
            RAISE EXCEPTION 'The settlement (%) is more than was claimed (%).', NEW.settlement_amount, COALESCE(NEW.claim_amount, OLD.claim_amount)
                USING ERRCODE = 'check_violation';
        END IF;
        NEW.settlement_date := COALESCE(NEW.settlement_date, CURRENT_DATE);
    END IF;

    NEW.updated_at := now();
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.ers_guard_insurance_claim() FROM public, anon;

DROP TRIGGER IF EXISTS aa_guard_insurance_claim ON public.insurance_incidents;
CREATE TRIGGER aa_guard_insurance_claim
    BEFORE UPDATE ON public.insurance_incidents
    FOR EACH ROW EXECUTE FUNCTION public.ers_guard_insurance_claim();

COMMENT ON COLUMN public.insurance_incidents.settlement_amount IS
    'What the insurer paid. Recorded only — not posted to cost_allocations (an insurance payout is income, not a maintenance-cost reduction; 0397).';

-- ── proof, inside the transaction, rolled back by an exception if it fails ──
-- The probe row must not leave entries in the audit trail (0394 audits this
-- table): that one trigger is suspended for the proof only. DDL is
-- transactional, so a failed proof rolls the suspension back with it.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_insurance_incidents_finops') THEN
        ALTER TABLE public.insurance_incidents DISABLE TRIGGER audit_insurance_incidents_finops;
    END IF;
END $$;

DO $$
DECLARE v_company uuid; v_asset uuid; v_inc uuid; ok boolean;
BEGIN
    SELECT a.company_id, a.id INTO v_company, v_asset FROM public.assets a ORDER BY a.created_at LIMIT 1;
    IF v_asset IS NULL THEN RAISE NOTICE '0397: no asset; proof skipped'; RETURN; END IF;
    INSERT INTO public.insurance_incidents (incident_number, asset_id, incident_date, incident_type, description, company_id)
    VALUES ('__INC0397', v_asset, now(), 'OTHER', 'probe', v_company) RETURNING id INTO v_inc;

    -- skipping SUBMITTED is refused
    ok := false;
    BEGIN UPDATE public.insurance_incidents SET claim_status = 'SETTLED', settlement_amount = 1 WHERE id = v_inc;
    EXCEPTION WHEN check_violation THEN ok := true; END;
    IF NOT ok THEN RAISE EXCEPTION '0397 proof: OPEN→SETTLED was allowed'; END IF;

    UPDATE public.insurance_incidents SET claim_status = 'SUBMITTED', claim_amount = 1000 WHERE id = v_inc;
    -- over-settlement is refused
    ok := false;
    BEGIN UPDATE public.insurance_incidents SET claim_status = 'SETTLED', settlement_amount = 1500 WHERE id = v_inc;
    EXCEPTION WHEN check_violation THEN ok := true; END;
    IF NOT ok THEN RAISE EXCEPTION '0397 proof: settlement above claim was allowed'; END IF;

    UPDATE public.insurance_incidents SET claim_status = 'SETTLED', settlement_amount = 800 WHERE id = v_inc;
    IF (SELECT settlement_date FROM public.insurance_incidents WHERE id = v_inc) IS NULL THEN RAISE EXCEPTION '0397 proof: settlement date not defaulted'; END IF;
    UPDATE public.insurance_incidents SET claim_status = 'CLOSED' WHERE id = v_inc;

    -- CLOSED is final
    ok := false;
    BEGIN UPDATE public.insurance_incidents SET claim_status = 'OPEN' WHERE id = v_inc;
    EXCEPTION WHEN check_violation THEN ok := true; END;
    IF NOT ok THEN RAISE EXCEPTION '0397 proof: CLOSED→OPEN was allowed'; END IF;

    DELETE FROM public.insurance_incidents WHERE id = v_inc;
    RAISE NOTICE '0397: claim-lifecycle proof passed';
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_insurance_incidents_finops') THEN
        ALTER TABLE public.insurance_incidents ENABLE TRIGGER audit_insurance_incidents_finops;
    END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
