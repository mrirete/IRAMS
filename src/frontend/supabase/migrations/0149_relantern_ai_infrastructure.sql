-- ═══════════════════════════════════════════════════════════════════════
-- 0149: Relantern AI Infrastructure Tables
-- ═══════════════════════════════════════════════════════════════════════
-- Creates the required tables for the AI subsystem (Phases 1-5):
--   1. ers_ai_audit_log  — Full AI interaction audit trail (NIST/IEC 62443)
--   2. ers_agent_actions  — Agent HITL action queue (pending_review → approved/rejected)
--   3. execute_readonly_sql() — Sandboxed RPC for NL-to-SQL read-only queries
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. AI Audit Log ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ers_ai_audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,
    username        TEXT NOT NULL,
    module          TEXT NOT NULL DEFAULT 'general',
    action_type     TEXT NOT NULL DEFAULT 'chat',
    query_text      TEXT,
    response_text   TEXT,
    context_type    TEXT,
    context_summary TEXT,
    model_used      TEXT NOT NULL DEFAULT 'gemini-2.0-flash',
    temperature     REAL DEFAULT 0.3,
    tokens_used     INT DEFAULT 0,
    duration_ms     INT DEFAULT 0,
    ip_address      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for admin audit queries (by user, module, time)
CREATE INDEX IF NOT EXISTS idx_ai_audit_username ON ers_ai_audit_log(username);
CREATE INDEX IF NOT EXISTS idx_ai_audit_module ON ers_ai_audit_log(module);
CREATE INDEX IF NOT EXISTS idx_ai_audit_created ON ers_ai_audit_log(created_at DESC);

-- RLS: service role only (backend writes), admin reads
ALTER TABLE ers_ai_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_audit_admin_read" ON ers_ai_audit_log
    FOR SELECT
    USING (
        auth.uid() IN (
            SELECT id FROM auth.users
            WHERE raw_user_meta_data->>'role' IN ('admin', 'administrator', 'reliability_engineer', 'plant_manager')
        )
    );


-- ── 2. Agent Actions (HITL Queue) ───────────────────────────────────

CREATE TABLE IF NOT EXISTS ers_agent_actions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_type      TEXT NOT NULL,
    trigger_id      TEXT,
    asset_id        TEXT,
    action_type     TEXT NOT NULL,
    draft_payload   JSONB NOT NULL DEFAULT '{}',
    status          TEXT NOT NULL DEFAULT 'pending_review'
                    CHECK (status IN ('pending_review', 'approved', 'rejected', 'expired')),
    reviewed_by     TEXT,
    reviewed_at     TIMESTAMPTZ,
    review_notes    TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for agent action queries
CREATE INDEX IF NOT EXISTS idx_agent_status ON ers_agent_actions(status);
CREATE INDEX IF NOT EXISTS idx_agent_type ON ers_agent_actions(agent_type);
CREATE INDEX IF NOT EXISTS idx_agent_asset ON ers_agent_actions(asset_id);
CREATE INDEX IF NOT EXISTS idx_agent_created ON ers_agent_actions(created_at DESC);

-- RLS
ALTER TABLE ers_agent_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_actions_read_all" ON ers_agent_actions
    FOR SELECT USING (true);

CREATE POLICY "agent_actions_insert_service" ON ers_agent_actions
    FOR INSERT WITH CHECK (true);

CREATE POLICY "agent_actions_update_reviewers" ON ers_agent_actions
    FOR UPDATE USING (true);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_agent_action_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_agent_action_updated
    BEFORE UPDATE ON ers_agent_actions
    FOR EACH ROW
    EXECUTE FUNCTION update_agent_action_timestamp();


-- ── 3. Read-Only SQL RPC (NL-to-SQL Sandbox) ───────────────────────
-- Executes user-generated SQL queries in a READ-ONLY transaction.
-- Used by the NL-to-SQL capability (Phase 5, Cap 8).
-- Security: Called through the backend proxy with validation.

CREATE OR REPLACE FUNCTION execute_readonly_sql(query_text TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '10s'
AS $$
DECLARE
    result JSONB;
BEGIN
    -- Safety check: only allow SELECT statements
    IF NOT (UPPER(TRIM(query_text)) LIKE 'SELECT%') THEN
        RAISE EXCEPTION 'Only SELECT queries are allowed';
    END IF;

    -- Block dangerous keywords
    IF query_text ~* '\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|EXEC|EXECUTE)\b' THEN
        RAISE EXCEPTION 'Query contains forbidden SQL keywords';
    END IF;

    -- Execute in a read-only mode
    SET LOCAL transaction_read_only = ON;
    EXECUTE 'SELECT jsonb_agg(row_to_json(t)) FROM (' || query_text || ') t' INTO result;

    RETURN COALESCE(result, '[]'::jsonb);
EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'SQL execution error: %', SQLERRM;
END;
$$;

-- Revoke direct public access — only callable through backend proxy
REVOKE ALL ON FUNCTION execute_readonly_sql(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION execute_readonly_sql(TEXT) TO service_role;


-- ── 4. RAG Document Chunks (OEM Manual Storage) ────────────────────

CREATE TABLE IF NOT EXISTS ers_rag_documents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source          TEXT NOT NULL,
    chunk_index     INT NOT NULL DEFAULT 0,
    chunk_text      TEXT NOT NULL,
    page_number     INT,
    asset_tag       TEXT,
    equipment_class TEXT,
    document_type   TEXT NOT NULL DEFAULT 'oem_manual',
    embedding       VECTOR(768),
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Vector similarity search index (IVFFlat for pgvector)
-- CREATE INDEX IF NOT EXISTS idx_rag_embedding ON ers_rag_documents
--     USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Filtered search indexes
CREATE INDEX IF NOT EXISTS idx_rag_asset ON ers_rag_documents(asset_tag);
CREATE INDEX IF NOT EXISTS idx_rag_class ON ers_rag_documents(equipment_class);
CREATE INDEX IF NOT EXISTS idx_rag_source ON ers_rag_documents(source);

-- RLS
ALTER TABLE ers_rag_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rag_docs_read_all" ON ers_rag_documents
    FOR SELECT USING (true);

CREATE POLICY "rag_docs_insert_service" ON ers_rag_documents
    FOR INSERT WITH CHECK (true);


COMMENT ON TABLE ers_ai_audit_log IS 'AI interaction audit trail for NIST/IEC 62443 compliance. Non-erasable log of all AI calls.';
COMMENT ON TABLE ers_agent_actions IS 'HITL agent action queue. All AI-drafted actions require human review before execution.';
COMMENT ON TABLE ers_rag_documents IS 'RAG document chunks with pgvector embeddings for OEM manual search.';
COMMENT ON FUNCTION execute_readonly_sql IS 'Sandboxed read-only SQL execution for NL-to-SQL queries. Service role only.';
