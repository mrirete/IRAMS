-- Add image_url column to the assets table for storing asset photos
ALTER TABLE assets ADD COLUMN IF NOT EXISTS image_url TEXT;
