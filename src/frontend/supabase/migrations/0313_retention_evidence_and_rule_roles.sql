-- ============================================================================
-- 0313 — Retention evidence can be written; live rule roles exist
--
-- 0311 fixed the retention sweep's NULL company_id, and the very next manual
-- run exposed the older fault underneath it: audit_logs.action is CHECKed to
-- INSERT / UPDATE / DELETE, so the sweep's 'RETENTION_SWEEP' evidence row has
-- been refused since 0282 introduced it — the sweep has NEVER completed. The
-- check now admits the system actions the platform writes as evidence.
--
-- Also: the live notification rules (a curated per-tenant set, not the 0053a
-- seed) address a "STORE_MANAGER" role on the stock-out alert; no such
-- template exists. Retargeted to STOREKEEPER (0312).
-- ============================================================================

BEGIN;

ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_action_check;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_action_check
    CHECK (action = ANY (ARRAY['INSERT', 'UPDATE', 'DELETE', 'RETENTION_SWEEP', 'ERASURE', 'SYSTEM']));

UPDATE public.notification_rules
   SET recipients = replace(recipients::text, '"STORE_MANAGER"', '"STOREKEEPER"')::jsonb
 WHERE recipients::text LIKE '%STORE_MANAGER%';

COMMIT;

-- VERIFY (after apply):
--   SELECT public.retention_sweep();   -- returns counts and writes one audit_logs row per active company
--   SELECT count(*) FROM audit_logs WHERE action = 'RETENTION_SWEEP';
