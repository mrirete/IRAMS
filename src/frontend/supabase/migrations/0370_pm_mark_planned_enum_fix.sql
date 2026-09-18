-- 0370 — pm_mark_planned: assets.criticality is an enum.
--
-- 0369 read the asset's criticality with coalesce(a.criticality, ''), which
-- casts '' to the enum and raises 22P02. Inside pm_autogen_sweep and the 0369
-- repair loop the error was caught and logged, so the planning gate never
-- actually ran and every generated order stayed OPEN; from the Generator the
-- RPC returned 400. Same function, the comparison on ::text, and the repair
-- pass over open generated orders is run again.
BEGIN;

CREATE OR REPLACE FUNCTION public.pm_mark_planned(p_wo uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
    w    record;
    crit text;
    ok   boolean;
BEGIN
    SELECT wo.id, wo.status, wo.asset_id, wo.description, wo.est_duration
      INTO w FROM public.work_orders wo WHERE wo.id = p_wo;
    IF w.id IS NULL THEN RETURN false; END IF;
    -- 0370: assets.criticality is an enum — compare its text, never coalesce the enum itself
    SELECT upper(coalesce(a.criticality::text, '')) INTO crit FROM public.assets a WHERE a.id = w.asset_id;
    ok := w.asset_id IS NOT NULL
      AND coalesce(trim(w.description), '') <> ''
      AND EXISTS (
            SELECT 1 FROM public.job_tasks t
             WHERE t.wo_id = p_wo
               AND (lower(trim(coalesce(t.description, ''))) NOT IN ('', 'new task step', 'new task', 'untitled step', 'untitled')
                    OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(t.instructions, '[]'::jsonb)) b
                                WHERE coalesce(trim(b ->> 'label'), '') <> '')))
      AND (coalesce(w.est_duration, 0) > 0
           OR coalesce((SELECT sum(t.est_hours) FROM public.job_tasks t WHERE t.wo_id = p_wo), 0) > 0)
      AND EXISTS (SELECT 1 FROM public.work_order_labor l WHERE l.wo_id = p_wo)
      AND (coalesce(crit, '') NOT IN ('A', 'B')
           OR EXISTS (SELECT 1 FROM public.jsa_hazards h JOIN public.jsa_assessments j ON j.id = h.jsa_id WHERE j.wo_id = p_wo));
    IF ok AND upper(w.status::text) = 'OPEN' THEN
        UPDATE public.work_orders SET status = 'PLAN', updated_at = now() WHERE id = p_wo;
    END IF;
    RETURN ok;
END;
$$;

-- Open generated orders whose plan already meets the gate are Planned.
DO $$
DECLARE w record;
BEGIN
    FOR w IN
        SELECT wo.id, wo.wo_number FROM public.work_orders wo
         WHERE wo.recurring_work_id IS NOT NULL AND upper(wo.status::text) = 'OPEN'
    LOOP
        BEGIN
            IF public.pm_mark_planned(w.id) THEN
                RAISE NOTICE '0370: WO % meets the planning gate → PLAN', w.wo_number;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE '0370: gate check failed for WO %: %', w.wo_number, SQLERRM;
        END;
    END LOOP;
END $$;

COMMIT;
