-- 0297: Inventory movements keep their justification
--
-- The stock-adjustment modal collects a reason and knows the actor, then
-- adjustInventoryStock dropped both on the floor — the only place they ever
-- appeared was the text of an error message. An adjustment audit trail that
-- records neither who nor why is not an audit trail (spotted in the pre-review
-- SAP audit; the client-side fix ships with this migration).
--
-- performed_by already exists on inventory_transactions; notes did not.

ALTER TABLE public.inventory_transactions
    ADD COLUMN IF NOT EXISTS notes text;

COMMENT ON COLUMN public.inventory_transactions.notes
    IS 'Reason / reference the user gave for a manual movement (stocktake ref, scrap justification). NULL on system-generated movements.';
