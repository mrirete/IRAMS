/**
 * ImportService — persistence edge of the CMMS import pipeline (Specialist
 * Phase 1, migration 0219). The pure transformation lives in
 * src/lib/importPipeline.ts; this service owns the batch lifecycle:
 *
 *   createBatch (draft) → saveMapping (mapped) → commitBatch (committed)
 *   → rollbackBatch (rolled_back)
 *
 * Commit writes REAL rows into assets / work_orders / wo_failure_data, all
 * stamped with import_batch_id. Historical WOs land with their real dates,
 * frozen costs and cost_frozen=true (immutable history — the freeze trigger
 * is BEFORE UPDATE only, so direct inserts are safe).
 */
import { supabase } from '../lib/supabase';
import type { AppliedImport, DqReport, ImportMapping, WoDraft } from '../../lib/importPipeline';

export interface ImportBatch {
    id: string;
    source_system: string;
    file_name: string | null;
    status: 'draft' | 'mapped' | 'committed' | 'rolled_back' | 'failed';
    mapping: ImportMapping | null;
    dq_report: DqReport | null;
    row_counts: { assets?: number; work_orders?: number; failure_rows?: number; skipped?: number } | null;
    created_at: string;
    committed_at: string | null;
}

export interface CommitResult {
    assetsCreated: number;
    assetsMatched: number;   // pre-existing assets linked by tag
    workOrdersCreated: number;
    workOrdersSkipped: number;
    failureRowsCreated: number;
    notes: string[];
}

const CHUNK = 200;

const chunk = <T,>(arr: T[], size = CHUNK): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
};

class ImportService {
    private static instance: ImportService;
    public static getInstance(): ImportService {
        if (!ImportService.instance) ImportService.instance = new ImportService();
        return ImportService.instance;
    }

