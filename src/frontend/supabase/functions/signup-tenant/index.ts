/**
 * signup-tenant — self-serve SMB signup: one POST creates a working, isolated
 * tenant and its first admin.
 *
 * Public in the same sense as audit-invite: called with the anon key from the
 * browser (verify_jwt stays ON — the anon key is a valid JWT), all real work
 * done here with the service key. The heavy machinery already exists and is
 * proven — provision_tenant() (0271/0278) clones the seed set with fresh
 * uuids, create_auth_user() (0141/0272) mints the auth user — this function
 * is the thin public door in front of them.
 *
 * ── Abuse posture, stated honestly ──────────────────────────────────────────
 * v1 guards: per-IP throttle (5/hour) + global cap (20/day) via
 * signup_throttle, which doubles as the audit log; input validation; tier
 * pinned server-side regardless of what the client sends; Turnstile CAPTCHA
 * when TURNSTILE_SECRET_KEY is set (turnstile.ts); EMAIL VERIFICATION (0314)
 * when mail can be sent (RESEND_API_KEY + FROM_EMAIL): the admin is created,
 * un-confirmed, and emailed a 24-hour link — GoTrue refuses password sign-in
 * until it is clicked. Without mail secrets the account stays auto-confirmed
 * (dev projects keep working) and the response says verify_email:false.
 * Sales-led onboarding remains create-tenant.mjs; if signup spam appears the
 * throttle table says exactly who and when.
 *
 * Second entry point: { action: "resend_verification", admin_email } — same
 * throttle; always answers 200 with a generic message so it cannot be used
 * to probe which emails exist or are verified.
 *
 * ── Failure atomicity ───────────────────────────────────────────────────────
 * provision_tenant is atomic (one transaction). If the ADMIN creation fails
 * after it commits, the half-tenant is torn down with deprovision_tenant —
 * a tenant with no admin is unreachable and would squat on its company code.
 *
 * Env: injected SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY; optional
 *      RESEND_API_KEY, FROM_EMAIL, APP_URL (shared with audit-invite),
 *      TURNSTILE_SECRET_KEY.
 * Deploy: supabase functions deploy signup-tenant
 */
import { corsHeaders } from "../_shared/cors.ts";
import { verifyTurnstile } from "./turnstile.ts";

/** Self-serve tenants start on the professional tier for this many days (0310). */
const TRIAL_DAYS = 30;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "";
const APP_URL = (Deno.env.get("APP_URL") ?? "https://irams.vercel.app").replace(/\/$/, "");
const VERIFY_EMAIL = !!RESEND_API_KEY && !!FROM_EMAIL;

const IP_HOURLY_LIMIT = 5;
const GLOBAL_DAILY_LIMIT = 20;

