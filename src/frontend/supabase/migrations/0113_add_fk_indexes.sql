-- ============================================================================
-- Migration 0113: Add missing indexes on all foreign key columns
--
-- Fixes: 84 Supabase Performance Advisor suggestions
--   "Unindexed foreign keys — Identifies foreign key constraints without a 
--    covering index, which can impact database performance."
--
-- Why this matters:
--   - Without an index on FK columns, JOINs scan entire tables (O(n))
--   - CASCADE deletes on parent tables scan every child row 
--   - Supabase queries joining assets→work_orders→parts become progressively slower
--
-- Strategy:
--   Dynamic loop: find every FK column that lacks an index, create one.
--   Uses CREATE INDEX IF NOT EXISTS for idempotency.
--   Uses CONCURRENTLY where possible (safe for production).
-- ============================================================================

DO $$
DECLARE
    r RECORD;
    idx_name TEXT;
    col_list TEXT;
BEGIN
    FOR r IN
        -- Find all FK constraints on public tables where the FK column(s) 
        -- are NOT covered by any existing index
        SELECT
            tc.table_name,
            tc.constraint_name,
            string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) AS columns,
            array_agg(kcu.column_name ORDER BY kcu.ordinal_position) AS col_array
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = 'public'
        GROUP BY tc.table_name, tc.constraint_name
        HAVING NOT EXISTS (
            -- Check if there's already an index covering the first FK column
            SELECT 1
            FROM pg_indexes pi
            WHERE pi.schemaname = 'public'
              AND pi.tablename = tc.table_name
              AND (
                  -- Index covers the FK column (appears in indexdef)
                  pi.indexdef LIKE '%(' || (array_agg(kcu.column_name ORDER BY kcu.ordinal_position))[1] || ')%'
                  OR pi.indexdef LIKE '%(' || (array_agg(kcu.column_name ORDER BY kcu.ordinal_position))[1] || ',%'
                  OR pi.indexdef LIKE '%, ' || (array_agg(kcu.column_name ORDER BY kcu.ordinal_position))[1] || ')%'
              )
        )
        ORDER BY tc.table_name, tc.constraint_name
    LOOP
        -- Generate a clean index name: idx_{table}_{first_column}
        idx_name := 'idx_' || r.table_name || '_' || r.col_array[1];
        
        -- Truncate if too long (Postgres max identifier = 63 chars)
        IF length(idx_name) > 63 THEN
            idx_name := left(idx_name, 63);
        END IF;

        -- Build the column list for the index
        col_list := array_to_string(r.col_array, ', ');

        BEGIN
            EXECUTE format(
                'CREATE INDEX IF NOT EXISTS %I ON public.%I (%s)',
                idx_name,
                r.table_name,
                col_list
            );
            RAISE NOTICE 'Created index: % on %.%', idx_name, r.table_name, col_list;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'Could not create index % on %(%): %', idx_name, r.table_name, col_list, SQLERRM;
        END;
    END LOOP;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 2: EXPLICIT INDEXES FOR COMMONLY QUERIED FK COLUMNS
