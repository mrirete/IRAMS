-- 0343 — REMEDY_CODE: the maintenance activity taxonomy (ISO 14224 Table B.5).
--
-- The Complete modal shows a coded Remedy select only when this category has
-- rows; with none seeded it fell back to free text, and the narrative landed
-- in wo_failure_data.remedy_code where a code belongs — so remedies could not
-- be analysed fleet-wide (2026-09-08 assurance run, P2-16). Product-standard
-- rows (company_id NULL); tenants may add their own.

INSERT INTO public.reference_codes (id, category, code, description, active, sort_order, company_id, properties)
VALUES
  (uuid_generate_v4(), 'REMEDY_CODE', 'REPLACE',   'Replace — item replaced by a new or refurbished one',                     true, 10,  NULL, '{"iso14224":"B.5"}'),
  (uuid_generate_v4(), 'REMEDY_CODE', 'REPAIR',    'Repair — item restored by repair (weld, machine, patch)',                  true, 20,  NULL, '{"iso14224":"B.5"}'),
  (uuid_generate_v4(), 'REMEDY_CODE', 'MODIFY',    'Modify — design or configuration changed to remove the cause',            true, 30,  NULL, '{"iso14224":"B.5"}'),
  (uuid_generate_v4(), 'REMEDY_CODE', 'ADJUST',    'Adjust — settings, alignment, tension or clearance adjusted',               true, 40,  NULL, '{"iso14224":"B.5"}'),
  (uuid_generate_v4(), 'REMEDY_CODE', 'REFIT',     'Refit — item removed, cleaned, reconditioned and refitted',               true, 50,  NULL, '{"iso14224":"B.5"}'),
  (uuid_generate_v4(), 'REMEDY_CODE', 'OVERHAUL',  'Overhaul — major strip-down and rebuild',                                  true, 60,  NULL, '{"iso14224":"B.5"}'),
  (uuid_generate_v4(), 'REMEDY_CODE', 'SERVICE',   'Service — lubricate, clean, top-up, minor service',                       true, 70,  NULL, '{"iso14224":"B.5"}'),
  (uuid_generate_v4(), 'REMEDY_CODE', 'CALIBRATE', 'Calibrate — instrument or protection re-calibrated',                       true, 80,  NULL, '{"iso14224":"B.5"}'),
  (uuid_generate_v4(), 'REMEDY_CODE', 'TEST',      'Test — function or proof test performed, no repair needed',               true, 90,  NULL, '{"iso14224":"B.5"}'),
  (uuid_generate_v4(), 'REMEDY_CODE', 'INSPECT',   'Inspect — inspected, condition recorded, no repair needed',               true, 100, NULL, '{"iso14224":"B.5"}'),
  (uuid_generate_v4(), 'REMEDY_CODE', 'RESET',     'Reset / restart — fault cleared by reset, cause not yet found',            true, 110, NULL, '{"iso14224":"B.5"}'),
  (uuid_generate_v4(), 'REMEDY_CODE', 'COMBINED',  'Combination — more than one of the above',                                true, 120, NULL, '{"iso14224":"B.5"}'),
  (uuid_generate_v4(), 'REMEDY_CODE', 'OTHER',     'Other — describe in the journal',                                         true, 130, NULL, '{"iso14224":"B.5"}')
ON CONFLICT (company_id, category, code) DO NOTHING;
