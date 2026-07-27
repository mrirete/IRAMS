// proposal-writeback — deliver approved Specialist proposals to the customer's
// own CMMS (Specialist Phase 3, strategy §6 item 9).
//
// This is the only place in the system that PUSHES data to a third party, so
// the gates are deliberate:
//   1. Caller must present a valid JWT (verify_jwt stays on).
//   2. Every proposal is re-read from ers_agent_actions with the service role
//      and must be status='approved'. A client cannot deliver work a human
//      never approved, whatever it puts in the request body.
//   3. Each delivery is recorded in writeback_log with the exact payload sent;
//      a PARTIAL UNIQUE index (0221) makes a successful send once-only, while
//      leaving failures retryable.
//   4. dry_run builds and logs the payload without any outbound call.
//
// The rendered `action` comes from the client (lib/writebackPackage, which is
// unit-tested); the authoritative `source.draft_payload` is attached
// server-side from the database, so the receiving system — and the audit
// trail — always carry the un-editable original alongside the presentation.
//
// Deploy: supabase functions deploy proposal-writeback
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.5.0";
import { corsHeaders } from "../_shared/cors.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface TargetConfig {
  headers?: Record<string, string>;
  auth?: { secret_env?: string; scheme?: "bearer" | "basic" | "raw"; header_name?: string };
  /** Wrap the envelope under this key, when the host API expects e.g. {"workorder": {...}}. */
  wrap_key?: string;
  /** Constant fields merged into the top level of every request body. */
  extra?: Record<string, unknown>;
}

