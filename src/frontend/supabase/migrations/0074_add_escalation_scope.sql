-- 0074_add_escalation_scope.sql
-- ============================================================
-- Adds escalation_scope to notification_rules table
-- to control how role-based recipients are resolved.
-- Values: 'ORG_UNIT' (walk up org tree), 'SITE', 'GLOBAL'
-- ============================================================

ALTER TABLE notification_rules
    ADD COLUMN IF NOT EXISTS escalation_scope TEXT DEFAULT 'ORG_UNIT';

COMMENT ON COLUMN notification_rules.escalation_scope IS 'Scope for role resolution: ORG_UNIT (walk up org tree), SITE (same site as asset), GLOBAL (all with role)';
