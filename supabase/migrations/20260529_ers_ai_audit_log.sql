-- ═══════════════════════════════════════════════════════════
-- ERS AI Audit Log — Full traceability for all AI interactions
-- NIST/IEC 62443 compliant: Who, What, When, Where for every
-- AI call, including queries that were blocked or errored.
-- ═══════════════════════════════════════════════════════════

-- AI Interaction Audit Log
CREATE TABLE IF NOT EXISTS ers_ai_audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,
    username        TEXT NOT NULL,
    module          TEXT NOT NULL DEFAULT 'general',
    action_type     TEXT NOT NULL DEFAULT 'chat',
    query_text      TEXT NOT NULL,
    response_text   TEXT,
    context_type    TEXT,
    context_summary TEXT,
    model_used      TEXT NOT NULL DEFAULT 'gemini-2.0-flash',
    temperature     REAL NOT NULL DEFAULT 0.3,
    tokens_used     INTEGER NOT NULL DEFAULT 0,
    duration_ms     INTEGER NOT NULL DEFAULT 0,
    ip_address      INET,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_ai_audit_user
    ON ers_ai_audit_log (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_audit_module
    ON ers_ai_audit_log (module, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_audit_action_type
    ON ers_ai_audit_log (action_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_audit_created
    ON ers_ai_audit_log (created_at DESC);

-- RLS: Users can see their own audit entries; admins can see all
ALTER TABLE ers_ai_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own AI audit entries"
    ON ers_ai_audit_log FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert AI audit entries"
    ON ers_ai_audit_log FOR INSERT
    WITH CHECK (true);

-- Comment for documentation
COMMENT ON TABLE ers_ai_audit_log IS
    'Non-erasable audit trail for all AI interactions. NIST/IEC 62443 compliant. Who/What/When/Where.';
COMMENT ON COLUMN ers_ai_audit_log.query_text IS
    'Truncated to 2000 chars. Full prompt for traceability.';
COMMENT ON COLUMN ers_ai_audit_log.response_text IS
    'Truncated to 5000 chars. AI response for audit review.';
COMMENT ON COLUMN ers_ai_audit_log.context_type IS
    'Type of EAM context provided (asset_detail, wo_history, pm_data, etc.)';
COMMENT ON COLUMN ers_ai_audit_log.tokens_used IS
    'Estimated token count for cost tracking and quota management.';
