-- ============================================================
-- SEED: Demo Work Orders + Failure Data
-- Adds failure_mode/failure_code columns to work_orders
-- Seeds 45+ realistic oil & gas maintenance records
-- across key equipment: K-601, P-101-A, GT-301, CMP-201, PMP-411
-- ============================================================

-- 1. Add failure_mode and failure_code columns to work_orders
--    (pullMaintenanceData queries these directly)
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS failure_mode TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS failure_code TEXT;

-- 2. Seed Work Orders
-- Pattern: wo_number, title, status, type, priority_code, asset_id (by tag),
--          description, failure_mode, failure_code, created_at, closed_at, cost fields

-- ═══════════════════════════════════════════
-- K-601 Gas Compressor (14 WOs — bad actor)
-- ═══════════════════════════════════════════
INSERT INTO work_orders (wo_number, title, status, type, priority_code, asset_id, description, failure_mode, failure_code, created_at, closed_at, frozen_labor_cost, frozen_material_cost, cost_frozen)
VALUES
  ('WO-2025-0001', 'K-601 High Vibration Alarm — 1X radial', 'TECO', 'CM', 'P1',
    (SELECT id FROM assets WHERE tag = 'K-601'),
    'Vibration on DE radial probe exceeded 5 mil pk-pk. Emergency shutdown initiated. Root cause: rotor imbalance from deposit buildup.',
    'Vibration Excess', 'FM-VIB-01', '2025-01-15 08:30:00+00', '2025-01-18 16:00:00+00', 4500.00, 1200.00, true),

  ('WO-2025-0014', 'K-601 Dry Gas Seal leak rate above threshold', 'TECO', 'CM', 'P1',
    (SELECT id FROM assets WHERE tag = 'K-601'),
    'Primary DGS leak rate at 18 scfm (limit 12 scfm). Replaced primary seal cartridge.',
    'Seal Leakage', 'FM-SEL-01', '2025-02-03 06:00:00+00', '2025-02-07 14:00:00+00', 8200.00, 32000.00, true),

  ('WO-2025-0029', 'K-601 Thrust Bearing temp high — 142°C', 'TECO', 'CM', 'P2',
    (SELECT id FROM assets WHERE tag = 'K-601'),
    'Thrust bearing temperature trended up over 48 hrs. Bearing replaced during mini-turnaround.',
    'Bearing Failure', 'FM-BRG-01', '2025-03-10 10:00:00+00', '2025-03-14 09:00:00+00', 6100.00, 18500.00, true),

  ('WO-2025-0041', 'K-601 Annual Performance Test', 'TECO', 'PM', 'P3',
    (SELECT id FROM assets WHERE tag = 'K-601'),
    'Annual Grade A performance test per OEM schedule. Polytropic efficiency at 78% (baseline 81%).',
    NULL, NULL, '2025-04-01 07:00:00+00', '2025-04-02 18:00:00+00', 3200.00, 0.00, true),

  ('WO-2025-0058', 'K-601 Surge event — investigate anti-surge valve', 'TECO', 'CM', 'P1',
    (SELECT id FROM assets WHERE tag = 'K-601'),
    'Compressor surged 3x during load rejection. Anti-surge valve response time slow (>2s). Recalibrated positioner.',
    'Surge Event', 'FM-SRG-01', '2025-05-12 14:00:00+00', '2025-05-13 22:00:00+00', 2800.00, 450.00, true),

  ('WO-2025-0073', 'K-601 Lube oil filter ΔP high', 'TECO', 'PM', 'P3',
    (SELECT id FROM assets WHERE tag = 'K-601'),
    'Differential pressure across lube oil filter at 22 psid (alarm 18). Replaced filter element.',
    NULL, NULL, '2025-06-18 09:00:00+00', '2025-06-18 14:00:00+00', 600.00, 350.00, true),

  ('WO-2025-0089', 'K-601 Vibration — coupling misalignment', 'TECO', 'CM', 'P2',
    (SELECT id FROM assets WHERE tag = 'K-601'),
    'Coupling guard removed, found 8 mil offset misalignment. Laser-aligned motor and compressor shafts.',
    'Vibration Excess', 'FM-VIB-01', '2025-07-22 06:30:00+00', '2025-07-24 17:00:00+00', 3900.00, 200.00, true),

  ('WO-2025-0102', 'K-601 Quarterly vibration route', 'TECO', 'PM', 'P4',
    (SELECT id FROM assets WHERE tag = 'K-601'),
    'Routine vibration data collection. DE axial trending upward — 2.8 mil (alert 3.5). Scheduled follow-up.',
    NULL, NULL, '2025-08-15 08:00:00+00', '2025-08-15 11:00:00+00', 400.00, 0.00, true),

  ('WO-2025-0118', 'K-601 Radial bearing replacement (planned)', 'TECO', 'CM', 'P2',
    (SELECT id FROM assets WHERE tag = 'K-601'),
    'DE radial bearing vibration exceeded 3.5 mil alert. Planned replacement during process unit trip.',
    'Bearing Failure', 'FM-BRG-01', '2025-09-05 07:00:00+00', '2025-09-08 19:00:00+00', 5500.00, 15000.00, true),

  ('WO-2025-0134', 'K-601 Process seal gas supply pressure low', 'TECO', 'CM', 'P1',
    (SELECT id FROM assets WHERE tag = 'K-601'),
    'Seal gas pressure dropped below minimum. Traced to a plugged coalescing filter. Replaced dual filter elements.',
    'Seal Leakage', 'FM-SEL-01', '2025-10-01 05:00:00+00', '2025-10-01 16:00:00+00', 1200.00, 800.00, true),

  ('WO-2025-0147', 'K-601 Governor valve actuator sticking', 'TECO', 'CM', 'P2',
    (SELECT id FROM assets WHERE tag = 'K-601'),
    'Speed control oscillation traced to sticking actuator on suction throttle valve. Cleaned and recalibrated.',
    'Control System Failure', 'FM-CTL-01', '2025-10-28 13:00:00+00', '2025-10-29 18:00:00+00', 2200.00, 300.00, true),

  ('WO-2025-0160', 'K-601 Annual turnaround — full inspection', 'TECO', 'PM', 'P3',
    (SELECT id FROM assets WHERE tag = 'K-601'),
    'Annual turnaround inspection. Bundle pulled, diaphragms inspected, labyrinth seals measured. All within tolerance.',
    NULL, NULL, '2025-11-10 06:00:00+00', '2025-11-15 18:00:00+00', 28000.00, 8500.00, true),

  ('WO-2025-0178', 'K-601 High discharge temperature', 'TECO', 'CM', 'P2',
    (SELECT id FROM assets WHERE tag = 'K-601'),
    'Discharge temp at 195°C (limit 190°C). Intercooler fouled; cleaned tube bundle.',
    'Overheating', 'FM-TMP-01', '2025-12-05 09:00:00+00', '2025-12-07 17:00:00+00', 3100.00, 400.00, true),

  ('WO-2026-0008', 'K-601 DGS primary vent leak', 'WIP', 'CM', 'P1',
    (SELECT id FROM assets WHERE tag = 'K-601'),
    'Primary vent leak rate rising. Monitoring — scheduled for next process window.',
    'Seal Leakage', 'FM-SEL-01', '2026-01-20 08:00:00+00', NULL, NULL, NULL, false)
