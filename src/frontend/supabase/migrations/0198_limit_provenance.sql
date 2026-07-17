-- 0198: alarm-band provenance (Phase 1.5.3 — acceptable limits & threshold intelligence)
--
-- Records WHERE each reading definition's alarm bands came from, so every limit
-- on screen can cite an auditable source. Values:
--   iso20816-<machine-class>  e.g. iso20816-medium-rigid (ISO 20816-3 zone boundaries)
--   template                  class template default (cited typical values)
--   learned                   statistical baseline (μ+2σ/μ+3σ) approved by a human
--   oem                       OEM datasheet / manual
--   manual                    typed in by a user with no cited source
-- NULL = legacy band predating provenance → UI shows "Unverified — review".
--
-- Frontend degrades gracefully when this migration is not yet applied
-- (DatabaseService strips the column on retry), so apply order is flexible.

alter table public.reading_definitions
    add column if not exists limit_source text;

comment on column public.reading_definitions.limit_source is
    'Provenance of the alarm bands: iso20816-<class> | template | learned | oem | manual; NULL = unverified legacy';
