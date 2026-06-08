
-- Delete all test users from AUTH and PUBLIC so they can be re-seeded cleanly
-- Using WHERE email IN (...) to be safe and specific

DELETE FROM auth.users WHERE email IN (
    'mrirete@gmail.com',
    'john.doe@cainergy.com',
    'alex@cainergy.com',
    'bea@cainergy.com',
    'charlie@cainergy.com',
    'dana@cainergy.com',
    'evan@cainergy.com',
    'fiona@cainergy.com',
    'greg@cainergy.com'
);

DELETE FROM public.users WHERE email IN (
    'mrirete@gmail.com',
    'john.doe@cainergy.com',
    'alex@cainergy.com',
    'bea@cainergy.com',
    'charlie@cainergy.com',
    'dana@cainergy.com',
    'evan@cainergy.com',
    'fiona@cainergy.com',
    'greg@cainergy.com'
);
