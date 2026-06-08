-- Migration: Add cost_center, description, and due_date columns to work_orders
-- These columns are expected by the UI but missing from the initial schema

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS cost_center TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS due_date TIMESTAMP WITH TIME ZONE;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS date_due_start TIMESTAMP WITH TIME ZONE;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES contacts(id);