/** PostgREST as the service role. */
async function rest(path: string, init: RequestInit = {}): Promise<Response> {
    return await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        ...init,
        headers: {
            "apikey": SERVICE_KEY,
            "Authorization": `Bearer ${SERVICE_KEY}`,
            "Content-Type": "application/json",
            ...(init.headers ?? {}),
        },
    });
}
async function rpc(fn: string, args: Record<string, unknown>): Promise<{ ok: boolean; body: string }> {
    const res = await rest(`rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });
    return { ok: res.ok, body: await res.text() };
}
const reply = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// ── email verification (0314) ───────────────────────────────────────────────
function newToken(): string {
    const b = new Uint8Array(32); crypto.getRandomValues(b);
    return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
async function sha256Hex(s: string): Promise<string> {
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, "0")).join("");
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

async function sendVerificationEmail(to: string, companyName: string, token: string): Promise<boolean> {
    const link = `${APP_URL}/verify-email?token=${token}`;
    const html = `<div style="font-family:Inter,Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1e293b">
  <p style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#94a3b8;margin:0 0 18px">IREAMS by Relantern</p>
  <h1 style="font-size:20px;margin:0 0 12px">Confirm your email to open ${esc(companyName)}</h1>
  <p style="font-size:15px;line-height:1.5;margin:0 0 20px">Your workspace is ready. Confirm this address to sign in as its administrator. The link works once and expires in 24 hours.</p>
  <a href="${esc(link)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:13px 24px;border-radius:10px">Confirm email</a>
  <p style="font-size:12px;color:#64748b;margin:24px 0 0">If you did not create an IREAMS workspace, ignore this email — nothing happens without the link.</p>
</div>`;
    try {
        const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ from: FROM_EMAIL, to, subject: "Confirm your email for IREAMS", html }),
        });
        if (!res.ok) console.error("[signup-tenant] resend failed:", res.status, await res.text());
        return res.ok;
    } catch (e) {
        console.error("[signup-tenant] resend unreachable:", String(e));
        return false;
    }
}

/**
 * Un-confirm the auth user and email a fresh link. `force` re-verifies an
 * account that create_auth_user just confirmed; without it, an already
 * verified account is left alone (resend path). Order matters on signup:
 * the link is SENT before the account is un-confirmed, so a mail failure
 * leaves a usable (auto-confirmed) account rather than a locked one.
 */
async function startVerification(email: string, companyName: string, force: boolean): Promise<"sent" | "skipped" | "failed"> {
    const token = newToken();
    const hash = await sha256Hex(token);
    if (force) {
        if (!(await sendVerificationEmail(email, companyName, token))) return "failed";
        const r = await rpc("begin_email_verification", { p_email: email, p_token_hash: hash, p_force: true });
        if (!r.ok) { console.error("[signup-tenant] begin_email_verification (0314 applied?):", r.body); return "failed"; }
        return "sent";
    }
    const r = await rpc("begin_email_verification", { p_email: email, p_token_hash: hash, p_force: false });
    if (!r.ok) { console.error("[signup-tenant] begin_email_verification:", r.body); return "failed"; }
    if (JSON.parse(r.body || "null") === null) return "skipped";       // unknown or already verified
    return (await sendVerificationEmail(email, companyName, token)) ? "sent" : "failed";
}

/** Per-IP + global throttle; also the audit trail. Returns a 429 Response or null. */
async function throttle(req: Request, email: string, what: string): Promise<{ ip: string; block: Response | null }> {
    const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    const dayAgo = new Date(Date.now() - 86400_000).toISOString();
    const [ipRes, allRes] = await Promise.all([
        rest(`signup_throttle?select=id&ip=eq.${encodeURIComponent(ip)}&created_at=gte.${hourAgo}`, { headers: { Prefer: "count=exact" } }),
        rest(`signup_throttle?select=id&created_at=gte.${dayAgo}`, { headers: { Prefer: "count=exact" } }),
    ]);
    const countOf = (r: Response) => Number((r.headers.get("content-range") ?? "/0").split("/")[1] || 0);
    if (countOf(ipRes) >= IP_HOURLY_LIMIT || countOf(allRes) >= GLOBAL_DAILY_LIMIT) {
        return { ip, block: reply(429, { error: "Too many signups right now — please try again later, or contact us." }) };
    }
    await rest("signup_throttle", { method: "POST", body: JSON.stringify({ ip, email, outcome: what }) });
    return { ip, block: null };
}

/** ACME-style code from the company name, uniquified by suffix if taken. */
function deriveCode(name: string): string {
    const base = name.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 10) || "TENANT";
    return base;
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return reply(405, { error: "POST only" });

    let payload: { action?: string; company_name?: string; admin_email?: string; password?: string; captcha_token?: string; website?: string };
    try { payload = await req.json(); } catch { return reply(400, { error: "invalid JSON" }); }

    // ── resend a verification link ──────────────────────────────────────────
    if (payload.action === "resend_verification") {
        const email = (payload.admin_email ?? "").trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) return reply(400, { error: "A valid email address is required." });
        const t = await throttle(req, email, "resend_verification");
        if (t.block) return t.block;
        const generic = { ok: true, message: "If that account is waiting for verification, a new link is on its way." };
        if (!VERIFY_EMAIL) return reply(200, generic);
        const outcome = await startVerification(email, "your IREAMS workspace", false);
        if (outcome === "failed") return reply(500, { error: "Could not send the verification email right now. Please try again shortly." });
        return reply(200, generic);
    }

    const companyName = (payload.company_name ?? "").trim();
    const email = (payload.admin_email ?? "").trim().toLowerCase();
    const password = payload.password ?? "";
    if (companyName.length < 2 || companyName.length > 80) return reply(400, { error: "Company name must be 2–80 characters." });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) return reply(400, { error: "A valid email address is required." });
    if (password.length < 10) return reply(400, { error: "Password must be at least 10 characters." });
    // Honeypot: the form renders a hidden "website" field humans never fill.
    if ((payload.website ?? "").trim() !== "") return reply(400, { error: "Could not create the workspace." });
    // CAPTCHA (enforced when TURNSTILE_SECRET_KEY is set — see turnstile.ts).
    const captcha = await verifyTurnstile(payload.captcha_token, req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for"));
    if (!captcha.ok) return reply(400, { error: captcha.reason });

    // ── throttle (and audit) ────────────────────────────────────────────────
    const { ip, block } = await throttle(req, email, "attempt");
    if (block) return block;

    // ── email must be new ───────────────────────────────────────────────────
    const existing = await rest(`users?select=id&email=eq.${encodeURIComponent(email)}&limit=1`);
    if (existing.ok && (await existing.json()).length > 0) {
        return reply(409, { error: "An account with this email already exists. Sign in instead." });
    }

    // ── company code, uniquified ────────────────────────────────────────────
    const base = deriveCode(companyName);
    let code = base;
    for (let i = 2; i <= 9; i++) {
        const taken = await rest(`companies?select=id&code=eq.${encodeURIComponent(code)}&limit=1`);
        if (taken.ok && (await taken.json()).length === 0) break;
        code = `${base}${i}`;
    }

    // ── the seed id list, from the in-database registry ─────────────────────
    const seedRes = await rest("product_seed_rows?select=id");
    const seedIds: string[] = seedRes.ok ? (await seedRes.json()).map((r: { id: string }) => r.id) : [];
    if (seedIds.length === 0) {
        // Refuse rather than provision an empty shell — a tenant with no audit
        // templates and no notification rules looks broken on first login.
        return reply(503, { error: "Signup is temporarily unavailable." });
    }

    // ── provision (atomic), then the admin, with teardown on failure ────────
    const prov = await rpc("provision_tenant", {
        p_name: companyName, p_code: code, p_seed_ids: seedIds,
        p_currency: null, p_country: null,
        // Pinned server-side; clients cannot choose a plan. Self-serve tenants
        // start on a PROFESSIONAL trial (launch review B1) so the onboarding
        // path — maturity intake, Specialist, import wizard — is reachable;
        // trial_expiry_sweep (0310) drops them to starter after TRIAL_DAYS.
        p_tier: "professional",
    });
    if (!prov.ok) {
        const msg = prov.body.includes("already exists") ? "That company appears to exist already." : "Could not create the workspace.";
        return reply(500, { error: msg });
    }
    const companyId = JSON.parse(prov.body);
    const trialEnds = new Date(Date.now() + TRIAL_DAYS * 86_400_000).toISOString();
    const trialSet = await rest(`companies?id=eq.${companyId}`, { method: "PATCH", body: JSON.stringify({ trial_ends_at: trialEnds }) });
    if (!trialSet.ok) console.warn("[signup-tenant] could not stamp trial_ends_at (0310 applied?):", await trialSet.text());

    const username = email.split("@")[0];
    const madeUser = await rpc("create_auth_user", {
        p_email: email, p_password: password, p_username: username, p_role: "SUPER_ADMIN",
    });
    if (!madeUser.ok) {
        await rpc("deprovision_tenant", { p_company: companyId });   // no admin = unreachable tenant
        return reply(500, { error: "Could not create the admin account." });
    }

    // Stamp tenant + roles (copied from a known-good admin row so the JSONB
    // shape matches what is_admin() reads).
    const stamped = await rest(`users?email=eq.${encodeURIComponent(email)}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ company_id: companyId, status: "active", roles: ["SUPER_ADMIN"] }),
    });
    if (!stamped.ok || ((await stamped.json()) as unknown[]).length === 0) {
        await rpc("deprovision_tenant", { p_company: companyId });
        return reply(500, { error: "Could not finalise the admin account." });
    }

    // ── email verification (0314): un-confirm + link, when mail is configured ──
    let verifyEmail = false;
    if (VERIFY_EMAIL) {
        const outcome = await startVerification(email, companyName, true);
        verifyEmail = outcome === "sent";
        if (!verifyEmail) console.warn(`[signup-tenant] ${code}: verification email not sent (${outcome}); account left auto-confirmed`);
    }

    await rest("signup_throttle", { method: "POST", body: JSON.stringify({ ip, email, outcome: `created:${code}${verifyEmail ? ":verify" : ""}` }) });
    return reply(200, { ok: true, company_code: code, verify_email: verifyEmail });
});
