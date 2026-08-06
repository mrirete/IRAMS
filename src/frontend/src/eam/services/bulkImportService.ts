/**
 * bulkImportService — hierarchy-aware bulk import for CMMS migration.
 *
 * Replaces the old per-row `DatabaseService.addAsset` loop, which dropped
 * `parentTag` entirely and never set `hierarchyLevel` — so a legacy category
 * fallback collapsed AREA→SITE, SUBSYSTEM→SYSTEM and everything else→EQUIPMENT,
 * landing every imported asset as a flat root node.
 *
 * What this does instead:
 *   • resolves the level through `hierarchyModel` (the same engine the register,
 *     the numbering trigger and the drag-drop guard obey)
 *   • topologically sorts by parentTag so children can appear above parents,
 *     with cycle detection
 *   • enforces per-level rules (allowed children, mandatory criticality) rather
 *     than defaulting everything to 'C'
 *   • reports every row's fate instead of silently succeeding
 *
 * Writes go straight through supabase (not DatabaseService) so the shape is
 * explicit and auditable; `DatabaseService.addAsset` remains for single-asset
 * creation in the register UI.
 */
import { supabase } from '../lib/supabase';
import {
    getLevelConfig, resolveLevelCode, isValidChild, criticalityRequired,
} from './hierarchyModel';
import { parseDateValue } from './assetTemplates';
import {
    emptyResult, tally, errMessage, isUniqueViolation,
    type ImportResult, type RowOutcome,
} from './importTypes';

/** Assets insert in small chunks: the numbering trigger takes a row lock on
 *  numbering_config for EVERY row, and an AFTER trigger writes an audit row. */
const ASSET_CHUNK = 50;
const LOOKUP_CHUNK = 200;
const READING_CHUNK = 200;

type Row = Record<string, string>;

/** Row number as it appears in the user's spreadsheet. */
const rowNum = (r: Row, fallback: number) => Number(r.__row) || fallback;

const chunk = <T,>(arr: T[], size: number): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
};

/**
 * The `import_batches.source_system` vocabulary → the name the identity map
 * files their ids under. Deliberately coarse: a customer running SAP PM and
 * SAP MM is on ONE system as far as an adapter is concerned, and splitting
 * them would mean two mappings for one vendor.
 */
const EXTERNAL_SYSTEM: Record<string, string> = {
    sap_pm: 'SAP',
    maximo: 'MAXIMO',
    maintainx: 'MAINTAINX',
    emaint: 'EMAINT',
    limble: 'LIMBLE',
    fiix: 'FIIX',
    upkeep: 'UPKEEP',
};

interface ExistingAsset { id: string; tag: string; level?: string; companyId: string | null }

/** Look up assets by tag in chunks (the `.in()` list has practical limits). */
async function fetchAssetsByTag(tags: string[]): Promise<Map<string, ExistingAsset>> {
    const map = new Map<string, ExistingAsset>();
    const unique = [...new Set(tags.filter(Boolean))];
    for (const part of chunk(unique, LOOKUP_CHUNK)) {
        const { data, error } = await supabase
            .from('assets')
            .select('id, tag, hierarchy_level, company_id')
            .in('tag', part);
        if (error) throw new Error(`Asset lookup failed: ${error.message}`);
        for (const a of data ?? []) {
            map.set(String(a.tag).toUpperCase(), {
                id: a.id, tag: a.tag, level: a.hierarchy_level ?? undefined, companyId: a.company_id ?? null,
            });
        }
    }
    return map;
}

// ───────────────────────── Assets ─────────────────────────

interface AssetDraft {
    row: number;
    tag: string;
    parentTag: string;
    level: string;
    data: Row;
}

/**
 * Sync mode: carry a file's changes onto assets that already exist.
 *
 * Only the columns the file actually carries are written. That is the whole
 * difference between this and an upsert: an upsert sends the full row, so
 * every column absent from the sheet would be overwritten with null and a
 * master-data feed carrying tag + manufacturer would quietly erase criticality,
 * serial numbers and cost centres across the register.
 *
 * Never touched, whatever the file says:
 *   tag         the key we matched on
 *   company_id  the tenant — an import must not move a record between customers
 *   parent_id / hierarchy_level
 *               structural, and re-parenting mid-sync would reorder the tree
 *               under work orders that reference it. A hierarchy change is a
 *               deliberate act, not a side effect of a nightly file.
 */
