-- Add properties column to assets table for extensible data (BOM, etc)
ALTER TABLE assets ADD COLUMN IF NOT EXISTS properties JSONB DEFAULT '{}'::JSONB;

-- Update audit trigger? 
-- The existing trigger 'audit_assets_changes' fires on generic UPDATE, 
-- and log_audit_event() captures TO_JSONB(NEW), so it should automatically include the new column.
