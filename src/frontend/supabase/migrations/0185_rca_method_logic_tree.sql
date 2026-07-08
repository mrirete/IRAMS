-- 0185 — allow logic_tree as an RCA method (fixes LTA method switch).
--
-- The UI offers "Logic Tree Analysis (LTA)" (method value logic_tree) but the
-- 0074 CHECK constraint only allows five_why/fishbone/fault_tree/taproot/apollo,
-- so switching to LTA was rejected (23514 → "Something went wrong" toast).
-- Atomic: wrap in a txn.
BEGIN;

ALTER TABLE public.ers_rca_investigations
  DROP CONSTRAINT IF EXISTS ers_rca_investigations_method_check;

ALTER TABLE public.ers_rca_investigations
  ADD CONSTRAINT ers_rca_investigations_method_check
  CHECK (method IN ('five_why','fishbone','fault_tree','logic_tree','taproot','apollo'));

COMMIT;
