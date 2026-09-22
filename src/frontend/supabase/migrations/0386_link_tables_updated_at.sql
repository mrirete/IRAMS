-- 0386 — the live link's tables keep updated_at honest.
--
-- 0385 fixed assets after the phase-1 UAT showed the column was never
-- maintained. The audit that followed found 81 tenant tables in the same
-- state. This migration covers the ones the live link's watermarks read in
-- phases 2 and 3 (docs/SAP-Live-Link-Plan.md §2.2) — the tables where a
-- stale updated_at means a change silently never reaches SAP, or a
-- both-sides change is never detected. It is the same trigger the other
-- maintained tables carry; a value a caller sets by hand is overridden with
-- the same instant that caller meant. No backfill.
--
-- Deliberately NOT a blanket sweep of all 81: a table the link does not
-- watermark gains nothing from the trigger, and one of them may be using
-- updated_at with a meaning of its own.

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'reading_definitions',   -- measuring points (phase 2)
        'service_requests',      -- notifications (phase 2)
        'work_orders',           -- orders and status (phase 2)
        'recurring_work',        -- maintenance plans / PM cycle revisions (phase 3)
        'purchase_orders', 'purchase_order_lines', 'inventory_items',
        'vendors', 'cost_centers', 'work_centers'   -- materials and finance masters (phase 3)
    ] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON public.%I', t);
        EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I
                        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_col()', t);
    END LOOP;
END $$;

-- VERIFY (after apply):
--   SELECT c.relname FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid
--    WHERE g.tgname = 'set_updated_at' ORDER BY 1;   -- includes the ten above
