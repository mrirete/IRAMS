-- Create Permit to Work (PTW) Tables
-- Linked to jsa_assessments → work_orders

-- ============================================================
-- 1. PTW Permits (Core permit record)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ptw_permits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    jsa_id UUID NOT NULL REFERENCES public.jsa_assessments(id) ON DELETE CASCADE,
    permit_type TEXT NOT NULL,           -- PERMIT_TYPE dictionary code
    status TEXT NOT NULL DEFAULT 'DRAFT', -- PTW_STATUS dictionary code
    permit_number TEXT,                  -- Human-readable (PTW-YYYY-NNN)
    description TEXT,                    -- Scope of work

    -- Safety Requirements
    safety_requirements JSONB DEFAULT '[]'::jsonb,   -- Array of strings
    ppe_requirements JSONB DEFAULT '[]'::jsonb,      -- Array of PPE_TYPE codes
    certificates_required JSONB DEFAULT '[]'::jsonb, -- Array of required cert strings
    environmental_conditions TEXT,                    -- Weather/atmosphere notes

    -- Validity Period
    validity_start TIMESTAMPTZ,
    validity_end TIMESTAMPTZ,

    -- Personnel
    permit_holder_id UUID REFERENCES auth.users(id),  -- Person performing work
    issuer_id UUID REFERENCES auth.users(id),          -- Person who issued
    receiver_id UUID REFERENCES auth.users(id),        -- Person who accepted

    -- Toolbox Talk
    toolbox_talk_completed BOOLEAN DEFAULT false,
    toolbox_talk_notes TEXT,

    -- Return / Closure
    return_notes TEXT,
    returned_at TIMESTAMPTZ,
    returned_by UUID REFERENCES auth.users(id),

    -- Audit
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Auto-generate permit_number trigger
CREATE OR REPLACE FUNCTION generate_permit_number()
RETURNS TRIGGER AS $$
DECLARE
    next_seq INT;
BEGIN
    SELECT COALESCE(MAX(
        CAST(SUBSTRING(permit_number FROM 'PTW-\d{4}-(\d+)') AS INT)
    ), 0) + 1
    INTO next_seq
    FROM public.ptw_permits
    WHERE permit_number LIKE 'PTW-' || EXTRACT(YEAR FROM NOW())::TEXT || '-%';

    NEW.permit_number := 'PTW-' || EXTRACT(YEAR FROM NOW())::TEXT || '-' || LPAD(next_seq::TEXT, 3, '0');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_permit_number
    BEFORE INSERT ON public.ptw_permits
    FOR EACH ROW
    WHEN (NEW.permit_number IS NULL)
    EXECUTE FUNCTION generate_permit_number();


-- ============================================================
-- 2. PTW Isolation Points (LOTO)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ptw_isolation_points (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    permit_id UUID NOT NULL REFERENCES public.ptw_permits(id) ON DELETE CASCADE,
    tag_number TEXT NOT NULL,             -- Equipment tag (e.g. XV-101)
    isolation_type TEXT NOT NULL,         -- ISOLATION_TYPE dictionary code
    method TEXT NOT NULL DEFAULT 'LOCK',  -- LOCK, TAG, BLANK, DISCONNECT
    normal_position TEXT DEFAULT 'OPEN',
    isolated_position TEXT DEFAULT 'CLOSED',

    -- Isolation Actions
    isolated_by UUID REFERENCES auth.users(id),
    isolated_at TIMESTAMPTZ,
    verified_by UUID REFERENCES auth.users(id),   -- Four-eyes: must differ from isolated_by
    verified_at TIMESTAMPTZ,
    de_isolated_by UUID REFERENCES auth.users(id),
    de_isolated_at TIMESTAMPTZ,

    status TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING, ISOLATED, VERIFIED, DE_ISOLATED
    sequence INT NOT NULL DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Four-eyes constraint: verifier != isolator
ALTER TABLE public.ptw_isolation_points
    ADD CONSTRAINT chk_four_eyes CHECK (verified_by IS NULL OR verified_by != isolated_by);


-- ============================================================
-- 3. PTW Approvals
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ptw_approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    permit_id UUID NOT NULL REFERENCES public.ptw_permits(id) ON DELETE CASCADE,
    approver_id UUID REFERENCES auth.users(id),
    role TEXT NOT NULL,                    -- AREA_AUTHORITY, HSE_OFFICER, OPS_SUPERVISOR, ISSUING_AUTHORITY
    decision TEXT NOT NULL DEFAULT 'PENDING', -- PENDING, APPROVED, REJECTED, REVOKED
    comments TEXT,
    decided_at TIMESTAMPTZ,
    sequence INT NOT NULL DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);


-- ============================================================
-- RLS Policies
-- ============================================================

-- ptw_permits
ALTER TABLE public.ptw_permits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for authenticated users" ON public.ptw_permits
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Enable insert for authenticated users" ON public.ptw_permits
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Enable update for authenticated users" ON public.ptw_permits
    FOR UPDATE TO authenticated USING (true);

-- ptw_isolation_points
ALTER TABLE public.ptw_isolation_points ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for authenticated users" ON public.ptw_isolation_points
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Enable insert for authenticated users" ON public.ptw_isolation_points
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Enable update for authenticated users" ON public.ptw_isolation_points
    FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Enable delete for authenticated users" ON public.ptw_isolation_points
    FOR DELETE TO authenticated USING (true);

-- ptw_approvals
ALTER TABLE public.ptw_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for authenticated users" ON public.ptw_approvals
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Enable insert for authenticated users" ON public.ptw_approvals
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Enable update for authenticated users" ON public.ptw_approvals
    FOR UPDATE TO authenticated USING (true);


-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_ptw_permits_jsa_id ON public.ptw_permits(jsa_id);
CREATE INDEX IF NOT EXISTS idx_ptw_permits_status ON public.ptw_permits(status);
CREATE INDEX IF NOT EXISTS idx_ptw_isolation_permit ON public.ptw_isolation_points(permit_id);
CREATE INDEX IF NOT EXISTS idx_ptw_approvals_permit ON public.ptw_approvals(permit_id);
