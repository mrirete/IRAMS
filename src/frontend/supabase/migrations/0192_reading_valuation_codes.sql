-- 0192 — Coded findings on readings (SAP valuation codes).
--
-- A reading is a number; a finding is what the technician SAW while taking it
-- ("leaking", "abnormal noise"). SAP PM records these as catalog valuation
-- codes on the measurement document — coded, so findings are countable (top
-- findings per asset class, finding × alarm correlation) where free-text
-- comments can't be.
--
-- One nullable column. The catalog itself lives code-side
-- (src/lib/valuationCodes.ts) so every site gets the same ISO 14224-flavoured
-- observation set with no seed data to manage. The frontend tolerates this
-- column being absent (strip + retry on insert), so readings keep saving even
-- before this migration is applied.
-- Atomic: wrap in a txn.
BEGIN;

ALTER TABLE public.reading_logs ADD COLUMN IF NOT EXISTS valuation_code TEXT;

COMMENT ON COLUMN public.reading_logs.valuation_code IS
  'Coded observation at reading time (SAP valuation-code style): OK, NOISE, VIBR, HOT, DIRTY, CORR, LEAK, LOOSE, DAMAGE — catalog in src/lib/valuationCodes.ts';

COMMIT;
