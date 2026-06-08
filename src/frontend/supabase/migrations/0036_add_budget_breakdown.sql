-- Add monthly breakdown column to budgets table
-- Stores JSON object: { "jan": 100, "feb": 100, ... } or { "months": [...] }
ALTER TABLE budgets 
ADD COLUMN IF NOT EXISTS monthly_data JSONB DEFAULT '{}'::jsonb;
