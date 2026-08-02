-- ════════════════════════════════════════════════════════════════════════════
-- 0240 — Phase 0 exit: make the repo describe the database
--
-- `node scripts/provision/audit-policies.mjs` replays every migration and diffs
-- the result against pg_policies. Two policies exist in production and in no
-- migration. This records them EXACTLY as they are — behaviour is unchanged, on
-- purpose. Phase 0 is an audit; changing what it finds belongs to Phase 3, once
-- the readers of each table have been swept.
--
-- Both are FOR ALL USING (true): every authenticated user may select, insert,
-- update AND delete.
--
-- ── ers_agent_actions ───────────────────────────────────────────────────────
-- 0149 authored three deliberately narrow policies here:
--     agent_actions_read_all         SELECT
--     agent_actions_insert_service   INSERT
--     agent_actions_update_reviewers UPDATE
-- Note what is absent: DELETE. Someone replaced all three with a single
-- FOR ALL policy, so the agent action queue — which records what the AI
-- proposed and who reviewed it — became deletable by any logged-in user. That
-- is a weaker posture than the migration that created it intended, and nothing
-- in the repo recorded the change.
--
-- ── ers_prediction_feedback ─────────────────────────────────────────────────
-- Worse: the TABLE itself appears in no migration. It was created out-of-band,
-- so the repo has never described it at all. Currently empty (0 rows).
-- Capturing its policy here does not capture its schema — run
-- scripts/provision/export-schema.mjs to bring the definition under version
-- control, which is a separate task.
--
-- Neither table has RLS disabled, which is the one thing that would have been
-- worse. The audit found zero tables in that state.
-- ════════════════════════════════════════════════════════════════════════════

-- Idempotent re-declaration of what is already live. No behaviour change.
DROP POLICY IF EXISTS "Authenticated users can manage agent actions" ON public.ers_agent_actions;
CREATE POLICY "Authenticated users can manage agent actions"
  ON public.ers_agent_actions FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

COMMENT ON TABLE public.ers_agent_actions IS
  'AI agent action queue. Policy is FOR ALL USING (true) — captured in 0240 as the live state, NOT endorsed: 0149 intended SELECT/INSERT/UPDATE only, with no DELETE. Revisit in the RBAC DB-enforcement Phase 3 (docs/RBAC-DB-Enforcement-Plan.md).';

DROP POLICY IF EXISTS "Authenticated users can manage prediction feedback" ON public.ers_prediction_feedback;
CREATE POLICY "Authenticated users can manage prediction feedback"
  ON public.ers_prediction_feedback FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

COMMENT ON TABLE public.ers_prediction_feedback IS
  'Created out-of-band — no CREATE TABLE migration exists for it. Policy captured in 0240; the schema is still unversioned. Revisit in Phase 3.';