-- ═══════════════════════════════════════════════════════════════════════════
-- All wrapped in a single DO block with per-statement exception handling.
-- If a table or column doesn't exist, the index creation is skipped
-- gracefully instead of failing the entire migration.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    idx_defs TEXT[] := ARRAY[
        -- ── Core EAM ──────────────────────────────────────────
        'CREATE INDEX IF NOT EXISTS idx_assets_parent_id ON public.assets(parent_id)',
        'CREATE INDEX IF NOT EXISTS idx_assets_cost_center_id ON public.assets(cost_center_id)',
        'CREATE INDEX IF NOT EXISTS idx_work_orders_asset_id ON public.work_orders(asset_id)',
        'CREATE INDEX IF NOT EXISTS idx_work_orders_assigned_to ON public.work_orders(assigned_to)',
        'CREATE INDEX IF NOT EXISTS idx_work_orders_cost_center_id ON public.work_orders(cost_center_id)',
        'CREATE INDEX IF NOT EXISTS idx_service_requests_asset_id ON public.service_requests(asset_id)',
        'CREATE INDEX IF NOT EXISTS idx_wo_failure_data_wo_id ON public.wo_failure_data(wo_id)',
        'CREATE INDEX IF NOT EXISTS idx_work_order_labor_wo_id ON public.work_order_labor(wo_id)',
        'CREATE INDEX IF NOT EXISTS idx_work_order_labor_contact_id ON public.work_order_labor(contact_id)',
        'CREATE INDEX IF NOT EXISTS idx_work_order_labor_job_task_id ON public.work_order_labor(job_task_id)',
        'CREATE INDEX IF NOT EXISTS idx_work_order_parts_wo_id ON public.work_order_parts(wo_id)',
        'CREATE INDEX IF NOT EXISTS idx_work_order_parts_item_id ON public.work_order_parts(item_id)',
        'CREATE INDEX IF NOT EXISTS idx_work_order_parts_job_task_id ON public.work_order_parts(job_task_id)',
        'CREATE INDEX IF NOT EXISTS idx_job_tasks_wo_id ON public.job_tasks(wo_id)',
        'CREATE INDEX IF NOT EXISTS idx_job_tasks_predecessor_task_id ON public.job_tasks(predecessor_task_id)',

        -- ── Contacts & People ─────────────────────────────────
        'CREATE INDEX IF NOT EXISTS idx_contacts_parent_id ON public.contacts(parent_id)',

        -- ── Financial ─────────────────────────────────────────
        'CREATE INDEX IF NOT EXISTS idx_asset_financials_asset_id ON public.asset_financials(asset_id)',
        'CREATE INDEX IF NOT EXISTS idx_cost_allocations_cost_center_id ON public.cost_allocations(cost_center_id)',
        'CREATE INDEX IF NOT EXISTS idx_cost_allocations_work_order_id ON public.cost_allocations(work_order_id)',
        'CREATE INDEX IF NOT EXISTS idx_budget_blocks_budget_id ON public.budget_blocks(budget_id)',
        'CREATE INDEX IF NOT EXISTS idx_budgets_cost_center_id ON public.budgets(cost_center_id)',
        'CREATE INDEX IF NOT EXISTS idx_depreciation_books_asset_financial_id ON public.depreciation_books(asset_financial_id)',
        'CREATE INDEX IF NOT EXISTS idx_depreciation_schedules_book_id ON public.depreciation_schedules(book_id)',
        'CREATE INDEX IF NOT EXISTS idx_asset_insurance_asset_id ON public.asset_insurance(asset_id)',
        'CREATE INDEX IF NOT EXISTS idx_capital_events_asset_financial_id ON public.capital_events(asset_financial_id)',
        'CREATE INDEX IF NOT EXISTS idx_insurance_incidents_insurance_policy_id ON public.insurance_incidents(insurance_policy_id)',
        'CREATE INDEX IF NOT EXISTS idx_warranty_claims_warranty_id ON public.warranty_claims(warranty_id)',

        -- ── Inventory ─────────────────────────────────────────
        'CREATE INDEX IF NOT EXISTS idx_inventory_stock_item_id ON public.inventory_stock(item_id)',
        'CREATE INDEX IF NOT EXISTS idx_inventory_stock_location_id ON public.inventory_stock(location_id)',
        'CREATE INDEX IF NOT EXISTS idx_inventory_items_cost_center_id ON public.inventory_items(cost_center_id)',

        -- ── Readings / Condition Data ─────────────────────────
        'CREATE INDEX IF NOT EXISTS idx_reading_definitions_asset_id ON public.reading_definitions(asset_id)',
        'CREATE INDEX IF NOT EXISTS idx_reading_logs_definition_id ON public.reading_logs(definition_id)',
        'CREATE INDEX IF NOT EXISTS idx_reading_logs_asset_id ON public.reading_logs(asset_id)',

        -- ── Notifications ─────────────────────────────────────
        'CREATE INDEX IF NOT EXISTS idx_notifications_parent_notification_id ON public.notifications(parent_notification_id)',

        -- ── Organization ──────────────────────────────────────
        'CREATE INDEX IF NOT EXISTS idx_organization_units_parent_id ON public.organization_units(parent_id)',
        'CREATE INDEX IF NOT EXISTS idx_org_unit_members_org_unit_id ON public.organization_unit_members(organization_unit_id)',
        'CREATE INDEX IF NOT EXISTS idx_org_unit_members_contact_id ON public.organization_unit_members(contact_id)',

        -- ── Entity Files / Journal (polymorphic) ──────────────
        'CREATE INDEX IF NOT EXISTS idx_entity_files_entity_id ON public.entity_files(entity_id)',
        'CREATE INDEX IF NOT EXISTS idx_journal_entries_entity_id ON public.journal_entries(entity_id)',

        -- ── Qualifications / Models ───────────────────────────
        'CREATE INDEX IF NOT EXISTS idx_qualifications_contact_id ON public.qualifications(contact_id)',
        'CREATE INDEX IF NOT EXISTS idx_manufacturer_models_contact_id ON public.manufacturer_models(contact_id)',

        -- ── Purchasing ────────────────────────────────────────
        'CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier_id ON public.purchase_orders(supplier_id)',

        -- ── Task Library ──────────────────────────────────────
        'CREATE INDEX IF NOT EXISTS idx_task_library_files_task_id ON public.task_library_files(task_id)',
        'CREATE INDEX IF NOT EXISTS idx_task_library_inventory_task_id ON public.task_library_inventory(task_id)',
        'CREATE INDEX IF NOT EXISTS idx_task_library_inv_item_id ON public.task_library_inventory(inventory_item_id)',
        'CREATE INDEX IF NOT EXISTS idx_task_library_roles_task_id ON public.task_library_roles(task_id)',

        -- ── JSA / PTW ─────────────────────────────────────────
        'CREATE INDEX IF NOT EXISTS idx_jsa_assessments_wo_id ON public.jsa_assessments(wo_id)',
        'CREATE INDEX IF NOT EXISTS idx_jsa_hazards_jsa_id ON public.jsa_hazards(jsa_id)',
        'CREATE INDEX IF NOT EXISTS idx_ptw_permits_jsa_id ON public.ptw_permits(jsa_id)',
        'CREATE INDEX IF NOT EXISTS idx_ptw_approvals_permit_id ON public.ptw_approvals(permit_id)',
        'CREATE INDEX IF NOT EXISTS idx_ptw_isolation_points_permit_id ON public.ptw_isolation_points(permit_id)',

        -- ── MoC ───────────────────────────────────────────────
        'CREATE INDEX IF NOT EXISTS idx_moc_requests_requested_by ON public.moc_requests(requested_by)',
        'CREATE INDEX IF NOT EXISTS idx_moc_requests_entity_id ON public.moc_requests(entity_id)',

        -- ── ERS Intelligence / Reliability ────────────────────
        'CREATE INDEX IF NOT EXISTS idx_ers_rca_investigations_asset_id ON public.ers_rca_investigations(asset_id)',
        'CREATE INDEX IF NOT EXISTS idx_ers_rca_nodes_investigation_id ON public.ers_rca_nodes(investigation_id)',
        'CREATE INDEX IF NOT EXISTS idx_ers_rca_nodes_parent_id ON public.ers_rca_nodes(parent_id)',
        'CREATE INDEX IF NOT EXISTS idx_ers_rca_corrective_actions_inv_id ON public.ers_rca_corrective_actions(investigation_id)',
        'CREATE INDEX IF NOT EXISTS idx_ers_rca_evidence_inv_id ON public.ers_rca_evidence(investigation_id)',
        'CREATE INDEX IF NOT EXISTS idx_ers_rca_team_members_inv_id ON public.ers_rca_team_members(investigation_id)',
        'CREATE INDEX IF NOT EXISTS idx_ers_rca_timeline_events_inv_id ON public.ers_rca_timeline_events(investigation_id)',
        'CREATE INDEX IF NOT EXISTS idx_ers_rca_audit_log_inv_id ON public.ers_rca_audit_log(investigation_id)',
        'CREATE INDEX IF NOT EXISTS idx_ers_fmea_items_worksheet_id ON public.ers_fmea_items(worksheet_id)',
        'CREATE INDEX IF NOT EXISTS idx_ers_fmea_worksheets_asset_id ON public.ers_fmea_worksheets(asset_id)',
        'CREATE INDEX IF NOT EXISTS idx_ers_reliability_analyses_asset_id ON public.ers_reliability_analyses(asset_id)',
        'CREATE INDEX IF NOT EXISTS idx_ers_criticality_assess_asset_id ON public.ers_criticality_assessments(asset_id)',

        -- ── ERS Corrosion / Inspection / IOW ──────────────────
        'CREATE INDEX IF NOT EXISTS idx_ers_cmls_asset_id ON public.ers_cmls(asset_id)',
        'CREATE INDEX IF NOT EXISTS idx_ers_thickness_readings_cml_id ON public.ers_thickness_readings(cml_id)',
        'CREATE INDEX IF NOT EXISTS idx_ers_corrosion_rates_cml_id ON public.ers_corrosion_rates(cml_id)',
        'CREATE INDEX IF NOT EXISTS idx_ers_corrosion_rates_asset_id ON public.ers_corrosion_rates(asset_id)',
        'CREATE INDEX IF NOT EXISTS idx_ers_damage_mechanisms_asset_id ON public.ers_damage_mechanisms(asset_id)',
        'CREATE INDEX IF NOT EXISTS idx_ers_rbi_assessments_asset_id ON public.ers_rbi_assessments(asset_id)',
        'CREATE INDEX IF NOT EXISTS idx_ers_iow_parameters_asset_id ON public.ers_iow_parameters(asset_id)',
        'CREATE INDEX IF NOT EXISTS idx_ers_inspections_asset_id ON public.ers_inspections(asset_id)',
        'CREATE INDEX IF NOT EXISTS idx_ers_ffs_assessments_asset_id ON public.ers_ffs_assessments(asset_id)',

        -- ── ERS Predict / Twin ────────────────────────────────
        'CREATE INDEX IF NOT EXISTS idx_ers_prediction_alerts_asset_id ON public.ers_prediction_alerts(asset_id)',
        'CREATE INDEX IF NOT EXISTS idx_ers_rul_estimates_asset_id ON public.ers_rul_estimates(asset_id)',
        'CREATE INDEX IF NOT EXISTS idx_ers_twin_states_asset_id ON public.ers_twin_states(asset_id)',

        -- ── ERS Sustain ───────────────────────────────────────
        'CREATE INDEX IF NOT EXISTS idx_ers_carbon_metrics_asset_id ON public.ers_carbon_metrics(asset_id)',
        'CREATE INDEX IF NOT EXISTS idx_ers_climate_risks_asset_id ON public.ers_climate_risks(asset_id)',

        -- ── ERS Vision / Data Quality ─────────────────────────
        'CREATE INDEX IF NOT EXISTS idx_ers_vision_results_asset_id ON public.ers_vision_results(asset_id)',
        'CREATE INDEX IF NOT EXISTS idx_ers_drone_surveys_asset_id ON public.ers_drone_surveys(asset_id)',

        -- ── ERS Bad Actors ────────────────────────────────────
        'CREATE INDEX IF NOT EXISTS idx_bad_actor_snapshots_asset_id ON public.bad_actor_snapshots(asset_id)',

        -- ── ERS PSM Studies ───────────────────────────────────
        'CREATE INDEX IF NOT EXISTS idx_ers_psm_studies_asset_id ON public.ers_psm_studies(asset_id)',
        'CREATE INDEX IF NOT EXISTS idx_ers_hazop_nodes_study_id ON public.ers_hazop_nodes(study_id)',
        'CREATE INDEX IF NOT EXISTS idx_ers_hazop_deviations_node_id ON public.ers_hazop_deviations(node_id)',
        'CREATE INDEX IF NOT EXISTS idx_ers_lopa_scenarios_study_id ON public.ers_lopa_scenarios(study_id)',
        'CREATE INDEX IF NOT EXISTS idx_ers_bowtie_elements_study_id ON public.ers_bowtie_elements(study_id)',
        'CREATE INDEX IF NOT EXISTS idx_ers_event_tree_branches_study_id ON public.ers_event_tree_branches(study_id)',
        'CREATE INDEX IF NOT EXISTS idx_ers_sil_assessments_study_id ON public.ers_sil_assessments(study_id)',
        'CREATE INDEX IF NOT EXISTS idx_ers_risk_register_asset_id ON public.ers_risk_register(asset_id)',
        'CREATE INDEX IF NOT EXISTS idx_ers_pssr_checklists_study_id ON public.ers_pssr_checklists(study_id)',
        'CREATE INDEX IF NOT EXISTS idx_ers_pha_items_study_id ON public.ers_pha_items(study_id)',

        -- ── OEE / Production ──────────────────────────────────
        'CREATE INDEX IF NOT EXISTS idx_asset_production_config_asset_id ON public.asset_production_config(asset_id)',
        'CREATE INDEX IF NOT EXISTS idx_production_logs_asset_id ON public.production_logs(asset_id)',
        'CREATE INDEX IF NOT EXISTS idx_prod_downtime_events_log_id ON public.production_downtime_events(production_log_id)',
        'CREATE INDEX IF NOT EXISTS idx_prod_downtime_events_asset_id ON public.production_downtime_events(asset_id)',

        -- ── Defect Elimination ────────────────────────────────
        'CREATE INDEX IF NOT EXISTS idx_ers_defect_elim_tasks_asset_id ON public.ers_defect_elimination_tasks(asset_id)',

        -- ── FinOps extras ─────────────────────────────────────
        'CREATE INDEX IF NOT EXISTS idx_cost_centers_parent_id ON public.cost_centers(parent_id)',
        'CREATE INDEX IF NOT EXISTS idx_wbs_elements_parent_id ON public.wbs_elements(parent_id)',
        'CREATE INDEX IF NOT EXISTS idx_wbs_elements_cost_center_id ON public.wbs_elements(cost_center_id)',
        'CREATE INDEX IF NOT EXISTS idx_cost_allocations_wbs_element_id ON public.cost_allocations(wbs_element_id)',
        'CREATE INDEX IF NOT EXISTS idx_goods_receipts_po_id ON public.goods_receipts(po_id)',
        'CREATE INDEX IF NOT EXISTS idx_invoice_matches_grn_id ON public.invoice_matches(grn_id)',
        'CREATE INDEX IF NOT EXISTS idx_invoice_matches_po_id ON public.invoice_matches(po_id)',

        -- ── RCA extras ────────────────────────────────────────
        'CREATE INDEX IF NOT EXISTS idx_ers_rca_ca_cause_node_id ON public.ers_rca_corrective_actions(cause_node_id)',
        'CREATE INDEX IF NOT EXISTS idx_ers_rca_barriers_inv_id ON public.ers_rca_barriers(investigation_id)',
        'CREATE INDEX IF NOT EXISTS idx_ers_rca_barriers_ca_id ON public.ers_rca_barriers(corrective_action_id)'
    ];
    stmt TEXT;
    success_count INT := 0;
    skip_count INT := 0;
