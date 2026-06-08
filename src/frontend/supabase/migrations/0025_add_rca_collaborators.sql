-- Migration: Add collaborators JSONB column to ers_rca_investigations
-- Purpose: Persist RCA study team members (contacts & org units) as a JSONB array
-- Each element: { id, type, ref_id, name, role, department?, email?, added_at, added_by? }

ALTER TABLE ers_rca_investigations
    ADD COLUMN IF NOT EXISTS collaborators jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN ers_rca_investigations.collaborators IS 'JSONB array of StudyCollaborator objects for team collaboration';
