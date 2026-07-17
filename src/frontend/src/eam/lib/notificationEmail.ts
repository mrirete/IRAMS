/**
 * Email outbox row construction — pure, no I/O.
 *
 * EMAIL deliveries are queued in `notification_outbox` (0199) and drained by
 * the notify-dispatch edge function, which resolves each recipient's address
 * from users.email and sends through Resend. Rows carry the app path in
 * action_link; the sender prefixes APP_URL.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface EmailContent {
    title: string;
    message: string;
    severity?: string;
    module?: string;
    entityNumber?: string;
    actionLink?: string;
}

export interface EmailOutboxRow {
    recipient_user_id: string;
    subject: string;
    message: string;
    severity: string;
    module: string | null;
    entity_number: string | null;
    action_link: string | null;
}

/**
 * One outbox row per real, distinct user. Non-UUID recipients (SYSTEM,
 * usernames that failed resolution) have no mailbox and are dropped here
 * rather than surfacing as SKIPPED rows in the queue.
 */
export function buildEmailOutboxRows(recipientUserIds: string[], content: EmailContent): EmailOutboxRow[] {
    const seen = new Set<string>();
    const rows: EmailOutboxRow[] = [];
    for (const id of recipientUserIds) {
        if (!id || !UUID_RE.test(id) || seen.has(id)) continue;
        seen.add(id);
        rows.push({
            recipient_user_id: id,
            subject: content.entityNumber ? `[${content.entityNumber}] ${content.title}` : content.title,
            message: content.message,
            severity: content.severity || 'INFO',
            module: content.module || null,
            entity_number: content.entityNumber || null,
            action_link: content.actionLink || null,
        });
    }
    return rows;
}
