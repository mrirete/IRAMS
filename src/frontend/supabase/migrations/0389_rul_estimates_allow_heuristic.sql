-- 0389: the RUL table accepts the honestly-tagged heuristic estimate.
--
-- WHY
-- Phase 1 of the Predict plan (2026-07-17) split RUL into a fitted censored
-- Weibull (>= 2 recorded failures) and a directional health-index heuristic,
-- and tags the heuristic row distribution_type = 'heuristic' so the UI can
-- badge it "HEURISTIC · DIRECTIONAL" instead of dressing it as a fit.
-- The CHECK constraint from 0074a predates that split and only knows the
-- five fitted families, so every heuristic write has failed since July with
-- "Failed to persist RUL estimate" — on exactly the assets (no failure
-- history yet) a first-time user runs RUL Forecast on. Verified live
-- 2026-09-24: zero 'heuristic' rows exist; B-301 has no RUL row at all.
--
-- WHAT
-- Widen the constraint. Nothing else changes: readers already branch on the
-- value (RULReliabilityTab, PredictPage displayRul override).

ALTER TABLE public.ers_rul_estimates
    DROP CONSTRAINT IF EXISTS ers_rul_estimates_distribution_type_check;

ALTER TABLE public.ers_rul_estimates
    ADD CONSTRAINT ers_rul_estimates_distribution_type_check
    CHECK (distribution_type = ANY (ARRAY[
        'weibull_2p'::text, 'weibull_3p'::text, 'lognormal'::text,
        'exponential'::text, 'normal'::text, 'heuristic'::text
    ]));

COMMENT ON CONSTRAINT ers_rul_estimates_distribution_type_check ON public.ers_rul_estimates IS
    'Fitted families plus ''heuristic'' — the directional health-index fallback written when an asset has fewer than two recorded failures (0389).';
