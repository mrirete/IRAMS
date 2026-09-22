/**
 * SAP load source — reads the master data the builder maps.
 *
 * Raw table rows, paged past PostgREST's per-request row cap (1000 by default)
 * so a plant with 40k historical readings exports all of them rather than the
 * first page silently. RLS applies as for any page: the caller sees their own
 * tenant's rows and nothing else.
 */
import { supabase } from '../../eam/lib/supabase';
import type { SapLoadSource, SrcSchedule } from './build';

const PAGE = 1000;

async function fetchAll<T>(table: string, select: string, order: string): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
            .from(table)
            .select(select)
            .order(order, { ascending: true })
            .range(from, from + PAGE - 1);
        if (error) throw new Error(`${table}: ${error.message}`);
        const rows = (data ?? []) as unknown as T[];
        out.push(...rows);
        if (rows.length < PAGE) break;
    }
    return out;
}

/** A table that may not exist on every tenant reads as empty rather than failing the export. */
async function fetchOptional<T>(table: string, select: string, order: string): Promise<T[]> {
    try { return await fetchAll<T>(table, select, order); } catch { return []; }
}

/**
 * Columns added by a later migration (0381 / 0382 source identity) may not
 * exist on every tenant. PostgREST rejects the WHOLE select for one unknown
 * column, which would take the entire export down for a missing nice-to-have;
 * so the select is retried without them and the rows come back without those
 * fields.
 */
async function fetchWithOptionalColumns<T>(table: string, select: string, optional: string, order: string): Promise<T[]> {
    try {
        return await fetchAll<T>(table, `${select}, ${optional}`, order);
    } catch (e) {
        if (!/column|does not exist|PGRST/i.test(e instanceof Error ? e.message : String(e))) throw e;
        return fetchAll<T>(table, select, order);
    }
}

export async function loadSapSource(): Promise<SapLoadSource> {
    const [
        assets, assetFinancials, inventoryItems, stock, stores, bomLines,
        readingDefinitions, readingLogs, vendors, costCenters, companies, workCenters,
        workOrders, woFailureData, users, schedules,
    ] = await Promise.all([
        fetchAll<SapLoadSource['assets'][number]>('assets',
            'id, tag, name, parent_id, hierarchy_level, criticality, equipment_number, company_id, cost_center_id, responsible_work_center_id, manufacturer, model, serial_number, asset_class, asset_type_code, status_code, properties',
            'tag'),
        fetchOptional<SapLoadSource['assetFinancials'][number]>('asset_financials', 'asset_id, acquisition_cost, acquisition_date', 'asset_id'),
        fetchAll<SapLoadSource['inventoryItems'][number]>('inventory_items',
            'id, part_number, material_number, description, type, uom, manufacturer, model, min_level, max_level, is_critical, is_active, unit_cost, preferred_vendor_id',
            'part_number'),
        fetchAll<SapLoadSource['stock'][number]>('inventory_stock', 'item_id, location_id, quantity, bin_location', 'item_id'),
        fetchAll<SapLoadSource['stores'][number]>('inventory_locations', 'id, name, code', 'name'),
        fetchAll<SapLoadSource['bomLines'][number]>('asset_bom',
            'id, asset_id, inventory_item_id, part_number, description, quantity, uom, is_critical, notes, created_at',
            'asset_id'),
        fetchWithOptionalColumns<SapLoadSource['readingDefinitions'][number]>('reading_definitions',
            'id, asset_id, reading_type_code, name, unit, category, min_warning, max_warning, min_critical, max_critical, is_active',
            'source_system, source_ref',
            'asset_id'),
        fetchWithOptionalColumns<SapLoadSource['readingLogs'][number]>('reading_logs',
            'id, definition_id, asset_id, reading_type_code, reading_date, reading_time, reading_value, delta, entered_by, comments, is_active',
            'valuation_code, source_system, source_ref',
            'reading_date'),
        fetchOptional<SapLoadSource['vendors'][number]>('vendors', 'id, code, name', 'name'),
        fetchOptional<SapLoadSource['costCenters'][number]>('cost_centers', 'id, code, company_code, controlling_area', 'code'),
        fetchOptional<SapLoadSource['companies'][number]>('companies', 'id, code, name, currency', 'code'),
        fetchOptional<SapLoadSource['workCenters'][number]>('work_centers', 'id, code', 'code'),
        fetchAll<SapLoadSource['workOrders'][number]>('work_orders',
            'id, wo_number, title, description, status, type, priority_code, asset_id, work_center_id, cost_center_id, created_at, closed_at, due_date, date_due_start, frozen_labor_cost, frozen_material_cost, total_actual_cost, actual_downtime_hrs, actual_duration_hrs, breakdown, malfunction_start, malfunction_end, created_by, parent_wo_id',
            'created_at'),
        fetchOptional<SapLoadSource['woFailureData'][number]>('wo_failure_data', 'wo_id, failure_mode_code, failure_cause_code, remedy_code, object_part, caused_by_wo_id', 'wo_id'),
        // Names for "reported by". RLS may hide other users from a non-admin; the field then stays blank.
        fetchOptional<SapLoadSource['users'][number]>('users', 'id, username, email', 'username'),
        // PM schedules with their step templates — what the cockpit export turns
        // into maintenance plans, items and task lists.
        fetchOptional<SrcSchedule>('recurring_work',
            'id, code, title, description, status, active, asset_id, assigned_assets, schedule_type, frequency_interval, frequency_unit, next_due_date, last_generated_date, job_type, priority_code, work_center_id, strategy_package, origin, templates, parent_pm_id, nesting_mode',
            'code'),
    ]);

    return {
        assets, assetFinancials, inventoryItems, stock, stores, bomLines,
        readingDefinitions, readingLogs, vendors, costCenters, companies, workCenters,
        workOrders, woFailureData, users, schedules,
    };
}
