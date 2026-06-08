-- ═══════════════════════════════════════════════════════════════════════
-- 0146_add_assessor_username.sql
-- Adds the assessor_username column and relaxes NOT NULL constraints
-- to support the auto-save workflow where fields are incrementally filled.
-- 
-- Root cause: The frontend code (AssessmentService.dehydrateState) writes
-- to 'assessor_username' but this column did not exist in the DB schema.
-- Additionally, NOT NULL constraints on assessor_name/company/email caused
-- inserts to fail when auto-save triggered before the user completed
-- all required fields.
-- ═══════════════════════════════════════════════════════════════════════

-- 1. Add the missing assessor_username column
ALTER TABLE audit_assessments
    ADD COLUMN IF NOT EXISTS assessor_username TEXT;

-- 2. Relax NOT NULL on assessor fields to support incremental auto-save.
--    The wizard auto-saves after 1.5s debounce — fields like company/email
--    may not be filled yet. Validation is enforced at the application layer
--    before step progression (canSubmit guard).
ALTER TABLE audit_assessments
    ALTER COLUMN assessor_name SET DEFAULT '',
    ALTER COLUMN assessor_name DROP NOT NULL;

ALTER TABLE audit_assessments
    ALTER COLUMN assessor_company SET DEFAULT '',
    ALTER COLUMN assessor_company DROP NOT NULL;

ALTER TABLE audit_assessments
    ALTER COLUMN assessor_email SET DEFAULT '',
    ALTER COLUMN assessor_email DROP NOT NULL;

-- 3. Index on username for People Bridge lookups
CREATE INDEX IF NOT EXISTS idx_assessments_username 
    ON audit_assessments(assessor_username) 
    WHERE assessor_username IS NOT NULL;

COMMENT ON COLUMN audit_assessments.assessor_username IS 
    'System username — bridges to Users/People module for onboarding pipeline';
