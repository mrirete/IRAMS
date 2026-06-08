-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 0144: Document Management Enhancement
-- Adds category, description, and task_id columns to entity_files table
-- Supports ISO 55000 document classification (P&ID, Manuals, Data Sheets, etc.)
-- ═══════════════════════════════════════════════════════════════════════════════

-- Add document category classification (matches DocumentCategory TypeScript type)
ALTER TABLE entity_files ADD COLUMN IF NOT EXISTS category TEXT;

-- Add free-text description for document context
ALTER TABLE entity_files ADD COLUMN IF NOT EXISTS description TEXT;

-- Add optional task-level linkage (enables attaching docs to specific work tasks)
ALTER TABLE entity_files ADD COLUMN IF NOT EXISTS task_id UUID;

-- Add index for category-based lookups (filtering documents by type)
CREATE INDEX IF NOT EXISTS idx_entity_files_category ON entity_files(category) WHERE category IS NOT NULL;

-- Add index for task-level document queries
CREATE INDEX IF NOT EXISTS idx_entity_files_task_id ON entity_files(task_id) WHERE task_id IS NOT NULL;

-- Comment documentation
COMMENT ON COLUMN entity_files.category IS 'ISO 55000 document classification: PID, DRAWING, OEM_MANUAL, DATASHEET, PROCEDURE, SAFETY, REPORT, PHOTO, SPREADSHEET, OTHER';
COMMENT ON COLUMN entity_files.description IS 'Free-text description providing context about the document';
COMMENT ON COLUMN entity_files.task_id IS 'Optional link to a specific work order task for task-level document attachment';
