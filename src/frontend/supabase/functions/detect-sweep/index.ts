/**
 * detect-sweep — server-side escalation sweep (Wave 2 / A3).
 *
 * Until now escalation ran only in the browser (NotificationCenter, 5-min
 * interval), so a breached deadline waited for someone to have a tab open.
 * This function sweeps ALL users' breached notifications centrally with the
 * service role: it creates the escalation copies, bumps escalation_level and
 * clears escalation_deadline on the original (the same server-side dedup the
 * client uses — the two can coexist safely), and mirrors the escalations
 * into notification_outbox when the EMAIL channel is on, so an escalation
 * reaches a phone even with zero sessions open.
 *
 * Recipient resolution mirrors NotificationService.checkEscalations with one
 * documented simplification: role codes resolve GLOBALLY (the client's
 * org-walk needs per-user context this sweep doesn't have). '' → same
 * recipient; '__SUPERVISOR' → the contact's parent contact, else same.
 *
 * Schedule (SQL editor, after enabling pg_cron + pg_net):
 *   select cron.schedule('detect-sweep', '*/5 * * * *',
 *     $$select net.http_post(
 *         url    := '<SUPABASE_URL>/functions/v1/detect-sweep',
 *         headers:= '{"Authorization":"Bearer <ANON_KEY>","Content-Type":"application/json"}'::jsonb,
 *         body   := '{}'::jsonb)$$);
 *
 * Env: injected SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY only.
 * Deploy: supabase functions deploy detect-sweep
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const SWEEP_LIMIT = 100;

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
    const text = await res.text();
    return text ? JSON.parse(text) : null; // inserts/patches return 201/204 with empty bodies
}

/** Case/separator-insensitive role compare — same rule as the client's roleMatches. */
const normRole = (s: string) => String(s || "").toUpperCase().replace(/[^A-Z0-9]+/g, "_");

interface ContactRow { id: string; user_id: string | null; parent_id: string | null; roles: string[] | null }
interface UserRow { id: string; contact_id: string | null }

/** contact → login user id, users.contact_id first (the populated direction). */
function contactToUserId(contact: ContactRow, usersByContact: Map<string, string>): string | null {
    return usersByContact.get(contact.id) ?? contact.user_id ?? null;
}

Deno.serve(async (req: Request) => {
    if (req.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
    }

    try {
        const nowIso = new Date().toISOString();

        // Breached, unhandled notifications across ALL users.
        const breached = await rest(
            `notifications?select=*&escalation_deadline=lt.${encodeURIComponent(nowIso)}` +
            `&is_read=eq.false&is_acknowledged=eq.false&order=escalation_deadline.asc&limit=${SWEEP_LIMIT}`,
        ) as Record<string, any>[];
        if (breached.length === 0) {
            return new Response(JSON.stringify({ swept: 0 }), { status: 200 });
        }

        // People directory, loaded once per sweep.
        const contacts = await rest(`contacts?select=id,user_id,parent_id,roles`) as ContactRow[];
        const users = await rest(`users?select=id,contact_id`) as UserRow[];
        const usersByContact = new Map<string, string>();
        for (const u of users) if (u.contact_id) usersByContact.set(u.contact_id, u.id);
        const contactByUser = new Map<string, ContactRow>();
        for (const c of contacts) {
            const uid = contactToUserId(c, usersByContact);
            if (uid) contactByUser.set(uid, c);
        }
        const contactById = new Map(contacts.map((c) => [c.id, c]));

        const roleHolders = (role: string): string[] => {
            const want = normRole(role);
            const ids: string[] = [];
            for (const c of contacts) {
                if ((c.roles || []).some((r) => normRole(r) === want)) {
                    const uid = contactToUserId(c, usersByContact);
                    if (uid) ids.push(uid);
                }
            }
            return ids;
        };

        // EMAIL mirror only if the global channel is on.
        let emailOn = false;
        try {
            const channels = await rest(`notification_channels?select=type,is_active&type=eq.EMAIL`) as { is_active: boolean }[];
            emailOn = !!channels?.[0]?.is_active;
        } catch { /* pre-0092: no email */ }

        let escalations = 0;
        const outboxRows: Record<string, unknown>[] = [];

        for (const notif of breached) {
            const newLevel = (Number(notif.escalation_level) || 0) + 1;
            const severity = newLevel >= 2 ? "CRITICAL" : "WARNING";
            const escalationRole = String(notif.escalation_recipient_role || "");

            // Resolve targets — original recipient always stays in copy when
            // escalating to someone else (mirrors the client).
            let targets: string[] = [notif.recipient_id];
            if (escalationRole === "__SUPERVISOR") {
                const contact = contactByUser.get(notif.recipient_id);
                const parent = contact?.parent_id ? contactById.get(contact.parent_id) : null;
                const supId = parent ? contactToUserId(parent, usersByContact) : null;
                if (supId) targets = [supId, notif.recipient_id];
            } else if (escalationRole) {
                const holders = roleHolders(escalationRole);
                if (holders.length > 0) targets = [...holders, notif.recipient_id];
            }
            targets = [...new Set(targets.filter(Boolean))];

            const title = `⚠️ ESCALATION (L${newLevel}): ${notif.title}`;
            const message = `This alert has not been acknowledged within the required timeframe. Original: ${notif.message}`;

            await rest(`notifications`, {
                method: "POST",
                body: JSON.stringify(targets.map((recipientId) => ({
                    recipient_id: recipientId,
                    title,
                    message,
                    severity,
                    notification_type: "ESCALATION",
                    module: notif.module,
                    entity_id: notif.entity_id,
                    entity_type: notif.entity_type,
                    entity_number: notif.entity_number,
                    action_link: notif.action_link,
                    action_required: true,
                    created_by: "SYSTEM_ESCALATION",
                }))),
            });
            escalations += targets.length;

            if (emailOn) {
                for (const recipientId of targets) {
                    outboxRows.push({
                        recipient_user_id: recipientId,
                        subject: notif.entity_number ? `[${notif.entity_number}] ${title}` : title,
                        message,
                        severity,
                        module: notif.module,
                        entity_number: notif.entity_number,
                        action_link: notif.action_link,
                    });
                }
            }

            // Dedup across sessions and future sweeps: bump + clear deadline.
            await rest(`notifications?id=eq.${notif.id}`, {
                method: "PATCH",
                body: JSON.stringify({ escalation_level: newLevel, escalation_deadline: null }),
            });
        }

        if (outboxRows.length > 0) {
            try {
                await rest(`notification_outbox`, { method: "POST", body: JSON.stringify(outboxRows) });
            } catch (e) {
                console.warn("outbox enqueue failed (0199 applied?):", e);
            }
        }

        return new Response(
            JSON.stringify({ swept: breached.length, escalations, emailsQueued: outboxRows.length }),
            { status: 200, headers: { "Content-Type": "application/json" } },
        );
    } catch (error) {
        console.error("detect-sweep error:", error);
        return new Response(JSON.stringify({ error: String(error) }), { status: 500 });
    }
});
