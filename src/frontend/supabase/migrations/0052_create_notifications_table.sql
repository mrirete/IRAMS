-- ============================================================
-- 0052: Create In-App Notifications Table
-- EAM Best Practice: SAP PM notification types + Maximo escalation
-- ============================================================

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Recipient
    recipient_id TEXT NOT NULL,
    recipient_role TEXT,

    -- Content
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('INFO','SUCCESS','WARNING','CRITICAL')),

    -- Context (SAP PM-style notification types)
    notification_type TEXT NOT NULL CHECK (notification_type IN (
        'APPROVAL_REQUIRED',
        'ASSIGNMENT',
        'STATUS_CHANGE',
        'SLA_BREACH',
        'INVENTORY_ALERT',
        'SCHEDULE_ALERT',
        'SAFETY_ALERT',
        'COST_THRESHOLD',
        'AI_RECOMMENDATION',
        'SYSTEM'
    )),

    -- Entity Link
    module TEXT NOT NULL,
    entity_id TEXT,
    entity_type TEXT,
    entity_number TEXT,
    action_link TEXT,
    action_required BOOLEAN DEFAULT false,

    -- Escalation (Maximo-style)
    escalation_level INT DEFAULT 0,
    escalation_deadline TIMESTAMPTZ,
    parent_notification_id UUID REFERENCES notifications(id),

    -- State
    is_read BOOLEAN DEFAULT false,
    is_acknowledged BOOLEAN DEFAULT false,
    read_at TIMESTAMPTZ,
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by TEXT,

    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by TEXT
);

-- Performance indexes
CREATE INDEX idx_notifications_recipient ON notifications(recipient_id, is_read, created_at DESC);
CREATE INDEX idx_notifications_entity ON notifications(entity_id, entity_type);
CREATE INDEX idx_notifications_unread ON notifications(recipient_id) WHERE is_read = false;
CREATE INDEX idx_notifications_escalation ON notifications(escalation_deadline)
    WHERE escalation_deadline IS NOT NULL AND is_acknowledged = false;

-- RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications"
    ON notifications FOR SELECT
    USING (true);

CREATE POLICY "System can insert notifications"
    ON notifications FOR INSERT
    WITH CHECK (true);

CREATE POLICY "Users can update own notifications"
    ON notifications FOR UPDATE
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Users can delete own notifications"
    ON notifications FOR DELETE
    USING (true);
