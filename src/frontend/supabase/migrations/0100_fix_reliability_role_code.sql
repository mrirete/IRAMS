-- Migration: Fix role code mismatch in contacts table
-- The seed data inserted 'RELIABILITY_ENGINEER' but the dictionary uses 'RELIABILITY_ENG'

UPDATE public.contacts
SET roles = array_replace(roles, 'RELIABILITY_ENGINEER', 'RELIABILITY_ENG')
WHERE 'RELIABILITY_ENGINEER' = ANY(roles);

-- Also sync the users table roles (JSONB) for any affected users
UPDATE public.users u
SET roles = to_jsonb(c.roles)
FROM public.contacts c
WHERE u.contact_id = c.id
  AND c.roles @> ARRAY['RELIABILITY_ENG'];
