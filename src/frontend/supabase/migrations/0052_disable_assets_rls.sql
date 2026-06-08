-- Disable RLS on assets table for development
-- The sb_publishable_ key format does not map to the 'anon' or 'authenticated'
-- Postgres roles, so all policy-based filtering returns 0 rows.
-- Re-enable RLS with proper policies before production deployment.
ALTER TABLE assets DISABLE ROW LEVEL SECURITY;
