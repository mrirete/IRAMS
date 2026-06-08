
-- Delete corrupted/stale 'Jsax' user so we can re-create cleanly
DELETE FROM auth.users WHERE email = 'Jsax@cainergy.com';
DELETE FROM public.users WHERE email = 'Jsax@cainergy.com';

-- Also check lowercase incase
DELETE FROM auth.users WHERE email = 'jsax@cainergy.com';
DELETE FROM public.users WHERE email = 'jsax@cainergy.com';

-- And original email just in case
DELETE FROM auth.users WHERE email = 'jsax@example.com';
DELETE FROM public.users WHERE email = 'jsax@example.com';