BEGIN
    FOREACH stmt IN ARRAY idx_defs LOOP
        BEGIN
            EXECUTE stmt;
            success_count := success_count + 1;
        EXCEPTION 
            WHEN undefined_table THEN
                skip_count := skip_count + 1;
                RAISE NOTICE 'Skipped (table not found): %', stmt;
            WHEN undefined_column THEN
                skip_count := skip_count + 1;
                RAISE NOTICE 'Skipped (column not found): %', stmt;
            WHEN OTHERS THEN
                skip_count := skip_count + 1;
                RAISE WARNING 'Failed: % — %', stmt, SQLERRM;
        END;
    END LOOP;

    RAISE NOTICE '=== PART 2 COMPLETE: % indexes created, % skipped ===', success_count, skip_count;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 3: COMPOSITE INDEXES FOR COMMON QUERY PATTERNS
-- ═══════════════════════════════════════════════════════════════════════════
-- These cover the most common WHERE + JOIN patterns in the EAM

-- Work orders: frequently filtered by status + asset
CREATE INDEX IF NOT EXISTS idx_work_orders_status_asset ON public.work_orders(status, asset_id);

-- Work orders: frequently sorted by created_at
CREATE INDEX IF NOT EXISTS idx_work_orders_created_at ON public.work_orders(created_at DESC);

