-- STEP 2 (FIXED): Directly create auth accounts for all Quick Switch users
-- Bypasses contact lookup since most contacts lack @cainergy.com emails

-- john.doe
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'john.doe@cainergy.com') THEN
    PERFORM public.create_auth_user('john.doe@cainergy.com', 'Password123!', 'john.doe', 'RELIABILITY_ENG', NULL);
    RAISE NOTICE 'Created: john.doe';
  END IF;
END $$;

-- alex
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'alex@cainergy.com') THEN
    PERFORM public.create_auth_user('alex@cainergy.com', 'Password123!', 'alex', 'TECHNICIAN', NULL);
    RAISE NOTICE 'Created: alex';
  END IF;
END $$;

-- bea
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'bea@cainergy.com') THEN
    PERFORM public.create_auth_user('bea@cainergy.com', 'Password123!', 'bea', 'TECHNICIAN', NULL);
    RAISE NOTICE 'Created: bea';
  END IF;
END $$;

-- charlie
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'charlie@cainergy.com') THEN
    PERFORM public.create_auth_user('charlie@cainergy.com', 'Password123!', 'charlie', 'TECHNICIAN', NULL);
    RAISE NOTICE 'Created: charlie';
  END IF;
END $$;

-- dana
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'dana@cainergy.com') THEN
    PERFORM public.create_auth_user('dana@cainergy.com', 'Password123!', 'dana', 'TECHNICIAN', NULL);
    RAISE NOTICE 'Created: dana';
  END IF;
END $$;

-- evan
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'evan@cainergy.com') THEN
    PERFORM public.create_auth_user('evan@cainergy.com', 'Password123!', 'evan', 'SUPERVISOR', NULL);
    RAISE NOTICE 'Created: evan';
  END IF;
END $$;

-- fiona
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'fiona@cainergy.com') THEN
    PERFORM public.create_auth_user('fiona@cainergy.com', 'Password123!', 'fiona', 'SUPERVISOR', NULL);
    RAISE NOTICE 'Created: fiona';
  END IF;
END $$;

-- greg
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'greg@cainergy.com') THEN
    PERFORM public.create_auth_user('greg@cainergy.com', 'Password123!', 'greg', 'PLANNER', NULL);
    RAISE NOTICE 'Created: greg';
  END IF;
END $$;

-- k.syrus
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'k.syrus@cainergy.com') THEN
    PERFORM public.create_auth_user('k.syrus@cainergy.com', 'Password123!', 'K.Syrus', 'RELIABILITY_ENG', NULL);
    RAISE NOTICE 'Created: K.Syrus';
  END IF;
END $$;