async function applyAssetUpdates(
    targets: { draft: AssetDraft; id: string }[],
    ccByCode: Map<string, string>,
    res: ImportResult,
): Promise<void> {
    for (const { draft, id } of targets) {
        const d = draft.data;
        const patch: Record<string, unknown> = {};
        const set = (col: string, val: unknown) => {
            if (val !== undefined && val !== null && String(val).trim() !== '') patch[col] = val;
        };

        set('name', d['name']);
        set('criticality', (d['criticality'] || '').toUpperCase() || undefined);
        set('status_code', (d['status'] || '').toUpperCase() || undefined);
        set('equipment_number', d['equipmentnumber']);
        set('serial_number', d['serialnumber']);
        set('manufacturer', d['manufacturer']);
        set('model', d['model']);
        set('asset_category', d['assettype']);
        set('asset_type_code', d['assettype']);

        const ccCode = (d['costcenter'] || '').toUpperCase();
        if (ccCode) {
            const ccId = ccByCode.get(ccCode);
            if (ccId) set('cost_center_id', ccId);
            else res.notes!.push(`Cost centre "${d['costcenter']}" not found — row ${draft.row} updated without it.`);
        }

        if (Object.keys(patch).length === 0) {
            tally(res, { row: draft.row, key: draft.tag, status: 'skipped', reason: 'Already present, and the file carried nothing to change' });
            continue;
        }

        const { error } = await supabase.from('assets').update(patch).eq('id', id);
        if (error) {
            tally(res, { row: draft.row, key: draft.tag, status: 'failed', reason: error.message });
        } else {
            tally(res, { row: draft.row, key: draft.tag, status: 'updated' });
        }
    }
}

