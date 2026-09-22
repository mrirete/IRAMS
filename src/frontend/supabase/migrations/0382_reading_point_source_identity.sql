-- 0382 — a reading POINT keeps the identity of the system it came from.
--
-- 0381 did this for readings. Points need it for the other direction: when
-- IREAMS exports its strategy back to the SAP it came from, a measuring point
-- that SAP already has must not be created a second time, and a measurement
-- document must name the point by the number SAP knows. Without the SAP
-- number on the point, every export would duplicate the plant's points.
--
-- Same shape and same reasoning as 0381: both columns new and NULL, so the
-- unique index cannot fail on any tenant's existing rows; NULLS DISTINCT
-- leaves points created in IREAMS unconstrained.

alter table public.reading_definitions
    add column if not exists source_system text,
    add column if not exists source_ref    text;

comment on column public.reading_definitions.source_system is
    'System this reading point was imported from (sap_pm, maximo, maintainx). NULL for points created in IREAMS.';
comment on column public.reading_definitions.source_ref is
    'That system''s own id for the point — SAP MEAS_POINT. Unique per company with source_system; the export names the point by it.';

create unique index if not exists reading_definitions_source_uq
    on public.reading_definitions (company_id, source_system, source_ref);