    public async listBatches(): Promise<ImportBatch[]> {
        const { data, error } = await supabase
            .from('import_batches')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50);
        if (error) {
            console.error('listBatches failed:', error.message);
            return [];
        }
        return (data ?? []) as ImportBatch[];
    }

    public async createBatch(sourceSystem: string, fileName: string): Promise<string> {
        const { data: { user } } = await supabase.auth.getUser();
        const { data, error } = await supabase
            .from('import_batches')
            .insert({
                source_system: sourceSystem || 'unknown',
                file_name: fileName,
                status: 'draft',
                created_by: user?.id ?? null,
            })
            .select('id')
            .single();
        if (error) throw new Error(`Could not create import batch: ${error.message}`);
        return data.id as string;
    }

    public async saveMapping(batchId: string, mapping: ImportMapping): Promise<void> {
        const { error } = await supabase
            .from('import_batches')
            .update({ mapping, status: 'mapped' })
            .eq('id', batchId);
        if (error) throw new Error(`Could not save mapping: ${error.message}`);
    }

    /**
     * Commit the applied import. Existing assets are matched by tag (never
     * duplicated); existing wo_numbers are suffixed to keep the file's history
     * rather than dropping it. Everything created carries import_batch_id.
     */
    public async commitBatch(
        batchId: string,
        applied: AppliedImport,
        dqReport: DqReport,
    ): Promise<CommitResult> {
        const notes: string[] = [];

        // 1. Resolve which asset tags already exist.
        const tags = applied.assets.map((a) => a.tag);
        const idByTag = new Map<string, string>();
        for (const part of chunk(tags)) {
            const { data, error } = await supabase.from('assets').select('id, tag').in('tag', part);
            if (error) throw new Error(`Asset lookup failed: ${error.message}`);
            for (const a of data ?? []) idByTag.set(a.tag, a.id);
        }
        const assetsMatched = idByTag.size;
        if (assetsMatched > 0) {
            notes.push(`${assetsMatched} asset tag(s) already existed — imported history was linked to the existing assets.`);
        }

        // 2. Insert the new assets.
        const newAssets = applied.assets.filter((a) => !idByTag.has(a.tag));
        let defaultedCrit = 0;
        for (const part of chunk(newAssets, 100)) {
            const rows = part.map((a) => {
                if (!a.criticality) defaultedCrit += 1;
                return {
                    tag: a.tag,
                    name: a.name,
                    // TODO: the wizard has no hierarchy columns, so history-derived
                    // assets land flat. Migrate the register via the asset template
                    // (Admin › Migration Center) FIRST and these match by tag instead.
                    hierarchy_level: 'EQUIPMENT',
                    criticality: a.criticality ?? 'C',
                    status_code: 'ACTIVE',
                    manufacturer: a.manufacturer,
                    model: a.model,
                    serial_number: a.serial_number,
                    asset_category: a.asset_category,
                    import_batch_id: batchId,
                    properties: { import_batch_id: batchId },
                };
            });
            const { data, error } = await supabase.from('assets').insert(rows).select('id, tag');
            if (error) throw new Error(`Asset insert failed: ${error.message}`);
            for (const a of data ?? []) idByTag.set(a.tag, a.id);
        }
        if (defaultedCrit > 0) {
            notes.push(`${defaultedCrit} asset(s) had no criticality in the file — defaulted to C pending a criticality assessment.`);
        }

        // 3. Avoid wo_number collisions with existing data (suffix, keep history).
        const woNumbers = applied.workOrders.map((w) => w.wo_number);
        const existingWo = new Set<string>();
        for (const part of chunk(woNumbers)) {
            const { data, error } = await supabase.from('work_orders').select('wo_number').in('wo_number', part);
            if (error) throw new Error(`WO number lookup failed: ${error.message}`);
            for (const w of data ?? []) existingWo.add(w.wo_number);
        }
        if (existingWo.size > 0) {
            notes.push(`${existingWo.size} work-order number(s) already existed — imported copies were suffixed with "-IMP".`);
        }

        // 4. Insert work orders (historical dates, frozen costs, immutable).
        let workOrdersCreated = 0;
        let workOrdersSkipped = 0;
        let failureRowsCreated = 0;
        const failureDrafts: { wo_id: string; draft: WoDraft }[] = [];

        for (const part of chunk(applied.workOrders, 100)) {
            const rows = part
                .filter((w) => {
                    if (!idByTag.has(w.asset_tag)) { workOrdersSkipped += 1; return false; }
                    return true;
                })
                .map((w) => {
                    const closed = w.status === 'CLOSED' || w.status === 'TECO';
                    const woNumber = existingWo.has(w.wo_number) ? `${w.wo_number}-IMP` : w.wo_number;
                    return {
                        wo_number: woNumber,
                        title: w.title,
                        description: w.description,
                        status: w.status,
                        type: w.type,
                        asset_id: idByTag.get(w.asset_tag)!,
                        created_at: w.created_at,
                        closed_at: w.closed_at ?? (closed ? w.created_at : null),
                        frozen_labor_cost: closed ? w.labor_cost : null,
                        frozen_material_cost: closed ? w.material_cost : null,
                        total_actual_cost: w.labor_cost + w.material_cost,
                        cost_frozen: closed,
                        actual_downtime_hrs: w.downtime_hours,
                        created_by: null,
                        import_batch_id: batchId,
                        properties: { import_priority_raw: w.priority, import_source_row: w.source_row },
                    };
                });
            if (rows.length === 0) continue;
            const { data, error } = await supabase.from('work_orders').insert(rows).select('id, wo_number');
            if (error) throw new Error(`Work-order insert failed: ${error.message}`);
            workOrdersCreated += (data ?? []).length;

            // Pair inserted ids back to drafts for failure-coding rows.
            const idByWoNumber = new Map((data ?? []).map((r) => [r.wo_number, r.id]));
            for (const w of part) {
                const num = existingWo.has(w.wo_number) ? `${w.wo_number}-IMP` : w.wo_number;
                const id = idByWoNumber.get(num);
                if (id && (w.failure_mode || w.failure_cause)) failureDrafts.push({ wo_id: id, draft: w });
            }
        }

        // 5. Failure coding sidecar. Only failure_mode_code is NOT NULL (0109
        // dropped the other two), and 'UNKNOWN' is not a catalog code — padding
        // with it produced rows that decode to nothing in sem_failure_events.
        // Genuine nulls keep the coverage statistics honest.
        for (const part of chunk(failureDrafts, 200)) {
            const rows = part.map(({ wo_id, draft }) => ({
                wo_id,
                failure_mode_code: draft.failure_mode ?? 'UNKNOWN',
                failure_cause_code: draft.failure_cause ?? null,
                remedy_code: draft.remedy ?? null,
                comments: 'Imported from foreign CMMS history',
            }));
            const { error } = await supabase.from('wo_failure_data').insert(rows);
            if (error) {
                notes.push(`Failure-coding rows could not be written (${error.message}) — WOs imported without coding.`);
                break;
            }
            failureRowsCreated += rows.length;
        }

        if (workOrdersSkipped > 0) {
            notes.push(`${workOrdersSkipped} work order(s) referenced an asset tag that could not be created — skipped.`);
        }

        // 6. Seal the batch.
        const rowCounts = {
            assets: newAssets.length,
            work_orders: workOrdersCreated,
            failure_rows: failureRowsCreated,
            skipped: applied.skippedRows + workOrdersSkipped,
        };
        const { error: sealErr } = await supabase
            .from('import_batches')
            .update({
                status: 'committed',
                dq_report: dqReport,
                row_counts: rowCounts,
                notes: notes.join(' '),
                committed_at: new Date().toISOString(),
            })
            .eq('id', batchId);
        if (sealErr) console.error('Batch seal failed (data committed):', sealErr.message);

        return {
            assetsCreated: newAssets.length,
            assetsMatched,
            workOrdersCreated,
            workOrdersSkipped,
            failureRowsCreated,
            notes,
        };
    }

    /**
     * Remove everything a batch created. WOs go first (wo_failure_data cascades);
     * assets created by the batch follow — any that gained other references
     * since import are left in place and reported.
     */
    public async rollbackBatch(batchId: string): Promise<{ workOrdersDeleted: number; assetsDeleted: number; assetsKept: number }> {
        const { data: wos, error: woErr } = await supabase
            .from('work_orders')
            .delete()
            .eq('import_batch_id', batchId)
            .select('id');
        if (woErr) throw new Error(`Rollback (work orders) failed: ${woErr.message}`);

        const { data: batchAssets } = await supabase
            .from('assets').select('id').eq('import_batch_id', batchId);
        let assetsDeleted = 0;
        let assetsKept = 0;
        for (const a of batchAssets ?? []) {
            const { error } = await supabase.from('assets').delete().eq('id', a.id);
            if (error) assetsKept += 1; // still referenced elsewhere — keep it
            else assetsDeleted += 1;
        }

        await supabase.from('import_batches')
            .update({ status: 'rolled_back' })
            .eq('id', batchId);

        return { workOrdersDeleted: (wos ?? []).length, assetsDeleted, assetsKept };
    }
}

export const importService = ImportService.getInstance();
