-- ============================================================
-- 0151: Allow 'montecarlo' (and full type set) in reliability analyses
-- The original CHECK omitted 'montecarlo', so saving a Monte Carlo
-- study failed the constraint and was silently dropped. Align the
-- constraint with the app's ReliabilityAnalysisType union.
-- ============================================================

ALTER TABLE ers_reliability_analyses
    DROP CONSTRAINT IF EXISTS ers_reliability_analyses_analysis_type_check;

ALTER TABLE ers_reliability_analyses
    ADD CONSTRAINT ers_reliability_analyses_analysis_type_check
    CHECK (analysis_type IN (
        'mtbf', 'weibull', 'availability', 'spares', 'maintainability', 'montecarlo'
    ));
