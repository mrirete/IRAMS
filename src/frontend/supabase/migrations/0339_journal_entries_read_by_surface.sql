-- 0339 — journal_entries: readers see the journals of the records they can see.
--
-- WHY. 0246a put journal_entries behind caller_can('finops','view') because at
-- the time only the FinOps page read it (0247 kept it there on the same
-- reasoning). 0285 then made the SAME table the append-only work-order
-- journal — every status change, assignment, observation and handover is
-- mirrored here and the WO read path prefers it — but never revisited the
-- policy. Result (found 2026-09-08): a TECHNICIAN cannot read a single
-- journal row. On My Work the status sentence on their own job reads
-- "Scheduled" with no date, the lifecycle rail shows no timestamps, and the
-- Analysis & History tab falls back to whatever the properties blob cached.
-- The record was honest; the reader was blind.
--
-- RULE. Tenant-scoped, then by the surface the entry belongs to: the journal
-- of a record is readable by whoever may read the record. FinOps keeps its
-- blanket read (its own ledger entries carry no entity_type contract).
-- Writes are unchanged (tenant-only insert; the app treats rows as
-- append-only).

DROP POLICY IF EXISTS finops_select_journal_entries ON public.journal_entries;
DROP POLICY IF EXISTS scoped_select_journal_entries ON public.journal_entries;

CREATE POLICY scoped_select_journal_entries ON public.journal_entries
    FOR SELECT TO authenticated
    USING (
        company_id = (SELECT public.caller_company())
        AND (
            (SELECT public.caller_can('finops', 'view'))
            OR (entity_type IN ('WORK_ORDER', 'WO')      AND (SELECT public.caller_can('workOrders', 'view')))
            OR (entity_type = 'ASSET'                    AND (SELECT public.caller_can('assets', 'view')))
            OR (entity_type = 'CONTACT'                  AND (SELECT public.caller_can('contacts', 'view')))
            OR (entity_type = 'INVENTORY_ITEM'           AND (SELECT public.caller_can('inventory', 'view')))
            OR (entity_type = 'RCA_INVESTIGATION'        AND (SELECT public.caller_can('reliability', 'view')))
        )
    );

COMMENT ON POLICY scoped_select_journal_entries ON public.journal_entries IS
    '0339: journal rows are readable by whoever can read the parent record (work order / asset / contact / RCA); FinOps view keeps a blanket read. Replaces the 0246a finops-only gate that blinded technicians to their own work-order history.';
