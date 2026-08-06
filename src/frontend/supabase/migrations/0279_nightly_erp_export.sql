-- ═══════════════════════════════════════════════════════════════
-- 0279 — The "nightly" in Tier 1 stops meaning "when someone clicks".
--
-- Everything the nightly exchange needs has existed for days except the
-- night itself: the export ran when a human pressed Preview/Download.
-- This migration gives the erp-export edge function what it needs to run
-- unattended:
--
--   1. The three export views gain company_id. The browser never needed
--      it — RLS scoped every read to the caller's tenant invisibly. The
--      edge function runs as service_role, which RLS waves through, so
--      WITHOUT an explicit column to filter on, a per-tenant export would
--      quietly contain every tenant's documents. The column is the
--      difference between "scoped by policy" and "scoped by discipline",
--      and service-role code only gets the second kind.
--
--   2. erp_export_runs — one row per company per nightly run: period,
--      files, document counts, skips, errors. The reconciliation panel
--      reads it; "did last night happen?" should never require reading
--      function logs. Tenant policy hand-written, because the policy
--      sweep has already run and cannot see tables born after it (the
--      movement_type_gl_overrides lesson).
--
--   3. A private storage bucket, erp-exports. Files land under
--      <company_id>/<date>/. No authenticated storage policies on
--      purpose: the files are for the customer's MIDDLEWARE, collected
--      with service credentials or signed URLs — they are not an
--      end-user download surface. The interactive panel keeps its own
--      browser-side download path.
--
--   4. The schedule: 04:30 UTC daily, after the day it exports has ended
--      everywhere the product runs, before the 05:30 watchdog. Follows
--      0223's tenant-portable pattern — url from Vault, the shared
--      x-cron-key — so a fresh tenant project schedules its OWN function.
--
-- Rollback:
--   SELECT cron.unschedule('erp-nightly-export');
--   DROP TABLE IF EXISTS erp_export_runs;
--   (bucket left in place — it may hold delivered files)
--   (views keep company_id; it is additive)
-- ═══════════════════════════════════════════════════════════════
BEGIN;

-- ───────────────────────────────────────────────────────────────
-- 1. company_id on the export views (third rewrite; DROP/CREATE
--    with security_invoker restated — the 0260 lesson)
-- ───────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.sem_stock_movements;

CREATE VIEW public.sem_stock_movements
WITH (security_invoker = true) AS
SELECT t.id                                   AS movement_id,
       t.company_id,
       t."timestamp"                          AS moved_at,
       t.movement_type,
       mt.name                                AS movement_name,
       mt.direction,
       mt.fi_posting,
       t.item_id,
       i.part_number,
       i.material_number,
       t.location_id,
       COALESCE(il.code, il.name)             AS location_code,
       t.quantity,
       t.cost_at_time,
       t.total_value,
       t.wo_id,
       w.wo_number,
       t.po_id,
       p.po_code,
       t.cost_center_id,
       cc.code                                AS cost_center_code,
       t.asset_id,
       a.tag                                  AS asset_tag,
       t.gl_account,
       t.cost_allocation_id,
       CASE
           WHEN mt.fi_posting = 'NONE'                             THEN 'stock only'
           WHEN mt.fi_posting = 'VIA_SETTLEMENT'                   THEN 'settles with the order'
           WHEN t.cost_allocation_id IS NOT NULL                   THEN 'posted'
           WHEN COALESCE(t.total_value, 0) = 0                     THEN 'no value'
           ELSE 'unposted'
       END                                    AS fi_status
FROM public.inventory_transactions t
LEFT JOIN public.movement_types      mt ON mt.code = t.movement_type
LEFT JOIN public.inventory_items     i  ON i.id    = t.item_id
LEFT JOIN public.inventory_locations il ON il.id   = t.location_id
LEFT JOIN public.work_orders         w  ON w.id    = t.wo_id
LEFT JOIN public.purchase_orders     p  ON p.id    = t.po_id
LEFT JOIN public.cost_centers        cc ON cc.id   = t.cost_center_id
LEFT JOIN public.assets              a  ON a.id    = t.asset_id;

COMMENT ON VIEW public.sem_stock_movements IS
    'Every stock movement with its SAP movement type, account assignment, value, financial document and business keys. company_id is for SERVICE-ROLE consumers (the nightly export), which RLS does not scope.';

GRANT SELECT ON public.sem_stock_movements TO authenticated, service_role;

DROP VIEW IF EXISTS public.sem_purchase_order_lines;

CREATE VIEW public.sem_purchase_order_lines
WITH (security_invoker = true) AS
SELECT l.id                                   AS line_id,
       l.company_id,
       l.po_id,
       p.po_code,
       p.status                               AS po_status,
       p.supplier_id,
       v.code                                 AS supplier_code,
       v.name                                 AS supplier_name,
       l.line_no,
       l.line_type,
       l.description,
       l.inventory_id,
       i.part_number,
       i.material_number,
       l.work_order_id,
       w.wo_number,
       l.uom,
       l.qty_ordered,
       l.qty_received,
       GREATEST(l.qty_ordered - l.qty_received, 0) AS qty_outstanding,
       l.unit_cost,
       l.line_total,
       ROUND(l.qty_received * l.unit_cost, 2)  AS received_value,
       l.cost_center_id,
       cc.code                                AS cost_center_code,
       l.gl_account,
       l.invoice_matched,
       l.created_at,
       CASE
           WHEN l.qty_received <= 0                 THEN 'awaiting delivery'
           WHEN l.qty_received < l.qty_ordered      THEN 'part received'
           WHEN l.invoice_matched                   THEN 'invoiced'
           ELSE 'received, awaiting invoice'
       END                                    AS line_status
