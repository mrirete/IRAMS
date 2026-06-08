-- Create Notification Channels Table
CREATE TABLE IF NOT EXISTS notification_channels (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type TEXT NOT NULL, -- 'EMAIL', 'PUSH', 'SMS'
    is_active BOOLEAN DEFAULT true,
    config_json JSONB DEFAULT '{}'::jsonb, -- Store API Keys, SMTP settings etc. securely (RLS should protect this)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(type)
);

-- Create Message Templates Table
CREATE TABLE IF NOT EXISTS message_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    trigger_event TEXT NOT NULL, -- e.g. 'JOB_ASSIGNED'
    channel_type TEXT NOT NULL, -- 'EMAIL', 'SMS'
    subject_template TEXT,
    body_template TEXT, -- Supports Liquid/Handlebars syntax
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create Notification Logs (In-App Mailbox for Testing & Audit)
CREATE TABLE IF NOT EXISTS notification_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recipient_id TEXT, -- User ID or Email
    channel TEXT NOT NULL,
    subject TEXT,
    body TEXT,
    status TEXT DEFAULT 'SENT', -- 'SENT', 'FAILED', 'QUEUED'
    error_message TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS Policies
ALTER TABLE notification_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_logs ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users (admins) to manage config
CREATE POLICY "Manage Channels" ON notification_channels FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Manage Templates" ON message_templates FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "View Logs" ON notification_logs FOR ALL USING (auth.role() = 'authenticated');
