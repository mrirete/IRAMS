-- Add estimated costs to Recurring Work (PMs)
ALTER TABLE recurring_work 
ADD COLUMN IF NOT EXISTS est_labor_cost DECIMAL(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS est_material_cost DECIMAL(10,2) DEFAULT 0;

-- Create Maintenance Forecast View
-- Projects annualized spend based on frequency
CREATE OR REPLACE VIEW maintenance_forecasts AS
SELECT 
    rw.id,
    rw.code,
    rw.title,
    rw.asset_id,
    rw.frequency_interval,
    rw.frequency_unit,
    rw.est_labor_cost,
    rw.est_material_cost,
    (rw.est_labor_cost + rw.est_material_cost) as cost_per_event,
    CASE 
        WHEN rw.frequency_unit = 'Days' THEN 365.0 / NULLIF(rw.frequency_interval, 0)
        WHEN rw.frequency_unit = 'Weeks' THEN 52.0 / NULLIF(rw.frequency_interval, 0)
        WHEN rw.frequency_unit = 'Months' THEN 12.0 / NULLIF(rw.frequency_interval, 0)
        WHEN rw.frequency_unit = 'Years' THEN 1.0 / NULLIF(rw.frequency_interval, 0)
        ELSE 0 
    END as annual_frequency,
    (
        (rw.est_labor_cost + rw.est_material_cost) * 
        CASE 
            WHEN rw.frequency_unit = 'Days' THEN 365.0 / NULLIF(rw.frequency_interval, 0)
            WHEN rw.frequency_unit = 'Weeks' THEN 52.0 / NULLIF(rw.frequency_interval, 0)
            WHEN rw.frequency_unit = 'Months' THEN 12.0 / NULLIF(rw.frequency_interval, 0)
            WHEN rw.frequency_unit = 'Years' THEN 1.0 / NULLIF(rw.frequency_interval, 0)
            ELSE 0 
        END
    ) as annual_estimated_spend,
    rw.next_due_date
FROM recurring_work rw
WHERE rw.active = true AND rw.status = 'ACTIVE';
