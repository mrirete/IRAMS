-- 0072_add_escalation_recipient_role.sql
-- ============================================================
-- Adds escalation_recipient_role to notification_rules and notifications
-- so the system knows WHO to escalate to when a deadline is breached.
-- ============================================================

-- notification_rules: store the configured escalation role
ALTER TABLE notification_rules
    ADD COLUMN IF NOT EXISTS escalation_recipient_role TEXT;

-- notifications: carry the escalation role so checkEscalations can resolve it
ALTER TABLE notifications
    ADD COLUMN IF NOT EXISTS escalation_recipient_role TEXT;

COMMENT ON COLUMN notification_rules.escalation_recipient_role IS 'Role code to escalate to (e.g. MAINT_MANAGER, __SUPERVISOR for org chart lookup)';
COMMENT ON COLUMN notifications.escalation_recipient_role IS 'Copied from rule at dispatch time; used by checkEscalations to resolve hierarchy';