ON CONFLICT (wo_number) DO NOTHING;

-- ═══════════════════════════════════════════
-- P-101-A Primary Feed Pump (10 WOs)
-- ═══════════════════════════════════════════
INSERT INTO work_orders (wo_number, title, status, type, priority_code, asset_id, description, failure_mode, failure_code, created_at, closed_at, frozen_labor_cost, frozen_material_cost, cost_frozen)
VALUES
  ('WO-2025-0003', 'P-101-A Mechanical seal leak — drip rate', 'TECO', 'CM', 'P2',
    (SELECT id FROM assets WHERE tag = 'P-101-A'),
    'Seal leak rate increased to 3 drops/min. Replaced mech seal cartridge. Root cause: thermal shock from rapid startup.',
    'Seal Leakage', 'FM-SEL-01', '2025-01-22 07:00:00+00', '2025-01-24 16:00:00+00', 3800.00, 6500.00, true),

  ('WO-2025-0019', 'P-101-A Quarterly impeller clearance check', 'TECO', 'PM', 'P4',
    (SELECT id FROM assets WHERE tag = 'P-101-A'),
    'Measured impeller running clearance at 22 thou (limit 30). Acceptable. Next check Q2.',
    NULL, NULL, '2025-02-15 08:00:00+00', '2025-02-15 12:00:00+00', 500.00, 0.00, true),

  ('WO-2025-0035', 'P-101-A DE bearing vibration alarm', 'TECO', 'CM', 'P2',
    (SELECT id FROM assets WHERE tag = 'P-101-A'),
    'DE bearing vibration at 4.2 mm/s (alarm 4.0). Bearing replaced; inner race pitting found.',
    'Bearing Failure', 'FM-BRG-01', '2025-03-20 10:00:00+00', '2025-03-22 15:00:00+00', 2200.00, 1800.00, true),

  ('WO-2025-0052', 'P-101-A Coupling guard inspection', 'TECO', 'PM', 'P4',
    (SELECT id FROM assets WHERE tag = 'P-101-A'),
    'Semi-annual coupling guard inspection per safety procedure. No defects found.',
    NULL, NULL, '2025-04-28 09:00:00+00', '2025-04-28 11:00:00+00', 300.00, 0.00, true),

  ('WO-2025-0068', 'P-101-A Cavitation noise at low flow', 'TECO', 'CM', 'P2',
    (SELECT id FROM assets WHERE tag = 'P-101-A'),
    'Cavitation damage on impeller eye after extended minimum-flow recirculation. Trim impeller replaced.',
    'Cavitation', 'FM-CAV-01', '2025-06-05 14:00:00+00', '2025-06-08 18:00:00+00', 4100.00, 7200.00, true),

  ('WO-2025-0085', 'P-101-A Motor insulation resistance test', 'TECO', 'PM', 'P3',
    (SELECT id FROM assets WHERE tag = 'P-101-A'),
    'Annual megger test — 250 MΩ at 1 kV (min acceptable 5 MΩ). Motor in good condition.',
    NULL, NULL, '2025-07-10 07:00:00+00', '2025-07-10 10:00:00+00', 400.00, 0.00, true),

  ('WO-2025-0099', 'P-101-A NDE bearing temperature high', 'TECO', 'CM', 'P2',
    (SELECT id FROM assets WHERE tag = 'P-101-A'),
    'NDE bearing temp at 95°C (alarm 90°C). Re-greased with correct qty (35g). Temp stabilized.',
    'Bearing Failure', 'FM-BRG-01', '2025-08-03 11:00:00+00', '2025-08-03 16:00:00+00', 600.00, 50.00, true),

  ('WO-2025-0115', 'P-101-A Suction strainer differential high', 'TECO', 'CM', 'P3',
    (SELECT id FROM assets WHERE tag = 'P-101-A'),
    'Suction strainer ΔP at 0.8 bar (alarm 0.5). Cleaned Y-strainer basket — debris from upstream pigging.',
    'Blockage', 'FM-BLK-01', '2025-09-12 06:00:00+00', '2025-09-12 14:00:00+00', 800.00, 0.00, true),

  ('WO-2025-0131', 'P-101-A Annual overhaul', 'TECO', 'PM', 'P3',
    (SELECT id FROM assets WHERE tag = 'P-101-A'),
    'Full overhaul: bearings replaced, mech seal inspected, coupling re-aligned, wear rings measured. All within spec.',
    NULL, NULL, '2025-10-20 06:00:00+00', '2025-10-24 18:00:00+00', 12000.00, 4500.00, true),

  ('WO-2026-0002', 'P-101-A Seal flush plan piping leak', 'OPEN', 'CM', 'P2',
    (SELECT id FROM assets WHERE tag = 'P-101-A'),
    'Small piping leak at seal flush plan 54 connection. Scheduled for next available window.',
    'External Leakage', 'FM-LEK-01', '2026-02-10 08:00:00+00', NULL, NULL, NULL, false)
