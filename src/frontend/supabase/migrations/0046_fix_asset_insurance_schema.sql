
-- Fix missing end_date in asset_insurance
ALTER TABLE asset_insurance 
ADD COLUMN IF NOT EXISTS end_date DATE;

-- Ensure it is not null if business logic requires, but allow null for existing records to avoid errors
-- ALTER TABLE asset_insurance ALTER COLUMN end_date SET NOT NULL; 
-- (Keeping it nullable for now or enforcing via app logic)
