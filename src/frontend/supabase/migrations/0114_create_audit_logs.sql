-- ═══════════════════════════════════════════════════════════════
-- 0114 — audit_logs (RECONSTRUCTED 2026-07-25)
--
-- This file's contents were lost at some point: the entire file was
-- the two characters "br". On a fresh replay it therefore failed with
-- `syntax error at or near "br"`, and everything depending on
-- audit_logs failed after it — 0118, 0121, 0130, 0158, then the
-- numbering chain (0157, 0160, 0162, 0165, 0167), then 0171, which
-- defines public.is_admin(), and from there most later migrations.
-- One lost file accounted for roughly half of the 43 failures the
-- replay test found (docs/Tenant-Provisioning-Runbook.md §6).
--
-- Reconstructed from the live schema of the origin project via
-- scripts/provision/export-schema.mjs, so it matches the table that
-- actually exists in production. Migration 0186 later replaces the
-- policies below with its append-only p2_* tiers; that is left to
-- 0186 rather than duplicated here.
--
-- New tenants are provisioned from the baseline schema, not by
-- replaying migrations — this repair is for history integrity and
-- for anyone replaying a subset.
-- ═══════════════════════════════════════════════════════════════
BEGIN;

CREATE TABLE IF NOT EXISTS public.audit_logs (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    table_name  TEXT NOT NULL,
    record_id   TEXT NOT NULL,
    action      TEXT NOT NULL,
    changed_by  UUID,
    "timestamp" TIMESTAMPTZ DEFAULT NOW(),
    changes     JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_table_name  ON public.audit_logs (table_name);
CREATE INDEX IF NOT EXISTS idx_audit_logs_record_id   ON public.audit_logs (record_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp   ON public.audit_logs ("timestamp" DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_record_time ON public.audit_logs (record_id, "timestamp" DESC);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Phase-1 baseline posture (0150/0155): authenticated may read and append.
-- 0186 supersedes these with the append-only p2_* tiers.
DROP POLICY IF EXISTS auth_select_audit_logs ON public.audit_logs;
DROP POLICY IF EXISTS auth_insert_audit_logs ON public.audit_logs;
CREATE POLICY auth_select_audit_logs ON public.audit_logs
    FOR SELECT TO authenticated USING (true);
CREATE POLICY auth_insert_audit_logs ON public.audit_logs
    FOR INSERT TO authenticated WITH CHECK (true);

COMMIT;
