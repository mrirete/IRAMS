-- ============================================================
-- 0213: LOTO permits — persisted lockout/tagout lifecycle
--
-- Makes the LOTO page real: energy-isolation permits with a
-- draft → issued → active → cleared lifecycle (cancellable at
-- any point before clearance). OSHA 1910.147.
--
-- RLS posture matches 0074's ers_* tables: single
-- "authenticated all" policy (site scoping is a later phase).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.loto_permits (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    permit_number    TEXT NOT NULL,
    asset_id         UUID REFERENCES assets(id) ON DELETE CASCADE,
    description      TEXT,
    isolation_points JSONB NOT NULL DEFAULT '[]',   -- [{ energy_type, point? }]
    padlocks         JSONB NOT NULL DEFAULT '[]',   -- [{ padlock_id, assigned_to, locked_date, unlocked_date }]
    blind_list       JSONB NOT NULL DEFAULT '[]',   -- ["BL-001 (24\" suction)", ...]
    status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','issued','active','cleared','cancelled')),
    requested_by     TEXT,
    authorized_by    TEXT,
    issued_at        TIMESTAMPTZ,
    activated_at     TIMESTAMPTZ,
    cleared_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.loto_permits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated all" ON public.loto_permits
    FOR ALL USING (auth.role() = 'authenticated');

CREATE INDEX IF NOT EXISTS idx_loto_permits_asset  ON public.loto_permits(asset_id);
CREATE INDEX IF NOT EXISTS idx_loto_permits_status ON public.loto_permits(status);
