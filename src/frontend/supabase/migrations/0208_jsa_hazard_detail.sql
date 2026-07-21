-- ============================================================
-- 0208: jsa_hazards was losing most of the risk assessment.
-- The UI captures a full 5×5 matrix (consequence × likelihood),
-- ISO 45001 hierarchy-of-controls selections, residual risk and
-- the high-risk sign-off name — but the table only stored the
-- combined score. Add the missing columns so a JSA reloads
-- exactly as it was assessed.
-- ============================================================

ALTER TABLE public.jsa_hazards
    ADD COLUMN IF NOT EXISTS consequence INTEGER CHECK (consequence BETWEEN 1 AND 5),
    ADD COLUMN IF NOT EXISTS likelihood INTEGER CHECK (likelihood BETWEEN 1 AND 5),
    ADD COLUMN IF NOT EXISTS control_hierarchy JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS residual_consequence INTEGER CHECK (residual_consequence BETWEEN 1 AND 5),
    ADD COLUMN IF NOT EXISTS residual_likelihood INTEGER CHECK (residual_likelihood BETWEEN 1 AND 5),
    ADD COLUMN IF NOT EXISTS signoff_required BOOLEAN,
    ADD COLUMN IF NOT EXISTS signoff_by TEXT,
    ADD COLUMN IF NOT EXISTS signoff_date TIMESTAMPTZ;

-- Backfill: rows saved before this migration only have the combined
-- risk_score. Leave consequence/likelihood NULL — the UI recomputes
-- level from the stored score when the factors are unknown.
