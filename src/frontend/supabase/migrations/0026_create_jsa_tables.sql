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
CREATE TRIGGER handle_updated_at BEFORE UPDATE ON public.jsa_assessments
    FOR EACH ROW EXECUTE FUNCTION moddatetime('updated_at');

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON public.jsa_hazards
    FOR EACH ROW EXECUTE FUNCTION moddatetime('updated_at');
