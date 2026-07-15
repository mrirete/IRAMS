-- ─────────────────────────────────────────────────────────────────────────
-- 0197 Request-visibility verification — run in the Supabase SQL editor
-- AFTER applying 0197. Each block is BEGIN…ROLLBACK: nothing persists.
-- Run blocks ONE AT A TIME and compare against the EXPECTED note.
--
-- Persona: NON_ADMIN below uses the technician test account from 0186
-- ('ersdebug90639'). Change it to any non-admin username you want to prove.
-- The blocks compute the ground-truth "authorized" set as the SQL-editor
-- owner (bypasses RLS) BEFORE impersonating, then compare to what RLS lets
-- the persona actually SELECT — so they self-verify regardless of seed data.
-- ─────────────────────────────────────────────────────────────────────────

-- ══ BLOCK 0 — baseline: total requests in the table (as owner) ═══════════
-- EXPECTED: the true row count; note it for comparison below.
SELECT 'TOTAL service_requests' AS check, count(*) FROM public.service_requests;

-- ══ BLOCK 1 — ADMIN sees ALL requests ════════════════════════════════════
-- EXPECTED: visible = total (from BLOCK 0). is_admin() short-circuits scope.
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', u.id::text, 'email', u.email, 'role', 'authenticated')::text, true)
FROM public.users u
WHERE u.roles ?| ARRAY['SUPER_ADMIN','SYS_ADMIN'] AND coalesce(u.status,'active')='active'
ORDER BY u.created_at LIMIT 1;
SET LOCAL ROLE authenticated;

SELECT 'ADMIN visible (= total?)' AS check, count(*) FROM public.service_requests;
ROLLBACK;

-- ══ BLOCK 2 — NON-ADMIN sees exactly (own ∪ crew) ════════════════════════
-- EXPECTED: visible = expected, and (usually) expected < total → scoping bites.
BEGIN;
-- ground truth, computed as owner (RLS not yet applied to this role):
CREATE TEMP TABLE _p AS
  SELECT id, email, username FROM public.users WHERE username = 'ersdebug90639';

-- ground truth mirrors the policy: triage/oversight roles see everything,
-- everyone else sees own ∪ crew.
CREATE TEMP TABLE _expected AS
  SELECT sr.id
  FROM public.service_requests sr, _p
  WHERE EXISTS (SELECT 1 FROM public.users u WHERE u.id = _p.id
                AND u.roles ?| ARRAY['SUPER_ADMIN','SYS_ADMIN','PLANNER','SUPERVISOR','MANAGER','EXECUTIVE','RELIABILITY_ENG'])
     OR sr.requester_id = _p.id
     OR (sr.work_center_id IS NOT NULL AND sr.work_center_id IN (
           SELECT m.work_center_id FROM public.work_center_members m
           JOIN public.users u ON u.contact_id = m.contact_id
           WHERE u.id = _p.id));

-- let the impersonated role read the ground-truth temp tables:
GRANT SELECT ON _p, _expected TO authenticated;

SELECT set_config('request.jwt.claims',
  json_build_object('sub', id::text, 'email', email, 'role', 'authenticated')::text, true)
FROM _p;
SET LOCAL ROLE authenticated;

SELECT 'NON-ADMIN visible'          AS check, (SELECT count(*) FROM public.service_requests) AS n
UNION ALL
SELECT 'expected (own ∪ crew)'      AS check, (SELECT count(*) FROM _expected)               AS n;
-- The two counts MUST match. If "expected" is 0, this user should see nothing.
ROLLBACK;

-- ══ BLOCK 3 — NON-ADMIN sees NO foreign, non-crew request ════════════════
-- EXPECTED: count = 0 (there is no visible row that is neither owned nor crew).
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', u.id::text, 'email', u.email, 'role', 'authenticated')::text, true)
FROM public.users u WHERE u.username = 'ersdebug90639';
SET LOCAL ROLE authenticated;

SELECT 'foreign+non-crew visible (=0?)' AS check, count(*)
FROM public.service_requests sr
WHERE sr.requester_id <> public.caller_user_id()
  AND sr.requester_id <> auth.uid()
  AND (sr.work_center_id IS NULL
       OR NOT (sr.work_center_id = ANY (public.caller_work_centers())));
ROLLBACK;

-- ══ BLOCK 4 — helper sanity (as owner) ═══════════════════════════════════
-- EXPECTED: caller_* resolve for the persona. Run inside impersonation to
-- confirm the JWT→users→contact→work_center chain is wired.
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', u.id::text, 'email', u.email, 'role', 'authenticated')::text, true)
FROM public.users u WHERE u.username = 'ersdebug90639';
SET LOCAL ROLE authenticated;

SELECT 'caller_user_id (not null?)'      AS check, public.caller_user_id()::text AS val
UNION ALL
SELECT 'caller_work_centers (count)'     AS check, cardinality(public.caller_work_centers())::text;
ROLLBACK;

-- ══ BLOCK 5 — anon is locked out entirely ════════════════════════════════
-- EXPECTED: ERROR "permission denied" (anon has no grant on the table).
BEGIN;
SET LOCAL ROLE anon;
SELECT count(*) FROM public.service_requests;
ROLLBACK;
