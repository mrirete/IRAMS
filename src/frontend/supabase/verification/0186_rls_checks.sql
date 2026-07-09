-- ─────────────────────────────────────────────────────────────────────────
-- 0186 RLS Phase-2 verification — run in the Supabase SQL editor AFTER 0186.
-- Each block is BEGIN…ROLLBACK: nothing persists, safe on production.
-- Run the blocks ONE AT A TIME and compare against the expected result.
-- ─────────────────────────────────────────────────────────────────────────

-- ══ BLOCK 1 — technician CANNOT write governance tables ══════════════════
-- EXPECTED: ERROR "new row violates row-level security policy"
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', u.id::text, 'email', u.email, 'role', 'authenticated')::text, true)
FROM public.users u WHERE u.username = 'ersdebug90639';   -- TECHNICIAN test account
SET LOCAL ROLE authenticated;

INSERT INTO public.reference_codes (category, code, description)
VALUES ('WORK_TYPE', 'ZZRLS', 'RLS negative test');
ROLLBACK;

-- ══ BLOCK 2 — technician CAN do normal operational work ══════════════════
-- EXPECTED: one row returned ("TECH CAN RAISE REQUEST"), then rolled back.
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', u.id::text, 'email', u.email, 'role', 'authenticated')::text, true)
FROM public.users u WHERE u.username = 'ersdebug90639';
SET LOCAL ROLE authenticated;

INSERT INTO public.service_requests (id, request_number, description, asset_id, requester_id, status)
SELECT gen_random_uuid(), 'REQ-RLSTEST', 'RLS smoke (rolled back)', a.id, auth.uid(), 'NEW'
FROM public.assets a LIMIT 1
RETURNING 'TECH CAN RAISE REQUEST' AS check, id;
ROLLBACK;

-- ══ BLOCK 3 — technician deletes are no-ops; audit trail immutable ═══════
-- EXPECTED: every statement returns 0 rows (RLS filters them out, no error).
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', u.id::text, 'email', u.email, 'role', 'authenticated')::text, true)
FROM public.users u WHERE u.username = 'ersdebug90639';
SET LOCAL ROLE authenticated;

DELETE FROM public.work_orders     WHERE id = (SELECT id FROM public.work_orders LIMIT 1)     RETURNING 'WO DELETE — MUST BE 0 ROWS' AS check, id;
DELETE FROM public.assets          WHERE id = (SELECT id FROM public.assets LIMIT 1)          RETURNING 'ASSET DELETE — MUST BE 0 ROWS' AS check, id;
DELETE FROM public.contacts        WHERE id = (SELECT id FROM public.contacts LIMIT 1)        RETURNING 'CONTACT DELETE — MUST BE 0 ROWS' AS check, id;
UPDATE public.audit_logs SET id = id
  WHERE id = (SELECT id FROM public.audit_logs LIMIT 1)
  RETURNING 'AUDIT UPDATE — MUST BE 0 ROWS' AS check, id;
ROLLBACK;

-- ══ BLOCK 4 — technician sees only their OWN notifications ═══════════════
-- EXPECTED: second count = 0.
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', u.id::text, 'email', u.email, 'role', 'authenticated')::text, true)
FROM public.users u WHERE u.username = 'ersdebug90639';
SET LOCAL ROLE authenticated;

SELECT 'own notifications'            AS check, count(*) FROM public.notifications;
SELECT 'foreign notifications (=0?)'  AS check, count(*) FROM public.notifications WHERE recipient_id <> auth.uid()::text;
ROLLBACK;

-- ══ BLOCK 5 — ADMIN retains governance writes ════════════════════════════
-- EXPECTED: one row returned ("ADMIN CAN WRITE GOVERNANCE"), then rolled back.
-- (Uses the admin account's username — adjust if yours differs.)
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', u.id::text, 'email', u.email, 'role', 'authenticated')::text, true)
FROM public.users u WHERE u.roles ?| ARRAY['SUPER_ADMIN','SYS_ADMIN'] AND coalesce(u.status,'active')='active'
ORDER BY u.created_at LIMIT 1;
SET LOCAL ROLE authenticated;

INSERT INTO public.reference_codes (category, code, description)
VALUES ('WORK_TYPE', 'ZZRLS', 'RLS admin test (rolled back)')
RETURNING 'ADMIN CAN WRITE GOVERNANCE' AS check, code;
ROLLBACK;

-- ══ BLOCK 6 — anon is locked out entirely ════════════════════════════════
-- EXPECTED: ERROR "permission denied" (grants revoked for anon).
BEGIN;
SET LOCAL ROLE anon;
SELECT count(*) FROM public.assets;
ROLLBACK;