export async function importAssets(
    rows: Row[],
    opts: {
        withBatch?: boolean;
        /**
         * 'insert' (default) — a one-time migration: rows that already exist
         * are left untouched. 'sync' — a repeatable master-data feed: rows that
         * already exist are updated from the file. Opt-in, because a re-run
         * under the default must never overwrite work done in the app.
         */
        mode?: 'insert' | 'sync';
        /**
         * Which system the file came out of (`import_batches.source_system`
         * vocabulary). Recorded on the batch, and — for anything other than a
         * spreadsheet — used to keep their ids in `erp_object_map` so a later
         * integration starts already mapped.
         */
        sourceSystem?: string;
    } = {},
): Promise<ImportResult> {
    const res = emptyResult();
    if (rows.length === 0) return res;

    // ── 1. Resolve levels; reject what the level model doesn't recognise ──
    const drafts: AssetDraft[] = [];
    const seenTags = new Set<string>();

    rows.forEach((r, i) => {
        const row = rowNum(r, i + 2);
        const tag = (r['tag'] || '').trim();
        const key = tag.toUpperCase();

        if (tag && seenTags.has(key)) {
            tally(res, { row, key: tag, status: 'failed', reason: 'Duplicate tag in this file' });
            return;
        }
        if (tag) seenTags.add(key);

        // Empty strings must become undefined: resolveLevelCode chains with ??,
        // which does NOT fall through on '' — a blank hierarchyLevel column
        // (explicitly allowed by the template) would otherwise block the
        // assetType fallback and fail the row.
        const level = resolveLevelCode({
            hierarchyLevel: (r['hierarchylevel'] || '').trim() || undefined,
            assetType: (r['assettype'] || '').trim() || undefined,
        });
        if (!level) {
            tally(res, {
                row, key: tag, status: 'failed',
                reason: `Unknown hierarchy level "${r['hierarchylevel'] || r['assettype'] || ''}" — see the template's Instructions sheet`,
            });
            return;
        }
        drafts.push({ row, tag, parentTag: (r['parenttag'] || '').trim(), level, data: r });
    });

    if (drafts.length === 0) return res;

    // ── 2. What already exists (own tags + parent tags) ──
    const existing = await fetchAssetsByTag([
        ...drafts.map(d => d.tag),
        ...drafts.map(d => d.parentTag),
    ]);

    const inFile = new Map<string, AssetDraft>();
    const pending: AssetDraft[] = [];
    const toUpdate: { draft: AssetDraft; id: string }[] = [];
    for (const d of drafts) {
        const hit = d.tag ? existing.get(d.tag.toUpperCase()) : undefined;
        if (hit) {
            // A one-time migration leaves what it finds alone; a master-data
            // sync is re-run precisely to carry changes across, so the same
            // row means "update" there and "skip" here. Sync is opt-in for
            // that reason — a re-run under the default must never overwrite
            // work someone did in the app after the first import.
            if (opts.mode === 'sync') {
                toUpdate.push({ draft: d, id: hit.id });
            } else {
                tally(res, { row: d.row, key: d.tag, status: 'skipped', reason: 'Tag already exists — left untouched' });
            }
            // Either way the row is not re-created, and it is a known tag that
            // later rows may legitimately name as their parent.
            if (d.tag) inFile.set(d.tag.toUpperCase(), d);
            continue;
        }
        if (d.tag) inFile.set(d.tag.toUpperCase(), d);
        pending.push(d);
    }

    // ── Cost centres (codes in the sheet → uuid FK) ──
    // Resolved here rather than after the sort because BOTH updates and
    // inserts need it, and a pure sync re-run has nothing to sort.
    const ccByCode = new Map<string, string>();
    if (drafts.some(d => d.data['costcenter'])) {
        const { data } = await supabase.from('cost_centers').select('id, code');
        for (const c of data ?? []) ccByCode.set(String(c.code).toUpperCase(), c.id);
    }

    // Applied before the sort, and before the "nothing to insert" early return
    // below — a re-run where every row already exists is the NORMAL shape of a
    // master-data sync, and returning early would silently do nothing.
    await applyAssetUpdates(toUpdate, ccByCode, res);

    // ── 3. Resolve parents; topological sort (Kahn) ──
    const blocked = new Set<AssetDraft>();
    for (const d of pending) {
        if (!d.parentTag) continue;
        const pk = d.parentTag.toUpperCase();
        if (!existing.has(pk) && !inFile.has(pk)) {
            tally(res, { row: d.row, key: d.tag, status: 'failed', reason: `Parent tag "${d.parentTag}" not found in this file or in ERS` });
            blocked.add(d);
        }
    }

    // Layers, not a flat order: every row in a layer has its in-file parent
    // already INSERTED (in an earlier layer), so a layer can be written as one
    // batch and still know its parent_ids. A flat list chunked at a fixed size
    // could split a parent from its child.
    const sortable = pending.filter(d => !blocked.has(d));
    const layers: AssetDraft[][] = [];
    const placed = new Set<string>();
    let remaining = [...sortable];

    while (remaining.length) {
        const ready = remaining.filter(d => {
            const pk = d.parentTag.toUpperCase();
            return !d.parentTag || !inFile.has(pk) || placed.has(pk);
        });
        if (ready.length === 0) break; // everything left is in a cycle
        layers.push(ready);
        ready.forEach(d => { if (d.tag) placed.add(d.tag.toUpperCase()); });
        const readySet = new Set(ready);
        remaining = remaining.filter(d => !readySet.has(d));
    }
    for (const d of remaining) {
        tally(res, { row: d.row, key: d.tag, status: 'failed', reason: 'Circular parent reference' });
    }
    // No early return when there is nothing to insert: a sync re-run where
    // every row already exists is the normal case, and the identity-map step
    // at the end still has work to do. The insert loops below iterate
    // `layers`, so they no-op on their own.

    // ── 5. Provenance batch (optional — import_batches is admin-only by RLS) ──
    let batchId: string | null = null;
    if (opts.withBatch && layers.length > 0) {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            const { data, error } = await supabase
                .from('import_batches')
                .insert({
                    source_system: opts.sourceSystem || 'spreadsheet',
                    file_name: 'Asset register import',
                    status: 'draft',
                    created_by: user?.id ?? null,
                })
                .select('id')
                .single();
            if (error) throw new Error(error.message);
            batchId = data.id as string;
        } catch (e) {
            res.notes!.push(`Provenance batch not recorded (${errMessage(e)}) — rows still imported, but this run can't be rolled back as a batch.`);
        }
    }

    // ── 6. Insert layer by layer so parent ids exist before children ──
    const idByTag = new Map<string, string>();
    for (const [k, v] of existing) idByTag.set(k, v.id);
    const companyByTag = new Map<string, string | null>();
    for (const [k, v] of existing) companyByTag.set(k, v.companyId);

    // Insert layer by layer; chunk WITHIN a layer (all parents already exist).
    for (const layer of layers) {
      for (const part of chunk(layer, ASSET_CHUNK)) {
        const payload: { draft: AssetDraft; row: Record<string, unknown> }[] = [];

        for (const d of part) {
            const pk = d.parentTag.toUpperCase();
            const parentId = d.parentTag ? idByTag.get(pk) : undefined;

            if (d.parentTag && !parentId) {
                // Parent was expected by now — it must have failed to insert.
                tally(res, { row: d.row, key: d.tag, status: 'failed', reason: `Parent "${d.parentTag}" was not imported, so this row has nowhere to hang` });
                continue;
            }

            const parentLevel = d.parentTag
                ? (existing.get(pk)?.level ?? inFile.get(pk)?.level)
                : undefined;

            if (parentLevel && !isValidChild({ hierarchyLevel: parentLevel }, d.level)) {
                const allowed = getLevelConfig(parentLevel)?.allowedChildCodes ?? [];
                tally(res, {
                    row: d.row, key: d.tag, status: 'failed',
                    reason: `${d.level} cannot sit under ${parentLevel} (allowed: ${allowed.join(', ') || 'none'})`,
                });
                continue;
            }

            const crit = (d.data['criticality'] || '').toUpperCase();
            if (!crit && criticalityRequired({ hierarchyLevel: d.level })) {
                tally(res, { row: d.row, key: d.tag, status: 'failed', reason: `Criticality is required for ${d.level} assets` });
                continue;
            }

            const ccCode = (d.data['costcenter'] || '').toUpperCase();
            const ccId = ccCode ? ccByCode.get(ccCode) : undefined;

            const props: Record<string, unknown> = {};
            if (d.data['department']) props.department = d.data['department'];
            if (d.data['location']) props.location = d.data['location'];
            if (d.data['description']) props.description = d.data['description'];
            if (batchId) props.import_batch_id = batchId;

            payload.push({
                draft: d,
                row: {
                    tag: d.tag || null,                        // blank ⇒ trigger auto-numbers
                    name: d.data['name'] || d.tag,
                    hierarchy_level: d.level,
                    parent_id: parentId ?? null,
                    criticality: crit || null,                 // nullable since 0161
                    status_code: (d.data['status'] || 'ACTIVE').toUpperCase(),
                    equipment_number: d.data['equipmentnumber'] || null,
                    serial_number: d.data['serialnumber'] || null,
                    manufacturer: d.data['manufacturer'] || null,
                    model: d.data['model'] || null,            // no more model←category stuffing
                    asset_category: d.data['assettype'] || null,
                    asset_type_code: d.data['assettype'] || null,
                    cost_center_id: ccId ?? null,
                    // Inherit the parent's company when there is one, and
                    // OMIT the key otherwise — never send an explicit null.
                    //
                    // Since the shared-DB tenancy work, company_id defaults to
                    // caller_company() and every insert policy carries
                    // WITH CHECK (company_id = caller_company()). An explicit
                    // null suppresses the default AND evaluates the check to
                    // NULL, which Postgres treats as a violation — so sending
                    // `company_id: null` does not import an untenanted row, it
                    // refuses the row outright. Every root-level asset went
                    // down that path, which is Migration Center phase 1 and the
                    // first thing a new customer does.
                    ...(d.parentTag && companyByTag.get(pk)
                        ? { company_id: companyByTag.get(pk) }
                        : {}),
                    import_batch_id: batchId,
                    properties: props,
                },
            });

            if (ccCode && !ccId) {
                res.notes!.push(`Cost centre "${d.data['costcenter']}" not found — row ${d.row} imported without it.`);
            }
        }

        if (payload.length === 0) continue;

        const { data, error } = await supabase
            .from('assets')
            .insert(payload.map(p => p.row))
            .select('id, tag, company_id');

        if (error) {
            // Chunk failed as a unit — retry row by row so one bad row doesn't
            // sink 49 good ones.
            for (const p of payload) {
                const { data: one, error: oneErr } = await supabase
                    .from('assets').insert(p.row).select('id, tag, company_id').single();
                if (oneErr) {
                    tally(res, {
                        row: p.draft.row, key: p.draft.tag, status: 'failed',
                        reason: isUniqueViolation(oneErr) ? 'Tag or equipment number already in use' : oneErr.message,
                    });
                } else {
                    idByTag.set(String(one.tag).toUpperCase(), one.id);
                    companyByTag.set(String(one.tag).toUpperCase(), one.company_id ?? null);
                    tally(res, { row: p.draft.row, key: p.draft.tag || one.tag, status: 'inserted' });
                }
            }
            continue;
        }

        const returnedByTag = new Map((data ?? []).map(a => [String(a.tag).toUpperCase(), a]));
        for (const p of payload) {
            const hit = p.draft.tag ? returnedByTag.get(p.draft.tag.toUpperCase()) : undefined;
            if (hit) {
                idByTag.set(String(hit.tag).toUpperCase(), hit.id);
                companyByTag.set(String(hit.tag).toUpperCase(), hit.company_id ?? null);
            }
            tally(res, { row: p.draft.row, key: p.draft.tag || hit?.tag, status: 'inserted' });
        }
      }
    }

    // ── 7. Keep their ids (0275) ──
    // A SAP PM or Maximo export carries the equipment numbers THEIR system
    // knows these assets by. Used only to match a row and then dropped, an
    // integration built later has to rediscover the same mapping by name —
    // which breaks the first time someone renames something. Recorded here,
    // it starts already mapped. A spreadsheet is skipped: hand-keyed rows
    // have no stable identity on the other side to map to.
    if (opts.sourceSystem && opts.sourceSystem !== 'spreadsheet' && opts.sourceSystem !== 'unknown') {
        const pairs = drafts
            .map(d => ({
                entity_id: d.tag ? idByTag.get(d.tag.toUpperCase()) : undefined,
                external_key: (d.data['equipmentnumber'] || '').trim(),
            }))
            .filter(p => p.entity_id && p.external_key);
        if (pairs.length > 0) {
            const { data: mapped, error } = await supabase.rpc('ers_map_external_ids', {
                p_entity_type: 'asset',
                p_system: EXTERNAL_SYSTEM[opts.sourceSystem] ?? opts.sourceSystem.toUpperCase(),
                p_pairs: pairs,
            });
            // Advisory: the rows are imported either way, and the mapping can
            // be rebuilt from the same file. Never fail an import over it.
            if (error) res.notes!.push(`External ids not recorded (${error.message}) — the import itself is unaffected.`);
            else if (mapped) res.notes!.push(`${mapped} external id(s) recorded for ${opts.sourceSystem}.`);
        }
    }

    // ── 8. Seal the batch ──
    if (batchId) {
        await supabase.from('import_batches').update({
            status: 'committed',
            row_counts: { assets: res.inserted, updated: res.updated, skipped: res.skipped + res.failed },
            committed_at: new Date().toISOString(),
        }).eq('id', batchId);
    }

    return res;
}