FROM public.purchase_order_lines l
JOIN public.purchase_orders p ON p.id = l.po_id
LEFT JOIN public.vendors         v  ON v.id  = p.supplier_id
LEFT JOIN public.inventory_items i  ON i.id  = l.inventory_id
LEFT JOIN public.work_orders     w  ON w.id  = l.work_order_id
LEFT JOIN public.cost_centers    cc ON cc.id = l.cost_center_id;

COMMENT ON VIEW public.sem_purchase_order_lines IS
    'PO lines with their order, item, work order, receipt state and business keys. company_id is for service-role consumers, which RLS does not scope.';

GRANT SELECT ON public.sem_purchase_order_lines TO authenticated, service_role;

DROP VIEW IF EXISTS public.sem_invoice_matches;

CREATE VIEW public.sem_invoice_matches
WITH (security_invoker = true) AS
SELECT m.id                       AS invoice_id,
       m.company_id,
       m.invoice_number,
       m.invoice_date,
       m.vendor_id,
       v.code                     AS vendor_code,
       v.name                     AS vendor_name,
       m.po_id,
       p.po_code,
       m.invoice_amount,
       m.currency,
       m.po_amount,
       m.grn_amount,
       m.variance_amount,
       m.match_status,
       m.payment_block,
       m.payment_date IS NOT NULL AS paid,
       m.matched_at,
       (SELECT COUNT(*) FROM public.invoice_match_lines l WHERE l.invoice_id = m.id) AS lines,
       (SELECT COUNT(*) FROM public.invoice_match_lines l
         WHERE l.invoice_id = m.id AND l.line_status = 'BLOCKED')                    AS blocked_lines,
       CASE
           WHEN m.payment_date IS NOT NULL      THEN 'paid'
           WHEN m.match_status = 'BLOCKED'      THEN 'blocked — ' || COALESCE(lower(m.payment_block), 'variance')
           WHEN m.match_status = 'MATCHED'      THEN 'cleared for payment'
           ELSE 'not yet matched'
       END                        AS payables_status
FROM public.invoice_matches m
LEFT JOIN public.vendors         v ON v.id = m.vendor_id
LEFT JOIN public.purchase_orders p ON p.id = m.po_id;

COMMENT ON VIEW public.sem_invoice_matches IS
    'Accounts-payable queue with the three-way verdict and vendor by code. company_id is for service-role consumers, which RLS does not scope.';

GRANT SELECT ON public.sem_invoice_matches TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────
-- 2. The run log
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_export_runs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id    UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    period_from   DATE NOT NULL,
    period_to     DATE NOT NULL,
    status        TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'empty', 'error')),
    documents     INT  NOT NULL DEFAULT 0,
    skipped       INT  NOT NULL DEFAULT 0,
    files         JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{name, rows}]
    error         TEXT,
    triggered_by  TEXT NOT NULL DEFAULT 'cron',          -- 'cron' | 'manual'
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.erp_export_runs IS
    'One row per company per nightly export run. "Did last night happen?" must never require reading function logs.';

CREATE INDEX IF NOT EXISTS idx_erp_export_runs_company
    ON public.erp_export_runs (company_id, created_at DESC);

-- Tenant policy HAND-WRITTEN: this table was born after the policy sweep,
-- and the sweep cannot see it (the movement_type_gl_overrides lesson).
-- Reads are tenant-scoped; writes are the export function's alone.
ALTER TABLE public.erp_export_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "erp_export_runs_read" ON public.erp_export_runs;
CREATE POLICY "erp_export_runs_read" ON public.erp_export_runs
    FOR SELECT TO authenticated
    USING (company_id = (SELECT public.caller_company()));
-- No INSERT/UPDATE/DELETE policies for authenticated: service_role only.

GRANT SELECT ON public.erp_export_runs TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────
-- 3. The bucket (private; middleware collects, users never browse it)
-- ───────────────────────────────────────────────────────────────
DO $$
BEGIN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('erp-exports', 'erp-exports', false)
    ON CONFLICT (id) DO NOTHING;
EXCEPTION WHEN insufficient_privilege THEN
    RAISE WARNING 'erp-exports bucket not created (insufficient privilege) — create it in the dashboard';
END $$;

-- ───────────────────────────────────────────────────────────────
-- 4. The night itself
-- ───────────────────────────────────────────────────────────────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'erp-nightly-export') THEN
        PERFORM cron.unschedule('erp-nightly-export');
    END IF;
END $$;

SELECT cron.schedule(
    'erp-nightly-export',
    '30 4 * * *',  -- daily 04:30 UTC: yesterday has ended everywhere; before the 05:30 watchdog
    $$
    SELECT net.http_post(
        url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
                   || '/functions/v1/erp-export',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-cron-key', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'briefing_cron_key')
        ),
        body    := '{}'::jsonb
    );
    $$
);

COMMIT;
