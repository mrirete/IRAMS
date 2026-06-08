-- ============================================================
-- 0134_error_logs.sql — Enterprise Error Tracking System
-- ============================================================
-- Provides persistent, queryable error diagnostics for the ERS
-- platform. Captures application errors, import failures,
-- validation violations, AI service faults, and system crashes.
--
-- Compliance: NIST SP 800-53 AU-3/AU-6, IEC 62443-3-3
-- References: ErrorLogService.ts (frontend singleton)
-- ============================================================

-- ── Severity Enum ────────────────────────────────────────────
DO $$ BEGIN
    CREATE TYPE error_severity AS ENUM ('info', 'warning', 'error', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Category Enum ────────────────────────────────────────────
DO $$ BEGIN
    CREATE TYPE error_category AS ENUM (
        'validation',
        'import',
        'api',
        'authentication',
        'permission',
        'business_rule',
        'integration',
        'ai',
        'system'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Main Table ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.error_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    severity        error_severity NOT NULL DEFAULT 'error',
    category        error_category NOT NULL DEFAULT 'system',
    module          TEXT,                    -- e.g. 'assets', 'work_orders', 'audit'
    action          TEXT,                    -- e.g. 'create', 'bulk_import', 'ai_request'
    message         TEXT NOT NULL,           -- Human-readable summary
    technical_detail TEXT,                   -- Stack trace / raw error payload
    user_id         TEXT,                    -- Username or auth UID
    entity_type     TEXT,                    -- e.g. 'asset', 'work_order'
    entity_id       TEXT,                    -- UUID or business key of affected record
    input_snapshot  JSONB DEFAULT '{}'::jsonb, -- Sanitized copy of user input at time of failure
    is_resolved     BOOLEAN DEFAULT FALSE,
    resolved_by     TEXT,                    -- Username who resolved
    resolved_at     TIMESTAMPTZ,
    resolution_note TEXT,                    -- Free-text explanation of fix
    browser_info    TEXT,                    -- navigator.userAgent
    url             TEXT,                    -- window.location.href
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes ──────────────────────────────────────────────────
-- Query patterns: filter by severity, category, module, resolution status, date range
CREATE INDEX IF NOT EXISTS idx_error_logs_severity     ON public.error_logs (severity);
CREATE INDEX IF NOT EXISTS idx_error_logs_category     ON public.error_logs (category);
CREATE INDEX IF NOT EXISTS idx_error_logs_module       ON public.error_logs (module);
CREATE INDEX IF NOT EXISTS idx_error_logs_is_resolved  ON public.error_logs (is_resolved);
CREATE INDEX IF NOT EXISTS idx_error_logs_created_at   ON public.error_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_user_id      ON public.error_logs (user_id);

-- Full-text search on message + technical_detail for the admin dashboard
CREATE INDEX IF NOT EXISTS idx_error_logs_fts
    ON public.error_logs
    USING GIN (to_tsvector('english', COALESCE(message, '') || ' ' || COALESCE(technical_detail, '')));

-- ── Row Level Security ───────────────────────────────────────
ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to insert error logs (fire-and-forget from frontend)
CREATE POLICY "Allow authenticated insert"
    ON public.error_logs FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- Allow authenticated users to read all error logs (admin dashboard)
CREATE POLICY "Allow authenticated read"
    ON public.error_logs FOR SELECT
    TO authenticated
    USING (true);

-- Allow authenticated users to update (resolve) error logs
CREATE POLICY "Allow authenticated update"
    ON public.error_logs FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- ── Comments ─────────────────────────────────────────────────
COMMENT ON TABLE public.error_logs IS 'Enterprise error tracking — captures application errors, import failures, validation violations, and system crashes for diagnostic analysis.';
COMMENT ON COLUMN public.error_logs.input_snapshot IS 'Sanitized JSON snapshot of user input at time of failure. Passwords, tokens, and secrets are redacted by ErrorLogService before persistence.';
COMMENT ON COLUMN public.error_logs.technical_detail IS 'Raw stack trace or error payload for developer debugging. May contain sensitive internal paths — access restricted via RLS.';
