-- Create JSA Assessments Table
CREATE TABLE IF NOT EXISTS public.jsa_assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wo_id UUID NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('DRAFT', 'REVIEW', 'AUTHORIZED')),
    permits JSONB DEFAULT '[]'::jsonb,
    signoffs JSONB DEFAULT '[]'::jsonb, -- Missing from schema.ts interface but in types.ts
    created_by UUID REFERENCES auth.users(id),
    authorized_by UUID REFERENCES auth.users(id),
    authorized_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.jsa_assessments ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Enable read access for authenticated users" ON public.jsa_assessments
    FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Enable insert for authenticated users" ON public.jsa_assessments
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Enable update for authenticated users" ON public.jsa_assessments
    FOR UPDATE
    TO authenticated
    USING (true);

-- Create JSA Hazards Table
CREATE TABLE IF NOT EXISTS public.jsa_hazards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    jsa_id UUID NOT NULL REFERENCES public.jsa_assessments(id) ON DELETE CASCADE,
    hazard TEXT NOT NULL,
    risk_score TEXT NOT NULL,
    controls TEXT NOT NULL,
    task_ref_id TEXT, -- Optional link to task
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.jsa_hazards ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Enable read access for authenticated users" ON public.jsa_hazards
    FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Enable all access for authenticated users" ON public.jsa_hazards
    FOR ALL
    TO authenticated
    USING (true);

-- Triggers for updated_at
--
-- FIXED 2026-07-25: these originally called moddatetime('updated_at'), but the
-- `moddatetime` extension was never installed on any database — so BOTH
-- triggers silently failed to be created here, on the origin project as well
-- as on any replay, and jsa_assessments/jsa_hazards.updated_at never actually
-- updated. Replaced with a plain trigger function owned by this schema, which
-- removes the extension dependency entirely. Migration 0224 applies the same
-- repair to already-deployed databases.
CREATE OR REPLACE FUNCTION public.update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS handle_updated_at ON public.jsa_assessments;
CREATE TRIGGER handle_updated_at BEFORE UPDATE ON public.jsa_assessments
    FOR EACH ROW EXECUTE FUNCTION public.update_modified_column();

DROP TRIGGER IF EXISTS handle_updated_at ON public.jsa_hazards;
CREATE TRIGGER handle_updated_at BEFORE UPDATE ON public.jsa_hazards
    FOR EACH ROW EXECUTE FUNCTION public.update_modified_column();
