-- ═══════════════════════════════════════════════════════════════
-- 0245 — IN-3: movement types with account assignment.
--
-- The last segment of the order-to-cost spine, and the hard prerequisite
-- for any SAP MM integration: today a stock movement is a bare row —
-- `transaction_type` is one of four generic labels, there is no storage
-- location, no account assignment, no value, and nothing links it to the
-- financial document it should produce. SAP posts every movement under a
-- movement type (101/201/261/701…) that decides the stock side AND the
-- account assignment. Without that vocabulary there is nothing to map an
-- integration onto.
--
-- Also settles the two decisions carried by 0244:
--
--   (1) MATERIAL ACTUAL = ISSUED PARTS ONLY. A planned part is a
--       commitment, not a cost. The goods-issue engine (lib/goodsIssue.ts)
--       already flips is_planned → false and stamps date_used when an
--       order reaches TECO, so the distinction is real data, not a guess.
--       sem_wo_actual_lines is redefined here; getOrderActuals is changed
--       in the same commit so the Cost tab and the ledger stay identical.
--
--   (2) BACKFILL IS PREVIEW-THEN-RUN, not a decision left open.
--       ers_settlement_preview() shows exactly what would post, for review,
--       without posting it. The runbook is at the bottom of this file.
--
-- WHERE THIS DEVIATES FROM SAP, DELIBERATELY:
-- SAP posts a 261 goods issue straight to FI and to the order, then
-- settles the order to its receiver — two documents. We have one ledger
-- (cost_allocations), so a WO-linked movement carries its account
-- assignment but does NOT post: settlement (0244) is the single poster for
-- anything with a work order, which makes double counting structurally
-- impossible. Movements with no work order (issue to cost center, scrap,
-- count gain/loss) have no settlement to ride on, so those post directly.
-- `movement_types.fi_posting` records which rule each type follows.
--
-- Inventory valuation postings (the stock side of a 101 receipt) are NOT
-- modelled. Stock value lives in inventory_valuations; a full MM→FI stock
-- account posting needs a chart of accounts, which arrives with the ERP
-- onboarding, not here. Those types are marked fi_posting = 'NONE'.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_inventory_tx_defaults ON inventory_transactions;
--   DROP TRIGGER IF EXISTS trg_inventory_tx_post_fi ON inventory_transactions;
--   DROP FUNCTION IF EXISTS ers_movement_defaults, ers_movement_post_fi,
--        ers_settlement_preview(int);
--   DROP VIEW IF EXISTS sem_stock_movements;
--   DELETE FROM cost_allocations WHERE source = 'STOCK_MOVEMENT';
--   ALTER TABLE inventory_transactions
--     DROP COLUMN movement_type, DROP COLUMN location_id, DROP COLUMN cost_center_id,
--     DROP COLUMN asset_id, DROP COLUMN gl_account, DROP COLUMN total_value,
--     DROP COLUMN cost_allocation_id;
--   DROP TABLE IF EXISTS movement_types;
--   (sem_wo_actual_lines reverts to the 0244 definition)
-- ═══════════════════════════════════════════════════════════════
BEGIN;

-- ───────────────────────────────────────────────────────────────
-- 1. A movement posted by a movement is a new ledger source
-- ───────────────────────────────────────────────────────────────
ALTER TABLE public.cost_allocations DROP CONSTRAINT IF EXISTS cost_allocations_source_chk;
ALTER TABLE public.cost_allocations
    ADD CONSTRAINT cost_allocations_source_chk
    CHECK (source IN ('MANUAL', 'WO_SETTLEMENT', 'WARRANTY_CREDIT', 'ERP_INBOUND', 'STOCK_MOVEMENT'));

