-- ============================================================
-- 0209: Team-shared JSA template library. Templates previously
-- lived in each browser's localStorage — a supervisor's "Hot Work
-- - Compressor" template was invisible to everyone else. One row
-- per template; hazards stored as the UI hazard shape (JSONB),
-- ids stripped (they're regenerated on load into a JSA).
-- Same RLS posture as the other JSA tables: authenticated
-- read/write; anon gets nothing.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.jsa_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    hazards JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.jsa_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "jsa_templates_auth_all" ON public.jsa_templates;
CREATE POLICY "jsa_templates_auth_all" ON public.jsa_templates
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Self-contained updated_at touch — the moddatetime extension is NOT
-- installed on this project (0026's triggers reference it but never applied).
CREATE OR REPLACE FUNCTION public.jsa_templates_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := timezone('utc'::text, now());
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS handle_updated_at ON public.jsa_templates;
CREATE TRIGGER handle_updated_at BEFORE UPDATE ON public.jsa_templates
    FOR EACH ROW EXECUTE FUNCTION public.jsa_templates_touch_updated_at();
