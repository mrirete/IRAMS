-- ═══════════════════════════════════════════════════════════════
-- 0222 — Manual Reader: repair 0149's RAG table + full-text search
--
-- WHY THIS EXISTS: migration 0149 is not transaction-wrapped, and the
-- Supabase SQL editor runs statement-by-statement. Its RAG section
-- opened with `embedding VECTOR(768)` while the pgvector extension had
-- never been installed, so the CREATE TABLE errored and every statement
-- after it was skipped. Everything BEFORE it (ers_ai_audit_log,
-- ers_agent_actions, execute_readonly_sql) applied fine — which is why
-- the gap went unnoticed: ers_rag_documents simply never existed.
-- 0149 has been given the missing CREATE EXTENSION line so fresh tenant
-- projects apply cleanly; this migration repairs already-deployed ones.
--
-- Retrieval strategy: FULL-TEXT FIRST. A generated tsvector column plus
-- a GIN index makes the Manual Reader useful immediately at zero
-- inference cost. The embedding column stays, ready for semantic search
-- when embedding credits are available — the agent tool reads whichever
-- is populated, so switching later needs no schema change.
--
-- Index note: 0149 proposed IVFFlat, which trains its lists from
-- existing rows and gives poor recall when built on an empty table.
-- HNSW (pgvector >= 0.5; this project has 0.8.0) has no training step
-- and maintains itself as rows arrive, so it is the correct choice here.
-- ═══════════════════════════════════════════════════════════════
BEGIN;

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Resolve the `vector` type and its operator classes from the extensions schema.
SET LOCAL search_path = public, extensions;

-- ── 1. The table 0149 intended ──────────────────────────────────
CREATE TABLE IF NOT EXISTS ers_rag_documents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source          TEXT NOT NULL,
    chunk_index     INT NOT NULL DEFAULT 0,
    chunk_text      TEXT NOT NULL,
    page_number     INT,
    asset_tag       TEXT,
    equipment_class TEXT,
    document_type   TEXT NOT NULL DEFAULT 'oem_manual',
    embedding       extensions.vector(768),
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Full-text vector, maintained by Postgres. The two-argument
-- to_tsvector with a literal config is immutable, so it is valid in a
-- STORED generated column.
ALTER TABLE ers_rag_documents
    ADD COLUMN IF NOT EXISTS fts tsvector
    GENERATED ALWAYS AS (to_tsvector('english', coalesce(chunk_text, ''))) STORED;

CREATE INDEX IF NOT EXISTS idx_rag_fts   ON ers_rag_documents USING GIN (fts);
CREATE INDEX IF NOT EXISTS idx_rag_asset ON ers_rag_documents(asset_tag);
CREATE INDEX IF NOT EXISTS idx_rag_class ON ers_rag_documents(equipment_class);
CREATE INDEX IF NOT EXISTS idx_rag_source ON ers_rag_documents(source);

-- Re-ingesting a document replaces its chunks rather than duplicating them
-- (the service deletes by source first; this is the backstop).
CREATE UNIQUE INDEX IF NOT EXISTS uq_rag_source_chunk
    ON ers_rag_documents(source, chunk_index);

-- Ready for embeddings; skips NULL vectors, so it costs nothing until
-- rows are actually embedded.
CREATE INDEX IF NOT EXISTS idx_rag_embedding_hnsw
    ON ers_rag_documents USING hnsw (embedding extensions.vector_cosine_ops);

-- ── 2. RLS ──────────────────────────────────────────────────────
-- 0149's policies carried no TO clause (so they addressed anon too).
-- These are scoped to authenticated, matching the 0186 posture.
ALTER TABLE ers_rag_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rag_docs_read_all"       ON ers_rag_documents;
DROP POLICY IF EXISTS "rag_docs_insert_service" ON ers_rag_documents;
DROP POLICY IF EXISTS auth_select_rag_documents ON ers_rag_documents;
DROP POLICY IF EXISTS auth_insert_rag_documents ON ers_rag_documents;
DROP POLICY IF EXISTS admin_delete_rag_documents ON ers_rag_documents;

CREATE POLICY auth_select_rag_documents ON ers_rag_documents
    FOR SELECT TO authenticated USING (true);
-- Ingestion runs in the browser (PDF text extraction is client-side).
CREATE POLICY auth_insert_rag_documents ON ers_rag_documents
    FOR INSERT TO authenticated WITH CHECK (true);
-- Removing a manual from the index is an administrative act.
CREATE POLICY admin_delete_rag_documents ON ers_rag_documents
    FOR DELETE TO authenticated USING (public.is_admin());

-- ── 3. Ranked search ────────────────────────────────────────────
-- SECURITY INVOKER (the default) so RLS applies to the caller, with an
-- explicit search_path — an unset search_path on an RPC was a root cause
-- in the 2026-07 schema-drift audit.
CREATE OR REPLACE FUNCTION public.search_manual_chunks(
    q           TEXT,
    asset       TEXT DEFAULT NULL,
    max_results INT  DEFAULT 8
)
RETURNS TABLE (
    id              UUID,
    source          TEXT,
    chunk_index     INT,
    chunk_text      TEXT,
    page_number     INT,
    asset_tag       TEXT,
    equipment_class TEXT,
    document_type   TEXT,
    score           REAL
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
    SELECT d.id, d.source, d.chunk_index, d.chunk_text, d.page_number,
           d.asset_tag, d.equipment_class, d.document_type,
           ts_rank_cd(d.fts, websearch_to_tsquery('english', q)) AS score
    FROM ers_rag_documents d
    WHERE d.fts @@ websearch_to_tsquery('english', q)
      AND (asset IS NULL OR d.asset_tag ILIKE asset)
    ORDER BY score DESC, d.source, d.chunk_index
    LIMIT GREATEST(1, LEAST(COALESCE(max_results, 8), 25));
$$;

REVOKE ALL ON FUNCTION public.search_manual_chunks(TEXT, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_manual_chunks(TEXT, TEXT, INT) TO authenticated, service_role;

COMMENT ON TABLE ers_rag_documents IS
    'OEM manual / SOP chunks. Full-text search via the generated fts column today; the embedding column is reserved for semantic search.';

COMMIT;
