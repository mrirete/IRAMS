# agent-run — reliability AI agent orchestrator (Phase 0)

Server-side orchestration for the reliability agents. Verifies the caller's JWT,
routes to an agent, runs a Gemini tool-calling loop (tools respect RLS via the
user-scoped client), enforces the Tier-2 autonomy cap, writes the audit trail,
and returns a cited `AgentResponse` plus any drafts queued for human approval.

Files: `index.ts` (handler) · `gemini.ts` (tool loop) · `agents.ts` (registry) ·
`tools.ts` (deterministic tools) · `types.ts`.

## Deploy

```bash
# from src/frontend/
supabase functions deploy agent-run
supabase secrets set GEMINI_API_KEY=<your-gemini-key>
# SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are auto-injected.
```

## Call (frontend)

```ts
import { runBadActorHunter } from '@/eam/services/agentRunClient';
const res = await runBadActorHunter();
// res.answer (narrative), res.sources (citations), res.proposals (DE drafts → ers_agent_actions, pending_review)
```

## Agents

- **bad_actor_hunter** (flagship) — tools `rank_bad_actors`, `draft_de_task`. Ranks
  assets by WO cost/frequency with Pareto, drafts defect-elimination tasks for the
  worst offenders. Tier 2: drafts only, human approval required.

## Audit

- `ers_ai_audit_log` — one row per run (query, answer, tools, tokens, duration).
- `ers_agent_actions` — one row per proposal, `status='pending_review'`.
