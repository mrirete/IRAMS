/**
 * audit-invite — Self-serve IREAMS access from the marketing website (IREAMS Supabase).
 *
 * The Relantern website's assessment funnel POSTs a prospect's contact details
 * here; we mint a one-time invite (same `user_invites` machinery admins use —
 * 0190) and email the /invite/<token> link, so no manual invite generation is
 * needed. Marketing/lead data stays in the website's own Supabase project —
 * this function only provisions access.
 *
 * Called with the anon key from the browser (verify_jwt stays ON), so writes
 * go through the service role held server-side here, never exposed.
 *
 * Abuse posture: honeypot field, email syntax check, one live invite per email
 * (repeat requests re-send the same link — idempotent, no invite stacking),
 * and already-registered emails get a "log in" email instead of a new invite.
 *
 * Env: RESEND_API_KEY, FROM_EMAIL, SALES_EMAIL (optional), APP_URL,
 *      ALLOWED_ORIGINS (comma-separated)
 *      + injected: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Deploy: supabase functions deploy audit-invite
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "Relantern <onboarding@resend.dev>";
const SALES_EMAIL = Deno.env.get("SALES_EMAIL") ?? "";
const APP_URL = (Deno.env.get("APP_URL") ?? "https://irams.vercel.app").replace(/\/$/, "");
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ??
    "https://relantern.com,https://www.relantern.com")
    .split(",").map((o) => o.trim()).filter(Boolean);

// Website prospects get the role with full audit-suite access and nothing
// administrative. Swap for a dedicated trial role when one exists.
const INVITE_ROLE = "RELIABILITY_ENG";

const corsFor = (req: Request) => {
    const origin = req.headers.get("origin") ?? "";
    return {
        "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Vary": "Origin",
    };
};

const json = (req: Request, body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", ...corsFor(req) },
    });

// ── Supabase REST (service role) ──

async function rest(path: string, init: RequestInit = {}): Promise<unknown> {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        ...init,
        headers: {
            "apikey": SERVICE_KEY,
            "Authorization": `Bearer ${SERVICE_KEY}`,
            "Content-Type": "application/json",
            ...(init.headers ?? {}),
        },
    });
    if (!res.ok) throw new Error(`PostgREST ${res.status}: ${await res.text()}`);
    return res.status === 204 ? null : res.json();
}

// ── Email (Resend) ──

async function sendEmail(to: string, subject: string, html: string) {
    const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
    return res.json();
}

const esc = (s: unknown): string =>
    String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function shell(inner: string): string {
    return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff">
    <div style="background:#0f172a;padding:24px 28px">
      <div style="color:#fff;font-size:18px;font-weight:800">Relantern</div>
      <div style="color:#94a3b8;font-size:12px">IREAMS — Reliability &amp; Enterprise Management</div>
    </div>
    <div style="padding:28px">${inner}</div>
    <div style="background:#f8fafc;padding:16px 28px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:11px">
      © Relantern — AI-powered reliability engineering &amp; enterprise asset management.
    </div>
  </div>`;
}

function inviteEmail(firstName: string, link: string, expiresAt: string): string {
    const expires = new Date(expiresAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    return shell(`
      <p style="font-size:15px;color:#0f172a">Hi ${esc(firstName || "there")},</p>
      <p style="font-size:14px;color:#475569;line-height:1.6">
        Here's your personal access link to the <strong>IREAMS Audit Module</strong> —
        run a full, evidence-based ISO 55001 / PSM / RBI maturity audit with an
        executive report and a prioritized improvement roadmap.</p>
      <div style="text-align:center;margin:26px 0">
        <a href="${esc(link)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:13px 24px;border-radius:10px">Set Up My IREAMS Access →</a>
      </div>
      <table style="width:100%;border-collapse:collapse;margin:6px 0 2px">
        <tr><td style="padding:7px 10px 7px 0;font-size:13px;color:#334155;vertical-align:top;white-space:nowrap"><strong style="color:#2563eb">1.</strong></td>
            <td style="padding:7px 0;font-size:13px;color:#475569">Open the link and choose your username and password — takes under a minute.</td></tr>
        <tr><td style="padding:7px 10px 7px 0;font-size:13px;color:#334155;vertical-align:top"><strong style="color:#2563eb">2.</strong></td>
            <td style="padding:7px 0;font-size:13px;color:#475569">In IREAMS, open <strong>Audits</strong> from the sidebar and start your first audit from a standard template.</td></tr>
      </table>
      <p style="font-size:12px;color:#94a3b8;margin-top:16px">
        This link works once and expires on ${esc(expires)}. If it expires, just request
        access again from <a href="https://relantern.com/assessment.html" style="color:#94a3b8">relantern.com</a>.</p>`);
}

function existingUserEmail(firstName: string): string {
    return shell(`
      <p style="font-size:15px;color:#0f172a">Hi ${esc(firstName || "there")},</p>
      <p style="font-size:14px;color:#475569;line-height:1.6">
        Good news — you already have an IREAMS account under this email address.
        Log in and open <strong>Audits</strong> from the sidebar to continue.</p>
      <div style="text-align:center;margin:26px 0">
        <a href="${esc(`${APP_URL}/login`)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:13px 24px;border-radius:10px">Log In to IREAMS →</a>
      </div>
      <p style="font-size:12px;color:#94a3b8">Forgot your password? Reply to this email and we'll help you out.</p>`);
}

// ── Handler ──

interface AccessRequest {
    firstName?: string; lastName?: string; name?: string;
    email?: string; company?: string; phone?: string;
    source?: string; hp?: string;
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) });
    if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

    try {
        const body = (await req.json()) as AccessRequest;

        // Honeypot: bots that fill the hidden field get a quiet, convincing 200.
        if (body.hp) return json(req, { ok: true });

        const email = String(body.email ?? "").trim().toLowerCase();
        const firstName = String(body.firstName ?? body.name ?? "").trim().split(/\s+/)[0] ?? "";
        const fullName = [body.firstName, body.lastName].filter(Boolean).join(" ").trim() ||
            String(body.name ?? "").trim();

        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
            return json(req, { error: "A valid email address is required" }, 400);
        }

        // Already a user? Point them at login instead of minting an invite.
        const existing = await rest(
            `users?select=id&email=eq.${encodeURIComponent(email)}&limit=1`,
        ) as { id: string }[];
        if (existing.length > 0) {
            await sendEmail(email, "You already have IREAMS access — log in", existingUserEmail(firstName));
            return json(req, { ok: true, existing: true });
        }

        // One live invite per email: re-send the same link rather than stacking.
        const pending = await rest(
            `user_invites?select=token,expires_at&email=eq.${encodeURIComponent(email)}` +
            `&status=eq.pending&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`,
        ) as { token: string; expires_at: string }[];

        let token: string, expiresAt: string;
        if (pending.length > 0) {
            ({ token, expires_at: expiresAt } = pending[0]);
        } else {
            // Same token shape as create_user_invite: two UUIDs of hex, no dashes.
            const created = await rest("user_invites", {
                method: "POST",
                headers: { "Prefer": "return=representation" },
                body: JSON.stringify({
                    token: (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, ""),
                    email,
                    invited_name: fullName || null,
                    role: INVITE_ROLE,
                }),
            }) as { token: string; expires_at: string }[];
            ({ token, expires_at: expiresAt } = created[0]);
        }

        const link = `${APP_URL}/invite/${token}`;
        await sendEmail(email, "Your IREAMS Audit Module access", inviteEmail(firstName, link, expiresAt));

        if (SALES_EMAIL) {
            try {
                await sendEmail(
                    SALES_EMAIL,
                    `IREAMS access requested: ${fullName || email}${body.company ? ` (${body.company})` : ""}`,
                    shell(`<p style="font-size:14px;color:#475569;line-height:1.7">
                      <strong>${esc(fullName || "—")}</strong> (${esc(email)})${body.company ? ` from <strong>${esc(body.company)}</strong>` : ""}
                      requested IREAMS audit access via <strong>${esc(body.source || "website")}</strong>.
                      Invite sent as ${esc(INVITE_ROLE)}, expires ${esc(new Date(expiresAt).toLocaleDateString())}.</p>`),
                );
            } catch (e) {
                console.error("sales notify failed:", e);
            }
        }

        return json(req, { ok: true });
    } catch (error) {
        console.error("audit-invite error:", error);
        return json(req, { error: "Could not process the request — please try again later" }, 500);
    }
});