ON CONFLICT (wo_number) DO NOTHING;

-- ═══════════════════════════════════════════
-- GT-301 Gas Turbine (8 WOs)
-- ═══════════════════════════════════════════
INSERT INTO work_orders (wo_number, title, status, type, priority_code, asset_id, description, failure_mode, failure_code, created_at, closed_at, frozen_labor_cost, frozen_material_cost, cost_frozen)
VALUES
  ('WO-2025-0005', 'GT-301 Combustion inspection (CI)', 'TECO', 'PM', 'P3',
    (SELECT id FROM assets WHERE tag = 'GT-301'),
    'Scheduled combustion inspection at 25,000 hrs. Replaced 6 transition pieces + 2 liners with minor cracking.',
    NULL, NULL, '2025-01-28 06:00:00+00', '2025-02-04 18:00:00+00', 45000.00, 120000.00, true),

  ('WO-2025-0032', 'GT-301 Compressor washing — online', 'TECO', 'PM', 'P4',
    (SELECT id FROM assets WHERE tag = 'GT-301'),
    'Online compressor wash with approved detergent. Power output recovered 1.2 MW.',
    NULL, NULL, '2025-03-15 04:00:00+00', '2025-03-15 06:00:00+00', 200.00, 150.00, true),

  ('WO-2025-0055', 'GT-301 Exhaust thermocouple failure', 'TECO', 'CM', 'P2',
    (SELECT id FROM assets WHERE tag = 'GT-301'),
    'Exhaust T/C #7 reading erratic. Replaced type-K thermocouple and sheath.',
    'Instrumentation Failure', 'FM-INS-01', '2025-05-02 13:00:00+00', '2025-05-03 10:00:00+00', 1500.00, 800.00, true),

  ('WO-2025-0071', 'GT-301 Fuel gas pressure transmitter calibration', 'TECO', 'PM', 'P3',
    (SELECT id FROM assets WHERE tag = 'GT-301'),
    'Annual calibration of fuel gas pressure transmitter PT-301A. Within ±0.1% accuracy.',
    NULL, NULL, '2025-06-20 08:00:00+00', '2025-06-20 12:00:00+00', 300.00, 0.00, true),

  ('WO-2025-0094', 'GT-301 Hot gas path inspection (HGPI)', 'TECO', 'PM', 'P2',
    (SELECT id FROM assets WHERE tag = 'GT-301'),
    'Major HGPI at 50,000 equivalent hrs. Stage 1 nozzle refurbished, stage 2 buckets replaced. Clearances restored.',
    NULL, NULL, '2025-07-28 06:00:00+00', '2025-08-11 18:00:00+00', 85000.00, 250000.00, true),

  ('WO-2025-0121', 'GT-301 Bearing #1 oil drain temp high', 'TECO', 'CM', 'P2',
    (SELECT id FROM assets WHERE tag = 'GT-301'),
    'Bearing #1 oil drain temp 10°C above normal. Oil analysis showed metallic particles. Bearing inspected and polished.',
    'Bearing Failure', 'FM-BRG-01', '2025-09-18 07:00:00+00', '2025-09-20 16:00:00+00', 7500.00, 2200.00, true),

  ('WO-2025-0149', 'GT-301 Generator stator cooling water leak', 'TECO', 'CM', 'P1',
    (SELECT id FROM assets WHERE tag = 'GT-301'),
    'Leak found on generator stator cooling water manifold. Emergency repair — brazed connection and tested at 5 bar.',
    'External Leakage', 'FM-LEK-01', '2025-11-02 04:00:00+00', '2025-11-03 22:00:00+00', 5500.00, 1200.00, true),

  ('WO-2026-0005', 'GT-301 Offline compressor wash', 'TECO', 'PM', 'P3',
    (SELECT id FROM assets WHERE tag = 'GT-301'),
    'Scheduled offline wash. Axial compressor efficiency recovered to 88.5% (was 86.2%).',
    NULL, NULL, '2026-01-08 05:00:00+00', '2026-01-08 18:00:00+00', 1200.00, 300.00, true)
