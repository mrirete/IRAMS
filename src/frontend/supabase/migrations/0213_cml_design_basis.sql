-- ============================================================
-- 0213: CML design basis — make t-min auditable.
-- t-min was a trusted stored input with no engineering basis.
-- These columns record the pressure-design inputs so the app can
-- COMPUTE minimum required thickness (ASME VIII Div 1 shells,
-- ASME B31.3 piping) and MAWP, and record which basis produced
-- the stored tmin_mm.
-- Units: pressure/stress MPa, dimensions mm.
-- ============================================================

ALTER TABLE ers_cmls
  ADD COLUMN IF NOT EXISTS design_pressure_mpa   NUMERIC,
  ADD COLUMN IF NOT EXISTS allowable_stress_mpa  NUMERIC,
  ADD COLUMN IF NOT EXISTS joint_efficiency      NUMERIC DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS inside_radius_mm      NUMERIC,  -- vessels/tanks (ASME VIII: t = P·R/(S·E − 0.6·P))
  ADD COLUMN IF NOT EXISTS outside_diameter_mm   NUMERIC,  -- piping (B31.3: t = P·D/(2·(S·E + P·Y)))
  ADD COLUMN IF NOT EXISTS y_coefficient         NUMERIC DEFAULT 0.4,
  ADD COLUMN IF NOT EXISTS corrosion_allowance_mm NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tmin_basis            TEXT NOT NULL DEFAULT 'manual'
    CHECK (tmin_basis IN ('manual','asme_viii','b31_3'));
