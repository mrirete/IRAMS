-- ============================================================
-- 0210: Server-side lock on authorized JSAs. Once all three
-- sign-offs are captured the client stamps status = AUTHORIZED;
-- from then on hazard rows must not change until authorization
-- is visibly withdrawn (a sign-off removed → status DRAFT).
--
-- Enforced as RESTRICTIVE RLS policies (AND with the existing
-- permissive ones) rather than a trigger: FK cascade deletes
-- bypass RLS, so deleting a whole work order still cleans up an
-- authorized JSA, while client writes are blocked.
--
-- One policy per write command — NOT "FOR ALL", which would also
-- cover SELECT and make an authorized JSA's hazards invisible.
-- ============================================================

DROP POLICY IF EXISTS "jsa_hazards_lock_when_authorized" ON public.jsa_hazards;
DROP POLICY IF EXISTS "jsa_hazards_lock_authorized_ins" ON public.jsa_hazards;
DROP POLICY IF EXISTS "jsa_hazards_lock_authorized_upd" ON public.jsa_hazards;
DROP POLICY IF EXISTS "jsa_hazards_lock_authorized_del" ON public.jsa_hazards;

CREATE POLICY "jsa_hazards_lock_authorized_ins" ON public.jsa_hazards
    AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (NOT EXISTS (
        SELECT 1 FROM public.jsa_assessments a
        WHERE a.id = jsa_hazards.jsa_id AND a.status = 'AUTHORIZED'));

CREATE POLICY "jsa_hazards_lock_authorized_upd" ON public.jsa_hazards
    AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (NOT EXISTS (
        SELECT 1 FROM public.jsa_assessments a
        WHERE a.id = jsa_hazards.jsa_id AND a.status = 'AUTHORIZED'))
    WITH CHECK (NOT EXISTS (
        SELECT 1 FROM public.jsa_assessments a
        WHERE a.id = jsa_hazards.jsa_id AND a.status = 'AUTHORIZED'));

CREATE POLICY "jsa_hazards_lock_authorized_del" ON public.jsa_hazards
    AS RESTRICTIVE FOR DELETE TO authenticated
    USING (NOT EXISTS (
        SELECT 1 FROM public.jsa_assessments a
        WHERE a.id = jsa_hazards.jsa_id AND a.status = 'AUTHORIZED'));
