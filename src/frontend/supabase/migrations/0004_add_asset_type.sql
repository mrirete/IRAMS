-- Add asset_type_code to assets table
ALTER TABLE public.assets 
ADD COLUMN asset_type_code TEXT;

-- Optional: Add foreign key constraint if strict strictness is desired, 
-- but given dictionary dynamic nature, we might just index it.
-- For now, loose coupling (text) to allow easy dictionary updates.

-- Migrate existing data (if any) - Assuming 'category' was lost or not stored precisely?
-- In our mock-to-db transition, we might have lost it. This is acceptable for dev.
