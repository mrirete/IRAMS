-- ============================================================
-- SEED: ERS Intelligence Demo Data
-- References real asset UUIDs from 0050_seed_ers_assets.sql
-- using uuid_generate_v5(ns, '<TAG>') pattern.
-- ============================================================

DO $$
DECLARE
  ns UUID := '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; -- DNS namespace (same as 0050)
  -- Asset UUIDs (deterministic)
  k601   UUID := uuid_generate_v5(ns, 'K-601');
  gt301  UUID := uuid_generate_v5(ns, 'GT-301');
  p102   UUID := uuid_generate_v5(ns, 'P-102');
  hx105  UUID := uuid_generate_v5(ns, 'HX-105');
  v602   UUID := uuid_generate_v5(ns, 'V-602');
  pmp411 UUID := uuid_generate_v5(ns, 'PMP-411');
  cmp201 UUID := uuid_generate_v5(ns, 'CMP-201');
  mv881  UUID := uuid_generate_v5(ns, 'MV-881');
  tk005  UUID := uuid_generate_v5(ns, 'TK-005');
  c902   UUID := uuid_generate_v5(ns, 'C-902');
  e605   UUID := uuid_generate_v5(ns, 'E-605');
  -- CML IDs (deterministic)
  cml1 UUID; cml2 UUID; cml3 UUID; cml4 UUID; cml5 UUID;
  cml6 UUID; cml7 UUID; cml8 UUID; cml9 UUID; cml10 UUID;
  -- FMEA worksheet ID
  fmea1 UUID;
  -- RCA IDs
  rca1 UUID; rca2 UUID;
BEGIN

-- ═══════════════════════════════════════════════════════════════
--  PREDICT: Twin States
-- ═══════════════════════════════════════════════════════════════
INSERT INTO ers_twin_states (asset_id, twin_id, health_index, calibration_quality, calibration_drift, sensor_summary, degradation_models, health_projection, last_calibrated_at)
VALUES
  (k601, 'twn-k601', 82.5, 94, 0.02,
   '{"Vib Radial (mm/s)": 4.2, "Vib Axial (mm/s)": 2.1, "Bearing Temp (°C)": 68.5, "Discharge Flow (m³/h)": 1240.2}'::jsonb,
   '[{"mechanism":"Bearing Wear","model_type":"L10 Lifetime","parameters":{"l10_base":50000},"current_damage_pct":17.5},{"mechanism":"Seal Degradation","model_type":"Linear Wear","parameters":{"wear_rate":0.003},"current_damage_pct":42.0}]'::jsonb,
   '[]'::jsonb, NOW()),
  (p102, 'twn-p102', 64.2, 78, 0.08,
   '{"Discharge Pressure (bar)": 14.8, "Suction Pressure (bar)": 2.1, "Motor Temp (°C)": 82.5, "Vibration (mm/s)": 6.8}'::jsonb,
   '[{"mechanism":"Impeller Erosion","model_type":"Exponential","parameters":{"rate":0.005},"current_damage_pct":55.0}]'::jsonb,
   '[]'::jsonb, NOW()),
  (gt301, 'twn-gt301', 91.0, 98, 0.01,
   '{"Exhaust Temp (°C)": 545.0, "Inlet Temp (°C)": 32.0, "Shaft Speed (RPM)": 14200, "Power Output (MW)": 24.8}'::jsonb,
   '[{"mechanism":"Hot Section Creep","model_type":"Larson-Miller","parameters":{"c":25},"current_damage_pct":8.0}]'::jsonb,
   '[]'::jsonb, NOW())
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
--  PREDICT: RUL Estimates
-- ═══════════════════════════════════════════════════════════════
INSERT INTO ers_rul_estimates (asset_id, rul_days, confidence, distribution_type, dqs_impact, governance_tier, confidence_bands)
VALUES
  (k601, 142.5, 0.88, 'weibull_2p', 0.02, 3,
   '[{"percentile":50,"lower_days":130,"upper_days":155,"median_days":142.5},{"percentile":80,"lower_days":110,"upper_days":180,"median_days":142.5},{"percentile":95,"lower_days":90,"upper_days":210,"median_days":142.5}]'::jsonb),
  (p102, 58.0, 0.72, 'lognormal', 0.08, 2,
   '[{"percentile":50,"lower_days":45,"upper_days":70,"median_days":58},{"percentile":80,"lower_days":30,"upper_days":90,"median_days":58},{"percentile":95,"lower_days":15,"upper_days":120,"median_days":58}]'::jsonb),
  (gt301, 320.0, 0.95, 'weibull_3p', 0.01, 3,
   '[{"percentile":50,"lower_days":300,"upper_days":340,"median_days":320},{"percentile":80,"lower_days":270,"upper_days":380,"median_days":320},{"percentile":95,"lower_days":240,"upper_days":420,"median_days":320}]'::jsonb)
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
--  PREDICT: Alerts
-- ═══════════════════════════════════════════════════════════════
INSERT INTO ers_prediction_alerts (alert_id, asset_id, alert_type, severity, title, description, confidence, dqs_impact, governance_tier)
VALUES
  ('alt-001', k601, 'trend_deviation', 'high', 'Accelerated Bearing Wear Detected',
   'Vibration signature in high-frequency band indicates early stage inner race spalling.', 0.92, 0.01, 3),
  ('alt-002', p102, 'threshold_breach', 'medium', 'Discharge Pressure Dropping',
   'Discharge pressure is 5% below expected dynamic threshold.', 0.85, 0.05, 2),
  ('alt-003', k601, 'anomaly', 'low', 'Minor Seal Leak Rate Increase',
   'Primary seal leak rate has increased by 12% over the past 72 hours.', 0.78, 0.0, 3)
