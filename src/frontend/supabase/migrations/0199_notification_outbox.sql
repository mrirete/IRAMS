-- 0199: Email delivery outbox.
--
-- IN_APP notifications land in `notifications`; anything that must leave the
-- app is queued here and drained by the notify-dispatch edge function, which
-- resolves each recipient's address from users.email and sends via Resend
-- (same stack as audit-invite). Queue-then-send keeps enqueue inside the
-- browser's fire-and-forget dispatch safe: a closed tab loses nothing once
-- the row is written.

CREATE TABLE IF NOT EXISTS notification_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_user_id TEXT NOT NULL,          -- users.id; address resolved at send time
    channel TEXT NOT NULL DEFAULT 'EMAIL',
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'INFO',
    module TEXT,
    entity_number TEXT,
    action_link TEXT,                          -- app path; sender prefixes APP_URL
    status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING','SENDING','SENT','FAILED','SKIPPED')),
    attempts INT NOT NULL DEFAULT 0,
    last_error TEXT,
    claimed_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_pending
    ON notification_outbox (status, created_at);

-- Clients may only enqueue. No SELECT/UPDATE/DELETE policies: the queue is
-- read and drained exclusively by the service role inside notify-dispatch,
-- so notification content addressed to others is never readable client-side.
ALTER TABLE notification_outbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "outbox_enqueue" ON notification_outbox;
CREATE POLICY "outbox_enqueue" ON notification_outbox
    FOR INSERT TO authenticated WITH CHECK (true);

-- Flip the global EMAIL channel on (seeded off in 0092). The Admin ›
-- Delivery Channels toggle remains the kill-switch.
UPDATE notification_channels
   SET is_active = true,
       config_json = jsonb_set(coalesce(config_json, '{}'::jsonb), '{description}',
                               '"Email via Resend (notify-dispatch edge function)"')
 WHERE type = 'EMAIL';

-- Opt the highest-stakes rules into EMAIL: critical severity and anything
-- that escalates. Everything else stays IN_APP-only until an admin adds
-- EMAIL per-rule in Notification Config.
UPDATE notification_rules
   SET channels = channels || '["EMAIL"]'::jsonb
 WHERE is_active
   AND NOT channels @> '["EMAIL"]'::jsonb
   AND (severity = 'CRITICAL' OR escalation_timeout_minutes > 0);