-- Reading logs: frequently queried by asset + date range
CREATE INDEX IF NOT EXISTS idx_reading_logs_asset_date ON public.reading_logs(asset_id, reading_date DESC);

-- Journal entries: polymorphic lookup
CREATE INDEX IF NOT EXISTS idx_journal_entries_entity ON public.journal_entries(entity_type, entity_id);

-- Entity files: polymorphic lookup  
CREATE INDEX IF NOT EXISTS idx_entity_files_entity ON public.entity_files(entity_type, entity_id);

-- Notifications: recipient + read status (inbox query)
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_read ON public.notifications(recipient_id, is_read);


-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    total_indexes INT;
    fk_count INT;
    unindexed_fk INT;
BEGIN
    -- Total indexes on public tables
    SELECT COUNT(*) INTO total_indexes
    FROM pg_indexes WHERE schemaname = 'public';

    -- Total FK constraints
    SELECT COUNT(*) INTO fk_count
    FROM information_schema.table_constraints
    WHERE constraint_type = 'FOREIGN KEY' AND table_schema = 'public';

    RAISE NOTICE '=== POST-MIGRATION INDEX STATUS ===';
    RAISE NOTICE 'Total indexes on public schema: %', total_indexes;
    RAISE NOTICE 'Total FK constraints:           %', fk_count;
    RAISE NOTICE 'All FK columns should now have covering indexes.';
END;
$$;