/** Build outbound headers; a secret named in config is read from the function env, never the DB. */
function buildHeaders(cfg: TargetConfig): { headers: Record<string, string>; warning?: string } {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(cfg.headers ?? {}),
  };
  const auth = cfg.auth;
  if (auth?.secret_env) {
    const secret = Deno.env.get(auth.secret_env) ?? "";
    if (!secret) {
      return { headers, warning: `Secret '${auth.secret_env}' is not set on this project — the request was sent unauthenticated.` };
    }
    const name = auth.header_name || "Authorization";
    headers[name] = auth.scheme === "basic"
      ? `Basic ${secret}`
      : auth.scheme === "raw"
        ? secret
        : `Bearer ${secret}`;
  }
  return { headers };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  try {
    // 1. Authn — the caller must be a signed-in user of this workspace.
    // JWT passed explicitly: newer auth-js drops the header fallback (see the
    // matching note in agent-run/index.ts).
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser(jwt);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const targetId: string = body?.targetId ?? "";
    const dryRun: boolean = body?.dryRun === true;
    const actions: Record<string, unknown>[] = Array.isArray(body?.actions) ? body.actions : [];
    if (!targetId) return json({ error: "Missing 'targetId'" }, 400);
    if (actions.length === 0) return json({ error: "No actions to deliver" }, 400);
    if (actions.length > 200) return json({ error: "Too many actions in one call (max 200)" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // 2. Target.
    const { data: target, error: tErr } = await admin
      .from("writeback_targets")
      .select("id, name, system, endpoint_url, method, config, is_active")
      .eq("id", targetId)
      .maybeSingle();
    if (tErr) throw new Error(`target lookup failed: ${tErr.message}`);
    if (!target) return json({ error: "Unknown write-back target" }, 404);
    if (!target.is_active && !dryRun) {
      return json({ error: `Target '${target.name}' is inactive — activate it or run a test first.` }, 400);
    }

    const cfg: TargetConfig = (target.config ?? {}) as TargetConfig;
    const { headers, warning } = buildHeaders(cfg);

    // 3. Authoritative proposal state — approval is checked here, not client-side.
    const proposalIds = [...new Set(actions.map((a) => String(a.proposal_id ?? "")).filter(Boolean))];
    const { data: proposals } = await admin
      .from("ers_agent_actions")
      .select("id, agent_type, action_type, asset_id, draft_payload, status, reviewed_by, reviewed_at")
      .in("id", proposalIds);
    const byId = new Map((proposals ?? []).map((p: Record<string, unknown>) => [String(p.id), p]));

    // Already-delivered proposals for this target (idempotency pre-check; the
    // partial unique index is the real guarantee under concurrency).
    const { data: sentRows } = await admin
      .from("writeback_log")
      .select("proposal_id")
      .eq("target_id", targetId)
      .eq("status", "sent")
      .in("proposal_id", proposalIds);
    const alreadySent = new Set((sentRows ?? []).map((r: { proposal_id: string }) => r.proposal_id));

    const results: Record<string, unknown>[] = [];
    let sent = 0, failed = 0, skipped = 0;

    for (const action of actions) {
      const proposalId = String(action.proposal_id ?? "");
      const record = async (
        status: "sent" | "failed" | "dry_run" | "skipped",
        extra: Record<string, unknown>,
      ) => {
        await admin.from("writeback_log").insert({
          target_id: targetId,
          proposal_id: proposalId,
          status,
          ...extra,
        });
      };

      const proposal = byId.get(proposalId);
      if (!proposal) {
        skipped += 1;
        results.push({ proposal_id: proposalId, status: "skipped", reason: "Proposal not found." });
        continue; // nothing to log against — the id isn't real
      }
      if (proposal.status !== "approved") {
        skipped += 1;
        await record("skipped", { error: `Proposal is '${proposal.status}', not approved.` });
        results.push({ proposal_id: proposalId, status: "skipped", reason: `Not approved (${proposal.status}).` });
        continue;
      }
      if (alreadySent.has(proposalId)) {
        skipped += 1;
        results.push({ proposal_id: proposalId, status: "skipped", reason: "Already delivered to this target." });
        continue;
      }

      // 4. Envelope — client-rendered action + server-authoritative source.
      const envelope: Record<string, unknown> = {
        ...(cfg.extra ?? {}),
        action,
        source: {
          proposal_id: proposalId,
          agent_type: proposal.agent_type,
          action_type: proposal.action_type,
          asset_id: proposal.asset_id,
          draft_payload: proposal.draft_payload,
          approved_by: proposal.reviewed_by,
          approved_at: proposal.reviewed_at,
          origin: "IRAMS Reliability Specialist",
        },
      };
      const payload = cfg.wrap_key ? { [cfg.wrap_key]: envelope } : envelope;

      if (dryRun) {
        await record("dry_run", { request_payload: payload });
        results.push({ proposal_id: proposalId, status: "dry_run" });
        continue;
      }

      try {
        const resp = await fetch(target.endpoint_url, {
          method: target.method || "POST",
          headers,
          body: JSON.stringify(payload),
        });
        const text = (await resp.text()).slice(0, 500);
        if (resp.ok) {
          sent += 1;
          await record("sent", { http_status: resp.status, request_payload: payload, response_excerpt: text });
          results.push({ proposal_id: proposalId, status: "sent", http_status: resp.status });
        } else {
          failed += 1;
          await record("failed", { http_status: resp.status, request_payload: payload, response_excerpt: text, error: `HTTP ${resp.status}` });
          results.push({ proposal_id: proposalId, status: "failed", http_status: resp.status, error: text });
        }
      } catch (e) {
        failed += 1;
        await record("failed", { request_payload: payload, error: String(e).slice(0, 300) });
        results.push({ proposal_id: proposalId, status: "failed", error: String(e) });
      }
    }

    // 5. Target bookkeeping (skipped on dry runs — a test is not a delivery).
    if (!dryRun) {
      await admin.from("writeback_targets").update({
        last_delivery_at: new Date().toISOString(),
        last_status: failed > 0 ? "error" : "ok",
        last_error: failed > 0 ? `${failed} of ${actions.length} deliveries failed` : null,
        updated_at: new Date().toISOString(),
      }).eq("id", targetId);
    }

    return json({
      target: target.name,
      dry_run: dryRun,
      sent,
      failed,
      skipped,
      warning,
      results,
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
