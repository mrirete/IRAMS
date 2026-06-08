
-- Seed Contacts for Default Users

INSERT INTO public.contacts (code, name, email, title, roles, is_employee, is_active)
VALUES 
('SYS_ADMIN', 'System Administrator', 'mrirete@gmail.com', 'System Administrator', ARRAY['SYS_ADMIN'], TRUE, TRUE),
('JD01', 'John Doe', 'john.doe@cainergy.com', 'Reliability Engineer', ARRAY['RELIABILITY_ENG'], TRUE, TRUE),
('TECH01', 'Alex Technician', 'alex@cainergy.com', 'Technician', ARRAY['TECHNICIAN'], TRUE, TRUE),
('TECH02', 'Bea Technician', 'bea@cainergy.com', 'Technician', ARRAY['TECHNICIAN'], TRUE, TRUE),
('TECH03', 'Charlie Technician', 'charlie@cainergy.com', 'Technician', ARRAY['TECHNICIAN'], TRUE, TRUE),
('TECH04', 'Dana Technician', 'dana@cainergy.com', 'Technician', ARRAY['TECHNICIAN'], TRUE, TRUE),
('SUP01', 'Evan Supervisor', 'evan@cainergy.com', 'Supervisor', ARRAY['SUPERVISOR'], TRUE, TRUE),
('SUP02', 'Fiona Supervisor', 'fiona@cainergy.com', 'Supervisor', ARRAY['SUPERVISOR'], TRUE, TRUE),
('PLAN01', 'Greg Planner', 'greg@cainergy.com', 'Planner', ARRAY['PLANNER'], TRUE, TRUE)
ON CONFLICT (code) DO UPDATE 
SET email = EXCLUDED.email, roles = EXCLUDED.roles, is_active = TRUE;

-- Sync Public Users from Auth Users + Contacts
-- Uses DISTINCT ON (au.id) to ensure we only try to update each user ONCE
-- preventing error 21000 if multiple contacts share an email (unlikely but possible during dev)

INSERT INTO public.users (id, username, email, contact_id, status, roles)
SELECT DISTINCT ON (au.id)
    au.id, 
    split_part(au.email, '@', 1) as username, -- Default username from email
    au.email, 
    c.id as contact_id, 
    'active', 
    to_jsonb(c.roles) as roles
FROM auth.users au
JOIN public.contacts c ON c.email = au.email
ORDER BY au.id, c.created_at DESC -- Pick the most recently created contact if duplicates exist
ON CONFLICT (id) DO UPDATE 
SET 
  contact_id = EXCLUDED.contact_id, 
  roles = EXCLUDED.roles, 
  status = 'active',
  username = EXCLUDED.username;

-- Special Adjustment for 'mrirete' if username needs to be exact
UPDATE public.users SET username = 'mrirete' WHERE email = 'mrirete@gmail.com';
