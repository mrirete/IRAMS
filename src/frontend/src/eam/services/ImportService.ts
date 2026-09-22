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
import { EXTERNAL_SYSTEM } from './bulkImportService';

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

        // 1. Resolve which assets already exist — by tag OR equipment number.
        //    SAP carries two identities (TechIdentNo. tag + EQUNR equipment
        //    number). A register imported with the tag as its identity keeps
        //    EQUNR in equipment_number; a work-order file that links rows by
        //    EQUNR must still find those assets. So every draft key is tried
        //    against both columns.
        const keys = [...new Set([
            ...applied.assets.map((a) => a.tag),
            ...applied.assets.flatMap((a) => (a.equipment_number ? [a.equipment_number] : [])),
        ])];
        const byTag = new Map<string, string>();
        const byEquipNo = new Map<string, string>();
        for (const part of chunk(keys)) {
            const [t, e] = await Promise.all([
                supabase.from('assets').select('id, tag').in('tag', part),
                supabase.from('assets').select('id, equipment_number').in('equipment_number', part),
            ]);
            if (t.error) throw new Error(`Asset lookup failed: ${t.error.message}`);
            if (e.error) throw new Error(`Asset lookup failed: ${e.error.message}`);
            for (const a of t.data ?? []) byTag.set(a.tag, a.id);
            for (const a of e.data ?? []) if (a.equipment_number) byEquipNo.set(a.equipment_number, a.id);
        }
        const idByTag = new Map<string, string>();
        for (const a of applied.assets) {
            const id = byTag.get(a.tag) ?? byEquipNo.get(a.tag)
                ?? (a.equipment_number ? byEquipNo.get(a.equipment_number) ?? byTag.get(a.equipment_number) : undefined);
            if (id) idByTag.set(a.tag, id);
        }
        const assetsMatched = idByTag.size;
        if (assetsMatched > 0) {
            notes.push(`${assetsMatched} asset(s) already existed (matched by tag or equipment number) — imported history was linked to the existing assets.`);
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
                    // Source CMMS identity (SAP EQUNR). Null lets the trigger
                    // auto-number EQ-NNNNNN as usual (0121).
                    equipment_number: a.equipment_number,
                    criticality: a.criticality ?? 'C',
                    status_code: 'ACTIVE',
                    manufacturer: a.manufacturer,
                    model: a.model,
                    serial_number: a.serial_number,
                    asset_category: a.asset_category,
                    import_batch_id: batchId,
                    properties: {
                        import_batch_id: batchId,
                        // SAP TPLNR path, kept for reference — this importer builds
                        // a flat list; the tree is the Asset Register importer's job.
                        ...(a.functional_location ? { functional_location: a.functional_location } : {}),
                        // Honest about what this is: an asset created to anchor
                        // history, not one placed in the register. The Hierarchy
                        // tab shows it as "placement needed" until someone gives it
                        // a parent (a parent_tag in the file clears it below).
                        ...(a.parent_tag ? {} : { needs_classification: true, classification_source: 'history_import' }),
                    },
                };
            });
            const { data, error } = await supabase.from('assets').insert(rows).select('id, tag');
            if (error) throw new Error(`Asset insert failed: ${error.message}`);
            for (const a of data ?? []) idByTag.set(a.tag, a.id);
        }
        if (defaultedCrit > 0) {
            notes.push(`${defaultedCrit} asset(s) had no criticality in the file — defaulted to C pending a criticality assessment.`);
        }
        const unplaced = newAssets.filter((a) => !a.parent_tag).length;
        if (unplaced > 0) {
            notes.push(`${unplaced} asset(s) were created from history without a parent — they sit at the top of the register flagged "placement needed". Import the register through Assets › Import (hierarchyLevel + parentTag), or set parents in the Asset Register, to place them.`);
        }

        // Keep their ids (0275/0388) — the same rule as the Asset Register
        // importer: a SAP or Maximo export carries the numbers THEIR system
        // knows these assets by. Recorded now, the live link (Integrations)
        // finds them already mapped instead of creating them a second time.
        // A spreadsheet has no stable identity on the other side and is skipped.
        const { data: batch } = await supabase.from('import_batches').select('source_system').eq('id', batchId).maybeSingle();
        const sourceSystem = String((batch as { source_system?: string } | null)?.source_system ?? '');
        if (sourceSystem && sourceSystem !== 'spreadsheet' && sourceSystem !== 'unknown') {
            const pairs = applied.assets
                .map((a) => ({ entity_id: idByTag.get(a.tag), external_key: (a.equipment_number ?? '').trim() }))
                .filter((p) => p.entity_id && p.external_key);
            if (pairs.length > 0) {
                const { data: mapped, error } = await supabase.rpc('ers_map_external_ids', {
                    p_entity_type: 'asset',
                    p_system: EXTERNAL_SYSTEM[sourceSystem] ?? sourceSystem.toUpperCase(),
                    p_pairs: pairs,
                });
                // Advisory: the history is imported either way, and the mapping can be rebuilt from the same file.
                if (error) notes.push(`External ids not recorded (${error.message}) — the import itself is unaffected.`);
                else if (mapped) notes.push(`${mapped} equipment number(s) recorded as ${EXTERNAL_SYSTEM[sourceSystem] ?? sourceSystem} identities — Integrations will recognise these assets as SAP's.`);
            }
        }

        // 2b. Parent links (B9) — second pass, after every row exists, so a
        // parent defined later in the same file (or already in the register)
        // still resolves. Unresolvable parents are reported, never guessed.
        const withParents = applied.assets.filter((a) => a.parent_tag && a.parent_tag !== a.tag);
        if (withParents.length > 0) {
            // The earlier lookup maps only cover keys named in THIS file — a
            // parent that already lives in the register (imported previously,
            // or built in the Asset Register) needs its own batched lookup.
            const parentById = new Map<string, string>();
            const resolveLocal = (t: string) => idByTag.get(t) ?? byTag.get(t) ?? byEquipNo.get(t);
            const missing = [...new Set(withParents.map((a) => a.parent_tag!))]
                .filter((t) => !resolveLocal(t));
            for (const part of chunk(missing)) {
                const { data } = await supabase.from('assets')
                    .select('id, tag, equipment_number')
                    .or(part.map((t) => `tag.eq.${JSON.stringify(t)},equipment_number.eq.${JSON.stringify(t)}`).join(','));
                for (const p of data ?? []) {
                    if (p.tag) parentById.set(p.tag, p.id);
                    if (p.equipment_number) parentById.set(p.equipment_number, p.id);
                }
            }
            let linked = 0;
            const unresolved: string[] = [];
            for (const a of withParents) {
                const childId = idByTag.get(a.tag);
                const parentId = resolveLocal(a.parent_tag!) ?? parentById.get(a.parent_tag!);
                if (!childId) continue;
                if (!parentId) { unresolved.push(a.parent_tag!); continue; }
                const { error } = await supabase.from('assets')
                    .update({ parent_id: parentId }).eq('id', childId);
                if (!error) linked += 1;
            }
            if (linked > 0) notes.push(`${linked} parent link(s) set from the Parent Tag column.`);
            if (unresolved.length > 0) {
                const sample = [...new Set(unresolved)].slice(0, 5).join(', ');
                notes.push(`${unresolved.length} parent reference(s) could not be resolved (${sample}${unresolved.length > 5 ? ', …' : ''}) — those assets imported without a parent; fix the tags and re-import, or set parents in the Asset Register.`);
            }
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
                        // 0283 reliability columns — the true failure-event data.
                        // NULLs stay NULL: "not recorded" is an honest state.
                        actual_duration_hrs: w.labor_hours,
                        breakdown: w.breakdown,
                        malfunction_start: w.malfunction_start,
                        malfunction_end: w.malfunction_end,
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

        // 5. Failure coding sidecar. failure_mode_code is nullable since 0298 —
        // a cause-only source row keeps its cause with a NULL mode instead of
        // the old 'UNKNOWN' pad, which was not a catalog code, decoded to
        // nothing in sem_failure_events, and counted as "coded failure
        // evidence" in isFailure. Genuine nulls keep coverage stats honest.
        for (const part of chunk(failureDrafts, 200)) {
            const rows = part.map(({ wo_id, draft }) => ({
                wo_id,
                failure_mode_code: draft.failure_mode ?? null,
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
     * Remove everything a batch created — one transaction, all or nothing.
     *
     * This used to run six-plus statements straight from the browser with
     * nothing holding them together. Work orders went first and
     * unconditionally, so when an asset was refused (one reading is enough) the
     * orders were already gone, the assets stayed, and the batch still read
     * 'committed'. Half a rollback, and nothing in the record said which half.
     *
     * It is now a single SECURITY DEFINER function (0375). The database decides
     * whether the batch can go, deletes everything or nothing, and hands back
     * what it found. Two things the browser could not do well:
     *
     *   • blockers — there are six NO ACTION references onto assets, and the old
     *     client checked four. A batch held by a maintenance request or a
     *     functional-location link was reported as "refused by a reference
     *     outside this batch", which named nothing.
     *   • collateral — about thirty tables CASCADE from assets, so removing an
     *     imported asset also removes its criticality assessment, RCA
     *     investigations, FMEA worksheets, inspections and warranties. That is
     *     months of engineering, and the old flow destroyed it without a word.
     *
     * `dryRun` computes both and changes nothing, which is what the confirmation
     * dialog is built from.
     */
    public async rollbackBatch(batchId: string, opts: { dryRun?: boolean } = {}): Promise<RollbackOutcome> {
        const { data, error } = await supabase.rpc('rollback_import_batch', {
            p_batch_id: batchId,
            p_dry_run: !!opts.dryRun,
        });
        if (error) {
            // Do NOT fall back to the old unsafe path — a half-rollback is worse
            // than a refusal the operator can act on.
            if (/function .*rollback_import_batch|PGRST202|42883/i.test(`${error.message} ${(error as { code?: string }).code ?? ''}`)) {
                throw new Error('Rollback needs migration 0375 — apply it, then try again. Nothing was changed.');
            }
            throw new Error(`Rollback failed: ${error.message}`);
        }
        const r = (data ?? {}) as Record<string, unknown>;
        const num = (k: string) => Number(r[k] ?? 0) || 0;
        return {
            ok: !!r.ok,
            dryRun: !!r.dry_run,
            workOrdersDeleted: num('work_orders_deleted'),
            assetsDeleted: num('assets_deleted'),
            workOrdersToDelete: num('work_orders_to_delete'),
            assetsToDelete: num('assets_to_delete'),
            blockers: Array.isArray(r.blockers) ? (r.blockers as { tag: string; reason: string }[]) : [],
            collateral: (r.collateral ?? {}) as Record<string, number>,
        };
    }
}

/** What a rollback did, or would do. Mirrors the jsonb from 0375. */
export interface RollbackOutcome {
    /** True when the batch can be, or has been, removed completely. */
    ok: boolean;
    dryRun: boolean;
    workOrdersDeleted: number;
    assetsDeleted: number;
    /** What a real run would remove — populated on a dry run. */
    workOrdersToDelete: number;
    assetsToDelete: number;
    /** Assets that cannot go, and the reference holding each one. */
    blockers: { tag: string; reason: string }[];
    /** Table name → rows that would be destroyed by cascade. Human work only. */
    collateral: Record<string, number>;
}

export const importService = ImportService.getInstance();