// ───────────────────────── Bills of materials ─────────────────────────

/**
 * BOM rows → the asset_bom junction table (SAP Material Master parity, 0130).
 *
 * This function exists because the previous BOM import path was a lie: the
 * Assets page wrote `bomItems` through updateAsset, which has not persisted
 * that field since 0130 moved BOM to a table — so the import toasted
 * "Imported N BOM items" and wrote nothing. The engine writes the real table
 * and reports what actually happened, row by row, like every other importer.
 *
 * Resolution follows the 0130 taxonomy: an inventoryCode that matches a
 * material (by part number or material number) links; one that matches
 * nothing becomes a TEXT BOM row — a real component with no material record,
 * promotable later — with a note saying so rather than a silent guess.
 * Re-importing the same file is idempotent: rows already on the asset's BOM
 * (same material, or same part number for text rows) are skipped.
 */
export async function importBoms(rows: Row[]): Promise<ImportResult> {
    const res = emptyResult();
    if (rows.length === 0) return res;

    // ── Resolve the assets the rows hang off ──
    const assets = await fetchAssetsByTag(rows.map(r => r['assettag'] || ''));

    // ── Resolve inventory codes: part number first, then material number ──
    const codes = [...new Set(rows.map(r => (r['inventorycode'] || '').trim().toUpperCase()).filter(Boolean))];
    const itemByCode = new Map<string, { id: string; partNumber: string; description: string; unitCost: number; uom: string }>();
    for (const part of chunk(codes, LOOKUP_CHUNK)) {
        for (const col of ['part_number', 'material_number'] as const) {
            const { data } = await supabase
                .from('inventory_items')
                .select('id, part_number, material_number, description, unit_cost, uom')
                .in(col, part);
            for (const i of data ?? []) {
                const item = {
                    id: i.id, partNumber: i.part_number || '',
                    description: i.description || '', unitCost: Number(i.unit_cost) || 0, uom: i.uom || 'EA',
                };
                if (i.part_number) itemByCode.set(String(i.part_number).toUpperCase(), item);
                if (i.material_number) itemByCode.set(String(i.material_number).toUpperCase(), item);
            }
        }
    }

    // ── What each asset already carries, so a re-import cannot duplicate ──
    const assetIds = [...new Set([...assets.values()].map(a => a.id))];
    const seen = new Set<string>();
    if (assetIds.length > 0) {
        const { data: existing } = await supabase
            .from('asset_bom')
            .select('asset_id, inventory_item_id, part_number')
            .in('asset_id', assetIds);
        for (const b of existing ?? []) {
            if (b.inventory_item_id) seen.add(`${b.asset_id}|inv:${b.inventory_item_id}`);
            if (b.part_number) seen.add(`${b.asset_id}|txt:${String(b.part_number).toUpperCase()}`);
        }
    }

    // ── Build, dedupe (against the DB and within the file), report ──
    const payload: { row: Record<string, unknown>; draft: { row: number; key: string; note?: string } }[] = [];
    rows.forEach((r, i) => {
        const rowNo = rowNum(r, i + 2);
        const tag = (r['assettag'] || '').trim();
        const code = (r['inventorycode'] || '').trim();
        const key = `${tag} → ${code || r['description'] || '?'}`;

        const asset = assets.get(tag.toUpperCase());
        if (!asset) {
            tally(res, { row: rowNo, key, status: 'failed', reason: `Asset tag "${tag}" not found in the register` });
            return;
        }
        if (!code && !(r['description'] || '').trim()) {
            tally(res, { row: rowNo, key, status: 'failed', reason: 'Row carries neither an inventory code nor a description' });
            return;
        }

        const item = code ? itemByCode.get(code.toUpperCase()) : undefined;
        const dupKey = item ? `${asset.id}|inv:${item.id}` : `${asset.id}|txt:${code.toUpperCase()}`;
        if (seen.has(dupKey)) {
            tally(res, { row: rowNo, key, status: 'skipped', reason: 'Already on this asset’s BOM' });
            return;
        }
        seen.add(dupKey);

        payload.push({
            draft: {
                row: rowNo, key,
                note: !item && code ? `"${code}" is not in inventory — added as a text BOM line (promotable to a material later)` : undefined,
            },
            row: {
                asset_id: asset.id,
                inventory_item_id: item?.id ?? null,
                part_number: item?.partNumber || code || null,
                description: (r['description'] || '').trim() || item?.description || code,
                quantity: Number(r['quantity']) || 1,
                uom: (r['uom'] || '').trim() || item?.uom || 'EA',
                is_critical: (r['critical'] || '').toUpperCase() === 'YES',
                estimated_cost: item?.unitCost ?? 0,
                // The 0261 rule, browser edition: inherit the ASSET's tenant so a
                // BOM row can never point across the boundary its parent sits in.
                // Omitted (never null) when unknown, so the column default applies.
                ...(asset.companyId ? { company_id: asset.companyId } : {}),
            },
        });
    });

    // ── Insert in chunks; a failed chunk retries row by row ──
    for (const part of chunk(payload, 50)) {
        const { error } = await supabase.from('asset_bom').insert(part.map(p => p.row));
        if (!error) {
            part.forEach(p => tally(res, { row: p.draft.row, key: p.draft.key, status: 'inserted', reason: p.draft.note }));
            continue;
        }
        for (const p of part) {
            const { error: oneErr } = await supabase.from('asset_bom').insert(p.row);
            tally(res, oneErr
                ? { row: p.draft.row, key: p.draft.key, status: 'failed', reason: oneErr.message }
                : { row: p.draft.row, key: p.draft.key, status: 'inserted', reason: p.draft.note });
        }
    }

    return res;
}

