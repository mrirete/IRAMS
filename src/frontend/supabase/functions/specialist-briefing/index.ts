// specialist-briefing — the Specialist's scheduled Monday-morning briefing
// (Specialist Phase 2, strategy §6). Invoked by pg_cron (migration 0220) via
// pg_net every Monday; can also be kicked manually for testing.
//
// Flow: verify x-cron-key → run the reliability_digest agent with a
// service-role tool context (fleet-wide; no user session exists on a
// schedule) → write the run to ers_ai_audit_log (the workspace shows it as
// the latest briefing) → enqueue an EMAIL outbox row per admin recipient →
// kick notify-dispatch to drain the queue.
//
// Deploy:  supabase functions deploy specialist-briefing --no-verify-jwt
// Secrets: BRIEFING_CRON_KEY (shared with the vault secret 'briefing_cron_key'
//          that the cron job reads), GEMINI_API_KEY (already set).
// Email delivery additionally needs RESEND_API_KEY on notify-dispatch.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.5.0";
import type { ToolContext } from "../agent-run/types.ts";
import { AGENTS } from "../agent-run/agents.ts";
import { MODEL, runToolLoop } from "../agent-run/gemini.ts";

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

  const started = Date.now();
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    // 1. Produce the briefing (service-role context — scheduled, fleet-wide).
    const agent = AGENTS["reliability_digest"];
    const ctx: ToolContext = { db: admin, proposals: [], sources: [] };
    const query =
      "Produce this Monday morning's reliability & integrity briefing for the fleet. " +
      "It will be emailed to the maintenance leadership — keep it skimmable and lead with what to act on this week.";
    const loop = await runToolLoop(agent, query, ctx, GEMINI_API_KEY);

    // 2. Record the run — the workspace's Briefing card reads this log.
    try {
      await admin.from("ers_ai_audit_log").insert({
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
      });
    } catch (e) {
      console.error("audit log write failed:", e);
    }

    // 3. Recipients: users with an email whose role reads as admin/manager/engineer.
    const { data: users } = await admin
      .from("users")
      .select("id, email, role")
      .not("email", "is", null);
    const recipients = (users ?? []).filter((u: { email: string | null; role: string | null }) => {
      const r = String(u.role ?? "").toLowerCase();
      const e = String(u.email ?? "").trim();
      return e.includes("@") && (r.includes("admin") || r.includes("manager") || r.includes("engineer"));
    });

    // 4. Enqueue one outbox email per recipient (notify-dispatch resolves + sends).
    let enqueued = 0;
    if (recipients.length && loop.answer) {
      const monday = new Date().toISOString().slice(0, 10);
      const { error } = await admin.from("notification_outbox").insert(
        recipients.map((u: { id: string }) => ({
          recipient_user_id: String(u.id),
          channel: "EMAIL",
          subject: `Your Monday reliability briefing — ${monday}`,
          message: loop.answer,
          severity: "INFO",
          module: "specialist",
          entity_number: null,
          action_link: "/specialist",
        })),
      );
      if (error) console.error("outbox enqueue failed:", error.message);
      else enqueued = recipients.length;
    }

    // 5. Drain the queue now rather than waiting for the next client kick.
    let dispatch: unknown = "skipped (nothing enqueued)";
    if (enqueued > 0) {
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

    return json({
      ok: true,
      briefing_chars: loop.answer.length,
      tools_used: loop.toolCalls,
      recipients: enqueued,
      dispatch,
      duration_ms: Date.now() - started,
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
