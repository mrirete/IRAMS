-- 0147_assessment_collaborators.sql
-- Colleague invitation system for collaborative assessments
-- Supports Viewer and Contributor roles with invite token for link sharing

CREATE TABLE IF NOT EXISTS audit_assessment_collaborators (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id UUID NOT NULL REFERENCES audit_assessments(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer', 'contributor')),
    invite_token TEXT UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
    invited_by TEXT,
    invited_at TIMESTAMPTZ DEFAULT now(),
    accepted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_collab_assessment ON audit_assessment_collaborators(assessment_id);
CREATE INDEX IF NOT EXISTS idx_collab_token ON audit_assessment_collaborators(invite_token);
CREATE INDEX IF NOT EXISTS idx_collab_email ON audit_assessment_collaborators(email);

-- Add column to store 6M checklist answers in existing assessments table
ALTER TABLE audit_assessments ADD COLUMN IF NOT EXISTS sixm_checklist_answers JSONB DEFAULT '[]'::jsonb;
ALTER TABLE audit_assessments ADD COLUMN IF NOT EXISTS sixm_dimension_notes JSONB DEFAULT '{}'::jsonb;

-- RLS
ALTER TABLE audit_assessment_collaborators ENABLE ROW LEVEL SECURITY;
CREATE POLICY "collab_full_access" ON audit_assessment_collaborators FOR ALL USING (true);