// ───────────────────────── Readings ─────────────────────────

/**
 * Historical meter / condition readings. Reading points (`reading_definitions`)
 * are created on demand — a migration file only carries the log, and requiring
 * the points to exist first would make the import unusable.
 */
export async function importReadings(rows: Row[]): Promise<ImportResult> {
    const res = emptyResult();
    if (rows.length === 0) return res;

    const assets = await fetchAssetsByTag(rows.map(r => r['assettag'] || ''));

    // Existing reading points, keyed asset+type.
    const defByKey = new Map<string, string>();
    const assetIds = [...new Set([...assets.values()].map(a => a.id))];
    for (const part of chunk(assetIds, LOOKUP_CHUNK)) {
        const { data, error } = await supabase
            .from('reading_definitions')
            .select('id, asset_id, reading_type_code')
            .in('asset_id', part);
        if (error) throw new Error(`Reading point lookup failed: ${error.message}`);
        for (const d of data ?? []) defByKey.set(`${d.asset_id}::${d.reading_type_code}`, d.id);
    }

    interface LogDraft { row: number; key: string; log: Record<string, unknown> }
    const drafts: LogDraft[] = [];
    let pointsCreated = 0;

    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const row = rowNum(r, i + 2);
        const tag = (r['assettag'] || '').trim();
        const asset = assets.get(tag.toUpperCase());
        if (!asset) {
            tally(res, { row, key: tag, status: 'failed', reason: `Asset "${tag}" not found — import assets first` });
            continue;
        }

        const type = (r['readingtype'] || '').trim().toUpperCase();
        const date = parseDateValue(r['date']);
        const value = Number(r['value']);
        if (!type) { tally(res, { row, key: tag, status: 'failed', reason: 'Missing readingType' }); continue; }
        if (!date) { tally(res, { row, key: tag, status: 'failed', reason: `Unrecognised date "${r['date']}"` }); continue; }
        if (isNaN(value)) { tally(res, { row, key: tag, status: 'failed', reason: `Value "${r['value']}" is not a number` }); continue; }

        // Find-or-create the reading point.
        const dk = `${asset.id}::${type}`;
        let defId = defByKey.get(dk);
        if (!defId) {
            const { data, error } = await supabase
                .from('reading_definitions')
                .insert({
                    asset_id: asset.id,
                    reading_type_code: type,
                    name: `${type.charAt(0)}${type.slice(1).toLowerCase()} (imported)`,
                    unit: r['unit'] || null,
                })
                .select('id')
                .single();
            if (error) {
                tally(res, { row, key: tag, status: 'failed', reason: `Could not create reading point: ${error.message}` });
                continue;
            }
            defId = data.id as string;
            defByKey.set(dk, defId);
            pointsCreated += 1;
        }

        drafts.push({
            row, key: `${tag} ${type}`,
            log: {
                definition_id: defId,
                asset_id: asset.id,
                reading_type_code: type,
                reading_value: value,
                reading_date: date,
                entered_by: 'import',
                notes: r['notes'] || null,
            },
        });
    }

    for (const part of chunk(drafts, READING_CHUNK)) {
        const { error } = await supabase.from('reading_logs').insert(part.map(d => d.log));
        if (error) {
            for (const d of part) {
                const { error: oneErr } = await supabase.from('reading_logs').insert(d.log);
                if (oneErr) tally(res, { row: d.row, key: d.key, status: 'failed', reason: oneErr.message });
                else tally(res, { row: d.row, key: d.key, status: 'inserted' });
            }
            continue;
        }
        for (const d of part) tally(res, { row: d.row, key: d.key, status: 'inserted' });
    }

    if (pointsCreated > 0) {
        res.notes!.push(`${pointsCreated} reading point${pointsCreated === 1 ? '' : 's'} created automatically. Set alarm limits on each asset's Readings tab.`);
    }
    return res;
}

