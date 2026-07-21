-- ============================================================
-- 0207: Enable RLS on ers_waveforms (0206 shipped without it —
-- flagged by the Supabase Security Advisor). Same posture as the
-- other predict-layer tables (0202 pattern): authenticated users
-- read/write; anon gets nothing.
-- ============================================================

ALTER TABLE ers_waveforms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ers_waveforms_auth_all" ON ers_waveforms;
CREATE POLICY "ers_waveforms_auth_all" ON ers_waveforms
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