ON CONFLICT (wo_number) DO NOTHING;

-- ═══════════════════════════════════════════
-- CMP-201 Main Air Compressor (7 WOs)
-- ═══════════════════════════════════════════
INSERT INTO work_orders (wo_number, title, status, type, priority_code, asset_id, description, failure_mode, failure_code, created_at, closed_at, frozen_labor_cost, frozen_material_cost, cost_frozen)
VALUES
  ('WO-2025-0009', 'CMP-201 Inlet filter differential pressure high', 'TECO', 'PM', 'P3',
    (SELECT id FROM assets WHERE tag = 'CMP-201'),
    'Inlet air filter ΔP at 250 mmWG (alarm 200). Replaced all 24 filter elements.',
    NULL, NULL, '2025-02-01 08:00:00+00', '2025-02-01 16:00:00+00', 800.00, 3600.00, true),

  ('WO-2025-0025', 'CMP-201 Oil separator element change', 'TECO', 'PM', 'P3',
    (SELECT id FROM assets WHERE tag = 'CMP-201'),
    'Scheduled oil separator element change at 8000 hrs. Oil carryover now <2 ppm.',
    NULL, NULL, '2025-03-05 07:00:00+00', '2025-03-05 15:00:00+00', 600.00, 2200.00, true),

  ('WO-2025-0045', 'CMP-201 Unloader valve sticking — capacity control', 'TECO', 'CM', 'P2',
    (SELECT id FROM assets WHERE tag = 'CMP-201'),
    'Compressor stuck at 100% capacity, unloader valve jammed. Cleaned valve and replaced diaphragm.',
    'Control System Failure', 'FM-CTL-01', '2025-04-15 11:00:00+00', '2025-04-16 14:00:00+00', 1500.00, 400.00, true),

  ('WO-2025-0063', 'CMP-201 Motor overheating — ventilation blocked', 'TECO', 'CM', 'P2',
    (SELECT id FROM assets WHERE tag = 'CMP-201'),
    'Motor winding temp at 155°C (class F limit 155°C). Air intake louvers blocked by debris. Cleaned and inspected.',
    'Overheating', 'FM-TMP-01', '2025-05-28 13:00:00+00', '2025-05-29 10:00:00+00', 900.00, 0.00, true),

  ('WO-2025-0082', 'CMP-201 Air dryer desiccant replacement', 'TECO', 'PM', 'P3',
    (SELECT id FROM assets WHERE tag = 'CMP-201'),
    'Bi-annual desiccant replacement on heatless air dryer. Dew point restored to -40°C.',
    NULL, NULL, '2025-07-03 06:00:00+00', '2025-07-04 18:00:00+00', 1200.00, 5500.00, true),

  ('WO-2025-0110', 'CMP-201 Inter-stage cooler tube leak', 'TECO', 'CM', 'P2',
    (SELECT id FROM assets WHERE tag = 'CMP-201'),
    'Water in compressed air downstream of inter-cooler. Found 2 leaking tubes. Plugged and tested.',
    'Internal Leakage', 'FM-LEK-02', '2025-08-25 09:00:00+00', '2025-08-27 17:00:00+00', 2800.00, 200.00, true),

  ('WO-2025-0155', 'CMP-201 Safety valve annual test', 'TECO', 'PM', 'P3',
    (SELECT id FROM assets WHERE tag = 'CMP-201'),
    'Annual PSV test and recertification. Set pressure 10.5 barg, popped at 10.6 barg — within tolerance.',
    NULL, NULL, '2025-11-05 07:00:00+00', '2025-11-05 14:00:00+00', 500.00, 0.00, true)
