-- 0381 — a reading keeps the identity of the system it came from.
--
-- Nothing rejects a repeated reading today: reading_logs carries only a
-- primary key, so importing the same export twice doubles the history. A
-- doubled history is not a cosmetic problem — it quietly falsifies every
-- trend, MTBF and Weibull fit computed from it, and nothing on screen says
-- so.
--
-- The guard keys on the SOURCE DOCUMENT, not on the reading's own values.
-- SAP gives every measurement document a number; Maximo and MaintainX have
-- their own. Keying on identity means two genuinely different readings at one
-- point on one day — before and after an adjustment, say — stay distinct,
-- whereas a uniqueness rule over (point, date, time) would reject the second
-- one and break the technician's work in order to protect the importer's.
--
-- Manual entry is exempt with no exemption logic: it leaves both columns
-- NULL, and the index keeps the default NULLS DISTINCT, under which every
-- (NULL, NULL) row is unique. Both columns are new, so the index cannot fail
-- on existing rows in any tenant — no backfill, no cleanup, no risk of a
-- migration that works here and fails on a busier database.

alter table public.reading_logs
    add column if not exists source_system text,
    add column if not exists source_ref    text;

comment on column public.reading_logs.source_system is
    'System this reading was imported from (sap_pm, maximo, maintainx). NULL for readings taken in IREAMS.';
comment on column public.reading_logs.source_ref is
    'That system''s own id for this reading — SAP MEASUREMENT_DOCUMENT, and so on. Unique per company with source_system, so re-importing an export inserts nothing.';

-- Default NULLS DISTINCT is the point, not an oversight: it is what leaves
-- manually entered readings unconstrained.
create unique index if not exists reading_logs_source_uq
    on public.reading_logs (company_id, source_system, source_ref);
