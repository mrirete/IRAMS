-- ============================================================
-- 0116 — Seed Defect Elimination Tasks linked to RCA examples
-- Demonstrates the full RCA → Defect Elimination workflow:
--   RCA-1  Premature Seal Failure (PMP-411)  →  DE task "in_progress"
--   RCA-2  Repeated Belt Failures (C-902)    →  DE task "identified"
--   Also adds a resolved example for Main Air Compressor (CMP-201)
-- ============================================================

DO $$
DECLARE
  ns     UUID := '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; -- DNS namespace (same as 0050/0075)
  -- Asset UUIDs (deterministic, matching 0050/0075 seed)
  pmp411 UUID := uuid_generate_v5(ns, 'PMP-411');
  c902   UUID := uuid_generate_v5(ns, 'C-902');
  cmp201 UUID := uuid_generate_v5(ns, 'CMP-201');
  -- RCA investigation UUIDs (deterministic, matching 0075 seed)
  rca1   UUID := uuid_generate_v5(ns, 'RCA-PMP411-SEAL');
  rca2   UUID := uuid_generate_v5(ns, 'RCA-C902-BELT');
  -- DE task UUIDs (deterministic for idempotency)
  de1    UUID := uuid_generate_v5(ns, 'DE-PMP411-SEAL');
  de2    UUID := uuid_generate_v5(ns, 'DE-C902-BELT');
  de3    UUID := uuid_generate_v5(ns, 'DE-CMP201-BEARING');
BEGIN

-- ═══════════════════════════════════════════════════════════════
--  DE Task 1: From RCA "Premature Seal Failure" on PMP-411
--  Status: in_progress (root cause identified, fix being implemented)
-- ═══════════════════════════════════════════════════════════════
INSERT INTO ers_defect_elimination_tasks
  (id, asset_id, asset_name, title, status, priority,
   annual_cost, estimated_savings, implementation_cost, payback_months,
   root_cause_summary, proposed_solution, rca_id, created_by, created_at)
VALUES
  (de1, pmp411,
   'Boiler Feed Pump B',
   'Eliminate Chronic Seal Failures — Upgrade to H₂S-Resistant Material',
   'in_progress', 'critical',
   125000,   -- annual cost from bad-actor Pareto (#1 by cost)
   95000,    -- estimated savings/yr after fix
   18000,    -- one-time implementation cost (new seal procurement + install)
   3,        -- payback in months (18K / (95K/12) ≈ 2.3 → round to 3)
   'Incorrect seal face material selected during procurement due to undocumented process fluid change (higher H₂S content). '
   || 'MoC process was not followed when process fluid composition was changed. '
   || 'Root cause confirmed via 5-Why investigation (RCA-PMP411-SEAL).',
   'Replace standard carbon/SiC seal with Tungsten Carbide faces rated for sour service (>500 ppm H₂S). '
   || 'Update procurement specification PMP-411-SEAL-SPEC-R2 to mandate H₂S-compatible materials. '
   || 'Add MoC checkpoint to process-fluid change workflow to prevent recurrence. '
   || 'Retrain procurement team on material compatibility requirements.',
   rca1,
   'Reliability Engineer',
   NOW() - INTERVAL '14 days')
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
--  DE Task 2: From RCA "Repeated Belt Failures" on C-902
--  Status: identified (still under investigation, no fix approved yet)
-- ═══════════════════════════════════════════════════════════════
INSERT INTO ers_defect_elimination_tasks
  (id, asset_id, asset_name, title, status, priority,
   annual_cost, estimated_savings, implementation_cost, payback_months,
   root_cause_summary, proposed_solution, rca_id, created_by, created_at)
VALUES
  (de2, c902,
   'Conveyor Belt C-902',
   'Defect Elimination: Recurring Belt Snap — Idler & Grade Root Cause',
   'identified', 'high',
   68000,    -- annual cost (belt replacement + production loss)
   52000,    -- estimated savings after fix
   24000,    -- implementation (replace seized idlers + upgrade belt grade)
   6,        -- payback months
   'Fishbone analysis identified two contributing causes: (1) Belt grade below specification — '
   || 'procurement substituted economy grade without engineering approval; '
   || '(2) Idler roller seizure creating localized hot spots causing premature belt degradation. '
   || 'Investigation still in progress (RCA-C902-BELT).',
   'Phase 1: Replace all seized idler rollers (12 units) and install temperature monitoring. '
   || 'Phase 2: Upgrade belt specification from EP250/3 to EP400/4 to match actual load profile. '
   || 'Phase 3: Add belt alignment sensors and integrate alerts into EAM notification engine. '
   || 'Estimated completion: 8 weeks.',
   rca2,
   'Reliability Engineer',
   NOW() - INTERVAL '7 days')
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
--  DE Task 3: Standalone example (no linked RCA yet)
--  Status: resolved (demonstrates the "success" lane on Kanban)
-- ═══════════════════════════════════════════════════════════════
INSERT INTO ers_defect_elimination_tasks
  (id, asset_id, asset_name, title, status, priority,
   annual_cost, estimated_savings, implementation_cost, payback_months,
   root_cause_summary, proposed_solution, rca_id, created_by, created_at)
VALUES
  (de3, cmp201,
   'Main Air Compressor',
   'Thrust Bearing Overtemperature — Lube Oil System Upgrade',
   'resolved', 'high',
   85000,    -- annual cost from bad-actor Pareto (#2 by cost)
   72000,    -- estimated savings after fix
   35000,    -- implementation cost
   6,        -- payback months
   'Repeated thrust bearing overtemperature events traced to inadequate lube oil flow at high ambient temperatures. '
   || 'Root cause: Single lube oil pump with no redundancy; filter dP alarm set too high, allowing partial blockage.',
   'Installed redundant lube oil pump with auto-switchover. Lowered filter dP alarm setpoint from 2.5 to 1.5 bar. '
   || 'Added continuous bearing temperature monitoring with 85°C pre-alarm and 95°C trip. '
   || 'FMEA worksheet updated — recommended action "Add redundant oil pump" now marked complete.',
   NULL,  -- no linked RCA (demonstrates standalone DE task from FMEA)
   'Maintenance Superintendent',
   NOW() - INTERVAL '45 days')
ON CONFLICT (id) DO NOTHING;

END $$;
