-- 0183 — Semantic layer, slice 1: canonical views + data catalog.
--
-- One trusted, annotated interface over the reliability data, instead of every
-- report/agent hand-rolling its own joins against raw tables:
--   • semantic_catalog        — dataset & column annotations (description, tags,
--                               lineage, ISO standard, sensitivity). The "wiki".
--   • sem_asset_health        — one row per asset: criticality, KPIs, open work,
--                               recent failures, last condition reading.
--   • sem_failure_events      — ISO 14224-style failure-event log (WO + failure
--                               coding + downtime + cost, decoded descriptions).
--   • sem_work_history        — canonical work-order history with cost/downtime.
--   • sem_readings            — condition readings decoded against thresholds.
--   • sem_pm_compliance       — recurring work with due/overdue status.
--
-- All views use security_invoker so RLS applies to the QUERYING user — they will
-- keep honoring the Phase-2 RLS hardening instead of bypassing it as owner.
-- Atomic: wrap in a txn.
BEGIN;

-- ── 1. Data catalog (the annotation store) ─────────────────────────────────

CREATE TABLE IF NOT EXISTS public.semantic_catalog (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_name  TEXT NOT NULL,              -- view/table this entry documents
  column_name  TEXT,                       -- NULL = dataset-level entry
  title        TEXT,
  description  TEXT NOT NULL,
  tags         TEXT[] NOT NULL DEFAULT '{}',
  owner        TEXT,                       -- accountable role/team, free text
  sensitivity  TEXT NOT NULL DEFAULT 'internal'
               CHECK (sensitivity IN ('public','internal','confidential')),
  source_tables TEXT[] NOT NULL DEFAULT '{}',  -- lineage: physical tables behind it
  iso_standard TEXT,                       -- e.g. 'ISO 14224'
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One dataset-level row (NULL column) and one row per documented column.
CREATE UNIQUE INDEX IF NOT EXISTS semantic_catalog_object_column_uq
  ON public.semantic_catalog (object_name, COALESCE(column_name, '·'));

ALTER TABLE public.semantic_catalog ENABLE ROW LEVEL SECURITY;

-- Reads broad (every authenticated user + agents), writes admin-only —
-- same posture as 0174/0175 config tables.
DROP POLICY IF EXISTS semantic_catalog_select ON public.semantic_catalog;
CREATE POLICY semantic_catalog_select ON public.semantic_catalog
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS semantic_catalog_write ON public.semantic_catalog;
CREATE POLICY semantic_catalog_write ON public.semantic_catalog
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ── 2. Canonical views ──────────────────────────────────────────────────────

-- Failure events: ISO 14224 event log. One row per WO that carries failure
-- coding, with mode/cause/remedy decoded from the dictionaries.
CREATE OR REPLACE VIEW public.sem_failure_events
WITH (security_invoker = true) AS
SELECT
  wo.id                    AS work_order_id,
  wo.wo_number,
  wo.title,
  a.id                     AS asset_id,
  a.tag                    AS asset_tag,
  a.name                   AS asset_name,
  a.criticality::text      AS criticality,
  wc.code                  AS work_center_code,
  fd.failure_mode_code,
  fm.description           AS failure_mode,
  fd.failure_cause_code,
  fc.description           AS failure_cause,
  fd.remedy_code,
  COALESCE(rr.description, rd.description) AS remedy,
  fd.local_impact,
  fd.plant_wide_impact,
  wo.actual_downtime_hrs,
  COALESCE(wo.frozen_labor_cost, 0) + COALESCE(wo.frozen_material_cost, 0)
                           AS event_cost,
  wo.created_at            AS reported_at,
  wo.closed_at
FROM public.work_orders wo
JOIN public.wo_failure_data fd ON fd.wo_id = wo.id
JOIN public.assets a           ON a.id = wo.asset_id
LEFT JOIN public.work_centers wc ON wc.id = wo.work_center_id
LEFT JOIN public.reference_codes fm
       ON fm.category = 'FAILURE_MODE'  AND fm.code = fd.failure_mode_code
LEFT JOIN public.reference_codes fc
       ON fc.category = 'FAILURE_CAUSE' AND fc.code = fd.failure_cause_code
LEFT JOIN public.reference_codes rr
       ON rr.category = 'REMEDY_CODE'   AND rr.code = fd.remedy_code
LEFT JOIN public.dictionaries rd
       ON rd.type = 'REMEDY_CODE'       AND rd.code = fd.remedy_code;

-- Work history: every WO with asset, work group, cost and downtime — the one
-- version of "maintenance history" reports and agents should read.
CREATE OR REPLACE VIEW public.sem_work_history
WITH (security_invoker = true) AS
SELECT
  wo.id                    AS work_order_id,
  wo.wo_number,
  wo.title,
  wo.type                  AS work_type,
  wo.status::text          AS status,
  wo.priority_code,
  a.id                     AS asset_id,
  a.tag                    AS asset_tag,
  a.name                   AS asset_name,
  a.criticality::text      AS criticality,
  wc.code                  AS work_center_code,
  wo.recurring_work_id,    -- non-null ⇒ generated by a PM
  wo.request_id,           -- non-null ⇒ originated from a service request
  COALESCE(wo.frozen_labor_cost, 0)    AS labor_cost,
  COALESCE(wo.frozen_material_cost, 0) AS material_cost,
  COALESCE(wo.frozen_labor_cost, 0) + COALESCE(wo.frozen_material_cost, 0)
                           AS total_cost,
  wo.actual_downtime_hrs,
  wo.created_at,
  wo.due_date,
  wo.closed_at
FROM public.work_orders wo
JOIN public.assets a ON a.id = wo.asset_id
LEFT JOIN public.work_centers wc ON wc.id = wo.work_center_id;

-- Condition readings: reading_logs decoded against their definition thresholds.
-- breach_severity is THE canonical alarm interpretation (NULL thresholds are
-- simply not evaluated).
CREATE OR REPLACE VIEW public.sem_readings
WITH (security_invoker = true) AS
SELECT
  rl.id                    AS reading_id,
  rl.reading_date,
  rl.reading_time,
  rl.reading_value,
  rd.unit,
  rd.name                  AS reading_name,
  rd.category              AS reading_category,
  rd.reading_type_code,
  rd.min_critical, rd.min_warning, rd.max_warning, rd.max_critical,
  rd.monitoring_frequency_days,
  rd.pf_interval_days,
  rl.is_alarm,
  CASE
    WHEN rl.reading_value >= rd.max_critical OR rl.reading_value <= rd.min_critical
      THEN 'CRITICAL'
    WHEN rl.reading_value >= rd.max_warning  OR rl.reading_value <= rd.min_warning
      THEN 'WARNING'
    ELSE 'NORMAL'
  END                      AS breach_severity,
  a.id                     AS asset_id,
  a.tag                    AS asset_tag,
  a.name                   AS asset_name,
  a.criticality::text      AS criticality,
  rl.entered_by,
  rl.comments,
  rl.created_at
FROM public.reading_logs rl
JOIN public.reading_definitions rd ON rd.id = rl.definition_id
JOIN public.assets a               ON a.id = rl.asset_id;

-- PM compliance: active recurring work with due status. Join is ::text because
-- recurring_work.asset_id is TEXT (legacy), not UUID.
CREATE OR REPLACE VIEW public.sem_pm_compliance
WITH (security_invoker = true) AS
SELECT
  rw.id                    AS pm_id,
  rw.code,
  rw.title,
  rw.status,
  rw.job_type,
  rw.priority_code,
  rw.schedule_type,
  rw.frequency_interval,
  rw.frequency_unit,
  rw.last_generated_date,
  rw.next_due_date,
  (rw.next_due_date IS NOT NULL AND rw.next_due_date < now()) AS is_overdue,
  a.id                     AS asset_id,
  a.tag                    AS asset_tag,
  a.name                   AS asset_name,
  a.criticality::text      AS criticality,
  wc.code                  AS work_center_code
FROM public.recurring_work rw
LEFT JOIN public.assets a        ON a.id::text = rw.asset_id
LEFT JOIN public.work_centers wc ON wc.id = rw.work_center_id
WHERE rw.active;

-- Asset health: one row per asset with reliability KPIs and live aggregates.
CREATE OR REPLACE VIEW public.sem_asset_health
WITH (security_invoker = true) AS
SELECT
  a.id                     AS asset_id,
  a.tag                    AS asset_tag,
  a.name                   AS asset_name,
  a.criticality::text      AS criticality,
  a.status_code,
  a.hierarchy_level,
  wc.code                  AS work_center_code,
  a.mtbf_days,
  a.mttr_hours,
  a.failure_count_ytd,
  a.running_hours,
  ow.open_wo_count,
  fe.failure_events_12mo,
  fe.downtime_hrs_12mo,
  pm.overdue_pm_count,
  lr.last_reading_at
FROM public.assets a
LEFT JOIN public.work_centers wc ON wc.id = a.responsible_work_center_id
LEFT JOIN LATERAL (
  SELECT count(*) AS open_wo_count
  FROM public.work_orders w
  WHERE w.asset_id = a.id
    AND w.status::text NOT IN ('CLOSED','CANCELLED','TECO','COMP')
) ow ON true
LEFT JOIN LATERAL (
  SELECT count(*)                          AS failure_events_12mo,
         COALESCE(sum(w.actual_downtime_hrs), 0) AS downtime_hrs_12mo
  FROM public.work_orders w
  JOIN public.wo_failure_data fd ON fd.wo_id = w.id
  WHERE w.asset_id = a.id
    AND w.created_at >= now() - interval '365 days'
) fe ON true
LEFT JOIN LATERAL (
  SELECT count(*) AS overdue_pm_count
  FROM public.recurring_work rw
  WHERE rw.asset_id = a.id::text
    AND rw.active
    AND rw.next_due_date IS NOT NULL
    AND rw.next_due_date < now()
) pm ON true
LEFT JOIN LATERAL (
  SELECT max(rl.created_at) AS last_reading_at
  FROM public.reading_logs rl
  WHERE rl.asset_id = a.id
) lr ON true;

-- ── 3. Seed the catalog (annotations for what we just published) ───────────

INSERT INTO public.semantic_catalog
  (object_name, column_name, title, description, tags, owner, source_tables, iso_standard)
VALUES
  ('sem_failure_events', NULL, 'Failure Events',
   'Canonical ISO 14224 failure-event log: one row per work order carrying failure coding, with failure mode, cause and remedy decoded to plain language, plus downtime hours and event cost. Use this — not raw work_orders — for reliability analysis (Pareto, MTBF, Weibull inputs).',
   ARRAY['reliability','failures','iso14224'], 'Reliability Engineering',
   ARRAY['work_orders','wo_failure_data','assets','reference_codes','dictionaries','work_centers'], 'ISO 14224'),
  ('sem_failure_events', 'event_cost', NULL,
   'Total maintenance cost of the event = frozen labor cost + frozen material cost. Frozen values are locked at WO closure; 0 when costs were never captured.',
   ARRAY['cost'], NULL, ARRAY['work_orders'], NULL),
  ('sem_failure_events', 'failure_mode', NULL,
   'Decoded ISO 14224 failure-mode description (reference_codes, category FAILURE_MODE). NULL when the coded value has no dictionary entry.',
   ARRAY['iso14224'], NULL, ARRAY['reference_codes'], 'ISO 14224'),

  ('sem_work_history', NULL, 'Work History',
   'Canonical maintenance work-order history: every WO with asset, work group, type, status, cost and downtime. recurring_work_id non-null means PM-generated; request_id non-null means it originated from a service request.',
   ARRAY['maintenance','work-orders'], 'Maintenance',
   ARRAY['work_orders','assets','work_centers'], NULL),

  ('sem_readings', NULL, 'Condition Readings',
   'Condition-monitoring readings decoded against their reading-point thresholds. breach_severity is the canonical interpretation: CRITICAL / WARNING / NORMAL (thresholds left NULL are not evaluated).',
   ARRAY['condition-monitoring','readings'], 'Reliability Engineering',
   ARRAY['reading_logs','reading_definitions','assets'], NULL),
  ('sem_readings', 'breach_severity', NULL,
   'CRITICAL when the value crosses min/max_critical, WARNING when it crosses min/max_warning, else NORMAL. This is the single source of truth for alarm interpretation.',
   ARRAY['alarms'], NULL, ARRAY['reading_definitions'], NULL),

  ('sem_pm_compliance', NULL, 'PM Compliance',
   'Active recurring work (PM strategies) with schedule and due status. is_overdue = next_due_date in the past. Use for backlog and compliance KPIs.',
   ARRAY['pm','compliance'], 'Maintenance Planning',
   ARRAY['recurring_work','assets','work_centers'], NULL),

  ('sem_asset_health', NULL, 'Asset Health',
   'One row per asset: criticality, reliability KPIs (MTBF days, MTTR hours, YTD failure count, running hours), open work-order count, failure events and downtime over the trailing 12 months, overdue PM count, and the timestamp of the last condition reading.',
   ARRAY['assets','kpi','reliability'], 'Reliability Engineering',
   ARRAY['assets','work_orders','wo_failure_data','recurring_work','reading_logs','work_centers'], NULL),
  ('sem_asset_health', 'criticality', NULL,
   'Asset criticality class A (highest) to D (lowest). Drives monitoring cadence and prioritization; NULL when unassessed.',
   ARRAY['criticality'], NULL, ARRAY['assets'], NULL)
ON CONFLICT DO NOTHING;

COMMIT;
