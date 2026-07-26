-- Migration: Add collaborators JSONB column to ers_rca_investigations
-- Purpose: Persist RCA study team members (contacts & org units) as a JSONB array
-- Each element: { id, type, ref_id, name, role, department?, email?, added_at, added_by? }
--
-- GUARDED 2026-07-25: ers_rca_investigations is not created until 0074, so on a
-- fresh replay this file ran ~49 migrations before its own table existed and
-- aborted the run. It only applied historically because the origin database was
-- built out of order. Skips cleanly when the table is absent; migration 0224
-- re-applies the column afterwards, so a replayed database still ends up correct.
DO $$
BEGIN
    IF to_regclass('public.ers_rca_investigations') IS NULL THEN
        RAISE NOTICE '0025: ers_rca_investigations does not exist yet — skipping (0224 re-applies).';
        RETURN;
    END IF;

    ALTER TABLE ers_rca_investigations
        ADD COLUMN IF NOT EXISTS collaborators jsonb DEFAULT '[]'::jsonb;

    COMMENT ON COLUMN ers_rca_investigations.collaborators IS
        'JSONB array of StudyCollaborator objects for team collaboration';
END $$;