ON CONFLICT (wo_number) DO NOTHING;

-- ═══════════════════════════════════════════
-- PMP-411 Boiler Feed Pump B (6 WOs)
-- ═══════════════════════════════════════════
INSERT INTO work_orders (wo_number, title, status, type, priority_code, asset_id, description, failure_mode, failure_code, created_at, closed_at, frozen_labor_cost, frozen_material_cost, cost_frozen)
VALUES
  ('WO-2025-0012', 'PMP-411 Mechanical seal failure — catastrophic', 'TECO', 'CM', 'P1',
    (SELECT id FROM assets WHERE tag = 'PMP-411'),
    'Catastrophic mech seal failure. Hot BFW leak flooded pump skid. Emergency isolation. Seal faces scored — replaced.',
    'Seal Leakage', 'FM-SEL-01', '2025-02-08 03:00:00+00', '2025-02-11 18:00:00+00', 6200.00, 9800.00, true),

  ('WO-2025-0038', 'PMP-411 Quarterly vibration check', 'TECO', 'PM', 'P4',
    (SELECT id FROM assets WHERE tag = 'PMP-411'),
    'Vibration data collection. DE 2.1 mm/s, NDE 1.8 mm/s — both well within limits.',
    NULL, NULL, '2025-03-25 08:00:00+00', '2025-03-25 10:00:00+00', 300.00, 0.00, true),

  ('WO-2025-0061', 'PMP-411 Coupling alignment check post-piping work', 'TECO', 'PM', 'P3',
    (SELECT id FROM assets WHERE tag = 'PMP-411'),
    'Piping contractor modified BFW header. Laser alignment confirmed 2 mil offset, 0.5 mil angular — within spec.',
    NULL, NULL, '2025-05-20 09:00:00+00', '2025-05-20 14:00:00+00', 800.00, 0.00, true),

  ('WO-2025-0092', 'PMP-411 High vibration — foundation bolt loose', 'TECO', 'CM', 'P2',
    (SELECT id FROM assets WHERE tag = 'PMP-411'),
    'Sudden vibration increase to 6.5 mm/s. Found 2 of 4 foundation bolts loose. Re-torqued and grouted.',
    'Vibration Excess', 'FM-VIB-01', '2025-07-30 16:00:00+00', '2025-08-01 12:00:00+00', 1500.00, 200.00, true),

  ('WO-2025-0128', 'PMP-411 Annual overhaul', 'TECO', 'PM', 'P3',
    (SELECT id FROM assets WHERE tag = 'PMP-411'),
    'Complete pump overhaul. All wear parts replaced, hydraulic test passed at 1.5x design pressure.',
    NULL, NULL, '2025-10-12 06:00:00+00', '2025-10-17 18:00:00+00', 14000.00, 7500.00, true),

  ('WO-2026-0011', 'PMP-411 Discharge check valve chattering', 'OPEN', 'CM', 'P2',
    (SELECT id FROM assets WHERE tag = 'PMP-411'),
    'Discharge check valve chattering at low flow. Suspect worn disc. Scheduled for inspection.',
    'Valve Failure', 'FM-VLV-01', '2026-02-15 10:00:00+00', NULL, NULL, NULL, false)
