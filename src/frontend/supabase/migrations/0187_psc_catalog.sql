-- 0187 — Potential Success Curve definitions in the semantic catalog.
--
-- Registers the success-centric metric vocabulary from Olorunfemi (2026),
-- "A Success-Centric Evolution of Reliability-Centered Maintenance in Modern
-- Asset Management" (Science, Technology & Public Policy), so reports and the
-- AI agents (lookup_data_definitions) ground these terms in the canonical
-- definitions rather than guessing. Computation lives in src/lib/psc.ts over
-- reading_definitions (bands) + reading_logs (observations).
-- Atomic: wrap in a txn.
BEGIN;

INSERT INTO public.semantic_catalog
  (object_name, column_name, title, description, tags, owner, source_tables, iso_standard)
VALUES
  ('psc_metrics', NULL, 'Potential Success Curve (PSC)',
   'Success-centric reliability framework (Olorunfemi, 2026): instead of only asking "when will this asset fail?", PSC measures how long an asset SUSTAINS optimal performance. An asset''s Golden Spot is its optimal performance envelope, defined by the warning bands (min/max_warning) of its condition reading points; critical bands mark Critical Departure. Zones: In Golden Spot → Sub-Optimal Drift → Critical Departure → Restored. Complements (never replaces) failure-centric RCM analysis; failure analysis remains authoritative for safety-critical scenarios.',
   ARRAY['psc','reliability','golden-spot','success-centric'], 'Reliability Engineering',
   ARRAY['reading_definitions','reading_logs','assets'], 'ISO 55000:2024'),

  ('psc_metrics', 'mtop', 'Mean Time of Optimal Performance',
   'MTOP = Σ(time in Golden Spot) / N in-spot periods (Eq. 1). The success-centric complement to MTBF: average duration the asset holds ALL banded parameters inside their optimal bands. Computed from time-stamped reading_logs evaluated against reading_definitions bands; an in-spot period ends at a Success Departure (any parameter leaving its optimal band).',
   ARRAY['psc','kpi'], NULL, ARRAY['reading_logs','reading_definitions'], 'ISO 55000:2024'),

  ('psc_metrics', 'mttrg', 'Mean Time to Restore Golden Spot',
   'MTTRg = Σ(restoration duration) / N completed restorations (Eq. 2). Extends MTTR: average time from Success Departure until every parameter is back inside its optimal band. Only completed restorations count; a departure still in progress is reported separately.',
   ARRAY['psc','kpi'], NULL, ARRAY['reading_logs','reading_definitions'], 'ISO 55000:2024'),

  ('psc_metrics', 'success_rate', 'Success Rate (SR)',
   'SR = MTOP / (MTOP + MTTRg) × 100% (Eq. 3). Availability measured against OPTIMAL performance rather than mere functioning. Targets per the framework: ≥90% on target, ≥95% world-class. Null until at least one complete departure-and-restoration cycle has been observed.',
   ARRAY['psc','kpi'], NULL, ARRAY['reading_logs','reading_definitions'], 'ISO 55000:2024'),

  ('psc_metrics', 'ope', 'Overall Performance Excellence (OPE)',
   'OPE = SR × PQ × EE (Eq. 4), where PQ is Production Quality and EE is Energy Efficiency (actual vs optimal consumption). Extends OEE with an energy dimension supporting the ISO 55000:2024 sustainability outcome. Target ≥85%. Not computed until PQ and EE data sources exist — values are never fabricated.',
   ARRAY['psc','kpi','sustainability'], NULL, ARRAY['reading_logs','reading_definitions'], 'ISO 55000:2024')
ON CONFLICT DO NOTHING;

COMMIT;
