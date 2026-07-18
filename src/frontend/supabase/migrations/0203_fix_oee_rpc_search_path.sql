-- 0203: repair the 0105 OEE RPCs — search_path fix.
--
-- compute_oee / get_plant_oee / get_oee_losses are SECURITY DEFINER functions
-- that reference tables unqualified (assets, production_logs, …). Under the
-- hardened default (empty search_path for definer functions) every call fails
-- with 42P01 'relation "assets" does not exist' — so the OEE RPCs have never
-- returned data in this environment. Pinning search_path = public fixes all
-- three without touching their bodies. (Frontend also carries a client-side
-- fallback that computes OEE from production_logs + asset_production_config
-- directly, so dashboards work either way.)

ALTER FUNCTION public.compute_oee(UUID, DATE, DATE) SET search_path = public;
ALTER FUNCTION public.get_plant_oee(DATE, DATE)     SET search_path = public;
ALTER FUNCTION public.get_oee_losses(UUID, DATE, DATE) SET search_path = public;