-- ───────────────────────────────────────────────────────────────
-- 2. The movement type catalog (SAP MM/IM)
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.movement_types (
    code           TEXT PRIMARY KEY,                    -- SAP BWART
    name           TEXT NOT NULL,
    description    TEXT,
    direction      TEXT NOT NULL CHECK (direction IN ('IN', 'OUT', 'TRANSFER')),
    -- What the posting must be charged to. ORDER = the work order supplies
    -- the receiver; COST_CENTER = the movement must name one itself.
    account_assignment TEXT NOT NULL DEFAULT 'NONE'
        CHECK (account_assignment IN ('NONE', 'ORDER', 'COST_CENTER')),
    -- NONE            → stock value only, no expense document
    -- DIRECT          → this movement posts to cost_allocations itself
    -- VIA_SETTLEMENT  → the work order's settlement posts it (0244)
    fi_posting     TEXT NOT NULL DEFAULT 'NONE'
        CHECK (fi_posting IN ('NONE', 'DIRECT', 'VIA_SETTLEMENT')),
    -- Left NULL on purpose: the chart of accounts is the customer's, and
    -- inventing account numbers would be fake precision. This is the field
    -- an ERP onboarding fills in, per tenant.
    gl_account     TEXT,
    reversal_of    TEXT REFERENCES public.movement_types(code),
    active         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.movement_types IS
    'SAP movement types (BWART). Decides the stock direction and the account assignment of every inventory movement.';
COMMENT ON COLUMN public.movement_types.gl_account IS
    'Mapped per tenant during ERP onboarding — intentionally unseeded.';

-- Parents before children (reversal_of is a self-reference).
INSERT INTO public.movement_types (code, name, description, direction, account_assignment, fi_posting) VALUES
    ('101', 'Goods receipt for purchase order', 'Stock received against a PO line',            'IN',       'NONE',        'NONE'),
    ('201', 'Goods issue to cost center',       'Consumables drawn by a cost center',          'OUT',      'COST_CENTER', 'DIRECT'),
    ('261', 'Goods issue to order',             'Parts consumed by a work order',              'OUT',      'ORDER',       'VIA_SETTLEMENT'),
    ('311', 'Transfer between storage locations','Stock moved, no value change',               'TRANSFER', 'NONE',        'NONE'),
    ('501', 'Receipt without purchase order',   'Stock received with no PO reference',         'IN',       'NONE',        'NONE'),
    ('551', 'Goods issue for scrapping',        'Stock written off as scrap',                  'OUT',      'COST_CENTER', 'DIRECT'),
    ('561', 'Initial stock entry',              'Opening balance / data migration',            'IN',       'NONE',        'NONE'),
    ('701', 'Inventory count gain',             'Physical count above book stock',             'IN',       'COST_CENTER', 'DIRECT'),
    ('702', 'Inventory count loss',             'Physical count below book stock',             'OUT',      'COST_CENTER', 'DIRECT')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.movement_types (code, name, description, direction, account_assignment, fi_posting, reversal_of) VALUES
    ('102', 'Reversal of goods receipt',        'Cancels a 101',                               'OUT', 'NONE',        'NONE',   '101'),
    ('202', 'Reversal of issue to cost center', 'Cancels a 201',                               'IN',  'COST_CENTER', 'DIRECT', '201'),
    ('262', 'Reversal of issue to order',       'Part returned to stores from a work order',   'IN',  'ORDER',       'VIA_SETTLEMENT', '261'),
    ('552', 'Reversal of scrapping',            'Cancels a 551',                               'IN',  'COST_CENTER', 'DIRECT', '551')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.movement_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "movement_types_read" ON public.movement_types;
CREATE POLICY "movement_types_read" ON public.movement_types
    FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "movement_types_admin_write" ON public.movement_types;
CREATE POLICY "movement_types_admin_write" ON public.movement_types
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ───────────────────────────────────────────────────────────────
-- 3. Movements gain a type, a place, and an account assignment
-- ───────────────────────────────────────────────────────────────
-- quantity was INTEGER: a 2.5 L issue could not be recorded at all, while
-- work_order_parts.quantity is numeric(10,2). Widening is lossless.
ALTER TABLE public.inventory_transactions
    ALTER COLUMN quantity TYPE NUMERIC(14, 3);

ALTER TABLE public.inventory_transactions
    ADD COLUMN IF NOT EXISTS movement_type      TEXT,
    ADD COLUMN IF NOT EXISTS location_id        UUID,
    ADD COLUMN IF NOT EXISTS cost_center_id     UUID,
    ADD COLUMN IF NOT EXISTS asset_id           UUID,
    ADD COLUMN IF NOT EXISTS gl_account         TEXT,
    ADD COLUMN IF NOT EXISTS total_value        NUMERIC(15, 2),
    ADD COLUMN IF NOT EXISTS cost_allocation_id UUID;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_transactions_movement_type_fkey') THEN
        ALTER TABLE public.inventory_transactions
            ADD CONSTRAINT inventory_transactions_movement_type_fkey
            FOREIGN KEY (movement_type) REFERENCES public.movement_types(code);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_transactions_location_id_fkey') THEN
        ALTER TABLE public.inventory_transactions
            ADD CONSTRAINT inventory_transactions_location_id_fkey
            FOREIGN KEY (location_id) REFERENCES public.inventory_locations(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_transactions_cost_center_id_fkey') THEN
        ALTER TABLE public.inventory_transactions
            ADD CONSTRAINT inventory_transactions_cost_center_id_fkey
            FOREIGN KEY (cost_center_id) REFERENCES public.cost_centers(id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_transactions_cost_allocation_id_fkey') THEN
        ALTER TABLE public.inventory_transactions
            ADD CONSTRAINT inventory_transactions_cost_allocation_id_fkey
            FOREIGN KEY (cost_allocation_id) REFERENCES public.cost_allocations(id) ON DELETE SET NULL;
    END IF;
END $$;

COMMENT ON COLUMN public.inventory_transactions.total_value IS
    'quantity x cost_at_time, signed as EXPENSE: positive when stock leaves (consumption), negative when it returns.';
COMMENT ON COLUMN public.inventory_transactions.cost_allocation_id IS
    'The financial document this movement produced, when it posts directly. NULL for stock-only movements and for WO-linked ones (settlement posts those).';

CREATE INDEX IF NOT EXISTS idx_inventory_tx_movement_type ON public.inventory_transactions (movement_type);
CREATE INDEX IF NOT EXISTS idx_inventory_tx_wo            ON public.inventory_transactions (wo_id);
CREATE INDEX IF NOT EXISTS idx_inventory_tx_cost_center   ON public.inventory_transactions (cost_center_id);

-- ───────────────────────────────────────────────────────────────
-- 4. Backfill the vocabulary onto history
-- ───────────────────────────────────────────────────────────────
-- The four legacy labels map onto movement types by what else the row
-- carries. ADJUST has no sign in history (adjustInventoryStock wrote
-- abs(delta)), so it cannot be split into gain/loss — it maps to 701 and
-- is flagged below rather than guessed at.
UPDATE public.inventory_transactions SET movement_type =
    CASE
        WHEN transaction_type = 'ISSUE'   AND wo_id IS NOT NULL THEN '261'
        WHEN transaction_type = 'ISSUE'                         THEN '201'
        WHEN transaction_type = 'RECEIPT' AND po_id IS NOT NULL THEN '101'
        WHEN transaction_type = 'RECEIPT'                       THEN '501'
        WHEN transaction_type = 'RETURN'  AND wo_id IS NOT NULL THEN '262'
        WHEN transaction_type = 'RETURN'                        THEN '202'
        ELSE '701'
    END
WHERE movement_type IS NULL;

-- Historical rows are NOT valued or posted retrospectively: cost_at_time is
-- 0 on every adjustment ever written (a documented TODO in the old code),
-- so any value computed for them would be fiction. They keep their type and
-- nothing else. New movements are valued from here on.

-- ───────────────────────────────────────────────────────────────
-- 5. Stamp defaults on every new movement
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ers_movement_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_mt   public.movement_types%ROWTYPE;
    v_sign SMALLINT;
BEGIN
    -- Legacy callers send only transaction_type; derive the type for them so
    -- no write path has to change before it is ready to.
    IF NEW.movement_type IS NULL THEN
        NEW.movement_type := CASE
            WHEN NEW.transaction_type = 'ISSUE'   AND NEW.wo_id IS NOT NULL THEN '261'
            WHEN NEW.transaction_type = 'ISSUE'                             THEN '201'
            WHEN NEW.transaction_type = 'RECEIPT' AND NEW.po_id IS NOT NULL THEN '101'
            WHEN NEW.transaction_type = 'RECEIPT'                           THEN '501'
            WHEN NEW.transaction_type = 'RETURN'  AND NEW.wo_id IS NOT NULL THEN '262'
            WHEN NEW.transaction_type = 'RETURN'                            THEN '202'
            ELSE '701'
        END;
    END IF;

    SELECT * INTO v_mt FROM public.movement_types WHERE code = NEW.movement_type;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'unknown movement type %', NEW.movement_type;
    END IF;

    -- Expense sign: stock leaving is a cost, stock returning is a credit.
    v_sign := CASE v_mt.direction WHEN 'OUT' THEN 1 WHEN 'IN' THEN -1 ELSE 0 END;

    IF NEW.total_value IS NULL THEN
        NEW.total_value := ROUND(ABS(COALESCE(NEW.quantity, 0)) * COALESCE(NEW.cost_at_time, 0) * v_sign, 2);
    END IF;

    -- Account assignment. An order supplies its own receiver; anything else
    -- falls back to the item's cost center.
    IF NEW.cost_center_id IS NULL THEN
        IF NEW.wo_id IS NOT NULL THEN
            SELECT r.cost_center_id INTO NEW.cost_center_id
            FROM public.sem_wo_receiver r WHERE r.work_order_id = NEW.wo_id;
        END IF;
        IF NEW.cost_center_id IS NULL THEN
            SELECT i.cost_center_id INTO NEW.cost_center_id
            FROM public.inventory_items i WHERE i.id = NEW.item_id;
        END IF;
    END IF;

    IF NEW.asset_id IS NULL AND NEW.wo_id IS NOT NULL THEN
        SELECT w.asset_id INTO NEW.asset_id FROM public.work_orders w WHERE w.id = NEW.wo_id;
    END IF;

    IF NEW.gl_account IS NULL THEN
        NEW.gl_account := v_mt.gl_account;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_tx_defaults ON public.inventory_transactions;
CREATE TRIGGER trg_inventory_tx_defaults
    BEFORE INSERT ON public.inventory_transactions
    FOR EACH ROW EXECUTE FUNCTION public.ers_movement_defaults();

-- ───────────────────────────────────────────────────────────────
-- 6. Post the movements that nothing else will post
-- ───────────────────────────────────────────────────────────────
-- Only fi_posting = 'DIRECT'. A 261 is skipped here because settlement owns
-- it — that is the whole double-counting guard, in one WHERE clause.
CREATE OR REPLACE FUNCTION public.ers_movement_post_fi()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_posting TEXT;
    v_alloc   UUID;
BEGIN
    SELECT fi_posting INTO v_posting FROM public.movement_types WHERE code = NEW.movement_type;

    IF v_posting <> 'DIRECT' OR COALESCE(NEW.total_value, 0) = 0 THEN
        RETURN NEW;
    END IF;

    INSERT INTO public.cost_allocations
        (work_order_id, asset_id, cost_center_id, cost_type, amount, quantity, unit,
         posting_date, source, created_by)
    VALUES
        (NEW.wo_id, NEW.asset_id, NEW.cost_center_id, 'MATERIAL', NEW.total_value,
         ABS(COALESCE(NEW.quantity, 0)), NULL, COALESCE(NEW."timestamp"::DATE, CURRENT_DATE),
         'STOCK_MOVEMENT', NEW.performed_by)
    RETURNING id INTO v_alloc;

    UPDATE public.inventory_transactions SET cost_allocation_id = v_alloc WHERE id = NEW.id;

    IF NEW.cost_center_id IS NOT NULL THEN
        PERFORM public.ers_refresh_budget_actual(NEW.cost_center_id);
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_tx_post_fi ON public.inventory_transactions;
CREATE TRIGGER trg_inventory_tx_post_fi
    AFTER INSERT ON public.inventory_transactions
    FOR EACH ROW EXECUTE FUNCTION public.ers_movement_post_fi();

-- ───────────────────────────────────────────────────────────────
-- 7. DECISION (1): material actual = issued parts only
-- ───────────────────────────────────────────────────────────────
-- Redefines the 0244 view. A planned part is a reservation (already netted
-- out of ATP by 0201); only an issued one is cost. Settlement is a delta
-- posting, so an order that settled under the old definition self-corrects
-- on its next run — the correction posts as a negative line, visibly.
CREATE OR REPLACE VIEW public.sem_wo_actual_lines AS
SELECT s.work_order_id,
       s.cost_type,
       s.cost_center_id,
       ROUND(SUM(s.amount), 2)              AS amount,
       NULLIF(ROUND(SUM(s.quantity), 3), 0) AS quantity,
       MAX(s.unit)                          AS unit
FROM (
    SELECT l.wo_id                                           AS work_order_id,
           'LABOR'::TEXT                                     AS cost_type,
           COALESCE(wc.cost_center_id, r.cost_center_id)     AS cost_center_id,
           SUM(COALESCE(l.hours_worked, 0)
               * COALESCE(NULLIF(l.rate_per_hour, 0), t.planned_rate, wc.activity_rate, 0)) AS amount,
           SUM(COALESCE(l.hours_worked, 0))                  AS quantity,
           'H'::TEXT                                         AS unit
    FROM public.work_order_labor l
    JOIN public.job_tasks       t ON t.id = l.job_task_id
    JOIN public.sem_wo_receiver r ON r.work_order_id = l.wo_id
    LEFT JOIN public.work_centers wc ON wc.id = t.work_center_id
    GROUP BY l.wo_id, COALESCE(wc.cost_center_id, r.cost_center_id)

    UNION ALL

    SELECT l.wo_id,
           'LABOR'::TEXT,
           r.cost_center_id,
           SUM(COALESCE(l.hours_worked, 0) * COALESCE(l.rate_per_hour, 0)),
           SUM(COALESCE(l.hours_worked, 0)),
           'H'::TEXT
    FROM public.work_order_labor l
    JOIN public.sem_wo_receiver r ON r.work_order_id = l.wo_id
    WHERE l.job_task_id IS NULL
    GROUP BY l.wo_id, r.cost_center_id

    UNION ALL

    -- ISSUED parts only. is_planned IS NULL is treated as issued: rows that
    -- predate the flag were written when every part row meant consumption.
    SELECT p.wo_id,
           'MATERIAL'::TEXT,
           r.cost_center_id,
           SUM(COALESCE(p.quantity, 0) * COALESCE(p.unit_cost, 0)),
           NULL::NUMERIC,
           NULL::TEXT
    FROM public.work_order_parts p
    JOIN public.sem_wo_receiver r ON r.work_order_id = p.wo_id
    WHERE p.is_planned IS DISTINCT FROM TRUE
    GROUP BY p.wo_id, r.cost_center_id
) s
GROUP BY s.work_order_id, s.cost_type, s.cost_center_id
HAVING ROUND(SUM(s.amount), 2) <> 0;

COMMENT ON VIEW public.sem_wo_actual_lines IS
    'Canonical actual cost per (work order, cost type, receiving cost center). LABOR = confirmed hours x posted rate. MATERIAL = ISSUED parts only (0245) — a planned part is a commitment, not a cost. Mirrors DatabaseService.getOrderActuals; change both together.';

-- ───────────────────────────────────────────────────────────────
-- 8. DECISION (2): preview before you post
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ers_settlement_preview(p_limit INT DEFAULT 500)
RETURNS TABLE (
    work_order_id      UUID,
    wo_number          TEXT,
    actual_cost        NUMERIC,
    settled_cost       NUMERIC,
    would_post         NUMERIC
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT s.work_order_id, s.wo_number, s.actual_cost, s.settled_cost, s.unsettled_variance
    FROM public.sem_wo_settlement s
    WHERE s.wo_state = 'done'
      AND ABS(s.unsettled_variance) >= 0.01
    ORDER BY ABS(s.unsettled_variance) DESC
    LIMIT GREATEST(p_limit, 0);
$$;

COMMENT ON FUNCTION public.ers_settlement_preview(INT) IS
    'Dry run: what ers_settlement_run() would post, largest variance first. Reads only.';

-- Backfill runbook (deliberate, reviewable, resumable):
--   1. SELECT sum(would_post), count(*) FROM ers_settlement_preview(100000);
--   2. SELECT * FROM ers_settlement_preview(50);        -- eyeball the largest
--   3. SELECT * FROM ers_settle_work_order('<one id>'); -- prove one order
--   4. SELECT * FROM ers_settlement_run(100);           -- then batch, repeat
--   Re-running is safe at every step: postings are deltas.

-- ───────────────────────────────────────────────────────────────
-- 9. The movement register
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.sem_stock_movements AS
SELECT t.id                                   AS movement_id,
       t."timestamp"                          AS moved_at,
       t.movement_type,
       mt.name                                AS movement_name,
       mt.direction,
       mt.fi_posting,
       t.item_id,
       i.part_number,
       i.material_number,
       t.location_id,
       t.quantity,
       t.cost_at_time,
       t.total_value,
       t.wo_id,
       t.po_id,
       t.cost_center_id,
       t.asset_id,
       t.gl_account,
       t.cost_allocation_id,
       -- What still owes a financial document, and why it does not have one.
       CASE
           WHEN mt.fi_posting = 'NONE'                             THEN 'stock only'
           WHEN mt.fi_posting = 'VIA_SETTLEMENT'                   THEN 'settles with the order'
           WHEN t.cost_allocation_id IS NOT NULL                   THEN 'posted'
           WHEN COALESCE(t.total_value, 0) = 0                     THEN 'no value'
           ELSE 'unposted'
       END                                    AS fi_status
FROM public.inventory_transactions t
LEFT JOIN public.movement_types  mt ON mt.code = t.movement_type
LEFT JOIN public.inventory_items i  ON i.id    = t.item_id;

COMMENT ON VIEW public.sem_stock_movements IS
    'Every stock movement with its SAP movement type, account assignment, value and financial document. The extract an MM integration reads.';

-- ───────────────────────────────────────────────────────────────
-- 10. Grants + catalog
-- ───────────────────────────────────────────────────────────────
GRANT SELECT ON public.movement_types      TO authenticated, service_role;
GRANT SELECT ON public.sem_stock_movements TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ers_settlement_preview(INT) TO authenticated, service_role;

DELETE FROM public.semantic_catalog
 WHERE object_name = 'sem_stock_movements'
   AND column_name IN ('movement_type', 'total_value', 'fi_status');

INSERT INTO public.semantic_catalog
    (object_name, column_name, title, description, tags, source_tables, iso_standard)
VALUES
    ('sem_stock_movements', 'movement_type', 'Movement type',
     'SAP movement type (BWART) governing the stock direction and account assignment: 101 goods receipt, 201 issue to cost center, 261 issue to order, 311 transfer, 551 scrap, 561 opening balance, 701/702 count gain/loss, and their reversals.',
     ARRAY['inventory', 'finops', 'canonical'], ARRAY['inventory_transactions', 'movement_types'], NULL),
    ('sem_stock_movements', 'total_value', 'Movement value',
     'Quantity x unit cost, signed as expense: positive when stock leaves the store, negative when it comes back. Zero on movements recorded before valuation was captured.',
     ARRAY['inventory', 'finops'], ARRAY['inventory_transactions'], NULL),
    ('sem_stock_movements', 'fi_status', 'Financial posting status',
     'Whether a movement has reached the cost ledger: "posted" (its own document), "settles with the order" (a work-order movement, posted by settlement so it cannot double count), "stock only" (no expense), "no value", or "unposted" — the exception queue.',
     ARRAY['inventory', 'finops', 'kpi'], ARRAY['inventory_transactions', 'cost_allocations'], NULL);

COMMIT;
