
-- Delete broken user 'dana' so we can re-seed
DELETE FROM auth.users WHERE email = 'dana@cainergy.com';
DELETE FROM public.users WHERE email = 'dana@cainergy.com';
