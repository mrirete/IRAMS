-- ============================================================
-- Fix notification_channels: add missing UNIQUE constraint & disable RLS
--
-- Migration 0071 recreated notification_channels without the
-- UNIQUE(type) constraint that was in migration 0030.
-- The saveNotificationChannel service uses upsert with
-- onConflict: 'type' which requires this constraint.
--
-- Also disables RLS on all notification/messaging tables
-- (same sb_publishable_ key issue as other EAM tables).
-- ============================================================

-- Add the missing UNIQUE constraint on 'type'
-- (safe: only one row per channel type: EMAIL, SMS, PUSH, IN_APP, WEBHOOK)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'notification_channels_type_key'
        AND conrelid = 'notification_channels'::regclass
    ) THEN
        ALTER TABLE notification_channels ADD CONSTRAINT notification_channels_type_key UNIQUE (type);
    END IF;
END $$;

-- Disable RLS on notification & messaging tables
ALTER TABLE notification_channels DISABLE ROW LEVEL SECURITY;
ALTER TABLE notification_rules DISABLE ROW LEVEL SECURITY;
ALTER TABLE notification_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE message_templates DISABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'notifications') THEN
        EXECUTE 'ALTER TABLE notifications DISABLE ROW LEVEL SECURITY';
    END IF;
END $$;

-- Seed the 5 default channel rows if they don't exist
INSERT INTO notification_channels (type, is_active, config_json)
VALUES
    ('IN_APP', true, '{"description": "In-app notifications and bell icon alerts"}'::jsonb),
    ('EMAIL', false, '{"description": "Email notifications via SMTP/SendGrid", "smtp_host": "", "smtp_port": 587}'::jsonb),
    ('SMS', false, '{"description": "SMS notifications via Twilio/SNS", "provider": ""}'::jsonb),
    ('PUSH', false, '{"description": "Push notifications to mobile apps", "provider": ""}'::jsonb),
    ('WEBHOOK', false, '{"description": "Webhook integrations (Slack, Teams, etc.)", "webhook_url": ""}'::jsonb)
ON CONFLICT (type) DO NOTHING;
