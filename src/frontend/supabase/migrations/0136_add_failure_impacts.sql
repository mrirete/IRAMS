-- 0136: Add Failure Impact columns (Local & Plant-Wide) to recurring_work and wo_failure_data
-- Supports RCM failure effect tracking across PM → WO conversion pipeline
-- Aligned with ISO 14224 Failure Effect classification

-- 1. Add local_impact and plant_wide_impact to recurring_work (PM templates)
ALTER TABLE recurring_work
ADD COLUMN IF NOT EXISTS local_impact TEXT,
ADD COLUMN IF NOT EXISTS plant_wide_impact TEXT;

COMMENT ON COLUMN recurring_work.local_impact IS 'Local failure effect: impact on the equipment/subsystem itself (ISO 14224 §B.2.5)';
COMMENT ON COLUMN recurring_work.plant_wide_impact IS 'Plant-wide failure effect: impact on production, safety, environment (ISO 14224 §B.2.5)';

-- 2. Add local_impact and plant_wide_impact to wo_failure_data (WO failure analysis)
ALTER TABLE wo_failure_data
ADD COLUMN IF NOT EXISTS local_impact TEXT,
ADD COLUMN IF NOT EXISTS plant_wide_impact TEXT;

COMMENT ON COLUMN wo_failure_data.local_impact IS 'Local failure effect at equipment level, populated from PM template or entered during WO closure';
COMMENT ON COLUMN wo_failure_data.plant_wide_impact IS 'Plant-wide failure effect on production/safety/environment, populated from PM template or entered during WO closure';
