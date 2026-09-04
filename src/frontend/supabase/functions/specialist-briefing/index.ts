// specialist-briefing — the Specialist's scheduled Monday-morning briefing
// (Specialist Phase 2, strategy §6). Invoked by pg_cron (migration 0220) via
// pg_net every Monday; can also be kicked manually for testing.
//
// Flow: verify x-cron-key → FOR EACH ACTIVE COMPANY, run the reliability_digest
// agent as that tenant (tenantSession.ts: a short-lived admin JWT so RLS,
// column defaults and the semantic views all resolve the right tenant) →
// write the run to ers_ai_audit_log (the workspace shows it as the latest
// briefing) → enqueue an EMAIL outbox row per admin recipient of that company
// → kick notify-dispatch once to drain the queue.
//
// Before 2026-09-04 this ran once as the service role: on a shared project it
// mixed tenants, and since 0276 (company_id NOT NULL) its audit-log and outbox
// inserts failed with 23502 — the cron reported success while nothing landed.
//
// Deploy:  supabase functions deploy specialist-briefing --no-verify-jwt
// Secrets: BRIEFING_CRON_KEY (shared with the vault secret 'briefing_cron_key'
//          that the cron job reads), GEMINI_API_KEY (already set),
//          SUPABASE_JWT_SECRET (tenant-scoped runs; falls back to service role).
// Email delivery additionally needs RESEND_API_KEY on notify-dispatch.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.5.0";
import type { ToolContext } from "../agent-run/types.ts";
import { AGENTS } from "../agent-run/agents.ts";
import { MODEL, runToolLoop } from "../agent-run/gemini.ts";
import { loadOrgContext, formatOrgContextBlock } from "../agent-run/orgContext.ts";
import { forEachTenant } from "../_shared/tenantSession.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const CRON_KEY = Deno.env.get("BRIEFING_CRON_KEY") ?? "";
  if (!CRON_KEY) return json({ error: "BRIEFING_CRON_KEY not configured" }, 500);
  if (req.headers.get("x-cron-key") !== CRON_KEY) return json({ error: "Unauthorized" }, 401);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
  if (!GEMINI_API_KEY) return json({ error: "GEMINI_API_KEY not configured" }, 500);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const baseAgent = AGENTS["reliability_digest"];
  const query =
    "Produce this Monday morning's reliability & integrity briefing for the fleet. " +
    "It will be emailed to the maintenance leadership — keep it skimmable and lead with what to act on this week.";
  const monday = new Date().toISOString().slice(0, 10);

  const results: Record<string, unknown>[] = [];
  let totalEnqueued = 0;

  const run = await forEachTenant(admin, async ({ companyId, companyName, db, scoped }) => {
    const started = Date.now();

    // 1. Produce the briefing as this tenant. Organisational context (0308)
    //    frames it around the stated objectives and weakest dimension. Fails open.
    const ctx: ToolContext = { db, proposals: [], sources: [] };
    let orgBlock = "";
    try { orgBlock = formatOrgContextBlock(await loadOrgContext(db)); } catch (e) { console.warn(`[briefing] ${companyName}: org context unavailable:`, String(e)); }
    const agent = orgBlock ? { ...baseAgent, systemPrompt: baseAgent.systemPrompt + orgBlock } : baseAgent;
    const loop = await runToolLoop(agent, query, ctx, GEMINI_API_KEY);

    // 2. Record the run — the workspace's Briefing card reads this log.
    //    company_id is stamped explicitly so the row lands in either mode.
    const { error: logErr } = await db.from("ers_ai_audit_log").insert({
      user_id: null,
      username: "specialist-scheduler",
      module: agent.module,
      action_type: "agent_run",
      query_text: query,
      response_text: loop.answer,
      context_type: agent.name,
      context_summary: `scheduled briefing; tools: ${loop.toolCalls.join(", ") || "none"}`,
      model_used: MODEL,
      tokens_used: loop.tokensUsed,
      duration_ms: Date.now() - started,
      company_id: companyId,
    });
    if (logErr) console.error(`[briefing] ${companyName}: audit log write failed:`, logErr.message);

    // 3. Recipients: this company's users with an email whose role reads as
    //    admin / manager / engineer (users.role is the primary role column;
    //    users.roles the array — accept either).
    const { data: users } = await db
      .from("users")
      .select("id, email, role, roles, status")
      .eq("company_id", companyId)
      .not("email", "is", null);
    const recipients = (users ?? []).filter((u: { email: string | null; role: string | null; roles: string[] | null; status: string | null }) => {
      const roleText = [u.role ?? "", ...((u.roles ?? []) as string[])].join(" ").toLowerCase();
      const e = String(u.email ?? "").trim();
      return (u.status ?? "active") === "active" && e.includes("@") &&
        (roleText.includes("admin") || roleText.includes("manager") || roleText.includes("engineer") || roleText.includes("planner"));
    });

    // 4. Enqueue one outbox email per recipient (notify-dispatch resolves + sends).
    let enqueued = 0;
    if (recipients.length && loop.answer) {
      const { error } = await db.from("notification_outbox").insert(
        recipients.map((u: { id: string }) => ({
          recipient_user_id: String(u.id),
          channel: "EMAIL",
          subject: `Your Monday reliability briefing — ${monday}`,
          message: loop.answer,
          severity: "INFO",
          module: "specialist",
          entity_number: null,
          action_link: "/specialist",
          company_id: companyId,
        })),
      );
      if (error) console.error(`[briefing] ${companyName}: outbox enqueue failed:`, error.message);
      else enqueued = recipients.length;
    }
    totalEnqueued += enqueued;
    results.push({ company: companyName, scoped, briefing_chars: loop.answer.length, tools_used: loop.toolCalls, recipients: enqueued, duration_ms: Date.now() - started });
  });

  // 5. Drain the queue now rather than waiting for the next kick.
  let dispatch: unknown = "skipped (nothing enqueued)";
  if (totalEnqueued > 0) {
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/notify-dispatch`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: "{}",
      });
      dispatch = resp.ok ? await resp.json() : `notify-dispatch ${resp.status}`;
    } catch (e) {
      dispatch = `notify-dispatch unreachable: ${String(e)}`;
    }
  }

  return json({ ok: run.errors.length === 0, companies: run.companies, tenant_scoped: run.scoped, results, errors: run.errors, dispatch }, run.errors.length && !results.length ? 500 : 200);
});
