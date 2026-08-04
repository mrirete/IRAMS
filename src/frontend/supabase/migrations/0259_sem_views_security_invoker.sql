-- ═══════════════════════════════════════════════════════════════
-- 0259 — The semantic views I added bypass RLS. Close it.
--
-- `0183_semantic_layer` set the rule and said why:
--
--     "All views use security_invoker so RLS applies to the QUERYING
--      user — they will keep honoring the Phase-2 RLS hardening
--      instead of bypassing it as owner."
--
-- The views added by 0244–0255 did not follow it. A Postgres view runs
-- with its OWNER's row-level security unless `security_invoker = true`,
-- so every one of these reads its base tables as the owner and returns
-- rows the querying user's policies would have refused.
--
-- Two consequences, one already live:
--
--   NOW — 0246 gated FinOps reads behind caller_can('finops','view').
--   sem_wo_settlement reads cost_allocations, so it hands that data to
--   any authenticated caller regardless of the gate. The gate is real;
--   the view walks around it.
--
--   SOON — the shared-database tenant tier (0258) filters by company_id
--   in RLS. A view that bypasses RLS bypasses tenancy with it, and the
--   semantic layer becomes a cross-tenant read of every object it
--   covers. That is the one failure this product cannot have.
--
-- Nothing else changes. SECURITY DEFINER functions that read these views
-- (ers_settle_work_order, ers_settlement_run) still run as owner and are
-- unaffected — the settlement path keeps working. Service-role callers
-- bypass RLS regardless. Only authenticated reads are now filtered, which
-- is what they were always meant to be, and 0247 deliberately re-opened
-- cost_allocations SELECT for exactly these screens.
--
-- NOT INCLUDED: sem_work_orders (0233), which has the same defect and
-- predates this work. It belongs to the RLS sweep that owns that file, so
-- that one migration changes one team's surface at a time. It should get
-- the same one-line treatment.
--
-- Rollback: ALTER VIEW … SET (security_invoker = false) per view.
-- ═══════════════════════════════════════════════════════════════
BEGIN;

ALTER VIEW public.sem_wo_receiver         SET (security_invoker = true);
ALTER VIEW public.sem_wo_actual_lines     SET (security_invoker = true);
ALTER VIEW public.sem_wo_settlement       SET (security_invoker = true);
ALTER VIEW public.sem_stock_movements     SET (security_invoker = true);
ALTER VIEW public.sem_purchase_order_lines SET (security_invoker = true);
ALTER VIEW public.sem_erp_mapping_health  SET (security_invoker = true);
ALTER VIEW public.sem_invoice_matches     SET (security_invoker = true);

COMMIT;