ON CONFLICT (wo_number) DO NOTHING;

-- 3. Also seed the wo_failure_data for closed WOs to support TECO compliance
INSERT INTO wo_failure_data (wo_id, failure_mode_code, failure_cause_code, remedy_code, comments)
SELECT wo.id, wo.failure_mode, 
  CASE 
    WHEN wo.failure_mode = 'Vibration Excess' THEN 'MECH-WEAR'
    WHEN wo.failure_mode = 'Seal Leakage' THEN 'WEAR-NORMAL'
    WHEN wo.failure_mode = 'Bearing Failure' THEN 'LUBR-DEGRAD'
    WHEN wo.failure_mode LIKE '%Leakage%' THEN 'CORR-EROSION'
    WHEN wo.failure_mode = 'Overheating' THEN 'FOUL-BLOCK'
    WHEN wo.failure_mode = 'Cavitation' THEN 'PROC-CHANGE'
    WHEN wo.failure_mode = 'Surge Event' THEN 'CTRL-DRIFT'
    WHEN wo.failure_mode = 'Control System Failure' THEN 'COMP-AGING'
    WHEN wo.failure_mode = 'Blockage' THEN 'FOUL-BLOCK'
    WHEN wo.failure_mode = 'Instrumentation Failure' THEN 'COMP-AGING'
    WHEN wo.failure_mode = 'Valve Failure' THEN 'MECH-WEAR'
    ELSE 'UNKNOWN'
  END,
  CASE 
    WHEN wo.failure_mode = 'Vibration Excess' THEN 'REPLACE'
    WHEN wo.failure_mode = 'Seal Leakage' THEN 'REPLACE'
    WHEN wo.failure_mode = 'Bearing Failure' THEN 'REPLACE'
    WHEN wo.failure_mode LIKE '%Leakage%' THEN 'REPAIR'
    WHEN wo.failure_mode = 'Overheating' THEN 'CLEAN'
    WHEN wo.failure_mode = 'Cavitation' THEN 'REPLACE'
    WHEN wo.failure_mode = 'Surge Event' THEN 'RECALIBRATE'
    WHEN wo.failure_mode = 'Control System Failure' THEN 'RECALIBRATE'
    WHEN wo.failure_mode = 'Blockage' THEN 'CLEAN'
    WHEN wo.failure_mode = 'Instrumentation Failure' THEN 'REPLACE'
    WHEN wo.failure_mode = 'Valve Failure' THEN 'REPLACE'
    ELSE 'INSPECT'
  END,
  'Auto-seeded failure data for demo purposes'
FROM work_orders wo
WHERE wo.failure_mode IS NOT NULL
  AND wo.status IN ('TECO', 'CLOSED')
  AND NOT EXISTS (SELECT 1 FROM wo_failure_data wf WHERE wf.wo_id = wo.id);

-- 4. Summary
SELECT 
  count(*) AS total_work_orders,
  count(*) FILTER (WHERE failure_mode IS NOT NULL) AS failure_work_orders,
  count(DISTINCT asset_id) AS assets_covered
FROM work_orders;
