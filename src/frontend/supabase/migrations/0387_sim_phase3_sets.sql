-- 0387 — the simulator learns phase 3's objects.
--
-- sap_sim_entities (0384) lists the entity sets it may hold. Phase 3 carries
-- maintenance plans (reliability: PM cycle revisions) and the finance
-- documents (material documents, supplier invoices, journal entries), so the
-- list grows. Nothing else changes; the constraint is re-created with the
-- same name so a re-run is harmless.

ALTER TABLE public.sap_sim_entities DROP CONSTRAINT IF EXISTS sap_sim_entities_entity_set_check;
ALTER TABLE public.sap_sim_entities ADD CONSTRAINT sap_sim_entities_entity_set_check
    CHECK (entity_set IN ('A_Equipment', 'A_FunctionalLocation', 'A_MeasuringPoint', 'A_MeasurementDocument',
                          'A_MaintenanceNotification', 'A_MaintenanceOrder',
                          'A_MaintenancePlan', 'A_MaterialDocumentHeader', 'A_SupplierInvoice', 'A_JournalEntry'));

-- VERIFY (after apply):
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'sap_sim_entities_entity_set_check';  -- lists 10 sets
