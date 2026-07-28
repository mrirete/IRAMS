// ai-proxy — the Gemini proxy the frontend calls, on Supabase instead of Railway.
//
// Replaces the FastAPI endpoints in src/layer2-modules/ers-ai/ that went dark
// when the Railway trial ended. Only the two routes the running app actually
// calls are ported: /ai/chat (the Specialist panel) and /ai/analyze
// (AIAnalysisEngine, AuditAssessor, RCMService). /ai/vision, /ai/oem/search and
// /ai/query have no live consumer in the frontend — the Python originals stay in
// the repo if they are ever needed again.
//
// The frontend appends the route itself, so setting
//   VITE_AI_PROXY_URL=https://<ref>.supabase.co/functions/v1/ai-proxy
// makes `${AI_PROXY_URL}/ai/chat` resolve here with NO frontend code change.
//
// Request/response shapes match the FastAPI originals exactly, including the
// `{ detail }` error body geminiService reads and the 429 on a refusal.
//
// Deploy:  supabase functions deploy ai-proxy
// Secret:  supabase secrets set GEMINI_API_KEY=...   (SUPABASE_* are auto-provided)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.5.0";

const MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash";
const ENDPOINT = (key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
// geminiService reads `error.detail` — keep the FastAPI error shape.
const fail = (detail: string, status: number) => json({ detail }, status);

// Verbatim from the FastAPI service so answers don't change with the host.
const RELANTERN_SYSTEM_INSTRUCTION =
  `You are the "Reliability Specialist" — an AI-powered advisor embedded in an Enterprise Asset Management system.
You follow ISO 55000, ISO 14224, IEC 60812, SAE JA1011, and OREDA standards.
You think like an experienced asset manager, act like an operations manager, and learn like a data scientist.

HITL Principle: All your outputs are SUGGESTIONS — you cannot authorize shutdowns, create POs, or close investigations without human validation.

You are grounded in Oil & Gas best practices but flexible across industries.`;

// ── Burst limiter ────────────────────────────────────────────
// Mirrors the Python _rate_limits (20 req/60s). Per-instance and lost on cold
// start, exactly like the original — it exists to blunt a hot loop, not to
// bound spend. The durable ceiling is the 0229 daily budget below.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 20;
const hits = new Map<string, number[]>();
function burstOk(userId: string): boolean {
  const now = Date.now();
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) {
    hits.set(userId, recent);
    return false;
  }
  recent.push(now);
  hits.set(userId, recent);
  return true;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return fail("Method not allowed", 405);

  const started = Date.now();
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
    if (!GEMINI_API_KEY) return fail("GEMINI_API_KEY not configured on the server", 500);

    // Route on the path suffix the frontend appends.
    const path = new URL(req.url).pathname;
    const isChat = path.endsWith("/ai/chat");
    const isAnalyze = path.endsWith("/ai/analyze");
    if (!isChat && !isAnalyze) return fail(`No such route: ${path}`, 404);

    // Authn — same explicit getUser(jwt) as agent-run. Passing the JWT
    // positionally matters: newer auth-js no longer falls back to the global
    // Authorization header, which once turned a redeploy into a blanket 401.
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const db = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authErr } = await db.auth.getUser(jwt);
    if (authErr || !user) return fail("Not authenticated", 401);

    const body = await req.json().catch(() => ({}));
    const prompt: string = body.prompt ?? "";
    if (!prompt || typeof prompt !== "string") return fail("Missing 'prompt'", 400);
    const temperature: number = typeof body.temperature === "number" ? body.temperature : 0.3;
    const module: string = body.module ?? "general";

    if (!burstOk(user.id)) return fail(`Rate limit exceeded (${RATE_MAX} requests/60s)`, 429);

    // Daily spend budget (0229) — the same pot agent-run draws from.
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: budget, error: budgetErr } = await admin
      .rpc("ers_ai_budget_reserve", { p_user_id: user.id });
    if (budgetErr) {
      console.warn("[ai-proxy] budget reserve failed, allowing call:", budgetErr.message);
    } else {
      const row = Array.isArray(budget) ? budget[0] : budget;
      if (row && row.allowed === false) return fail(row.reason || "Daily AI budget reached", 429);
    }

    // Prompt assembly — byte-for-byte with the FastAPI handlers.
    let fullPrompt = prompt;
    let systemInstruction = RELANTERN_SYSTEM_INSTRUCTION;
    let actionType = "chat";
    let contextSummary: string | null = null;

    if (isChat) {
      const context: string | undefined = body.context;
      if (context) {
        fullPrompt = `Context:\n${context}\n\nUser Question:\n${prompt}`;
        contextSummary = context.slice(0, 200);
      }
    } else {
      systemInstruction = RELANTERN_SYSTEM_INSTRUCTION +
        "\n\nIMPORTANT: Always respond with valid JSON only. " +
        "No markdown, no code fences, just raw JSON.";
      actionType = body.action_type ?? "analyze";
      contextSummary = body.context_summary ?? null;
    }

    // ── Gemini ──
    const resp = await fetch(ENDPOINT(GEMINI_API_KEY), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
        generationConfig: { temperature },
      }),
    });

    if (!resp.ok) {
      const txt = (await resp.text()).slice(0, 500);
      // Surface Google's own throttling as a 429 so the client can tell the
      // difference between "you are over budget" and "the model is busy".
      const status = resp.status === 429 ? 429 : 503;
      return fail(`AI service error: Gemini API ${resp.status}: ${txt}`, status);
    }

    const result = await resp.json();
    const text: string = (result?.candidates?.[0]?.content?.parts ?? [])
      .map((p: { text?: string }) => p.text ?? "").join("").trim();
    // Real usage from the API, not the chars/4 estimate the Python side used.
    const tokensUsed: number = result?.usageMetadata?.totalTokenCount ?? 0;
    const durationMs = Date.now() - started;

    await admin.rpc("ers_ai_budget_record", { p_user_id: user.id, p_tokens: tokensUsed });

    const username = (user.user_metadata?.username as string) || user.email || user.id;
    await admin.from("ers_ai_audit_log").insert({
      user_id: user.id,
      username,
      module,
      action_type: actionType,
      query_text: fullPrompt.slice(0, 2000),
      response_text: text.slice(0, 5000),
      context_type: body.context_type ?? null,
      context_summary: contextSummary,
      model_used: MODEL,
      temperature,
      tokens_used: tokensUsed,
      duration_ms: durationMs,
    });

    return json({ text, tokens_used: tokensUsed, duration_ms: durationMs });
  } catch (e) {
    console.error("[ai-proxy] unexpected:", e);
    return fail(`AI error: ${String(e)}`, 500);
  }
});