// ───────────────────── Failure-code catalogs ─────────────────────

/** A code used by imported history that the catalog cannot decode. */
export interface UnresolvedCode { category: string; code: string; uses: number }

/**
 * Every failure code in wo_failure_data that has no catalog entry.
 *
 * These are invisible failures: nothing rejects an unknown code on insert, and
 * the semantic layer LEFT JOINs the catalog, so the record counts as "coded"
 * while decoding to blank. This is what makes coverage statistics lie.
 */
export async function findUnresolvedFailureCodes(): Promise<UnresolvedCode[]> {
    const [{ data: coded }, { data: catalog }] = await Promise.all([
        supabase.from('wo_failure_data').select('failure_mode_code, failure_cause_code, remedy_code'),
        supabase.from('reference_codes_effective').select('category, code'),
    ]);

    const known = new Set((catalog ?? []).map(c => `${c.category}|${c.code}`));
    const counts = new Map<string, UnresolvedCode>();

    const note = (category: string, code: string | null) => {
        const c = (code ?? '').trim();
        if (!c || c.toUpperCase() === 'UNKNOWN') return;
        if (known.has(`${category}|${c}`)) return;
        const key = `${category}|${c}`;
        const hit = counts.get(key);
        if (hit) hit.uses += 1;
        else counts.set(key, { category, code: c, uses: 1 });
    };

    for (const r of coded ?? []) {
        note('FAILURE_MODE', r.failure_mode_code);
        note('FAILURE_CAUSE', r.failure_cause_code);
        note('REMEDY_CODE', r.remedy_code);
    }
    return [...counts.values()].sort((a, b) => b.uses - a.uses || a.code.localeCompare(b.code));
}

