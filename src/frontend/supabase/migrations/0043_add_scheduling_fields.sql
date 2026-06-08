-- Migration: Add estimated duration to work_orders
-- This field tracks the elapsed wall-clock duration of the job (Scheduled Finish - Scheduled Start)

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS est_duration NUMERIC(10, 2);
