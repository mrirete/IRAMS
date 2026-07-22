/**
 * notify-dispatch — drains the notification_outbox (0199) and delivers EMAIL
 * rows through Resend (same stack and secrets as audit-invite).
 *
 * The app enqueues rows client-side (NotificationService → notification_outbox)
 * and invokes this function fire-and-forget; rows a closed tab leaves behind
 * are picked up by the next invocation. Optionally schedule a pg_cron sweeper:
 *   select cron.schedule('notify-dispatch-sweep', '0-59/5 * * * *',   -- every 5 min ("star-slash-5" would end this comment)
 *     $$select net.http_post(
 *         url    := '<SUPABASE_URL>/functions/v1/notify-dispatch',
 *         headers:= '{"Authorization":"Bearer <ANON_KEY>","Content-Type":"application/json"}'::jsonb,
 *         body   := '{}'::jsonb)$$);
 *
 * Concurrency-safe: rows are claimed by PATCHing PENDING→SENDING with a
 * status filter, so two overlapping invocations never send the same row.
 * Failures retry on later invocations up to MAX_ATTEMPTS; recipients without
 * an email address are marked SKIPPED.
 *
 * Env: RESEND_API_KEY, FROM_EMAIL, APP_URL (already set for audit-invite)
 *      + injected: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Deploy: supabase functions deploy notify-dispatch
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "Relantern <onboarding@resend.dev>";
const APP_URL = (Deno.env.get("APP_URL") ?? "https://irams.vercel.app").replace(/\/$/, "");

const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 3;
const STALE_CLAIM_MINUTES = 10;

interface OutboxRow {
    id: string;
    recipient_user_id: string;
    subject: string;
    message: string;
    severity: string;
    module: string | null;
    entity_number: string | null;
    action_link: string | null;
    attempts: number;
}

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

const patchRow = (id: string, body: Record<string, unknown>) =>
    rest(`notification_outbox?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(body) });

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

const SEVERITY_COLORS: Record<string, string> = {
    CRITICAL: "#dc2626",
    WARNING: "#d97706",
    SUCCESS: "#16a34a",
    INFO: "#475569",
};

function notificationEmail(row: OutboxRow): string {
    const color = SEVERITY_COLORS[row.severity] ?? SEVERITY_COLORS.INFO;
    const link = row.action_link ? `${APP_URL}${row.action_link.startsWith("/") ? "" : "/"}${row.action_link}` : `${APP_URL}/`;
    return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff">
    <div style="background:#0f172a;padding:24px 28px">
      <div style="color:#fff;font-size:18px;font-weight:800">Relantern</div>
      <div style="color:#94a3b8;font-size:12px">IRAMS — Reliability &amp; Asset Management</div>
    </div>
    <div style="padding:28px">
      <div style="margin-bottom:14px">
        <span style="display:inline-block;background:${color};color:#fff;font-size:11px;font-weight:700;letter-spacing:.4px;padding:3px 10px;border-radius:999px">${esc(row.severity)}</span>
        ${row.entity_number ? `<span style="display:inline-block;margin-left:8px;color:#64748b;font-size:12px;font-weight:600">${esc(row.entity_number)}</span>` : ""}
      </div>
      <p style="font-size:16px;color:#0f172a;font-weight:700;margin:0 0 10px">${esc(row.subject)}</p>
      <p style="font-size:14px;color:#475569;line-height:1.6;margin:0 0 22px">${esc(row.message)}</p>
      <div style="text-align:center;margin:26px 0">
        <a href="${esc(link)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:13px 24px;border-radius:10px">Open in IRAMS →</a>
      </div>
      <p style="font-size:12px;color:#94a3b8;margin-top:16px">
        You're receiving this because a notification was addressed to you in IRAMS.
        Delivery channels can be adjusted by your administrator under Admin › Notifications.</p>
    </div>
    <div style="background:#f8fafc;padding:16px 28px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:11px">
      © Relantern — AI-powered reliability engineering &amp; enterprise asset management.
    </div>
  </div>`;
}

// ── Handler ──

Deno.serve(async (req) => {
    if (req.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
    }

    try {
        // Reclaim rows a crashed run left in SENDING.
        const staleBefore = new Date(Date.now() - STALE_CLAIM_MINUTES * 60_000).toISOString();
        await rest(
            `notification_outbox?status=eq.SENDING&claimed_at=lt.${encodeURIComponent(staleBefore)}`,
            { method: "PATCH", body: JSON.stringify({ status: "PENDING" }) },
        );

        // Claim a batch: PENDING → SENDING, filtered on status so overlapping
        // invocations can't double-claim.
        const pending = await rest(
            `notification_outbox?select=id&status=eq.PENDING&order=created_at.asc&limit=${BATCH_SIZE}`,
        ) as { id: string }[];
        if (pending.length === 0) {
            return new Response(JSON.stringify({ processed: 0 }), { status: 200 });
        }
        const claimed = await rest(
            `notification_outbox?id=in.(${pending.map((r) => r.id).join(",")})&status=eq.PENDING&select=*`,
            {
                method: "PATCH",
                headers: { "Prefer": "return=representation" },
                body: JSON.stringify({ status: "SENDING", claimed_at: new Date().toISOString() }),
            },
        ) as OutboxRow[];

        // Resolve recipient addresses in one query.
        const userIds = [...new Set(claimed.map((r) => r.recipient_user_id))];
        const users = userIds.length
            ? await rest(`users?select=id,email&id=in.(${userIds.join(",")})`) as { id: string; email: string | null }[]
            : [];
        const emailByUser = new Map(users.map((u) => [u.id, (u.email ?? "").trim()]));

        let sent = 0, failed = 0, skipped = 0;
        for (const row of claimed) {
            const to = emailByUser.get(row.recipient_user_id);
            if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
                await patchRow(row.id, { status: "SKIPPED", last_error: "recipient has no valid email" });
                skipped++;
                continue;
            }
            try {
                await sendEmail(to, row.subject, notificationEmail(row));
                await patchRow(row.id, { status: "SENT", sent_at: new Date().toISOString(), last_error: null });
                sent++;
            } catch (e) {
                const attempts = (row.attempts ?? 0) + 1;
                await patchRow(row.id, {
                    status: attempts >= MAX_ATTEMPTS ? "FAILED" : "PENDING",
                    attempts,
                    last_error: String(e).slice(0, 500),
                });
                failed++;
            }
        }

        return new Response(JSON.stringify({ processed: claimed.length, sent, failed, skipped }), { status: 200 });
    } catch (error) {
        console.error("notify-dispatch error:", error);
        return new Response(JSON.stringify({ error: String(error) }), { status: 500 });
    }
});
