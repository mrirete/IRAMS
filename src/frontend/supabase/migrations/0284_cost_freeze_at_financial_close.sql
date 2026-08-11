-- 0284: Cost freeze at financial close, with a real snapshot (P0 governance fix)
--
-- Two defects in freeze_costs_on_close (0000):
--
--   1. It froze costs at TECO, while the completion modal promises "Costs can
--      still be posted until Financial Close". SAP semantics (and the module's
--      own TECO vs CLOSED distinction) put the freeze at business/financial
--      close, not technical completion.
--
--   2. The "snapshot" was fiction: nothing in the app computes
--      frozen_labor_cost / frozen_material_cost at close — the trigger just
--      defaulted NULL to 0 (and the app creates WOs with 0 anyway). Every
--      UI-completed WO froze at $0, and cost reporting that prefers frozen
--      values has been reading zeros. Only the CSV importer ever wrote real
--      snapshots.
--
-- New behavior:
--   - closed_at is stamped at the FIRST completion (TECO or CLOSED) — it is
--     the reliability event basis and settlement timing, unchanged.
--   - cost_frozen flips only when status becomes CLOSED, and the frozen
--     labor/material snapshots are computed at that moment from
--     sem_wo_actual_lines (0244) — the same canonical actuals the settlement
--     engine posts from. LABOR → frozen_labor_cost, everything else
--     (MATERIAL/SERVICE) → frozen_material_cost.
--   - The immutability guards (no un-freeze, no editing frozen values) are
--     unchanged.
--   - INSERTs are untouched (trigger is BEFORE UPDATE), so the importer's
--     supplied snapshots still land as-is.
--
-- Backfill: WOs frozen by the old trigger with $0 snapshots get corrected from
-- actual lines, and TECO-but-not-CLOSED WOs are un-frozen (they are, by the
-- module's own definition, still open for cost postings). The trigger is
-- disabled during the backfill because it (correctly) forbids exactly this
-- kind of edit in normal operation; audit_logs still records every row change.

CREATE OR REPLACE FUNCTION public.freeze_costs_on_close()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
    -- First completion (technical or financial): stamp the reference date.
    IF (NEW.status IN ('CLOSED', 'TECO') AND OLD.status NOT IN ('CLOSED', 'TECO')) THEN
        IF NEW.closed_at IS NULL THEN
            NEW.closed_at := NOW();
        END IF;
    END IF;

    -- Financial close: freeze, snapshotting actuals from the canonical lines.
    IF (NEW.status = 'CLOSED' AND OLD.status IS DISTINCT FROM 'CLOSED' AND NOT COALESCE(OLD.cost_frozen, FALSE)) THEN
        NEW.cost_frozen := TRUE;
        SELECT
            COALESCE(SUM(amount) FILTER (WHERE cost_type = 'LABOR'), 0),
            COALESCE(SUM(amount) FILTER (WHERE cost_type <> 'LABOR'), 0)
        INTO NEW.frozen_labor_cost, NEW.frozen_material_cost
        FROM public.sem_wo_actual_lines
        WHERE work_order_id = NEW.id;
    END IF;

    -- Immutability guards (unchanged from 0000).
    IF (OLD.cost_frozen = TRUE) THEN
        IF (NEW.cost_frozen = FALSE) THEN
            RAISE EXCEPTION 'Governance Rule: Cannot un-freeze a Work Order.';
        END IF;
        IF (NEW.frozen_labor_cost != OLD.frozen_labor_cost OR NEW.frozen_material_cost != OLD.frozen_material_cost) THEN
            RAISE EXCEPTION 'Governance Rule: Cannot modify costs after they are frozen.';
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

-- ── Backfill ──────────────────────────────────────────────────────────────
ALTER TABLE public.work_orders DISABLE TRIGGER enforce_cost_freezing;

-- TECO WOs frozen by the old rule: still open for postings under the new rule.
UPDATE public.work_orders
SET cost_frozen = FALSE
WHERE status = 'TECO' AND cost_frozen = TRUE;

-- CLOSED WOs frozen at $0 by the old rule: recompute the snapshot from the
-- canonical actual lines. Rows with a real (importer-supplied) snapshot, or
-- with no actual lines, are left alone.
UPDATE public.work_orders w
SET frozen_labor_cost    = s.labor,
    frozen_material_cost = s.material
FROM (
    SELECT work_order_id,
           COALESCE(SUM(amount) FILTER (WHERE cost_type = 'LABOR'), 0)  AS labor,
           COALESCE(SUM(amount) FILTER (WHERE cost_type <> 'LABOR'), 0) AS material
    FROM public.sem_wo_actual_lines
    GROUP BY work_order_id
) s
WHERE s.work_order_id = w.id
  AND w.status = 'CLOSED'
  AND w.cost_frozen = TRUE
  AND COALESCE(w.frozen_labor_cost, 0) = 0
  AND COALESCE(w.frozen_material_cost, 0) = 0
  AND (s.labor > 0 OR s.material > 0);

ALTER TABLE public.work_orders ENABLE TRIGGER enforce_cost_freezing;