/**
 * Load a failure-code catalog. Upserts on (category, code) — the table's own
 * unique key — so re-importing a corrected sheet updates descriptions instead
 * of duplicating codes.
 */
export async function importFailureCodes(rows: Row[]): Promise<ImportResult> {
    const res = emptyResult();
    if (rows.length === 0) return res;

    const unresolvedBefore = await findUnresolvedFailureCodes().catch(() => []);

    const { data: existing } = await supabase.from('reference_codes_effective').select('category, code');
    const known = new Set((existing ?? []).map(c => `${c.category}|${c.code}`));

    interface Draft { row: number; key: string; payload: Record<string, unknown> }
    const drafts: Draft[] = [];

    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const row = rowNum(r, i + 2);
        const category = (r['category'] || '').trim().toUpperCase();
        const code = (r['code'] || '').trim();
        const description = (r['description'] || '').trim();

        if (!category) { tally(res, { row, status: 'failed', reason: 'Missing category' }); continue; }
        if (!code) { tally(res, { row, key: category, status: 'failed', reason: 'Missing code' }); continue; }
        if (!description) { tally(res, { row, key: `${category} ${code}`, status: 'failed', reason: 'Missing description — an undescribed code is no more useful than an uncatalogued one' }); continue; }

        drafts.push({
            row,
            key: `${category} ${code}`,
            payload: {
                category,
                code,
                description,
                active: !['no', 'false', 'n'].includes((r['active'] || 'yes').toLowerCase()),
            },
        });
    }

    for (const part of chunk(drafts, LOOKUP_CHUNK)) {
        const { error } = await supabase
            .from('reference_codes')
            .upsert(part.map(d => d.payload), { onConflict: 'company_id,category,code' });

        if (error) {
            // reference_codes writes are admin-only; say so rather than
            // reporting a bare permission error per row.
            const denied = error.code === '42501';
            for (const d of part) {
                tally(res, {
                    row: d.row, key: d.key, status: 'failed',
                    reason: denied ? 'Administrator rights are required to load a code catalog' : error.message,
                });
            }
            if (denied) break;
            continue;
        }
        for (const d of part) {
            const updated = known.has(`${d.payload.category}|${d.payload.code}`);
            tally(res, {
                row: d.row, key: d.key,
                status: 'inserted',
                reason: updated ? 'description updated' : undefined,
            });
        }
    }

    // What the import actually bought: how much of the existing history now decodes.
    if (res.inserted > 0) {
        const after = await findUnresolvedFailureCodes().catch(() => null);
        if (after) {
            const fixed = unresolvedBefore.length - after.length;
            if (fixed > 0) {
                res.notes!.push(`${fixed} code(s) used by your existing history now resolve.`);
            }
            if (after.length > 0) {
                const top = after.slice(0, 3).map(u => `${u.code} (${u.uses}×)`).join(', ');
                res.notes!.push(`${after.length} code(s) in your history still have no catalog entry — e.g. ${top}.`);
            } else if (unresolvedBefore.length > 0) {
                res.notes!.push('Every failure code in your history now resolves.');
            }
        }
    }

    return res;
}

export const bulkImportService = { importAssets, importReadings, importFailureCodes, findUnresolvedFailureCodes };

// Exported for unit tests — pure ordering logic, no I/O.
export const __testables = { chunk };

export type { ImportResult, RowOutcome };
