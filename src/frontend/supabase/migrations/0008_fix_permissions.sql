
-- Fix permissions for the API/Auth roles
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;

-- Ensure search_path is correct (optional, but good practice)
ALTER ROLE authenticated SET search_path = public;
ALTER ROLE anon SET search_path = public;
ALTER ROLE service_role SET search_path = public;

-- Fix for "Database error querying schema" often related to auth schema access
GRANT USAGE ON SCHEMA auth TO postgres, anon, authenticated, service_role;
-- Note: we usually don't grant select on auth tables to anon/authenticated for security, 
-- but 'service_role' needs it, and Supabase internal roles need it. 
-- The error 500 suggests the internal role used by Gotrue (Supabase Auth) is failing.