ON CONFLICT (alert_id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
--  PREDICT: Sensor Readings (snapshot)
-- ═══════════════════════════════════════════════════════════════
INSERT INTO ers_sensor_readings (asset_id, tag, current_value, unit, trend, alarm_high, alarm_low)
VALUES
  (k601, 'Vib Radial (mm/s)', 4.2, 'mm/s', 'rising', 6.0, NULL),
  (k601, 'Vib Axial (mm/s)', 2.1, 'mm/s', 'stable', 4.0, NULL),
  (k601, 'Bearing Temp (°C)', 68.5, '°C', 'rising', 85, NULL),
  (k601, 'Discharge Flow (m³/h)', 1240.2, 'm³/h', 'falling', NULL, 1100),
  (p102, 'Discharge Pressure (bar)', 14.8, 'bar', 'falling', NULL, 13),
  (p102, 'Suction Pressure (bar)', 2.1, 'bar', 'stable', NULL, NULL),
  (p102, 'Motor Temp (°C)', 82.5, '°C', 'rising', 95, NULL),
  (p102, 'Vibration (mm/s)', 6.8, 'mm/s', 'rising', 8.0, NULL),
  (gt301, 'Exhaust Temp (°C)', 545.0, '°C', 'stable', 580, NULL),
  (gt301, 'Inlet Temp (°C)', 32.0, '°C', 'stable', NULL, NULL),
  (gt301, 'Shaft Speed (RPM)', 14200, 'RPM', 'stable', NULL, NULL),
  (gt301, 'Power Output (MW)', 24.8, 'MW', 'falling', NULL, 22)
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
--  INTEGRITY: CMLs
-- ═══════════════════════════════════════════════════════════════
cml1  := uuid_generate_v5(ns, 'CML-V205-01');  -- Note: V-602 used as proxy for V-205 (static vessel)
cml2  := uuid_generate_v5(ns, 'CML-V205-02');
cml3  := uuid_generate_v5(ns, 'CML-V205-03');
cml4  := uuid_generate_v5(ns, 'CML-HX405-01');
cml5  := uuid_generate_v5(ns, 'CML-HX405-02');
cml6  := uuid_generate_v5(ns, 'CML-P102-01');
cml7  := uuid_generate_v5(ns, 'CML-TK005-01');
cml8  := uuid_generate_v5(ns, 'CML-TK005-02');
cml9  := uuid_generate_v5(ns, 'CML-K601-01');
cml10 := uuid_generate_v5(ns, 'CML-GT301-01');

INSERT INTO ers_cmls (id, asset_id, cml_number, component_type, nominal_thickness_mm, tmin_mm, orientation)
VALUES
  (cml1,  v602,  'CML-V205-01', 'shell',             12.70, 6.35,  '12 o''clock'),
  (cml2,  v602,  'CML-V205-02', 'head',              15.90, 7.95,  'Top head'),
  (cml3,  v602,  'CML-V205-03', 'nozzle',            11.10, 5.55,  'N1 inlet'),
  (cml4,  hx105, 'CML-HX405-01','shell',             19.05, 9.52,  '6 o''clock'),
  (cml5,  hx105, 'CML-HX405-02','piping_elbow',       8.56, 3.18,  'Exit elbow'),
  (cml6,  p102,  'CML-P102-01', 'piping_straight',    7.11, 3.05,  'Discharge line'),
  (cml7,  tk005, 'CML-TK005-01','tank_shell_course', 25.40, 12.70, 'Course 1'),
  (cml8,  tk005, 'CML-TK005-02','tank_floor',         6.35, 3.18,  'NW quadrant'),
  (cml9,  k601,  'CML-K601-01', 'shell',             38.10, 19.05, '3 o''clock'),
  (cml10, gt301, 'CML-GT301-01','piping_tee',         9.52, 4.76,  'Fuel gas tee')
ON CONFLICT (cml_number) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
--  INTEGRITY: Thickness Readings
-- ═══════════════════════════════════════════════════════════════
INSERT INTO ers_thickness_readings (cml_id, reading_date, measured_thickness_mm, ut_method, technician)
VALUES
  (cml1, NOW() - INTERVAL '365 days', 11.20, 'ut_contact', 'D. Chen'),
  (cml1, NOW() - INTERVAL '180 days', 10.90, 'ut_contact', 'D. Chen'),
  (cml1, NOW() - INTERVAL '30 days',  10.40, 'paut',       'M. Okafor'),
  (cml4, NOW() - INTERVAL '200 days', 17.80, 'ut_contact', 'D. Chen'),
  (cml4, NOW() - INTERVAL '20 days',  16.50, 'paut',       'D. Chen'),
  (cml5, NOW() - INTERVAL '60 days',   4.10, 'ut_contact', 'M. Okafor'),
  (cml7, NOW() - INTERVAL '90 days',  23.10, 'ut_compression','A. Burton'),
  (cml8, NOW() - INTERVAL '90 days',   3.50, 'scan',       'A. Burton'),
  (cml9, NOW() - INTERVAL '45 days',  36.80, 'paut',       'D. Chen'),
  (cml6, NOW() - INTERVAL '15 days',   4.80, 'ut_contact', 'M. Okafor')
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
--  INTEGRITY: Corrosion Rates
-- ═══════════════════════════════════════════════════════════════
INSERT INTO ers_corrosion_rates (cml_id, asset_id, short_term_rate_mmpy, long_term_rate_mmpy, rate_type, is_accelerating, last_reading_date)
VALUES
  (cml1, v602,  0.30, 0.15, 'general', true,  NOW() - INTERVAL '30 days'),
  (cml4, hx105, 0.26, 0.22, 'general', false, NOW() - INTERVAL '20 days'),
  (cml5, hx105, 0.45, 0.18, 'pitting', true,  NOW() - INTERVAL '60 days'),
  (cml6, p102,  0.12, 0.10, 'general', false, NOW() - INTERVAL '15 days'),
  (cml7, tk005, 0.08, 0.07, 'general', false, NOW() - INTERVAL '90 days'),
  (cml8, tk005, 0.35, 0.12, 'pitting', true,  NOW() - INTERVAL '90 days')
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
--  INTEGRITY: RBI Assessments
-- ═══════════════════════════════════════════════════════════════
INSERT INTO ers_rbi_assessments (asset_id, governing_code, pof_score, cof_score, risk_rank, next_inspection_interval_months, next_inspection_due, assessor, assessed_date)
VALUES
  (v602,  'API 510',   4, 'C', 'Medium-High', 24, NOW() + INTERVAL '60 days',  'S. Jenkins', NOW() - INTERVAL '120 days'),
  (hx105, 'API 510',   3, 'B', 'Medium',      36, NOW() + INTERVAL '180 days', 'S. Jenkins', NOW() - INTERVAL '200 days'),
  (tk005, 'API 653',   5, 'A', 'Very High',   12, NOW() - INTERVAL '10 days',  'S. Jenkins', NOW() - INTERVAL '400 days'),
  (p102,  'ASME B31.3',2, 'D', 'Low',         60, NOW() + INTERVAL '500 days', 'N. Nagata',  NOW() - INTERVAL '180 days'),
  (k601,  'API 510',   4, 'A', 'High',        18, NOW() + INTERVAL '30 days',  'S. Jenkins', NOW() - INTERVAL '300 days')
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
--  INTEGRITY: IOW Parameters
-- ═══════════════════════════════════════════════════════════════
INSERT INTO ers_iow_parameters (asset_id, parameter_name, iow_type, unit, low_limit, high_limit, current_value, breach_status, last_breach_date)
VALUES
  (v602,  'Operating Temperature', 'critical',      '°C',       50,    175, 168,  'alert',  NOW() - INTERVAL '5 days'),
  (v602,  'Operating Pressure',    'critical',      'barg',     NULL,  45,  38,   'normal', NULL),
  (hx105, 'Shell-Side Inlet Temp', 'standard',      '°C',       NULL,  320, 335,  'breach', NOW() - INTERVAL '1 day'),
  (tk005, 'Product pH',            'standard',      'pH',       5.5,   8.5, 6.8,  'normal', NULL),
  (k601,  'Vibration Level',       'critical',      'mm/s RMS', NULL,  11.2,14.8, 'breach', NOW()),
  (gt301, 'Exhaust Gas Temp',      'informational', '°C',       NULL,  620, 595,  'normal', NULL)
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
--  INTEGRITY: Inspections
-- ═══════════════════════════════════════════════════════════════
INSERT INTO ers_inspections (asset_id, inspection_type, scheduled_date, status, findings_count, inspector)
VALUES
  (v602,  'UT',   NOW() + INTERVAL '3 days',   'scheduled',  0, 'D. Chen'),
  (hx105, 'PAUT', NOW() - INTERVAL '5 days',   'overdue',    0, 'M. Okafor'),
  (tk005, 'MFL',  NOW() + INTERVAL '10 days',  'scheduled',  0, 'A. Burton'),
  (k601,  'VT',   NOW() - INTERVAL '30 days',  'completed',  3, 'S. Jenkins'),
  (p102,  'PT',   NOW() + INTERVAL '15 days',  'scheduled',  0, 'M. Okafor'),
  (v602,  'RT',   NOW() - INTERVAL '60 days',  'completed',  1, 'D. Chen'),
  (gt301, 'MT',   NOW() + INTERVAL '7 days',   'scheduled',  0, 'A. Burton'),
  (hx105, 'VT',   NOW() - INTERVAL '15 days',  'completed',  2, 'D. Chen'),
  (tk005, 'UT',   NOW() + INTERVAL '25 days',  'scheduled',  0, 'D. Chen'),
  (k601,  'UT',   NOW() + INTERVAL '20 days',  'scheduled',  0, 'M. Okafor'),
  (v602,  'PAUT', NOW() + INTERVAL '45 days',  'scheduled',  0, 'D. Chen')
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
--  INTEGRITY: Damage Mechanisms (API 571)
-- ═══════════════════════════════════════════════════════════════
INSERT INTO ers_damage_mechanisms (api_571_code, mechanism_name, description, status, source, affected_asset_ids)
VALUES
  ('4.3.3',   'CUI (Corrosion Under Insulation)',
   'External corrosion on carbon steel beneath wet or damaged insulation in the 50–175°C range.',
   'active', 'engineer_confirmed', ('["' || v602 || '","' || hx105 || '"]')::jsonb),
  ('4.5.3',   'Sulfidation (H₂S Corrosion)',
   'High-temperature corrosion in H₂S-containing environments above 260°C.',
   'susceptible', 'historical', ('["' || gt301 || '"]')::jsonb),
  ('5.1.2.3', 'HIC (Hydrogen-Induced Cracking)',
   'Blistering and internal cracking from wet H₂S service causing hydrogen charging.',
   'active', 'engineer_confirmed', ('["' || v602 || '"]')::jsonb),
  ('4.2.16',  'HTHA (High-Temperature Hydrogen Attack)',
   'Decarburization and fissuring in steels exposed to high temperature/pressure hydrogen.',
   'latent', 'ai_suggested', ('["' || k601 || '"]')::jsonb),
  ('4.5.1',   'Chloride SCC',
   'Stress corrosion cracking of austenitic stainless steels in chloride-containing environments.',
   'susceptible', 'ai_suggested', ('["' || hx105 || '"]')::jsonb),
  ('4.3.8',   'Microbiologically-Influenced Corrosion (MIC)',
   'Corrosion in stagnant water legs and tank bottoms caused by sulfate-reducing bacteria.',
   'active', 'historical', ('["' || tk005 || '"]')::jsonb),
  ('4.2.7',   'Erosion-Corrosion',
   'Metal loss from combined erosion and corrosion in high-velocity or turbulent flow.',
   'susceptible', 'ai_suggested', ('["' || p102 || '"]')::jsonb),
  ('4.3.9',   'Soil-Side Corrosion',
   'External corrosion on buried piping and tank bottoms from soil moisture and chemistry.',
   'active', 'engineer_confirmed', ('["' || tk005 || '"]')::jsonb)
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
--  INTEGRITY: FFS Assessments (API 579)
-- ═══════════════════════════════════════════════════════════════
INSERT INTO ers_ffs_assessments (asset_id, api_579_part, level, status, rsf, remaining_life_years, assessor, assessed_date, recommended_action)
VALUES
  (v602,  'Part 4 — General Metal Loss', 'Level 1', 'passed',     0.82, 8.5, 'S. Jenkins', NOW() - INTERVAL '60 days',  'Continue monitoring. Next assessment in 4 years.'),
  (hx105, 'Part 6 — Pitting',            'Level 2', 'failed',     0.58, 1.2, 'S. Jenkins', NOW() - INTERVAL '30 days',  'Weld overlay repair required. Generate WO immediately.'),
  (tk005, 'Part 5 — Local Metal Loss',   'Level 1', 'monitoring', 0.71, 3.0, 'N. Nagata',  NOW() - INTERVAL '90 days',  'Increase inspection frequency to 6-monthly. Monitor CML-TK005-02.')
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
--  ANALYZE: FMEA
-- ═══════════════════════════════════════════════════════════════
fmea1 := uuid_generate_v5(ns, 'FMEA-CMP201');

INSERT INTO ers_fmea_worksheets (id, asset_id, title, fmea_type, status, max_rpn, avg_rpn, high_risk_count)
VALUES (fmea1, cmp201, 'Centrifugal Compressor FMEA', 'equipment', 'active', 280, 85, 3)
ON CONFLICT DO NOTHING;

INSERT INTO ers_fmea_items (worksheet_id, component, "function", failure_mode, failure_effect, failure_cause, severity, occurrence, detection, current_controls, recommended_action, action_status)
VALUES
  (fmea1, 'Radial Bearing',  'Support rotor radially', 'Babbitt fatigue/wiping',
   'High vibration, rotor contact', 'Lube oil starvation', 8, 4, 3,
   'Vibration monitoring (monthly route)', 'Install continuous vibration sensors', 'open'),
  (fmea1, 'Dry Gas Seal',    'Prevent gas leakage', 'O-ring explosive decompression',
   'Gas leak, unit trip', 'Rapid depressurization', 10, 2, 2,
   'Slow depressurization procedure', NULL, 'closed'),
  (fmea1, 'Thrust Bearing',  'Absorb axial loads', 'Overload wiping',
   'Rotor crash, extensive damage', 'Surge event', 10, 4, 7,
   'Anti-surge valve', 'Recalibrate anti-surge controller tuning', 'open'),
  (fmea1, 'Lube Oil Pump',   'Circulate lube oil', 'Low oil pressure',
   'Bearing damage', 'Filter blockage', 7, 3, 4,
   'dP alarm on filter', 'Add redundant oil pump', 'open'),
  (fmea1, 'Coupling',        'Transmit torque', 'Misalignment fatigue',
   'Vibration, premature failure', 'Foundation settling', 6, 2, 5,
   'Laser alignment on overhaul', NULL, 'closed')
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
--  ANALYZE: RCA
-- ═══════════════════════════════════════════════════════════════
rca1 := uuid_generate_v5(ns, 'RCA-PMP411-SEAL');
rca2 := uuid_generate_v5(ns, 'RCA-C902-BELT');

INSERT INTO ers_rca_investigations (id, asset_id, title, method, status, problem_statement, root_cause_summary)
VALUES
  (rca1, pmp411, 'Premature Seal Failure', 'five_why', 'review',
   'Mechanical seal failed after only 3 weeks of operation, causing a tier 2 environmental spill.',
   'Incorrect seal face material selected during procurement due to undocumented process fluid change (higher H2S content).'),
  (rca2, c902, 'Repeated Belt Failures', 'fishbone', 'in_progress',
   'Conveyor belts snapping every 3-4 months, well below expected 24 month lifespan.',
   NULL)
ON CONFLICT DO NOTHING;

INSERT INTO ers_rca_nodes (investigation_id, parent_id, node_type, description, depth, is_root_cause)
VALUES
  -- RCA 1: 5-Why tree
  (rca1, NULL, 'problem', 'Mechanical seal failed prematurely', 0, false),
  (rca1, NULL, 'why', 'Seal faces became heavily pitted', 1, false),
  (rca1, NULL, 'why', 'Material chemically attacked by process fluid', 2, false),
  (rca1, NULL, 'why', 'Procurement ordered standard material', 3, false),
  (rca1, NULL, 'root_cause', 'MoC process was not followed when process fluid composition was changed', 4, true),
  -- RCA 2: Fishbone (partial)
  (rca2, NULL, 'problem', 'Belt snapping every 3-4 months', 0, false),
  (rca2, NULL, 'category', 'Material — belt grade below specification', 1, false),
  (rca2, NULL, 'category', 'Machine — idler roller seizure causing hot spots', 1, false)
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
--  ANALYZE: Bad Actor Snapshot (February 2026)
-- ═══════════════════════════════════════════════════════════════
INSERT INTO ers_bad_actor_snapshots (report_period, criteria, pareto_threshold_pct, total_assets_analyzed, top_assets)
VALUES
  ('2026-02', 'cost', 80, 1450, ('[
    {"asset_id":"' || pmp411 || '","asset_name":"Boiler Feed Pump B","rank":1,"metric_value":125000,"metric_unit":"$","pct_of_total":25.5,"cumulative_pct":25.5,"trend":"worsening","previous_rank":3},
    {"asset_id":"' || cmp201 || '","asset_name":"Main Air Compressor","rank":2,"metric_value":85000,"metric_unit":"$","pct_of_total":17.3,"cumulative_pct":42.8,"trend":"stable","previous_rank":2},
    {"asset_id":"' || hx105  || '","asset_name":"Overhead Condenser","rank":3,"metric_value":55000,"metric_unit":"$","pct_of_total":11.2,"cumulative_pct":54.0,"trend":"improving","previous_rank":1},
    {"asset_id":"' || mv881  || '","asset_name":"Inlet Block Valve","rank":4,"metric_value":25000,"metric_unit":"$","pct_of_total":5.1,"cumulative_pct":59.1,"trend":"stable","previous_rank":4},
    {"asset_id":"' || tk005  || '","asset_name":"Slop Oil Tank","rank":5,"metric_value":16700,"metric_unit":"$","pct_of_total":3.4,"cumulative_pct":62.5,"trend":"worsening","previous_rank":12}
  ]')::jsonb),
  ('2026-02', 'downtime', 80, 1450, ('[
    {"asset_id":"' || cmp201 || '","asset_name":"Main Air Compressor","rank":1,"metric_value":480,"metric_unit":"hrs","pct_of_total":22.0,"cumulative_pct":22.0,"trend":"worsening","previous_rank":1},
    {"asset_id":"' || pmp411 || '","asset_name":"Boiler Feed Pump B","rank":2,"metric_value":310,"metric_unit":"hrs","pct_of_total":14.2,"cumulative_pct":36.2,"trend":"stable","previous_rank":3},
    {"asset_id":"' || c902   || '","asset_name":"Conveyor Belt C-902","rank":3,"metric_value":255,"metric_unit":"hrs","pct_of_total":11.7,"cumulative_pct":47.9,"trend":"worsening","previous_rank":8},
    {"asset_id":"' || hx105  || '","asset_name":"Overhead Condenser","rank":4,"metric_value":180,"metric_unit":"hrs","pct_of_total":8.3,"cumulative_pct":56.2,"trend":"improving","previous_rank":2},
    {"asset_id":"' || tk005  || '","asset_name":"Slop Oil Tank","rank":5,"metric_value":95,"metric_unit":"hrs","pct_of_total":4.4,"cumulative_pct":60.6,"trend":"stable","previous_rank":5}
  ]')::jsonb),
  ('2026-02', 'wo_frequency', 80, 1450, ('[
    {"asset_id":"' || c902   || '","asset_name":"Conveyor Belt C-902","rank":1,"metric_value":42,"metric_unit":"WOs","pct_of_total":18.5,"cumulative_pct":18.5,"trend":"worsening","previous_rank":2},
    {"asset_id":"' || pmp411 || '","asset_name":"Boiler Feed Pump B","rank":2,"metric_value":35,"metric_unit":"WOs","pct_of_total":15.4,"cumulative_pct":33.9,"trend":"stable","previous_rank":1},
    {"asset_id":"' || cmp201 || '","asset_name":"Main Air Compressor","rank":3,"metric_value":28,"metric_unit":"WOs","pct_of_total":12.3,"cumulative_pct":46.2,"trend":"stable","previous_rank":3},
    {"asset_id":"' || mv881  || '","asset_name":"Inlet Block Valve","rank":4,"metric_value":18,"metric_unit":"WOs","pct_of_total":7.9,"cumulative_pct":54.1,"trend":"improving","previous_rank":4},
    {"asset_id":"' || hx105  || '","asset_name":"Overhead Condenser","rank":5,"metric_value":12,"metric_unit":"WOs","pct_of_total":5.3,"cumulative_pct":59.4,"trend":"stable","previous_rank":6}
  ]')::jsonb)
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
--  VISION: Results
-- ═══════════════════════════════════════════════════════════════
INSERT INTO ers_vision_results (asset_id, image_name, analysis_type, detected_items, max_severity, reviewed, timestamp)
VALUES
  (v602,  'V205_shell_12oclock.jpg',   'corrosion',  3, 'moderate', true,  NOW() - INTERVAL '5 days'),
  (hx105, 'HX405_exit_elbow.jpg',      'corrosion',  7, 'severe',   false, NOW() - INTERVAL '3 days'),
  (gt301, 'GT301_exhaust_thermal.ir',   'thermal',    2, 'moderate', false, NOW() - INTERVAL '2 days'),
  (tk005, 'TK801_roof_drone.jpg',       'condition',  4, 'critical', false, NOW() - INTERVAL '1 day'),
  (p102,  'P102_nameplate.jpg',         'tagging',    1, 'minor',    true,  NOW() - INTERVAL '7 days')
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
--  VISION: Drone Surveys
-- ═══════════════════════════════════════════════════════════════
INSERT INTO ers_drone_surveys (survey_name, date, area_covered_sqm, anomalies_found, reviewed)
VALUES
  ('Tank Farm Q1 Aerial',       NOW() - INTERVAL '10 days', 45000, 6, true),
  ('Platform Alpha Topside',    NOW() - INTERVAL '3 days',  12000, 3, false)
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
--  SUSTAIN: Carbon Metrics
-- ═══════════════════════════════════════════════════════════════
INSERT INTO ers_carbon_metrics (asset_id, asset_name, scope1_tco2, scope2_tco2, reporting_period)
VALUES
  (gt301, 'Gas Turbine GT-301',       12400, 850,  '2026-Q1'),
  (k601,  'Gas Compressor K-601',      8200, 1200, '2026-Q1'),
  (p102,  'Booster Pump P-102',           0, 340,  '2026-Q1')
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
--  SUSTAIN: Climate Risks
-- ═══════════════════════════════════════════════════════════════
INSERT INTO ers_climate_risks (asset_id, asset_name, risk_level, risk_factors, vulnerability_score)
VALUES
  (tk005, 'Slop Oil Tank TK-005',     'high',     '["Storm surge flooding","High wind — roof uplift"]'::jsonb, 78),
  (gt301, 'Gas Turbine GT-301',       'moderate', '["Extreme heat — derating","Sandstorm abrasion"]'::jsonb,  52),
  (p102,  'Booster Pump P-102',       'low',      '["Flooding (low probability)"]'::jsonb,                    22)
ON CONFLICT DO NOTHING;

END $$;
