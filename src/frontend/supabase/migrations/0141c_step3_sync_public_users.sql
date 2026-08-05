-- STEP 3: Sync public.users table (run after step 2)

INSERT INTO public.users (id, username, email, contact_id, status, roles)
SELECT DISTINCT ON (au.id)
    au.id,
    split_part(au.email, '@', 1) as username,
    au.email,
    c.id as contact_id,
    'active',
    to_jsonb(c.roles) as roles
FROM auth.users au
JOIN public.contacts c ON c.email = au.email
WHERE NOT EXISTS (SELECT 1 FROM public.users pu WHERE pu.id = au.id)
ORDER BY au.id, c.created_at DESC
ON CONFLICT (id) DO UPDATE
SET
  contact_id = EXCLUDED.contact_id,
  roles = EXCLUDED.roles,
  status = 'active',
  username = EXCLUDED.username;
