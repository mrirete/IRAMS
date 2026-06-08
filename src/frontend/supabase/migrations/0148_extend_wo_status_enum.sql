-- ============================================================
-- ERS Scheduling Module — Extend wo_status enum
-- Adds PLAN, SCHED, WAIT, CANC to the wo_status enum type
-- ============================================================
-- Run this in your Supabase SQL Editor.
-- The wo_status enum was created in 0000_initial_schema.sql as:
--   CREATE TYPE wo_status AS ENUM ('OPEN', 'WIP', 'CLOSED', 'TECO', 'CANCELLED');
-- We need to add lifecycle statuses for scheduling.
-- ============================================================

-- Add PLAN (after OPEN — planning stage, WO created but not scheduled)
ALTER TYPE wo_status ADD VALUE IF NOT EXISTS 'PLAN' AFTER 'OPEN';

-- Add SCHED (after PLAN — dates assigned, ready for execution)
ALTER TYPE wo_status ADD VALUE IF NOT EXISTS 'SCHED' AFTER 'PLAN';

-- Add WAIT (after WIP — on hold for parts/approval/weather)
ALTER TYPE wo_status ADD VALUE IF NOT EXISTS 'WAIT' AFTER 'WIP';

-- Add CANC (short form for cancelled, used by frontend)
ALTER TYPE wo_status ADD VALUE IF NOT EXISTS 'CANC';

-- ============================================================
-- Verification — run after migration:
-- ============================================================
-- SELECT unnest(enum_range(NULL::wo_status));
-- Expected: OPEN, PLAN, SCHED, WIP, WAIT, TECO, CLOSED, CANCELLED, CANC
