-- 0292: Recurring work joins the maintenance strategy (X-1 wiring)
--
-- Strategies (nested cycle packages with absorption) existed as a catalog and
-- simulator; PMs couldn't reference them, so absorption never reached the real
-- schedule. A recurring_work row can now declare "I am the 1M package of
-- strategy S on this asset". At generation time, if a LONGER package of the
-- same strategy+asset is due the same day (interval an exact multiple), the
-- shorter PM is ABSORBED: no work order is raised, its schedule rolls forward,
-- and the longer service carries the scope. One service, not a stack.

ALTER TABLE public.recurring_work
    ADD COLUMN IF NOT EXISTS strategy_id uuid REFERENCES public.maintenance_strategies(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS strategy_package text;

CREATE INDEX IF NOT EXISTS recurring_work_strategy_idx
    ON public.recurring_work (strategy_id, asset_id)
    WHERE strategy_id IS NOT NULL;

COMMENT ON COLUMN public.recurring_work.strategy_package
    IS 'Which package of strategy_id this PM implements (label, e.g. 1M/3M/12M). Generation applies same-day absorption by longer packages of the same strategy+asset.';

INSERT INTO public.semantic_catalog
  (object_name, column_name, title, description, tags, owner, source_tables, iso_standard)
VALUES
  ('recurring_work', 'strategy_package', 'Strategy Package',
   'The cycle package this PM implements within its maintenance strategy. At generation, a package due the same day as a longer package (whose interval it divides) on the same asset is absorbed — the longer service includes its scope, so no duplicate work order is raised and the schedule rolls forward.',
   ARRAY['work_management','pm','canonical'], 'Maintenance',
   ARRAY['recurring_work','maintenance_strategies','strategy_packages'], NULL)
ON CONFLICT DO NOTHING;
