-- 0368a — The Weibull-created schedule gets the readable shape of 0367.
--
-- 0367 was applied before this data fix was added to it (the repo copy has
-- been restored to the applied version); this forward migration carries the
-- part that was missing. Code PM-<tag>-W01 (W = from Weibull analysis), name
-- "<tag> — time-directed replacement", job text "Prevents: …", analysis essay
-- kept in origin.narrative. Nothing else changes.
BEGIN;

-- ── Data: the Weibull-created schedule gets the same shape ───────────────
-- "PM — 20000005 — Weibull-based replacement (β=1.69)" with an analysis
-- essay as its description. The essay moves to origin.narrative; the job text
-- becomes "Prevents: …"; the code becomes PM-<tag>-W01 (W = Weibull analysis).
UPDATE public.recurring_work rw
   SET origin = coalesce(rw.origin, '{}'::jsonb)
                || jsonb_build_object('source', 'weibull_analysis', 'narrative', rw.description,
                                      'asset_tag', a.tag, 'migrated_by', '0367'),
       title = regexp_replace(rw.title, '^PM — (.*?) — Weibull-based replacement.*$', '\1 — time-directed replacement'),
       description = 'Prevents: wear-out failures of ' || coalesce(nullif(a.name, ''), a.tag) || E'\n'
                     || 'Time-directed replacement · every ' || rw.frequency_interval || ' ' || lower(rw.frequency_unit)
                     || ' (from Weibull life-data analysis)',
       code = CASE WHEN rw.code ~ '^PM-[0-9]{5}$'
                   AND NOT EXISTS (SELECT 1 FROM public.recurring_work x WHERE x.company_id = rw.company_id AND x.code = 'PM-' || upper(a.tag) || '-W01')
                   THEN 'PM-' || upper(a.tag) || '-W01' ELSE rw.code END,
       updated_at = now()
  FROM public.assets a
 WHERE a.id::text = rw.asset_id
   AND rw.title ~ '^PM — .* — Weibull-based replacement'
   AND rw.description LIKE 'Time-directed Preventive Maintenance based on Weibull%';

COMMIT;
