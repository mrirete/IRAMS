-- ═══════════════════════════════════════════════════════════════
-- 0233 — ONE definition of work-order state (semantic layer)
--
-- "Open work order" had four independent definitions (Dashboard,
-- Reports, the reliability-digest tool, the mission engine). They agreed
-- only because the seeded data used four status codes; the first real
-- CMMS import brings foreign vocabulary (the import pipeline already
-- reports `unmapped_status`) and the same fact would be quoted three
-- different ways on three screens.
--
-- This is the server-side half, mirroring src/lib/woState.ts exactly.
-- Change both together — the TS tests pin the buckets.
--
--   open    — work still owed to the plant (incl. UNRECOGNISED codes:
--             work that cannot be proven finished is still someone's
--             problem, and hiding it would silently shrink the backlog)
--   done    — actually performed and finished
--   void    — cancelled/rejected: neither backlog nor completion
-- ═══════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.ers_wo_state(p_status TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    WITH s AS (SELECT upper(regexp_replace(btrim(coalesce(p_status, '')), '[\s-]+', '_', 'g')) AS code)
    SELECT CASE
        WHEN (SELECT code FROM s) = '' THEN 'unknown'
        WHEN (SELECT code FROM s) IN (
            'CLOSED','CLSD','CLOSE','TECO','COMP','COMPLETE','COMPLETED','FINISHED',
            'DONE','SETTLED','HISTORICAL'
        ) THEN 'done'
        WHEN (SELECT code FROM s) IN (
            'CANCELLED','CANCELED','CANC','CAN','CNCL','VOID','VOIDED','REJECTED',
            'DELETED','DUPLICATE'
        ) THEN 'void'
        WHEN (SELECT code FROM s) IN (
            'OPEN','WIP','PLAN','PLANNED','PLANNING','REL','RELEASED','CRTD','CREATED',
            'NEW','SCHED','SCHEDULED','INPRG','IN_PROGRESS','INPROGRESS','STARTED',
            'ACTIVE','HOLD','ON_HOLD','WAITING','WAPPR','APPR','APPROVED','ASSIGNED',
            'DISPATCHED','PENDING'
        ) THEN 'open'
        ELSE 'unknown'
    END;
$$;

COMMENT ON FUNCTION public.ers_wo_state(TEXT) IS
    'Canonical work-order state: open | done | void | unknown. Mirrors src/lib/woState.ts. Unrecognised codes classify as unknown and COUNT AS BACKLOG.';

-- Every consumer that wants the truth reads this, not raw status.
CREATE OR REPLACE VIEW public.sem_work_orders AS
SELECT
    w.*,
    public.ers_wo_state(w.status::TEXT)                                   AS wo_state,
    (public.ers_wo_state(w.status::TEXT) IN ('open', 'unknown'))          AS is_open,
    (public.ers_wo_state(w.status::TEXT) = 'done')                        AS is_done
FROM public.work_orders w;

GRANT SELECT ON public.sem_work_orders TO authenticated, service_role;

-- Catalog it so the agents can look the definition up like any other term.
DELETE FROM public.semantic_catalog
 WHERE object_name = 'sem_work_orders' AND column_name IN ('wo_state', 'is_open');

INSERT INTO public.semantic_catalog (object_name, column_name, title, description, tags, source_tables, iso_standard)
VALUES
    ('sem_work_orders', 'wo_state', 'Work-order state',
     'Canonical lifecycle bucket: open (work still owed, INCLUDING unrecognised statuses), done (performed and finished), void (cancelled/rejected — neither backlog nor completion). One definition shared by the dashboard, reports, the reliability digest and the mission engine. Mirrors src/lib/woState.ts.',
     ARRAY['work_management', 'canonical'], ARRAY['work_orders'], 'ISO 14224'),
    ('sem_work_orders', 'is_open', 'Open work order',
     'TRUE when the work order is backlog: state open or unknown. An unmapped status counts as open on purpose — work that cannot be proven finished is still owed, and hiding it would silently shrink the backlog after an import.',
     ARRAY['work_management', 'canonical', 'kpi'], ARRAY['work_orders'], 'ISO 14224');

COMMIT;
