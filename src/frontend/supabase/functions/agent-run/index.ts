// agent-run — Phase 0 orchestration Edge Function for the reliability AI agents.
// Flow: verify the caller's JWT → route to an agent → reserve against the
// caller's daily AI budget (0229) → run the Gemini tool loop (tools respect RLS
// via the user-scoped client) → enforce the tier cap → persist the audit trail
// + any proposals → return a structured AgentResponse.
//
// Deploy:  supabase functions deploy agent-run
// Secret:  supabase secrets set GEMINI_API_KEY=...   (SUPABASE_* are auto-provided)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.5.0";
import type { AgentProposal, AgentResponse, ToolContext } from "./types.ts";
import { AGENTS } from "./agents.ts";
import { MODEL, runToolLoop } from "./gemini.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const started = Date.now();
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
    if (!GEMINI_API_KEY) return json({ error: "GEMINI_API_KEY not configured on the server" }, 500);

    // 1. Authn — user-scoped client (carries the caller's JWT; reads respect RLS).
    // Pass the JWT to getUser EXPLICITLY: newer auth-js (re-resolved by esm.sh
    // under the pinned supabase-js on every redeploy) no longer falls back to
    // the global Authorization header, which turned a 2026-07-27 redeploy into
    // a blanket 401 with zero code change.
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const db = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authErr } = await db.auth.getUser(jwt);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    // 2. Route.
    const { agent: agentName, query, history } = await req.json().catch(() => ({}));
    const agent = AGENTS[agentName];
    if (!agent) return json({ error: `Unknown agent '${agentName}'` }, 400);
    if (!query || typeof query !== "string") return json({ error: "Missing 'query'" }, 400);

    // 3. Daily spend budget (migration 0229) — the same ceiling the FastAPI AI
    // proxy enforces, so an agent run and a chat message draw on one pot. This
    // function previously had no limit of any kind: a logged-in caller could
    // loop it. Fails OPEN on a budget-backend error; a cost guard must not be
    // the reason the agents stop answering.
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: budget, error: budgetErr } = await admin
      .rpc("ers_ai_budget_reserve", { p_user_id: user.id });
    if (budgetErr) {
      console.warn("[agent-run] budget reserve failed, allowing call:", budgetErr.message);
    } else {
      const row = Array.isArray(budget) ? budget[0] : budget;
      if (row && row.allowed === false) {
        return json({
          error: row.reason || "Daily AI budget reached",
          budget: { requests_today: row.requests_today, max_requests: row.max_requests },
        }, 429);
      }
    }

    // 4. Run the tool-calling loop (history enables multi-turn copilots).
    const ctx: ToolContext = { db, proposals: [], sources: [] };
    const loop = await runToolLoop(agent, query, ctx, GEMINI_API_KEY, Array.isArray(history) ? history : []);

    const proposals: AgentProposal[] = ctx.proposals;
    const requiresApproval = proposals.length > 0; // any draft needs a human
    const duration = Date.now() - started;

    // 5. Persist (service role — audit/proposals must succeed regardless of RLS).
    const username = (user.user_metadata?.username as string) || user.email || user.id;

    // Charge the run's real token cost against today's budget.
    await admin.rpc("ers_ai_budget_record", { p_user_id: user.id, p_tokens: loop.tokensUsed ?? 0 });

    await admin.from("ers_ai_audit_log").insert({
      user_id: user.id,
      username,
      module: agent.module,
      action_type: "agent_run",
      query_text: query,
      response_text: loop.answer,
      context_type: agent.name,
      context_summary: `tools: ${loop.toolCalls.join(", ") || "none"}`,
      model_used: MODEL,
      tokens_used: loop.tokensUsed,
      duration_ms: duration,
    });

    if (proposals.length) {
      await admin.from("ers_agent_actions").insert(
        proposals.map((p) => ({
          agent_type: p.agent_type,
          asset_id: p.asset_id,
          action_type: p.action_type,
          draft_payload: p.draft_payload,
          status: "pending_review",
        })),
      );
    }

    // 6. Respond.
    const response: AgentResponse = {
      agent: agent.name,
      query,
      answer: loop.answer,
      confidence: loop.sources.length ? 0.85 : 0.5,
      tier_used: agent.maxTier,
      requires_human_approval: requiresApproval,
      sources: loop.sources,
      proposals,
      safety_flags: [],
      tokens_used: loop.tokensUsed,
      duration_ms: duration,
    };
    return json(response);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
